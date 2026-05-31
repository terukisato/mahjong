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

let waitingRoom=new Room();

function getWaitingRoom(){
  if(waitingRoom.phase==='waiting') return waitingRoom;
  waitingRoom=new Room();
  return waitingRoom;
}

wss.on('connection',(ws)=>{
  let myRoom=null;
  const myId=`h-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const player={id:myId,ws,name:'Player',seat:-1,isBot:false};

  ws.send(JSON.stringify({type:'hello'}));

  ws.on('message',(raw)=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}

    if(msg.type==='join'){
      if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
      player.name=(msg.name||'Player').slice(0,20);
      myRoom=getWaitingRoom();
      if(!myRoom.addHuman(player)){
        waitingRoom=new Room();myRoom=waitingRoom;myRoom.addHuman(player);
      }
      ws.send(JSON.stringify({type:'joined',seat:player.seat}));
    }

    if(msg.type==='ready'&&myRoom) myRoom.setReady(myId);

    if(msg.type==='start_now'&&myRoom&&myRoom.phase==='waiting'){
      myRoom.fillBots();myRoom.start();
    }

    if(msg.type==='action'&&myRoom) myRoom.action(myId,msg.action);

    if(msg.type==='chat'&&myRoom) myRoom.chat(myId,msg.text||'');

    if(msg.type==='leave'){
      if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
    }
  });

  ws.on('close',()=>{
    if(myRoom){myRoom.removeHuman(myId);myRoom=null;}
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🀄 Mahjong on http://localhost:${PORT}`));
