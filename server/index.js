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

// Single waiting room — replace when game starts
let waitingRoom=new Room();
const BOT_DELAY=10000;

function getWaitingRoom(){
  if(waitingRoom.phase==='waiting') return waitingRoom;
  waitingRoom=new Room();
  return waitingRoom;
}

wss.on('connection',(ws)=>{
  // Each WS connection = fresh anonymous player, no session tracking
  let myRoom=null;
  let myId=`h-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const player={id:myId,ws,name:'Player',seat:-1,isBot:false};

  ws.send(JSON.stringify({type:'hello'}));

  ws.on('message',(raw)=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}

    // ── join ──────────────────────────────────────────────────────────────
    if(msg.type==='join'){
      // Clean up previous room if somehow still in one
      if(myRoom){myRoom.removeHuman(myId);myRoom=null;}

      player.name=(msg.name||'Player').slice(0,20);
      myRoom=getWaitingRoom();
      const ok=myRoom.addHuman(player);
      if(!ok){
        // Room full — make a new one
        waitingRoom=new Room();
        myRoom=waitingRoom;
        myRoom.addHuman(player);
      }

      // Confirm seat
      ws.send(JSON.stringify({type:'joined',seat:player.seat}));

      // If now 4 humans, start immediately
      if(myRoom.humanCount()===4) myRoom.start();
      else {
        // Schedule bot fill
        const roomRef=myRoom;
        setTimeout(()=>{
          if(roomRef.phase==='waiting'&&roomRef.humanCount()>0){
            roomRef.fillBots();
            roomRef.start();
          }
        },BOT_DELAY);
      }
    }

    // ── start_now ─────────────────────────────────────────────────────────
    if(msg.type==='start_now'&&myRoom&&myRoom.phase==='waiting'){
      myRoom.fillBots();
      myRoom.start();
    }

    // ── game action ───────────────────────────────────────────────────────
    if(msg.type==='action'&&myRoom) myRoom.action(myId,msg.action);

    // ── leave ─────────────────────────────────────────────────────────────
    if(msg.type==='leave'){
      if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
      // No reply needed — client handles UI immediately
    }
  });

  ws.on('close',()=>{
    if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🀄 Mahjong on http://localhost:${PORT}`));
