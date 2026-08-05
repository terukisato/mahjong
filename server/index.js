'use strict';
const express=require('express');
const http=require('http');
const WebSocket=require('ws');
const path=require('path');
const {Room}=require('./room');
const {getStats,getLeaderboard,deleteStats,migrateToIds}=require('./stats');
const {listProfiles,createProfile,verifyProfile,deleteProfile,setIcon,getIcon,renameProfile,setCode,setTitle,getTitle,createRememberToken,verifyRememberToken,forgetRememberToken,getId,getNameById,migrateLegacyIds}=require('./profiles');

// One-time upgrade of both data files from the old name-keyed shape to the
// new stable-id-keyed shape (see profiles.js's migrateLegacyIds and
// stats.js's migrateToIds) — a no-op on every boot after the first. Must
// run before anything else touches either file.
migrateToIds(migrateLegacyIds());

const app=express();
const server=http.createServer(app);
const wss=new WebSocket.Server({server});

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

// Used by 'create_room' — registers the room in openRooms so it's
// immediately browsable/joinable via the Room List.
function createFreshRoom(mode,rules,numPlayers){
  const room=new Room(mode,'normal',rules,numPlayers);
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
    myRoom.removeHuman(myId);
    if(myRoom.phase==='waiting'&&myRoom.humanCount()===0) openRooms.delete(myRoom.id);
    myRoom=null;
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
      player.voiceTheme=(msg.voiceTheme||'Default').slice(0,30);
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
      player.voiceTheme=(msg.voiceTheme||'Default').slice(0,30);
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
      if(player.profileId) seatedProfiles.set(player.profileId,{roomId:myRoom.id,playerId:myId});
      ws.send(JSON.stringify({type:'joined',seat:player.seat,roomId:myRoom.id,gameMode:myRoom.gameMode,numPlayers:myRoom.numPlayers,rules:myRoom.rules}));
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
        player.voiceTheme=(msg.voiceTheme||'Default').slice(0,30);
        myRoom=room;
        if(!myRoom.addHuman(player)){
          myRoom=null;
          ws.send(JSON.stringify({type:'join_room_result',ok:false,error:'That room is full.'}));
        } else {
          if(player.profileId) seatedProfiles.set(player.profileId,{roomId:myRoom.id,playerId:myId});
          ws.send(JSON.stringify({type:'joined',seat:player.seat,roomId:myRoom.id,gameMode:myRoom.gameMode,numPlayers:myRoom.numPlayers,rules:myRoom.rules}));
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

    if(msg.type==='chat'&&myRoom) myRoom.chat(myId,msg.text||'',msg.color);

    if(msg.type==='get_stats'){
      // Uses this connection's own unlocked profile, never msg.name — same
      // reasoning as assignIdentity above, otherwise anyone could read any unlocked
      // profile's stats just by naming it.
      if(unlockedId) ws.send(JSON.stringify({type:'stats',name:unlockedName,stats:getStats(unlockedId)}));
    }

    if(msg.type==='get_leaderboard'){
      const variant=msg.variant==='sanma'?'sanma':'yonma';
      // Whitelisted against stats.js's getLeaderboard, which otherwise just
      // does (b[sortBy]||0)-(a[sortBy]||0) on whatever field name it's
      // given — an unchecked client-supplied sortBy could sort by any
      // field on the row object (or silently no-op on a typo) instead of
      // one of the ones the Rankings UI actually offers tabs for.
      const validSorts=['totalFinalScore','gamesWon','avgPlacement','bestScore','bestHan','handsWon','yakumanCount','dealInRate'];
      const sortBy=validSorts.includes(msg.sortBy)?msg.sortBy:'totalFinalScore';
      // getLeaderboard returns {id,...} rows (stats.js has no notion of
      // names) — attach each row's current display name here, the one
      // place id and name actually need to meet for this message.
      const entries=getLeaderboard(sortBy,variant).map(e=>({...e,name:getNameById(e.id)}));
      ws.send(JSON.stringify({type:'leaderboard',variant,sortBy,entries}));
    }

    if(msg.type==='list_profiles'){
      // {name,icon} pairs — safe to send before any code is entered, never
      // includes salt/codeHash. Powers the profile-picker's icon+name cards.
      ws.send(JSON.stringify({type:'profiles',profiles:listProfiles()}));
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
        ws.send(JSON.stringify({type:'profile_unlocked',ok:true,name,icon:getIcon(name),title:getTitle(name),token}));
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
        ws.send(JSON.stringify({type:'profile_unlocked',ok:true,name,icon:getIcon(name),title:getTitle(name),silent:true}));
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
        if(result.ok) unlockedName=result.name;
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
        if(result.ok) deleteStats(result.id);
        ws.send(JSON.stringify({type:'delete_profile_result',ok:result.ok,error:result.error}));
      }
    }

    if(msg.type==='leave'){
      leaveCurrentRoom();
    }
    }catch(e){ console.error('[server message error]',e.message,'\n',e.stack); }
  });

  ws.on('close',()=>{
    leaveCurrentRoom();
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
