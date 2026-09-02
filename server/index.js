'use strict';
const express=require('express');
const http=require('http');
const WebSocket=require('ws');
const path=require('path');
const {Room}=require('./room');
const {getStats,getLeaderboard,getPeriodLeaderboard,deleteStats,migrateToIds}=require('./stats');
const {getHistory,getGameDetail,deleteHistory,clearAllHistory}=require('./history');
const {listProfiles,createProfile,verifyProfile,deleteProfile,setIcon,getIcon,renameProfile,setCode,setTitle,getTitle,setVoiceTheme,getVoiceTheme,createRememberToken,verifyRememberToken,forgetRememberToken,getId,getNameById,migrateLegacyIds}=require('./profiles');
const friends=require('./friends');
const coins=require('./economy');

// One-time upgrade of both data files from the old name-keyed shape to the
// new stable-id-keyed shape (see profiles.js's migrateLegacyIds and
// stats.js's migrateToIds) — a no-op on every boot after the first. Must
// run before anything else touches either file.
migrateToIds(migrateLegacyIds());

const app=express();
const server=http.createServer(app);
const wss=new WebSocket.Server({server});

// Whitelisted against stats.js's getLeaderboard, which otherwise just does
// (b[sortBy]||0)-(a[sortBy]||0) on whatever field name it's given — an
// unchecked client-supplied sortBy could sort by any field on the row
// object (or silently no-op on a typo) instead of one of the ones the
// Rankings UI actually offers tabs for. Shared by 'get_leaderboard' and
// 'get_player_stats' below — the latter looks up one player's row out of
// the exact same getLeaderboard() call, so it needs the same gate.
const VALID_LEADERBOARD_SORTS=['totalFinalScore','gamesWon','avgPlacement','bestScore','bestHan','handsWon','yakumanCount','dealInRate','bestWinStreak'];

// Whitelisted against stats.js's getPeriodLeaderboard the same reason
// VALID_LEADERBOARD_SORTS gates sortBy above — 'get_period_leaderboard'
// only ever needs to ask for the two periods the Rankings UI's Weekly/
// Monthly tabs actually offer.
const VALID_PERIODS=['week','month'];

// Gates 'create_profile'/'delete_profile' only — everything else
// (unlocking/playing as an existing profile) only ever needs that
// profile's own code, never this.
// Set a real value via the DEV_SECRET env var for any deployment that
// isn't just localhost — the fallback below is fine for local dev only.
const DEV_SECRET=process.env.DEV_SECRET||'changeme';

app.use(express.static(path.join(__dirname,'../public')));

// Detect and clean up dead connections the browser never tells us about.
// Mobile OSes routinely suspend a backgrounded tab's socket without firing
// a close event on either end — the connection just goes silent, `readyState`
// still reports OPEN, and a player can sit there tapping a discard that's
// actually going nowhere (see room.js's removeHuman, which only ever runs
// off a real close event). Standard `ws` library pattern: ping every
// interval, and if a client never answered the PREVIOUS ping with a pong,
// terminate() it — that forces a real close event, so the room correctly
// hands the seat to a bot instead of stalling on a phantom human forever
// (e.g. a pending ron/pon/chi/kan decision that would otherwise never
// resolve — see Room._resolveReactions' humanResponded check).
const HEARTBEAT_INTERVAL_MS=30000;
function markAlive(){ this.isAlive=true; }
const heartbeatTimer=setInterval(()=>{
  wss.clients.forEach((ws)=>{
    if(ws.isAlive===false) return ws.terminate();
    ws.isAlive=false;
    ws.ping();
  });
  // Backstop for activeGames (see below): a normal game deregisters itself
  // via Room.onFinish, and even an abandoned bot-only one plays to
  // completion within a few minutes — but drop anything absurdly old so a
  // wedged room can't leak a resume entry forever.
  const cutoff=Date.now()-2*60*60*1000;
  for(const [id,e] of activeGames) if(e.startedAt<cutoff) activeGames.delete(id);
},HEARTBEAT_INTERVAL_MS);
wss.on('close',()=>clearInterval(heartbeatTimer));

// Every Room still in its 'waiting' phase with at least one real human
// seated lives here, keyed by Room.id — the pool 'list_rooms'/'join_room'
// browse and join into by hand (see the Room List panel). A room leaves
// this map the moment it starts (see the 'ready'/'start_now' handlers
// below) or its last human leaves (see leaveCurrentRoom) — a bot-only room
// isn't worth listing or joining into. 'quick_match' below never touches
// this map at all — it's a standalone instant game against bots, not
// something meant to be found or joined by anyone else.
const openRooms=new Map();

// Every Room that has actually STARTED and not yet finished, keyed by
// Room.id — what a reconnecting client's 'resume' message looks its game up
// in (see the handler below). Includes quick_match games, which openRooms
// never tracks. A Room adds itself here via its onStart hook (set in
// trackGame) and removes itself via onFinish; the heartbeat sweep below is
// a backstop for the rare bot-only game that somehow never ends.
const activeGames=new Map(); // roomId -> { room, startedAt }

// Wire a freshly-constructed Room into activeGames' lifecycle. Called once
// per Room, right after construction, before it can start.
function trackGame(room){
  room.onStart=r=>activeGames.set(r.id,{room:r,startedAt:Date.now()});
  room.onFinish=r=>activeGames.delete(r.id);
}

// Used by 'create_room' — registers the room in openRooms so it's
// immediately browsable/joinable via the Room List.
function createFreshRoom(mode,rules,numPlayers){
  const room=new Room(mode,'normal',rules,numPlayers);
  trackGame(room);
  openRooms.set(room.id,room);
  return room;
}

// Tracks which profile (by profiles.js's stable id) is currently seated in
// which room, across EVERY room — including 'quick_match' ones, which
// (unlike create_room's) never touch openRooms at all. Without this, the
// same profile unlocked on a second device/tab could join the exact same
// room a first connection is already seated in (or any other room while
// still seated somewhere), letting one person control multiple seats at
// once and double-recording that profile's stats/achievements for a
// single game. Guests are deliberately never tracked here — profileId is
// null for all of them, so they'd otherwise all collide with each other.
// Populated right after a profiled player is actually seated (quick_match/
// create_room/join_room below) and cleared in leaveCurrentRoom — the one
// choke point every "this connection is done with myRoom" path (a new
// join, the 'leave' message, and the WebSocket 'close' handler) already
// runs through, so nothing extra needs to hook disconnects separately.
const seatedProfiles=new Map(); // profileId -> {roomId, playerId}

// Every profiled connection currently unlocked ANYWHERE in the lobby or a
// room — not just seated ones (see seatedProfiles above, which only covers
// players actually sitting in a room). This is what Room Invite's player
// picker ('get_online_profiles' below) draws from, and how an invite
// actually reaches the invited player's own socket ('invite_player' below).
// Keyed by profiles.js's stable id; one entry per profile (a second tab/
// device unlocking the same profile just overwrites the previous
// connection's entry here — see goOnline below), storing just enough to
// name them in a picker and reach their live socket. Populated on a
// successful 'unlock_profile'/'unlock_profile_token' (see goOnline) and
// removed on 'select_guest' or connection close (see goOffline) — NOT tied
// to room join/leave, since a player can be online in the lobby without
// ever being seated anywhere.
const onlineProfiles=new Map(); // profileId -> {name, ws, playerId}

// Push a live friend-notification badge count to a profile if it's online
// right now — so a friend request / acceptance bumps the recipient's bell
// badge without them needing to reload. A no-op if they're offline; the
// notification itself is already persisted (see friends.js), so they'll see
// it in the panel next time they connect either way. Mirrors the
// 'room_invite' unicast pattern below — straight to one connection's socket,
// never a broadcast.
function pushFriendBadge(targetId){
  const entry=targetId&&onlineProfiles.get(targetId);
  if(entry&&entry.ws?.readyState===1){
    entry.ws.send(JSON.stringify({type:'friend_notification',unread:friends.unreadCount(targetId)}));
  }
}

// One WebSocket connection = one prospective player. `player` is a plain
// object handed to Room (see room.js) — it stays the same object across
// join/leave/reconnect-to-a-new-room within this connection's lifetime, so
// Room can freely stash extra fields on it (seat, isBot, etc).
wss.on('connection',(ws)=>{
  ws.isAlive=true;
  ws.on('pong',markAlive);
  let myRoom=null;
  const myId=`h-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const player={id:myId,ws,name:'Player',seat:-1,isBot:false};
  // Set only by a successful 'unlock_profile' on THIS connection —
  // 'quick_match'/'create_room'/'join_room'/'get_stats' trust this, never
  // the name in the incoming message, so a
  // client can't just claim someone else's profile name without its code.
  // Lives only in memory for this WebSocket's lifetime ("unlocked for the
  // session" per the design — closing/reloading the tab drops it).
  // unlockedId is the same profile's stable id (see profiles.js) — this is
  // what actually gets attached to a seat (player.profileId, below) and
  // passed into stats.js, since player-stats.json is keyed by id, not by
  // the (renameable) name. unlockedName stays around purely for display/
  // login purposes (player.name, the 'profile_unlocked'/'stats' responses).
  let unlockedName=null;
  let unlockedId=null;

  // Keeps an already-seated player's identity (name/icon/isGuest) in sync
  // when unlockedName changes WHILE still sitting in a waiting-phase room —
  // e.g. joined a Room List room as Guest, then unlocked a real profile
  // without re-joining. Without this, the waiting room (room_update's
  // seats, rendered as the matchmaking slots) keeps showing whatever
  // identity was captured at the original join time forever, even after
  // the profile picker/client-side #iname has already moved on to the real
  // name — and worse, the match would still record this seat as a guest
  // (see room.js's recordGameResult, which skips isGuest seats) even though
  // a real profile got unlocked before the game actually started. Only
  // matters for 'create_room'/'join_room' — 'quick_match' starts the game
  // in the same tick, so there's no window for identity to change under it.
  // Mirrors assignIdentity below. No-op once the
  // room has left 'waiting' (game in progress) — identity shouldn't shift
  // mid-game — or if this connection was never actually seated (seat -1)
  // or has since been replaced (removeHuman swaps in a bot).
  function syncSeatedIdentity(){
    if(!myRoom||myRoom.phase!=='waiting') return;
    if(player.seat<0||myRoom.seats[player.seat]!==player) return;
    if(unlockedName){
      player.name=unlockedName;
      player.icon=getIcon(unlockedName);
      player.voiceTheme=getVoiceTheme(unlockedName);
      player.profileId=unlockedId;
      player.isGuest=false;
    } else {
      player.name='Guest'+Math.floor(1000+Math.random()*9000);
      player.icon='default';
      player.profileId=null;
      player.isGuest=true;
    }
    myRoom.fillBots(); // no seats actually empty — just used for its broadcast
  }

  // Shared by 'quick_match'/'create_room'/'join_room' — all three are "seat
  // this connection somewhere new", just picking that room differently, so
  // they all need the exact same identity-assignment step first. See
  // 'quick_match' below (or syncSeatedIdentity above) for why unlockedName
  // always wins over anything the client claims.
  function assignIdentity(){
    if(unlockedName){
      player.name=unlockedName;
      player.icon=getIcon(unlockedName);
      player.title=getTitle(unlockedName);
      player.voiceTheme=getVoiceTheme(unlockedName);
      player.profileId=unlockedId;
      player.isGuest=false;
    } else {
      player.name='Guest'+Math.floor(1000+Math.random()*9000);
      player.icon='default';
      player.title=null;
      player.profileId=null;
      player.isGuest=true;
    }
  }

  // Shared by 'quick_match'/'create_room'/'join_room' (leaving whatever room this
  // connection was already in before joining a new one) and 'leave'/close
  // below. Beyond removeHuman's own bookkeeping, this also drops the room
  // from openRooms once its last human is gone (still 'waiting', 0 humans
  // left) — a room nobody real is in isn't worth listing or matching new
  // players into, even though removeHuman itself keeps it bot-filled and
  // technically playable. Also releases this connection's seatedProfiles
  // entry, if any — checked against playerId (not just profileId) so a
  // stale call can never accidentally clear a DIFFERENT connection's more
  // recent entry for the same profile.
  function leaveCurrentRoom(){
    if(!myRoom) return;
    if(player.profileId&&seatedProfiles.get(player.profileId)?.playerId===myId) seatedProfiles.delete(player.profileId);
    // This is a deliberate exit (leave button / joining elsewhere), not a
    // dropped connection — so give up the seat's resume slot too, or a
    // stale token could later reclaim a seat the player chose to abandon.
    myRoom.forfeitSeatResume(myId);
    myRoom.removeHuman(myId);
    if(myRoom.phase==='waiting'&&myRoom.humanCount()===0) openRooms.delete(myRoom.id);
    myRoom=null;
  }

  // Marks this connection's unlocked profile as online (see onlineProfiles
  // above) — called right after 'unlock_profile'/'unlock_profile_token'
  // succeed. A no-op for guests (unlockedId is null). Storing `myId`
  // alongside lets goOffline below tell "this connection's own entry" apart
  // from a newer one a second tab/device may have since overwritten it with.
  function goOnline(){
    if(unlockedId) onlineProfiles.set(unlockedId,{name:unlockedName,ws,playerId:myId});
  }
  // Reverse of goOnline — called on 'select_guest' (before the profile is
  // actually cleared, see its handler below) and on connection close.
  // Checked against playerId, same reasoning as leaveCurrentRoom's
  // seatedProfiles cleanup above: a stale call can never clear a DIFFERENT,
  // newer connection's entry for the same profile.
  function goOffline(){
    if(unlockedId&&onlineProfiles.get(unlockedId)?.playerId===myId) onlineProfiles.delete(unlockedId);
  }

  // Called after assignIdentity()+leaveCurrentRoom() but before actually
  // seating this connection anywhere new — true means some OTHER
  // connection already holds this same profile's seat, so the
  // quick_match/create_room/join_room handler below should bail out
  // instead of seating a second copy of the same profile. Always false for
  // guests (player.profileId is null) — see seatedProfiles' own comment
  // for why guests aren't tracked here at all.
  function isProfileSeatedElsewhere(){
    return !!(player.profileId&&seatedProfiles.has(player.profileId));
  }

  // Shared by 'ready' (auto-start once every human is ready) and
  // 'start_now' (explicit) below — either can flip phase away from
  // 'waiting', at which point the room should stop showing up in
  // 'list_rooms' or being joined into via 'join_room'.
  function closeIfStarted(room){
    if(room&&room.phase!=='waiting') openRooms.delete(room.id);
  }

  ws.send(JSON.stringify({type:'hello'}));

  // Message dispatch — each `if` is independent (not else-if), so a
  // malformed message with multiple recognized type-shaped fields could in
  // theory trigger more than one branch; in practice `msg.type` is a single
  // string so only one ever matches. All the actual game logic lives in
  // Room; this file only routes messages to it and never touches game state
  // directly (see room.js for what each message ultimately does).
  ws.on('message',(raw)=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    try{
    // App-level liveness probe, separate from the protocol-level ping/pong
    // heartbeat above: the browser WebSocket API can neither send protocol
    // pings nor observe pongs, so the client can't use that sweep to check
    // its own socket after a background suspend. It sends {type:'ping'} and
    // treats a missing {type:'pong'} as a dead socket worth rebuilding (see
    // probeConnection in script.js). Answer it before anything else and
    // without touching room state.
    if(msg.type==='ping'){ try{ ws.send(JSON.stringify({type:'pong'})); }catch{} return; }
    // "Quick Match" — straight into a game against bots, no waiting room,
    // never listed/joinable by anyone else (see openRooms's comment above).
    // Unlike 'create_room'/'join_room' below this never sits in 'waiting'
    // long enough to matter: addHuman/fillBots/start all run synchronously
    // within this one message handler, so there's no window for another
    // connection's message to interleave and see this room half-built.
    // `instant:true` on the 'joined' reply tells the client to skip the
    // waiting-room screen entirely (see onMsg in script.js) — game_start
    // follows within the same tick anyway, so showing "Looking for
    // players..." first would just be a one-frame flash.
    if(msg.type==='quick_match'){
      // No unlocked profile on this connection? Play as a Guest instead of
      // rejecting the request — guests hold no data at all: recordGameResult
      // (see room.js's _finishGame) skips any seat with isGuest set, so
      // nothing about a guest's play is ever written to player-stats.json,
      // and there's no profile record for their icon/name to live in
      // either. A random per-connection suffix just keeps simultaneous
      // guests visually distinct at the table, not for identity purposes.
      // (See assignIdentity above — shared with create_room/join_room.)
      assignIdentity();
      // Leave any room this connection was already in first — lets the
      // client re-send 'quick_match' to switch game mode or retry without
      // needing a fresh WebSocket connection.
      leaveCurrentRoom();
      // Same profile already seated in some OTHER room (another device/tab
      // that unlocked it) — refuse rather than letting one profile occupy
      // two seats at once. See seatedProfiles' comment above.
      if(isProfileSeatedElsewhere()){
        ws.send(JSON.stringify({type:'error',context:'quick_match',error:'This profile is already in a game on another device.'}));
        return;
      }
      // A logged-in profile's voice theme is server-authoritative (see
      // profiles.getVoiceTheme / 'set_profile_voice_theme'), same as icon
      // and title — the client's msg.voiceTheme is only trusted for guests,
      // who have no profile to persist a choice onto.
      player.voiceTheme=unlockedName?getVoiceTheme(unlockedName):(msg.voiceTheme||'Default').slice(0,30);
      const mode=msg.gameMode==='hanchan'?'hanchan':'tonpuu';
      const numPlayers=msg.variant==='sanma'?3:4;
      // Rule variants — picked once in the lobby, like gameMode.
      const rules={
        akaDora: msg.rules?.akaDora!==false,
        kuitanAri: msg.rules?.kuitanAri!==false,
        doubleRon: msg.rules?.doubleRon!==false,
        nagashiMangan: msg.rules?.nagashiMangan!==false,
        chonbo: msg.rules?.chonbo===true,
      };
      myRoom=new Room(mode,'normal',rules,numPlayers);
      myRoom.matchKind='quick';
      trackGame(myRoom);
      myRoom.addHuman(player);
      if(player.profileId) seatedProfiles.set(player.profileId,{roomId:myRoom.id,playerId:myId});
      // 'joined' must reach the client BEFORE start()'s game_start broadcast
      // below — the client only learns its own seat number from 'joined'
      // (see mySeat in script.js), and startGame()'s seat-rotation math
      // (`(mySeat+i)%numSeats`) needs that to already be set. addHuman above
      // already assigned player.seat, so nothing here depends on
      // fillBots()/start() having run yet — sending this first just fixes
      // the ordering, doesn't need to wait on anything else.
      ws.send(JSON.stringify({type:'joined',seat:player.seat,roomId:myRoom.id,instant:true}));
      myRoom.fillBots();
      myRoom.start();
    }

    // Explicit "Create Room" — always a brand-new room, registered in
    // openRooms (unlike 'quick_match' above, which never is). Shows up in
    // 'list_rooms' for others to join by hand via 'join_room' below — no
    // code to share, rules apply automatically to whoever joins it.
    if(msg.type==='create_room'){
      assignIdentity();
      leaveCurrentRoom();
      // Same profile already seated in some OTHER room — see
      // isProfileSeatedElsewhere's comment (quick_match above).
      if(isProfileSeatedElsewhere()){
        ws.send(JSON.stringify({type:'error',context:'create_room',error:'This profile is already in a game on another device.'}));
        return;
      }
      // A logged-in profile's voice theme is server-authoritative (see
      // profiles.getVoiceTheme / 'set_profile_voice_theme'), same as icon
      // and title — the client's msg.voiceTheme is only trusted for guests,
      // who have no profile to persist a choice onto.
      player.voiceTheme=unlockedName?getVoiceTheme(unlockedName):(msg.voiceTheme||'Default').slice(0,30);
      const mode=msg.gameMode==='hanchan'?'hanchan':'tonpuu';
      const numPlayers=msg.variant==='sanma'?3:4;
      const rules={
        akaDora: msg.rules?.akaDora!==false,
        kuitanAri: msg.rules?.kuitanAri!==false,
        doubleRon: msg.rules?.doubleRon!==false,
        nagashiMangan: msg.rules?.nagashiMangan!==false,
        chonbo: msg.rules?.chonbo===true,
      };
      myRoom=createFreshRoom(mode,rules,numPlayers);
      myRoom.addHuman(player);
      // Marks this connection as the one allowed to trigger a same-room
      // rematch after game_over (see Room.hostStartPlayAgain) — stays the
      // creator's id for the room's whole lifetime; join_room below never
      // overwrites it.
      myRoom.hostId=myId;
      if(player.profileId) seatedProfiles.set(player.profileId,{roomId:myRoom.id,playerId:myId});
      ws.send(JSON.stringify({type:'joined',seat:player.seat,roomId:myRoom.id,gameMode:myRoom.gameMode,numPlayers:myRoom.numPlayers,rules:myRoom.rules,isHost:true}));
    }

    // Join a specific open room by id, picked from 'list_rooms' — the
    // room's own rules apply automatically (the whole point: no need to
    // match toggles by hand or communicate a code). Fails with an error
    // rather than falling back to anything else — the player asked for
    // THIS room specifically.
    if(msg.type==='join_room'){
      const room=openRooms.get(Number(msg.roomId));
      if(!room||room.phase!=='waiting'){
        ws.send(JSON.stringify({type:'join_room_result',ok:false,error:'That room is no longer available.'}));
      } else {
        assignIdentity();
        leaveCurrentRoom();
        // Same profile already seated in some OTHER room — see
        // isProfileSeatedElsewhere's comment (quick_match above).
        if(isProfileSeatedElsewhere()){
          ws.send(JSON.stringify({type:'join_room_result',ok:false,error:'This profile is already in a game on another device.'}));
          return;
        }
        // A logged-in profile's voice theme is server-authoritative (see
      // profiles.getVoiceTheme / 'set_profile_voice_theme'), same as icon
      // and title — the client's msg.voiceTheme is only trusted for guests,
      // who have no profile to persist a choice onto.
      player.voiceTheme=unlockedName?getVoiceTheme(unlockedName):(msg.voiceTheme||'Default').slice(0,30);
        myRoom=room;
        if(!myRoom.addHuman(player)){
          myRoom=null;
          ws.send(JSON.stringify({type:'join_room_result',ok:false,error:'That room is full.'}));
        } else {
          if(player.profileId) seatedProfiles.set(player.profileId,{roomId:myRoom.id,playerId:myId});
          // isHost always false here — joiners never take over the
          // create_room caller's hostId (see its own comment above).
          ws.send(JSON.stringify({type:'joined',seat:player.seat,roomId:myRoom.id,gameMode:myRoom.gameMode,numPlayers:myRoom.numPlayers,rules:myRoom.rules,isHost:false}));
        }
      }
    }

    // Snapshot of every open room, for the Room List panel — icon/name per
    // seat (bots included) is enough to render each room's card without a
    // second round-trip; never includes anything auth-related, same
    // "safe before any code is entered" spirit as 'list_profiles' below.
    if(msg.type==='list_rooms'){
      const rooms=[...openRooms.values()]
        .filter(r=>r.phase==='waiting')
        .map(r=>({
          id: r.id,
          gameMode: r.gameMode,
          numPlayers: r.numPlayers,
          rules: r.rules,
          seats: r.seats.map(p=>p?{name:p.name,icon:p.icon||'default',isBot:!!p.isBot}:null),
        }));
      ws.send(JSON.stringify({type:'room_list',rooms}));
    }

    if(msg.type==='ready'&&myRoom){
      myRoom.setReady(myId);
      closeIfStarted(myRoom);
    }

    if(msg.type==='set_bot_difficulty'&&myRoom) myRoom.setBotDifficulty(myId,Number(msg.seat),msg.difficulty);

    if(msg.type==='start_now'&&myRoom&&myRoom.phase==='waiting'){
      myRoom.fillBots();myRoom.start();
      closeIfStarted(myRoom);
    }

    if(msg.type==='action'&&myRoom) myRoom.action(myId,msg.action);

    // Same-room rematch after game_over — create_room/join_room only (see
    // Room.playAgain's own comment for why quick_match is excluded).
    if(msg.type==='play_again'&&myRoom) myRoom.playAgain(myId);

    // Only the room's creator can actually pull the trigger — Room itself
    // enforces that (returns null for anyone else, or if ineligible), but
    // it can't reach seatedProfiles (this module's own map) to release
    // whichever humans it booted for not voting, so that happens here
    // using the list it hands back.
    if(msg.type==='play_again_start'&&myRoom){
      const booted=myRoom.hostStartPlayAgain(myId);
      if(booted){
        for(const p of booted){
          if(p.ws?.readyState===1) p.ws.send(JSON.stringify({type:'play_again_left_behind'}));
          if(p.profileId&&seatedProfiles.get(p.profileId)?.playerId===p.id) seatedProfiles.delete(p.profileId);
        }
        closeIfStarted(myRoom);
      }
    }

    if(msg.type==='chat'&&myRoom) myRoom.chat(myId,msg.text||'',msg.color);

    if(msg.type==='typing'&&myRoom) myRoom.typing(myId);

    if(msg.type==='emoji_react'&&myRoom) myRoom.emojiReact(myId,msg.emoji);

    if(msg.type==='msg_react'&&myRoom) myRoom.reactToMessage(myId,msg.msgId,msg.emoji);

    if(msg.type==='get_advice'&&myRoom) myRoom.getAdvice(myId);

    if(msg.type==='get_stats'){
      // Uses this connection's own unlocked profile, never msg.name — same
      // reasoning as assignIdentity above, otherwise anyone could read any unlocked
      // profile's stats just by naming it.
      if(unlockedId) ws.send(JSON.stringify({type:'stats',name:unlockedName,stats:getStats(unlockedId)}));
    }

    // Play History list — summary rows only (no round detail, see
    // history.getHistory) for this connection's own unlocked profile, same
    // "trust unlockedId, never msg.name" reasoning as get_stats above.
    if(msg.type==='get_game_history'){
      if(unlockedId) ws.send(JSON.stringify({type:'game_history',games:getHistory(unlockedId)}));
    }

    // One game's full round-by-round detail, fetched on demand when a Play
    // History row is expanded (see history.getGameDetail) — still scoped to
    // this connection's own unlockedId, so a client can't fetch another
    // profile's game detail just by guessing its id.
    if(msg.type==='get_game_history_detail'){
      if(unlockedId){
        const game=getGameDetail(unlockedId,String(msg.gameId||''));
        ws.send(JSON.stringify({type:'game_history_detail',gameId:msg.gameId,game}));
      }
    }

    if(msg.type==='get_leaderboard'){
      const variant=msg.variant==='sanma'?'sanma':'yonma';
      const sortBy=VALID_LEADERBOARD_SORTS.includes(msg.sortBy)?msg.sortBy:'totalFinalScore';
      // getLeaderboard returns {id,...} rows (stats.js has no notion of
      // names) — attach each row's current display name here, the one
      // place id and name actually need to meet for this message.
      const entries=getLeaderboard(sortBy,variant).map(e=>({...e,name:getNameById(e.id)}));
      ws.send(JSON.stringify({type:'leaderboard',variant,sortBy,entries}));
    }

    // Weekly/Monthly Rankings tabs — same shape/gating as get_leaderboard
    // above (see VALID_LEADERBOARD_SORTS), just scoped to the current
    // calendar week/month instead of all time (see stats.js's
    // getPeriodLeaderboard/_periodRange). Its own message type (not an
    // extra param on get_leaderboard) so the two stay independently
    // cacheable/obviously-different on the client, same reasoning
    // 'player_stats' below stays separate from 'stats'.
    if(msg.type==='get_period_leaderboard'){
      const variant=msg.variant==='sanma'?'sanma':'yonma';
      const sortBy=VALID_LEADERBOARD_SORTS.includes(msg.sortBy)?msg.sortBy:'totalFinalScore';
      const period=VALID_PERIODS.includes(msg.period)?msg.period:'week';
      const entries=getPeriodLeaderboard(sortBy,variant,period).map(e=>({...e,name:getNameById(e.id)}));
      ws.send(JSON.stringify({type:'period_leaderboard',variant,sortBy,period,entries}));
    }

    // Rankings "click a name to see their card" feature — keyed by an
    // arbitrary msg.name, unlike get_stats above, deliberately: not a new
    // category of exposure, just the same public leaderboard rows (see
    // get_leaderboard right above) for ONE player instead of everyone.
    // Sends a full SUMMARY — this player's rank+row in every category, for
    // both variants — rather than just whichever one sort tab happened to
    // be active, so the card answers "how do they rank overall" without
    // needing to click through each tab. Reuses getLeaderboard() itself
    // (not getStats()) once per category so every number is exactly what
    // the leaderboard itself would show (same minimum-sample gates, same
    // sort), never a separately-computed value that could drift out of
    // sync with it — VALID_LEADERBOARD_SORTS.length (8) × 2 variants worth
    // of calls, which is cheap at this app's scale (a full in-memory scan
    // of the stats file each time, same as get_leaderboard already does
    // once per open/tab-switch). Each category's `entry` is null if this
    // player doesn't currently qualify for a rank in it (e.g. below the
    // minimum-hands gate for a rate stat) — the client skips/labels those
    // rather than showing a broken row.
    // Sent as its own 'player_stats' type, NOT reusing 'leaderboard' or
    // 'stats' — 'stats' in particular also refreshes the VIEWER's own
    // unlockedThemes/unlockedTitles/achievements/nameplate tier from
    // whatever it's given, so routing another player's data through it
    // would corrupt the viewer's own Voice Theme/Title pickers.
    if(msg.type==='get_player_stats'){
      const name=String(msg.name||'').trim();
      if(!name) return;
      const id=getId(name);
      const summarize=variant=>VALID_LEADERBOARD_SORTS.map(sortBy=>{
        const rows=getLeaderboard(sortBy,variant);
        const idx=rows.findIndex(r=>r.id===id);
        return {sortBy,rank:idx>=0?idx+1:null,entry:idx>=0?rows[idx]:null};
      });
      // Nameplate tier (see nameplateTierClass in script.js) needs this
      // player's own combined win count — the leaderboard-summary rows
      // above don't carry it (a player below a category's ranking minimum
      // still has real wins, they're just not represented in `entry`),
      // so it's pulled straight from their stats record instead.
      const st=getStats(id);
      const wins=(st.yonma.gamesWon||0)+(st.sanma.gamesWon||0);
      // Lifetime headline numbers (games played/won, best single-hand
      // score/han) — shown unconditionally in the card regardless of
      // ranking-category eligibility, unlike the per-category rows above
      // (which are gated behind each category's own minimum-sample rule and
      // simply omitted for a low-sample player). Pulled straight off
      // getStats()'s per-variant view rather than through summarize()/
      // getLeaderboard(), since these are plain lifetime totals, not ranked
      // comparisons.
      const headline=v=>({gamesPlayed:v.gamesPlayed||0,gamesWon:v.gamesWon||0,bestHan:v.bestHan||0,bestScore:v.bestScore||0});
      // Combined-across-both-variants summary for the lightweight in-game
      // nameplate popover (see openPlayerCardInGame/renderPlayerPopover in
      // script.js) — that one deliberately shows a single set of numbers
      // rather than a Sanma/Yonma breakdown, unlike the full Rankings player
      // card above. Deal-in rate computed from summed LIFETIME dealIns/
      // handsWon (not the windowed/"recent form" rate getLeaderboard's rows
      // use) — a quick mid-game glance at an opponent should read as "how
      // careful is this player overall", not their last-100-hands form.
      const dealInHands=(st.yonma.handsWon||0)+(st.yonma.dealIns||0)+(st.sanma.handsWon||0)+(st.sanma.dealIns||0);
      const dealIns=(st.yonma.dealIns||0)+(st.sanma.dealIns||0);
      const combined={
        gamesPlayed:(st.yonma.gamesPlayed||0)+(st.sanma.gamesPlayed||0),
        gamesWon:wins,
        dealInRate:dealInHands>0?(dealIns/dealInHands)*100:null,
        // Best HAN, not best score — the two variants' scores aren't
        // directly comparable (different starting points/seat counts, see
        // stats.js's own comment on why they're kept in separate buckets),
        // but han is scale-free, so the higher of the two variants' bests
        // is a meaningful single number here, unlike a combined bestScore
        // would be.
        bestHan:Math.max(st.yonma.bestHan||0,st.sanma.bestHan||0),
        // Already account-wide (see currentWinStreak on stats.js's
        // _emptyStats) — no summing/maxing across variants needed, unlike
        // the fields above.
        currentWinStreak:st.currentWinStreak||0,
      };
      ws.send(JSON.stringify({
        type:'player_stats',name,icon:getIcon(name),title:getTitle(name),wins,
        yonma:summarize('yonma'),sanma:summarize('sanma'),
        yonmaHeadline:headline(st.yonma),sanmaHeadline:headline(st.sanma),
        combined,
      }));
    }

    if(msg.type==='list_profiles'){
      // {name,icon} pairs — safe to send before any code is entered, never
      // includes salt/codeHash. Powers the profile-picker's icon+name cards.
      ws.send(JSON.stringify({type:'profiles',profiles:listProfiles()}));
    }

    // Room Invite's player picker (see the "Invite Players" link in
    // script.js, used both from the waiting room and from Create Room) —
    // every OTHER known profile (minus this connection's own), each tagged
    // `online`: reachable right now (unlocked somewhere — see
    // onlineProfiles above — AND not already seated in a room, since
    // inviting a busy profile wouldn't be actionable either way). Unlike
    // the old online-only list, profiles that are offline (or just busy)
    // are still included — dimmed and unpickable client-side — rather than
    // silently missing, so a host can see "not online" instead of just not
    // finding a name they expected. Online-first, then alphabetical within
    // each group, so the people you can actually invite right now are
    // always the ones on top.
    if(msg.type==='get_online_profiles'){
      const profiles=listProfiles()
        .filter(p=>p.name!==unlockedName)
        .map(p=>{
          const id=getId(p.name);
          const online=!!(id&&onlineProfiles.has(id)&&!seatedProfiles.has(id));
          return {name:p.name,icon:p.icon,online};
        })
        .sort((a,b)=>(b.online-a.online)||a.name.localeCompare(b.name));
      ws.send(JSON.stringify({type:'online_profiles',profiles}));
    }

    // Host-only — invites one online profile to this connection's own room.
    // Doesn't reserve a seat or touch Room state at all: create_room already
    // registers every room in openRooms, so the invitee could always have
    // found and joined it via the Room List (see join_room below); this
    // just pushes a direct notification to their socket ('room_invite') so
    // they don't have to go browsing for it, with a one-click Join that
    // reuses the exact same join_room path. Mirrors 'achievements_unlocked'
    // in room.js — a direct unicast to one connection's own `ws`, never a
    // room broadcast (nobody else in the room should see who was invited).
    if(msg.type==='invite_player'&&myRoom){
      const targetName=String(msg.name||'').slice(0,20);
      if(myRoom.hostId!==myId||myRoom.phase!=='waiting'){
        ws.send(JSON.stringify({type:'invite_result',ok:false,name:targetName,error:'Only the host can invite players.'}));
        return;
      }
      if(myRoom.humanCount()>=myRoom.numPlayers){
        ws.send(JSON.stringify({type:'invite_result',ok:false,name:targetName,error:'Room is full.'}));
        return;
      }
      const targetId=getId(targetName);
      const online=targetId&&onlineProfiles.get(targetId);
      if(!online||online.ws.readyState!==1){
        ws.send(JSON.stringify({type:'invite_result',ok:false,name:targetName,error:'That player is no longer online.'}));
        return;
      }
      online.ws.send(JSON.stringify({type:'room_invite',roomId:myRoom.id,
        fromName:player.name,fromIcon:player.icon,
        gameMode:myRoom.gameMode,numPlayers:myRoom.numPlayers,rules:myRoom.rules}));
      ws.send(JSON.stringify({type:'invite_result',ok:true,name:targetName}));
    }

    // ── Friends ── all gated on unlockedId (this connection's own unlocked
    // profile), same "trust the session, never a name/id in the message for
    // WHO I am" reasoning as get_stats above. friends.js is the source of
    // truth; these handlers just route to it and unicast a live badge nudge
    // to the other party when they're online.

    // Full friends view for the Friends panel — friends list (each tagged
    // online/busy from this module's own maps), plus pending requests both
    // ways so the panel can show Accept/Decline and "pending" rows.
    if(msg.type==='get_friends'&&unlockedId){
      const tag=row=>({...row,online:onlineProfiles.has(row.id),busy:seatedProfiles.has(row.id)});
      ws.send(JSON.stringify({type:'friends',myId:unlockedId,
        friends:friends.listFriends(unlockedId).map(tag),
        incoming:friends.listIncoming(unlockedId),
        outgoing:friends.listOutgoing(unlockedId)}));
    }

    // Notification panel contents (opened from the bell) + the unread count
    // that drives its badge.
    if(msg.type==='get_notifications'&&unlockedId){
      ws.send(JSON.stringify({type:'notifications',
        items:friends.notifications(unlockedId),unread:friends.unreadCount(unlockedId)}));
    }

    // Marks every notification read — sent when the bell panel is opened.
    if(msg.type==='mark_notifications_read'&&unlockedId){
      friends.markRead(unlockedId);
      ws.send(JSON.stringify({type:'notifications_read',unread:0}));
    }

    // A -> B friend request, by B's 16-digit id (typed into the Friends
    // panel, or read off an opponent's nameplate popover — see friendId in
    // room.js's _seatInfo). friends.sendRequest does all validation and may
    // auto-accept a crossed request.
    if(msg.type==='send_friend_request'&&unlockedId){
      const toId=String(msg.toId||'');
      const r=friends.sendRequest(unlockedId,toId);
      ws.send(JSON.stringify({type:'friend_request_result',...r}));
      if(r.ok) pushFriendBadge(toId);
    }

    if(msg.type==='accept_friend_request'&&unlockedId){
      const fromId=String(msg.fromId||'');
      const r=friends.accept(unlockedId,fromId);
      ws.send(JSON.stringify({type:'friend_action_done',ok:r.ok}));
      if(r.ok) pushFriendBadge(fromId);
    }

    if(msg.type==='decline_friend_request'&&unlockedId){
      friends.decline(unlockedId,String(msg.fromId||''));
      ws.send(JSON.stringify({type:'friend_action_done',ok:true}));
    }

    if(msg.type==='remove_friend'&&unlockedId){
      friends.remove(unlockedId,String(msg.otherId||''));
      ws.send(JSON.stringify({type:'friend_action_done',ok:true}));
    }

    if(msg.type==='unlock_profile'){
      const name=String(msg.name||'').slice(0,20);
      if(verifyProfile(name,msg.code)){
        unlockedName=name;
        unlockedId=getId(name);
        // "Stay logged in" — only issues a token when the client opts in
        // (see #profile-remember's toggle in script.js); the client then
        // stores name+token in localStorage and trades it in via
        // 'unlock_profile_token' on future visits instead of asking for
        // the code again.
        const token=msg.remember?createRememberToken(name):undefined;
        // Daily login bonus — once per UTC day, on either unlock path.
        const daily=coins.claimDailyBonus(unlockedId);
        ws.send(JSON.stringify({type:'profile_unlocked',ok:true,name,icon:getIcon(name),title:getTitle(name),voiceTheme:getVoiceTheme(name),token,id:unlockedId,unread:friends.unreadCount(unlockedId),coins:daily.balance,dailyBonus:daily.granted?daily.amount:0}));
        goOnline();
        syncSeatedIdentity();
      } else {
        ws.send(JSON.stringify({type:'profile_unlocked',ok:false,error:'Incorrect code'}));
      }
    }

    // Silent auto-login from a stored "stay logged in" token (see above) —
    // sent automatically on connect (see script.js's ws.onopen) rather
    // than from a user action, so failures just fall back to the normal
    // picker instead of surfacing an error like a real code attempt would.
    if(msg.type==='unlock_profile_token'){
      const name=String(msg.name||'').slice(0,20);
      if(verifyRememberToken(name,msg.token)){
        unlockedName=name;
        unlockedId=getId(name);
        const daily=coins.claimDailyBonus(unlockedId);
        ws.send(JSON.stringify({type:'profile_unlocked',ok:true,name,icon:getIcon(name),title:getTitle(name),voiceTheme:getVoiceTheme(name),silent:true,id:unlockedId,unread:friends.unreadCount(unlockedId),coins:daily.balance,dailyBonus:daily.granted?daily.amount:0}));
        goOnline();
        syncSeatedIdentity();
      } else {
        ws.send(JSON.stringify({type:'profile_unlocked',ok:false,silent:true}));
      }
    }

    // Explicit "play as Guest" pick from the profile picker — no code
    // needed, just clears any profile this connection had unlocked (if
    // none, this is a no-op). The next quick_match/create_room/join_room then falls into the same
    // Guest-assignment branch above as if nothing had ever been unlocked.
    if(msg.type==='select_guest'){
      goOffline();
      unlockedName=null;
      unlockedId=null;
      ws.send(JSON.stringify({type:'guest_selected'}));
      syncSeatedIdentity();
    }

    // Explicit "forget this device" — sent when the player switches away
    // from a "stay logged in" profile (see selectGuest/selectProfileCard in
    // script.js clearing their stored token) so a token left in this
    // browser's localStorage can't silently auto-login again later.
    if(msg.type==='forget_profile'){
      forgetRememberToken(String(msg.name||'').slice(0,20));
    }

    // Persists an icon change from the User Profile panel onto the profile
    // itself (see profiles.setIcon) — requires this connection to already
    // be unlocked as that name, same as get_stats below; a client can't
    // repaint someone else's profile without their code.
    if(msg.type==='set_profile_icon'&&unlockedName){
      setIcon(unlockedName,msg.icon);
    }

    // Same pattern as set_profile_icon above, for the Title picker in the
    // User Profile panel — but also checked against THIS profile's own
    // earned titles (see stats.getStats/achievements.js's `unlocksTitle`)
    // before calling setTitle, which only knows the overall set of
    // recognized titles (TITLES), not who's actually earned which one. A
    // client could otherwise claim any recognized title without earning it.
    if(msg.type==='set_profile_title'&&unlockedId){
      if(getStats(unlockedId).unlockedTitles.includes(msg.title)){
        setTitle(unlockedName,msg.title);
      }
    }

    // Same pattern again for the Voice Theme picker — cross-checked against
    // this profile's own unlockedThemes (achievements.js's `unlocksTheme`)
    // before setVoiceTheme, which only knows the recognized set. 'Default'
    // is always allowed (it's in every record's unlockedThemes anyway).
    if(msg.type==='set_profile_voice_theme'&&unlockedId){
      if(getStats(unlockedId).unlockedThemes.includes(msg.theme)){
        setVoiceTheme(unlockedName,msg.theme);
      }
    }

    // Owner-only rename, from the User Profile > Change Username panel.
    // Requires the profile's OWN current code, not just an already-unlocked
    // session — unlike set_profile_icon above, this changes login identity,
    // so a stale/hijacked tab shouldn't be able to silently repoint it
    // without knowing the code. renameProfile just flips the `name` field
    // on the record kept under unlockedId (see profiles.js) — the stats
    // record in player-stats.json is keyed by that same id and is never
    // touched, so unlike the old name-keyed scheme there's nothing here
    // that can race a game finishing and lose a stats write.
    if(msg.type==='change_username'&&unlockedName){
      if(!verifyProfile(unlockedName,msg.currentCode)){
        ws.send(JSON.stringify({type:'change_username_result',ok:false,error:'Incorrect code'}));
      } else {
        const result=renameProfile(unlockedName,msg.newName);
        if(result.ok){
          unlockedName=result.name;
          // Keep the online-profiles registry's display name in sync too —
          // otherwise another host's invite picker would keep showing this
          // profile under its old name until they reconnect.
          if(onlineProfiles.get(unlockedId)?.playerId===myId) onlineProfiles.get(unlockedId).name=unlockedName;
        }
        ws.send(JSON.stringify({type:'change_username_result',...result}));
      }
    }

    // Owner-only code change, from the User Profile > Change Key panel.
    // Same current-code gate as change_username above, same reasoning.
    if(msg.type==='change_code'&&unlockedName){
      if(!verifyProfile(unlockedName,msg.currentCode)){
        ws.send(JSON.stringify({type:'change_code_result',ok:false,error:'Incorrect code'}));
      } else {
        // Rotating the code invalidates any "stay logged in" token too —
        // otherwise a token issued under the old code would keep working
        // (e.g. on a device the owner no longer trusts) after the change.
        forgetRememberToken(unlockedName);
        ws.send(JSON.stringify({type:'change_code_result',...setCode(unlockedName,msg.newCode)}));
      }
    }

    // Gate for Developer Settings' own UI (see devpanel-gate in index.html)
    // — a plain check-only version of the create_profile/delete_profile
    // gate below, with no side effect. The client re-sends devSecret on
    // every actual action anyway (create/delete are independently
    // re-checked), so this exists purely so the panel's content can stay
    // hidden until a correct key is entered, without performing an action
    // just to test the key.
    if(msg.type==='verify_dev_key'){
      ws.send(JSON.stringify({type:'dev_key_result',ok:msg.devSecret===DEV_SECRET}));
    }

    // Developer-only — creating a profile needs DEV_SECRET, not any
    // profile's own code. Unrelated to unlockedName; doesn't unlock the
    // new profile for this connection, it just creates it.
    if(msg.type==='create_profile'){
      if(msg.devSecret!==DEV_SECRET){
        ws.send(JSON.stringify({type:'create_profile_result',ok:false,error:'Invalid developer key'}));
      } else {
        ws.send(JSON.stringify({type:'create_profile_result',...createProfile(msg.name,msg.code)}));
      }
    }

    // Developer-only, same gate as create_profile. Also clears the deleted
    // profile's stats/achievements (see stats.deleteStats, keyed by the id
    // deleteProfile hands back) so a later profile recreated under the same
    // name starts clean rather than inheriting them — it gets a brand-new
    // id, so it could never see the old stats record even if this were
    // skipped, but leaving it behind would just be an orphaned row.
    if(msg.type==='delete_profile'){
      if(msg.devSecret!==DEV_SECRET){
        ws.send(JSON.stringify({type:'delete_profile_result',ok:false,error:'Invalid developer key'}));
      } else {
        const result=deleteProfile(msg.name);
        if(result.ok){ deleteStats(result.id); deleteHistory(result.id); friends.purge(result.id); coins.purge(result.id); }
        ws.send(JSON.stringify({type:'delete_profile_result',ok:result.ok,error:result.error}));
      }
    }

    // Developer-only, same DEV_SECRET gate as create/delete_profile —
    // wipes EVERY profile's play history in one shot (see
    // history.clearAllHistory). Deliberately independent of delete_profile:
    // this clears game-history.json only, leaving every profile/stats
    // record untouched, for a "reset what Play History shows" tool rather
    // than a "remove these players" one.
    if(msg.type==='clear_all_history'){
      if(msg.devSecret!==DEV_SECRET){
        ws.send(JSON.stringify({type:'clear_all_history_result',ok:false,error:'Invalid developer key'}));
      } else {
        clearAllHistory();
        ws.send(JSON.stringify({type:'clear_all_history_result',ok:true}));
      }
    }

    if(msg.type==='leave'){
      leaveCurrentRoom();
    }

    // Reconnect into a game this client was dropped from (phone app-switch,
    // tab suspend, flaky network — see the heartbeat/disconnectHuman path).
    // The client re-sends {roomId, seat, resumeToken} it stashed at
    // game_start; reclaimSeat verifies the token and swaps this connection
    // back into that seat (from the grace-held human placeholder, or the
    // bot that replaced it). On any mismatch — game already over, server
    // restarted, wrong token — tell the client so it can drop back to the
    // lobby instead of sitting on a dead board.
    if(msg.type==='resume'){
      const entry=activeGames.get(Number(msg.roomId));
      const room=entry&&entry.room;
      const seat=Number(msg.seat);
      if(!room||!Number.isInteger(seat)||!room.reclaimSeat(seat,player,String(msg.token||''))){
        ws.send(JSON.stringify({type:'resume_result',ok:false}));
      } else {
        // Detach from anything this (fresh) connection was in first — should
        // be nothing, but keeps seatedProfiles/openRooms honest if not.
        if(myRoom&&myRoom!==room) leaveCurrentRoom();
        myRoom=room;
        // reclaimSeat restored the seat's original identity onto `player`
        // (name/profileId/icon/…) from the game-start snapshot. Mirror the
        // profile side of that so stats/achievements still attribute to the
        // right account and the "seated elsewhere" guard stays accurate.
        if(player.profileId){
          unlockedId=unlockedId||player.profileId;
          unlockedName=unlockedName||player.name;
          seatedProfiles.set(player.profileId,{roomId:room.id,playerId:myId});
          goOnline();
        }
        ws.send(JSON.stringify({type:'resume_result',ok:true,seat,warm:!!msg.warm}));
        room.sendResumeSnapshot(player,!!msg.warm);
      }
    }
    }catch(e){ console.error('[server message error]',e.message,'\n',e.stack); }
  });

  ws.on('close',()=>{
    goOffline();
    // Mid-game: hold the seat for a grace window so a quick reconnect lands
    // back in it (see Room.disconnectHuman) rather than immediately handing
    // it to a bot the way leaveCurrentRoom → removeHuman does. Still release
    // the module-side bookkeeping (seatedProfiles/openRooms) now — a
    // successful 'resume' re-establishes it, and if none comes the grace
    // timer falls back to bot play anyway.
    if(myRoom&&myRoom.phase==='playing'){
      if(player.profileId&&seatedProfiles.get(player.profileId)?.playerId===myId) seatedProfiles.delete(player.profileId);
      myRoom.disconnectHuman(myId);
      myRoom=null;
    } else {
      leaveCurrentRoom();
    }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🀄 Mahjong on http://localhost:${PORT}`));

// Railway (and most container platforms) do a rolling deploy: start the new
// instance, and once it's healthy, send SIGTERM to the old one to shut it
// down — completely normal, not a failure. Without a handler, Node just
// dies on that signal with no clean exit, which Railway logs as a crash for
// the OLD (being-replaced) deployment — the "deploy crashed" email on every
// otherwise-successful deploy. Closing everything explicitly and exiting 0
// tells the platform this was an intentional, graceful shutdown instead.
function shutdown(){
  console.log('Shutting down gracefully…');
  wss.clients.forEach(client=>client.terminate());
  server.close(()=>process.exit(0));
  // Force-exit if something (a lingering keep-alive, a stuck close callback)
  // stops server.close() from ever firing — better a hard exit than hanging
  // past the platform's own shutdown grace period. unref() so this timer
  // itself never keeps the process alive if shutdown finishes first.
  setTimeout(()=>process.exit(0),5000).unref();
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);

// Every per-connection code path above is already wrapped in its own
// try/catch (the ws 'message' handler, Room.action()), but the ~dozen
// setTimeout callbacks that drive bot turns/reactions inside room.js are
// NOT — they run outside any of those try blocks, on the raw event loop.
// Without a handler here, an exception thrown inside one of those (a bad
// hand shape reaching a rules function, for instance) is unhandled at the
// top level and crashes this ENTIRE process by default, taking down every
// concurrent room — quick-match and room-match alike — not just the one
// that hit the bug, which would look like "the game just stopped" to
// everyone else too. Logging and carrying on isn't a full fix for whatever
// the underlying bug was (that one room's game may still be stuck), but it
// stops a single room's edge case from being a whole-server outage.
process.on('uncaughtException',(err)=>{ console.error('[uncaughtException]',err.message,'\n',err.stack); });
process.on('unhandledRejection',(err)=>{ console.error('[unhandledRejection]',err); });
