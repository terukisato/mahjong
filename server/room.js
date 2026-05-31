'use strict';
const {buildWall,shuffle,sort,key,isWin,waits,canPon,canKan,canChi,
       detectYaku,countDora,calcFu,basePoints,handLabel,decompose} = require('./mahjong');
const {botName,bestDiscard,botReact} = require('./bot');

let _roomId=0;
const BOT_DELAY=1200;

class Room {
  constructor(){
    this.id=++_roomId;
    this.phase='waiting'; // waiting | ready | playing | done
    this.seats=[null,null,null,null];
    this.ready=new Set(); // set of human playerIds who clicked ready
    this.game=null;
  }

  // ── Seat management ────────────────────────────────────────────────────
  addHuman(player){
    const seat=this.seats.indexOf(null);
    if(seat===-1) return false;
    player.seat=seat;
    this.seats[seat]=player;
    this._broadcastRoomUpdate();
    return true;
  }

  removeHuman(playerId){
    const seat=this.seats.findIndex(p=>p&&!p.isBot&&p.id===playerId);
    if(seat===-1) return;
    this.ready.delete(playerId);
    if(this.phase==='playing'){
      const bot=this._makeBot(seat);
      this.seats[seat]=bot;
    } else {
      this.seats[seat]=null;
    }
    this._broadcastRoomUpdate();
  }

  humanCount(){ return this.seats.filter(p=>p&&!p.isBot).length; }
  totalCount(){ return this.seats.filter(Boolean).length; }

  fillBots(){
    for(let i=0;i<4;i++){
      if(!this.seats[i]) this.seats[i]=this._makeBot(i);
    }
    this._broadcastRoomUpdate();
  }

  _makeBot(seat){
    return {id:`bot-${seat}-${Date.now()}`,name:botName(),seat,isBot:true};
  }

  // ── Ready system ───────────────────────────────────────────────────────
  setReady(playerId){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p||this.phase!=='waiting') return;
    this.ready.add(playerId);
    this._broadcastRoomUpdate();
    this._checkAllReady();
  }

  _checkAllReady(){
    const humans=this.seats.filter(p=>p&&!p.isBot);
    if(humans.length>0 && humans.every(p=>this.ready.has(p.id))){
      this.fillBots();
      this.start();
    }
  }

  // ── Chat ───────────────────────────────────────────────────────────────
  chat(playerId, text){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p) return;
    const msg=text.trim().slice(0,60);
    if(!msg) return;
    this._broadcastAll({type:'chat',seat:p.seat,name:p.name,text:msg});
  }

  // ── Game start ─────────────────────────────────────────────────────────
  start(){
    if(this.phase!=='waiting'||this.totalCount()<4) return;
    this.phase='playing';
    const wall=shuffle(buildWall());
    const hands=[0,1,2,3].map(()=>[]);
    for(let i=0;i<52;i++) hands[i%4].push(wall.shift());

    this.game={
      wall,
      deadWall:wall.splice(-14),
      hands:hands.map(h=>sort(h)),
      discards:[[],[],[],[]],
      melds:[[],[],[],[]],
      scores:[25000,25000,25000,25000],
      turn:0,
      round:1,
      roundWind:1,
      honba:0,
      riichiSticks:0,
      dora:[],
      riichi:[false,false,false,false],
      ippatsu:[false,false,false,false],
      pending:null,
      drawTile:null,
    };
    this.game.dora.push(this.game.deadWall[4]);
    this._broadcastAll({type:'game_start',seats:this._seatInfo()});
    setTimeout(()=>this._draw(),150);
  }

  // ── Turn flow ──────────────────────────────────────────────────────────
  _draw(){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    if(g.wall.length===0){this._endRound('draw');return;}
    const t=g.wall.shift();
    g.drawTile=t;
    g.hands[g.turn].push(t);
    g.hands[g.turn]=sort(g.hands[g.turn]);
    this._sendState();
    const seat=this.seats[g.turn];
    if(seat?.isBot) setTimeout(()=>this._botTurn(g.turn),BOT_DELAY);
  }

  _botTurn(seat){
    const g=this.game;
    if(!g||g.turn!==seat||this.phase!=='playing') return;
    const hand=g.hands[seat];
    if(isWin(hand)){this._tsumo(seat);return;}
    if(!g.riichi[seat]&&!g.melds[seat].length&&g.scores[seat]>=1000){
      const tid=this._findRiichiTile(seat);
      if(tid!==null){this._riichi(seat,tid);return;}
    }
    this._discard(seat,bestDiscard(hand));
  }

  _findRiichiTile(seat){
    const hand=this.game.hands[seat];
    for(const t of hand){if(waits(hand.filter(x=>x.id!==t.id)).length>0) return t.id;}
    return null;
  }

  // ── Player actions ─────────────────────────────────────────────────────
  action(playerId,act){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    const seat=this.seats.findIndex(p=>p&&!p.isBot&&p.id===playerId);
    if(seat===-1) return;
    if(act.type==='discard'&&g.turn===seat) this._discard(seat,act.tileId);
    else if(act.type==='tsumo'&&g.turn===seat) this._tsumo(seat);
    else if(act.type==='riichi'&&g.turn===seat) this._riichi(seat,act.tileId);
    else if(act.type==='ron') this._reactResponse(seat,{type:'ron'});
    else if(act.type==='pon') this._reactResponse(seat,{type:'pon'});
    else if(act.type==='chi') this._reactResponse(seat,{type:'chi',tileIds:act.tileIds});
    else if(act.type==='pass') this._reactResponse(seat,{type:'pass'});
  }

  // ── Discard ────────────────────────────────────────────────────────────
  _discard(seat,tileId){
    const g=this.game;
    const idx=g.hands[seat].findIndex(t=>t.id===tileId);
    if(idx===-1) return;
    const [tile]=g.hands[seat].splice(idx,1);
    g.discards[seat].push(tile);
    g.drawTile=null;
    g.ippatsu=g.ippatsu.map((v,i)=>i===seat?false:v);

    const reactions=this._checkReactions(seat,tile);
    if(reactions.length){
      g.pending={tile,fromSeat:seat,seats:reactions.map(r=>r.seat),options:reactions,responses:{},
        timer:setTimeout(()=>this._resolveReactions(),8000)};
      this._sendState();
      for(const r of reactions){
        if(this.seats[r.seat]?.isBot){
          const dec=botReact(g.hands[r.seat],tile,r.options);
          setTimeout(()=>{if(!g.pending)return;g.pending.responses[r.seat]=dec;this._checkAllReacted();},BOT_DELAY);
        }
      }
    } else {
      this._nextTurn();
    }
  }

  _checkReactions(fromSeat,tile){
    const g=this.game;
    const reactions=[];
    for(let seat=0;seat<4;seat++){
      if(seat===fromSeat) continue;
      const hand=g.hands[seat],opts=[];
      if(isWin([...hand,tile])) opts.push({type:'ron'});
      if(canPon(hand,tile)) opts.push({type:'pon'});
      if(canKan(hand,tile)) opts.push({type:'kan'});
      if(seat===(fromSeat+1)%4&&!g.riichi[seat]){
        const seqs=canChi(hand,tile);
        if(seqs.length) opts.push({type:'chi',sequences:seqs});
      }
      if(opts.length) reactions.push({seat,options:opts});
    }
    return reactions;
  }

  _reactResponse(seat,resp){
    const g=this.game;
    if(!g.pending||!g.pending.seats.includes(seat)) return;
    g.pending.responses[seat]=resp;
    if(resp.type==='ron'){clearTimeout(g.pending.timer);this._resolveReactions();return;}
    this._checkAllReacted();
  }

  _checkAllReacted(){
    const g=this.game;
    if(!g.pending) return;
    if(g.pending.seats.every(s=>g.pending.responses[s])){
      clearTimeout(g.pending.timer);this._resolveReactions();
    }
  }

  _resolveReactions(){
    const g=this.game;
    if(!g.pending) return;
    const {tile,fromSeat,seats,options,responses}=g.pending;
    g.pending=null;
    let ronSeat=null,ponSeat=null,chiSeat=null;
    for(const seat of seats){
      const r=responses[seat]||{type:'pass'};
      if(r.type==='ron'){ronSeat=seat;break;}
      if(r.type==='pon') ponSeat=seat;
      if(r.type==='chi') chiSeat=seat;
    }
    if(ronSeat!==null) this._ron(ronSeat,fromSeat,tile);
    else if(ponSeat!==null) this._pon(ponSeat,tile);
    else if(chiSeat!==null) this._chi(chiSeat,tile,responses[chiSeat].tileIds);
    else this._nextTurn();
  }

  _pon(seat,tile){
    const g=this.game;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===key(tile));
    const used=matches.slice(0,2);
    g.hands[seat]=hand.filter(t=>!used.map(u=>u.id).includes(t.id));
    g.melds[seat].push({type:'pon',tiles:[...used,tile]});
    g.turn=seat;
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,bestDiscard(g.hands[seat])),BOT_DELAY);
  }

  _chi(seat,tile,tileIds){
    const g=this.game;
    const hand=g.hands[seat];
    const used=hand.filter(t=>tileIds.includes(t.id));
    g.hands[seat]=hand.filter(t=>!tileIds.includes(t.id));
    g.melds[seat].push({type:'chi',tiles:sort([...used,tile])});
    g.turn=seat;
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,bestDiscard(g.hands[seat])),BOT_DELAY);
  }

  // ── Win ────────────────────────────────────────────────────────────────
  _tsumo(seat){
    const g=this.game;
    const hand=g.hands[seat];
    if(!isWin(hand)) return;
    const {han,yakuList}=detectYaku(hand,g.melds[seat],true,g.roundWind,g.roundWind,g.riichi[seat],g.ippatsu[seat]);
    if(han===0) return;
    const dc=countDora(hand,g.dora),totalHan=han+dc;
    const decomps=decompose(hand);
    const fu=decomps.length?calcFu(decomps[0],true,!g.melds[seat].length):30;
    const bp=basePoints(totalHan,fu);
    const isDealer=seat===0;
    let gain=0;
    for(let i=0;i<4;i++){
      if(i===seat) continue;
      const pay=Math.ceil((isDealer?bp*2:i===0?bp*2:bp)/100)*100+g.honba*100;
      g.scores[i]-=pay;gain+=pay;
    }
    g.scores[seat]+=gain+g.riichiSticks*1000;
    const yl=dc>0?[...yakuList,{name:'Dora',jp:'ドラ',han:dc}]:yakuList;
    this._endRound('tsumo',seat,null,hand,yl,totalHan,fu,gain);
  }

  _ron(winSeat,loseSeat,tile){
    const g=this.game;
    const hand=[...g.hands[winSeat],tile];
    const {han,yakuList}=detectYaku(hand,g.melds[winSeat],false,g.roundWind,g.roundWind,g.riichi[winSeat],g.ippatsu[winSeat]);
    if(han===0){this._sendState();return;}
    const dc=countDora(hand,g.dora),totalHan=han+dc;
    const decomps=decompose(hand);
    const fu=decomps.length?calcFu(decomps[0],false,!g.melds[winSeat].length):30;
    const bp=basePoints(totalHan,fu);
    const pay=Math.ceil(bp*4/100)*100+g.honba*300+g.riichiSticks*1000;
    g.scores[loseSeat]-=pay;g.scores[winSeat]+=pay;
    const yl=dc>0?[...yakuList,{name:'Dora',jp:'ドラ',han:dc}]:yakuList;
    this._endRound('ron',winSeat,loseSeat,hand,yl,totalHan,fu,pay);
  }

  _riichi(seat,tileId){
    const g=this.game;
    if(g.riichi[seat]||g.scores[seat]<1000) return;
    const hand=g.hands[seat];
    if(waits(hand.filter(t=>t.id!==tileId)).length===0) return;
    g.riichi[seat]=true;g.ippatsu[seat]=true;
    g.scores[seat]-=1000;g.riichiSticks++;
    this._broadcastAll({type:'riichi',seat,name:this.seats[seat]?.name,scores:g.scores});
    this._discard(seat,tileId);
  }

  _nextTurn(){
    const g=this.game;
    g.turn=(g.turn+1)%4;
    this._draw();
  }

  _endRound(reason,winner,loser,hand,yakuList,han,fu,payment){
    this.phase='done';
    const g=this.game;
    this._broadcastAll({type:'round_end',reason,winner,loser,hand,yakuList,han,fu,payment,
      scores:g.scores,handLabel:han?handLabel(han):'',playerNames:this.seats.map(p=>p?.name||'—')});
  }

  // ── State ──────────────────────────────────────────────────────────────
  _sendState(){
    const g=this.game;
    if(!g) return;
    for(let seat=0;seat<4;seat++){
      const p=this.seats[seat];
      if(!p||p.isBot) continue;
      const hand=g.hands[seat];
      const w=hand.length===13?waits(hand):[];
      let pendingForMe=null;
      if(g.pending&&g.pending.seats.includes(seat)){
        const myR=g.pending.options.find(r=>r.seat===seat);
        pendingForMe={isForMe:true,discard:g.pending.tile,fromSeat:g.pending.fromSeat,options:myR?.options||[]};
      } else if(g.pending){
        pendingForMe={isForMe:false};
      }
      this._send(p,{type:'game_state',seat,myHand:hand,myMelds:g.melds[seat],
        discards:g.discards,melds:g.melds,scores:g.scores,turn:g.turn,
        round:g.round,roundWind:g.roundWind,honba:g.honba,riichiSticks:g.riichiSticks,
        dora:g.dora,wallCount:g.wall.length,waits:w,riichi:g.riichi,pending:pendingForMe,
        oppHandSizes:g.hands.map((h,i)=>i===seat?null:h.length),
        drawTile:g.turn===seat?g.drawTile:null});
    }
  }

  _seatInfo(){ return this.seats.map(p=>p?{name:p.name,isBot:!!p.isBot}:null); }

  _broadcastRoomUpdate(){
    const readyIds=Array.from(this.ready);
    const info=this._seatInfo().map((p,i)=>{
      if(!p) return null;
      const player=this.seats[i];
      return {...p,ready:player&&!player.isBot?readyIds.includes(player.id):true};
    });
    this._broadcastAll({type:'room_update',seats:info});
  }

  _broadcastAll(msg){
    const raw=JSON.stringify(msg);
    for(const p of this.seats){
      if(p&&!p.isBot&&p.ws?.readyState===1) p.ws.send(raw);
    }
  }

  _send(player,msg){
    if(player&&!player.isBot&&player.ws?.readyState===1)
      player.ws.send(JSON.stringify(msg));
  }
}

module.exports={Room};
