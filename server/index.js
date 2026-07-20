'use strict';
const express=require('express');
const http=require('http');
const WebSocket=require('ws');
const path=require('path');
const {Room}=require('./room');

const app=express();
const server=http.createServer(app);
const wss=new WebSocket.Server({server});

app.use(express.static(path.join(__dirname,'../public')));

// Matchmaking: a single shared "waiting room" per game mode at a time.
// Whoever joins first claims it; once it starts (or if its mode doesn't
// match), the next joiner gets a brand-new Room instead. There's no
// support for multiple concurrent waiting rooms of the same mode, private
// rooms, or joining a specific room by ID — first-come-first-served into
// whatever's currently open is the entire matchmaking model.
let waitingRoom=null;

function getWaitingRoom(mode,difficulty){
  if(waitingRoom&&waitingRoom.phase==='waiting'&&waitingRoom.gameMode===mode) return waitingRoom;
  waitingRoom=new Room(mode,difficulty);
  return waitingRoom;
}

// One WebSocket connection = one prospective player. `player` is a plain
// object handed to Room (see room.js) — it stays the same object across
// join/leave/reconnect-to-a-new-room within this connection's lifetime, so
// Room can freely stash extra fields on it (seat, isBot, etc).
wss.on('connection',(ws)=>{
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
      const difficulty=['easy','normal','hard'].includes(msg.difficulty)?msg.difficulty:'normal';
      myRoom=getWaitingRoom(mode,difficulty);
      // Race fallback: the shared waitingRoom could have filled up (or
      // moved past 'waiting') between getWaitingRoom's check and here if
      // multiple joins land close together — just spin up a fresh one.
      if(!myRoom.addHuman(player)){
        waitingRoom=new Room(mode,difficulty);myRoom=waitingRoom;myRoom.addHuman(player);
      }
      ws.send(JSON.stringify({type:'joined',seat:player.seat}));
    }

    if(msg.type==='ready'&&myRoom) myRoom.setReady(myId);

    if(msg.type==='start_now'&&myRoom&&myRoom.phase==='waiting'){
      myRoom.fillBots();myRoom.start();
    }

    if(msg.type==='action'&&myRoom) myRoom.action(myId,msg.action);

    if(msg.type==='chat'&&myRoom) myRoom.chat(myId,msg.text||'',msg.color);

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
