'use strict';
const express=require('express');
const http=require('http');
const WebSocket=require('ws');
const path=require('path');
const {Room}=require('./room');
const {getStats}=require('./stats');

const app=express();
const server=http.createServer(app);
const wss=new WebSocket.Server({server});

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

// Matchmaking: a single shared "waiting room" per (game mode, player count)
// pair at a time. Whoever joins first claims it; once it starts (or if its
// mode/player-count doesn't match), the next joiner gets a brand-new Room
// instead. There's no support for multiple concurrent waiting rooms of the
// same mode, private rooms, or joining a specific room by ID —
// first-come-first-served into whatever's currently open is the entire
// matchmaking model. Sanma (numPlayers=3) and yonma (numPlayers=4) rooms
// are always separate — a sanma joiner must never land in a yonma waiting
// room or vice versa.
let waitingRoom=null;

function getWaitingRoom(mode,rules,numPlayers){
  if(waitingRoom&&waitingRoom.phase==='waiting'&&waitingRoom.gameMode===mode&&waitingRoom.numPlayers===numPlayers) return waitingRoom;
  waitingRoom=new Room(mode,'normal',rules,numPlayers);
  return waitingRoom;
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
    if(msg.type==='join'){
      // Leave any room this connection was already in first — lets the
      // client re-send 'join' to switch game mode or retry without needing
      // a fresh WebSocket connection.
      if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
      player.name=(msg.name||'Player').slice(0,20);
      player.voiceTheme=(msg.voiceTheme||'Default').slice(0,30);
      const mode=msg.gameMode==='hanchan'?'hanchan':'tonpuu';
      const numPlayers=msg.variant==='sanma'?3:4;
      // Rule variants — picked once in the lobby, like gameMode. Not part
      // of the shared-waiting-room reuse check below (same as gameMode's
      // sibling settings, voiceTheme/difficulty): the first joiner's picks
      // apply to a shared public room, a deliberate simplicity tradeoff.
      const rules={
        akaDora: msg.rules?.akaDora!==false,
        kuitanAri: msg.rules?.kuitanAri!==false,
        doubleRon: msg.rules?.doubleRon!==false,
        nagashiMangan: msg.rules?.nagashiMangan!==false,
      };
      myRoom=getWaitingRoom(mode,rules,numPlayers);
      // Race fallback: the shared waitingRoom could have filled up (or
      // moved past 'waiting') between getWaitingRoom's check and here if
      // multiple joins land close together — just spin up a fresh one.
      if(!myRoom.addHuman(player)){
        waitingRoom=new Room(mode,'normal',rules,numPlayers);myRoom=waitingRoom;myRoom.addHuman(player);
      }
      ws.send(JSON.stringify({type:'joined',seat:player.seat}));
    }

    if(msg.type==='ready'&&myRoom) myRoom.setReady(myId);

    if(msg.type==='set_bot_difficulty'&&myRoom) myRoom.setBotDifficulty(myId,Number(msg.seat),msg.difficulty);

    if(msg.type==='start_now'&&myRoom&&myRoom.phase==='waiting'){
      myRoom.fillBots();myRoom.start();
    }

    if(msg.type==='action'&&myRoom) myRoom.action(myId,msg.action);

    if(msg.type==='chat'&&myRoom) myRoom.chat(myId,msg.text||'',msg.color);

    if(msg.type==='get_stats'){
      const name=(msg.name||'Player').slice(0,20);
      ws.send(JSON.stringify({type:'stats',name,stats:getStats(name)}));
    }

    if(msg.type==='leave'){
      if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
    }
    }catch(e){ console.error('[server message error]',e.message,'\n',e.stack); }
  });

  ws.on('close',()=>{
    if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🀄 Mahjong on http://localhost:${PORT}`));
