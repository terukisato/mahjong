'use strict';
const {buildWall,shuffle,sort,key,isWin,waits,canPon,canKan,canChi,
       detectYaku,countDora,countAkaDora,calcFu,waitFu,basePoints,handLabel,decompose} = require('./mahjong');
const {botName,bestDiscard,botReact} = require('./bot');

let _roomId=0;
const BOT_DELAY=1200;

// ── Dead wall layout (14 tiles) ─────────────────────────────────────────────
// [0-3]  = rinshan tiles (drawn on kan)
// [4-8]  = dora indicators  (dora[0] = deadWall[4], revealed on kan = deadWall[5..8])
// [9-13] = ura dora indicators (revealed only on riichi win)

class Room {
  constructor(gameMode='tonpuu'){
    this.id=++_roomId;
    this.phase='waiting';
    this.gameMode=gameMode; // 'tonpuu' (4 rounds) or 'hanchan' (8 rounds)
    this.seats=[null,null,null,null];
    this.ready=new Set();
    this.game=null;
  }

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

  chat(playerId, text){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p) return;
    const msg=text.trim().slice(0,60);
    if(!msg) return;
    this._broadcastAll({type:'chat',seat:p.seat,name:p.name,text:msg});
  }

  // ── Game lifecycle ─────────────────────────────────────────────────────────
  _initRound(){
    const g=this.game;
    const wall=shuffle(buildWall());
    const hands=[0,1,2,3].map(()=>[]);
    for(let i=0;i<52;i++) hands[i%4].push(wall.shift());
    const deadWall=wall.splice(-14);

    g.wall=wall;
    g.deadWall=deadWall;
    g.hands=hands.map(h=>sort(h));
    g.discards=[[],[],[],[]];
    g.melds=[[],[],[],[]];
    g.dora=[deadWall[4]];
    g.riichi=[false,false,false,false];
    g.doubleRiichi=[false,false,false,false]; // track double riichi separately
    g.ippatsu=[false,false,false,false];
    g.furiten=[false,false,false,false];     // permanent furiten (discarded own wait)
    g.tempFuriten=[false,false,false,false]; // temporary furiten (passed a ron opportunity)
    g.pending=null;
    g.drawTile=null;
    g.riichiTile={};
    g.kanCount=0;
    g.kanSeats=[];
    g.isRinshan=false;
    g.haiteiNext=false;
    g.firstRound=true;   // for double riichi / tenhou / chiihou detection
    g.turnCount=0;       // total discards this round
    g.nagashi=[true,true,true,true]; // nagashi eligibility per seat
  }

  start(){
    if(this.phase!=='waiting'||this.totalCount()<4) return;
    this.phase='playing';
    const startDealer=Math.floor(Math.random()*4);
    this.game={
      scores:[25000,25000,25000,25000],
      turn:startDealer,
      dealer:startDealer,
      round:1,        // hand number within current wind (1-4+)
      roundWind:1,    // 1-8 for hanchan: 1-4=East, 5-8=South
      honba:0,
      riichiSticks:0,
    };
    this._initRound();
    this._broadcastAll({type:'game_start',seats:this._seatInfo(),gameMode:this.gameMode,dealer:this.game.dealer});
    setTimeout(()=>this._draw(),2000);
  }

  // ── Turn flow ──────────────────────────────────────────────────────────────
  _draw(fromRinshan=false){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    if(g.wall.length===0&&!fromRinshan){this._endRound('draw');return;}
    let t;
    if(fromRinshan){
      t=g.deadWall.shift();
      g.isRinshan=true;
    } else {
      t=g.wall.shift();
      g.isRinshan=false;
      if(g.wall.length===0) g.haiteiNext=true;
    }
    g.drawTile=t;
    g.hands[g.turn].push(t);
    g.hands[g.turn]=sort(g.hands[g.turn]);
    g.tempFuriten[g.turn]=false;
    this._sendState();
    const seat=this.seats[g.turn];
    if(seat?.isBot){
      const botSeat=g.turn;
      setTimeout(()=>this._botAct(botSeat), BOT_DELAY);
    }
  }

  // Unified bot action entry — called after draw or as watchdog
  _botAct(seat){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    if(g.turn!==seat||g.pending) return;
    if(!this.seats[seat]?.isBot) return;
    this._botTurn(seat);
  }

  _botTurn(seat){
    const g=this.game;
    if(!g||g.turn!==seat||this.phase!=='playing') return;
    if(g.pending) return;
    const hand=g.hands[seat];
    if(!g.riichi[seat]){
      const ankanTile=this._findAnkan(seat);
      if(ankanTile){this._ankan(seat,ankanTile);return;}
    }
    // Only tsumo if hand wins AND has valid yaku
    if(isWin(hand,g.melds[seat])&&!this._isFuriten(seat)){
      const sw=this._seatWindOf(seat);
      const isHaitei=g.haiteiNext&&!g.isRinshan;
      const winKey=g.drawTile?key(g.drawTile):null;
      const {han}=detectYaku(hand,g.melds[seat],true,sw,this._roundWindValue(),
        g.riichi[seat],g.ippatsu[seat],g.doubleRiichi[seat],g.isRinshan,false,isHaitei,false,false,false,winKey);
      if(han>0){this._tsumo(seat);return;}
    }
    if(!g.riichi[seat]&&!g.melds[seat].length&&g.scores[seat]>=1000){
      const tid=this._findRiichiTile(seat);
      if(tid!==null){this._riichi(seat,tid);return;}
    }
    // In riichi: must discard the drawn tile
    if(g.riichi[seat]&&g.drawTile){
      this._discard(seat,g.drawTile.id);
      return;
    }
    this._discard(seat,bestDiscard(hand));
  }

  _findRiichiTile(seat){
    const hand=this.game.hands[seat];
    for(const t of hand){if(waits(hand.filter(x=>x.id!==t.id)).length>0) return t.id;}
    return null;
  }

  _findAnkan(seat){
    const g=this.game;
    const hand=g.hands[seat];
    const c={};
    for(const t of hand) c[key(t)]=(c[key(t)]||0)+1;
    for(const [k,n] of Object.entries(c)) if(n===4) return k;
    return null;
  }

  // ── Furiten checks ─────────────────────────────────────────────────────────
  // A player is in furiten if:
  // 1. They discarded any tile in their own wait set (permanent furiten)
  // 2. They passed on a ron opportunity this turn cycle (temporary furiten, resets on own draw)
  _isFuriten(seat){
    const g=this.game;
    return g.furiten[seat]||g.tempFuriten[seat];
  }

  _updateFuriten(seat){
    // Recalculate permanent furiten based on discards vs current waits
    const g=this.game;
    const hand=g.hands[seat];
    const ws=waits(hand,g.melds[seat]);
    if(!ws.length) return;
    const myDiscards=g.discards[seat].map(key);
    g.furiten[seat]=ws.some(w=>myDiscards.includes(w));
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  action(playerId,act){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    const seat=this.seats.findIndex(p=>p&&!p.isBot&&p.id===playerId);
    if(seat===-1) return;
    if(act.type==='discard'&&g.turn===seat) this._discard(seat,act.tileId);
    else if(act.type==='tsumo'&&g.turn===seat) this._tsumo(seat);
    else if(act.type==='riichi'&&g.turn===seat) this._riichi(seat,act.tileId);
    else if(act.type==='ankan'&&g.turn===seat) this._ankan(seat,act.tileKey);
    else if(act.type==='kakan'&&g.turn===seat) this._kakan(seat,act.tileId);
    else if(act.type==='ron') this._reactResponse(seat,{type:'ron'});
    else if(act.type==='pon') this._reactResponse(seat,{type:'pon'});
    else if(act.type==='kan') this._reactResponse(seat,{type:'kan'});
    else if(act.type==='chi') this._reactResponse(seat,{type:'chi',tileIds:act.tileIds});
    else if(act.type==='pass') this._reactResponse(seat,{type:'pass'});
  }

  // ── Discard ────────────────────────────────────────────────────────────────
  _discard(seat,tileId){
    const g=this.game;
    const idx=g.hands[seat].findIndex(t=>t.id===tileId);
    if(idx===-1) return;
    const [tile]=g.hands[seat].splice(idx,1);
    if(g.riichiTile&&g.riichiTile[seat]===tile.id) tile.riichi=true;
    g.discards[seat].push(tile);
    g.drawTile=null;
    g.isRinshan=false;
    g.ippatsu=g.ippatsu.map((v,i)=>i===seat?false:v);
    g.turnCount++;

    // After discard, check nagashi (any non-terminal/honour or called tile = loses nagashi)
    const k=key(tile);
    const isTermHon=['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'].includes(k);
    if(!isTermHon) g.nagashi[seat]=false;

    // After first discard by all players, firstRound ends
    if(g.turnCount>=4) g.firstRound=false;

    // Update permanent furiten for this player
    this._updateFuriten(seat);

    const reactions=this._checkReactions(seat,tile);
    if(reactions.length){
      const humanInReactions=reactions.some(r=>!this.seats[r.seat]?.isBot);
      g.pending={tile,fromSeat:seat,seats:reactions.map(r=>r.seat),options:reactions,responses:{},timer:null};
      this._sendState();
      if(!humanInReactions){
        for(const r of reactions){
          const dec=botReact(g.hands[r.seat],tile,r.options);
          setTimeout(()=>{
            if(!g.pending) return;
            g.pending.responses[r.seat]=dec;
            if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
          },BOT_DELAY);
        }
      }
    } else {
      if(this._checkSuukaisan()) return;
      this._nextTurn();
    }
  }

  _checkReactions(fromSeat,tile){
    const g=this.game;
    const reactions=[];
    for(let seat=0;seat<4;seat++){
      if(seat===fromSeat) continue;
      const hand=g.hands[seat],opts=[];

      // Ron: only if not in furiten
      if(!this._isFuriten(seat)&&isWin([...hand,tile],g.melds[seat])){
        const sw=this._seatWindOf(seat);
        const isDblRiichi=g.doubleRiichi[seat];
        const {han}=detectYaku([...hand,tile],g.melds[seat],false,sw,this._roundWindValue(),
          g.riichi[seat],g.ippatsu[seat],isDblRiichi,false,false,false,g.haiteiNext,false,false,key(tile));
        if(han>0) opts.push({type:'ron'});
      }
      if(!g.riichi[seat]){
        if(canPon(hand,tile)) opts.push({type:'pon'});
        if(canKan(hand,tile)&&g.kanCount<4) opts.push({type:'kan'});
        if(seat===(fromSeat+1)%4){
          const seqs=canChi(hand,tile);
          if(seqs.length) opts.push({type:'chi',sequences:seqs});
        }
      }
      if(opts.length) reactions.push({seat,options:opts});
    }
    return reactions;
  }

  _reactResponse(seat,resp){
    const g=this.game;
    if(!g.pending||!g.pending.seats.includes(seat)) return;
    g.pending.responses[seat]=resp;

    // If player passes a valid ron, set temporary furiten
    if(resp.type==='pass'){
      const myOpts=g.pending.options.find(r=>r.seat===seat);
      if(myOpts&&myOpts.options.some(o=>o.type==='ron')){
        g.tempFuriten[seat]=true;
      }
    }

    if(resp.type==='ron'){this._resolveReactions();return;}
    if(resp.type==='kan'){const tile=g.pending.tile;g.pending=null;this._daiminkan(seat,tile);return;}

    const tile=g.pending.tile;
    for(const r of g.pending.options){
      const s=r.seat;
      if(this.seats[s]?.isBot&&!g.pending.responses[s]){
        const dec=botReact(g.hands[s],tile,r.options);
        setTimeout(()=>{
          if(!g.pending) return;
          g.pending.responses[s]=dec;
          if(g.pending.seats.every(s2=>g.pending.responses[s2])) this._resolveReactions();
        },BOT_DELAY);
      }
    }
    if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
  }

  _resolveReactions(){
    const g=this.game;
    if(!g.pending) return;
    const {tile,fromSeat,seats,options,responses}=g.pending;
    const humanResponded=seats.filter(s=>!this.seats[s]?.isBot).every(s=>responses[s]);
    if(!humanResponded) return;

    g.pending=null;

    // Collect all ron winners (multiple ron supported)
    const ronSeats=seats.filter(s=>(responses[s]||{type:'pass'}).type==='ron');
    if(ronSeats.length>0){
      // Multiple ron: all win, loser pays each separately
      this._multiRon(ronSeats,fromSeat,tile);
      return;
    }

    let ponSeat=null,chiSeat=null;
    for(const seat of seats){
      const r=responses[seat]||{type:'pass'};
      if(r.type==='pon'){ponSeat=seat;break;}
      if(r.type==='chi'){chiSeat=seat;break;}
    }
    if(ponSeat!==null) this._pon(ponSeat,tile,fromSeat);
    else if(chiSeat!==null) this._chi(chiSeat,tile,responses[chiSeat].tileIds,fromSeat);
    else {
      if(this._checkSuukaisan()) return;
      this._nextTurn();
    }
  }

  // ── Multiple Ron ───────────────────────────────────────────────────────────
  _multiRon(winSeats,loseSeat,tile){
    const g=this.game;
    const results=[];
    for(const winSeat of winSeats){
      const hand=[...g.hands[winSeat],tile];
      const sw=this._seatWindOf(winSeat);
      const isHoutei=g.haiteiNext&&!g.isRinshan;
      const isDblRiichi=g.doubleRiichi[winSeat];
      const {han,yakuList}=detectYaku(hand,g.melds[winSeat],false,sw,this._roundWindValue(),
        g.riichi[winSeat],g.ippatsu[winSeat],isDblRiichi,false,false,false,isHoutei,false,false,key(tile));
      if(han===0) continue;
      // Ura dora for riichi players
      const uraDora=g.riichi[winSeat]?this._countUraDora(hand):0;
      const dc=countDora(hand,g.dora)+uraDora+countAkaDora(hand);
      const totalHan=han+dc;
      const decomps=decompose(hand);
      const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
      const fu=decomps.length?calcFu(decomps[0],false,!g.melds[winSeat].length,key(tile),hasPinfu):30;
      const bp=basePoints(totalHan,fu);
      const pay=Math.ceil(bp*4/100)*100+g.honba*300;
      results.push({winSeat,hand,yakuList,han:totalHan,fu,pay,uraDora,dc});
    }
    if(!results.length){this._sendState();return;}

    // Each winner gets paid separately by loser; riichi sticks go to closest winner
    const totalRiichiSticks=g.riichiSticks;
    // Winner closest to loser in turn order gets the riichi sticks
    const closestWinner=winSeats.reduce((best,s)=>{
      const dist=(s-loseSeat+4)%4;
      const bestDist=(best-loseSeat+4)%4;
      return dist<bestDist?s:best;
    },winSeats[0]);

    let totalLoss=0;
    const winGains={};
    for(const r of results){
      totalLoss+=r.pay;
      winGains[r.winSeat]=(winGains[r.winSeat]||0)+r.pay;
    }
    g.scores[loseSeat]-=totalLoss;
    for(const r of results){
      g.scores[r.winSeat]+=winGains[r.winSeat];
    }
    g.scores[closestWinner]+=totalRiichiSticks*1000;

    // Build combined yaku display (show first winner's hand info in round_end, extras in extras)
    const primary=results[0];
    const yl=primary.dc>0?[...primary.yakuList,{name:'Dora',jp:'ドラ',han:primary.dc}]:primary.yakuList;
    this._endRound('ron',primary.winSeat,loseSeat,primary.hand,yl,primary.han,primary.fu,totalLoss,
      results.length>1?results.slice(1):null);
  }

  // ── Pon / Chi ──────────────────────────────────────────────────────────────
  _pon(seat,tile,fromSeat){
    const g=this.game;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===key(tile));
    const used=matches.slice(0,2);
    g.hands[seat]=hand.filter(t=>!used.map(u=>u.id).includes(t.id));
    g.melds[seat].push({type:'pon',tiles:[...used,tile],calledTileId:tile.id,fromSeat});
    g.nagashi[seat]=false;
    g.turn=seat;
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,bestDiscard(g.hands[seat])),BOT_DELAY);
  }

  _chi(seat,tile,tileIds,fromSeat){
    const g=this.game;
    const hand=g.hands[seat];
    const used=hand.filter(t=>tileIds.includes(t.id));
    g.hands[seat]=hand.filter(t=>!tileIds.includes(t.id));
    g.melds[seat].push({type:'chi',tiles:sort([...used,tile]),calledTileId:tile.id,fromSeat});
    g.nagashi[seat]=false;
    g.turn=seat;
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,bestDiscard(g.hands[seat])),BOT_DELAY);
  }

  // ── Kan types ──────────────────────────────────────────────────────────────
  _daiminkan(seat,tile){
    const g=this.game;
    if(g.kanCount>=4) return;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===key(tile));
    if(matches.length<3) return;
    g.hands[seat]=hand.filter(t=>!matches.map(u=>u.id).includes(t.id));
    g.melds[seat].push({type:'kan',kanType:'daiminkan',tiles:[...matches,tile],calledTileId:tile.id,open:true});
    g.kanCount++;g.kanSeats.push(seat);
    g.nagashi[seat]=false;
    this._openNewDora(g);
    g.turn=seat;
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'kan',seat,kanType:'daiminkan'});
    this._draw(true);
  }

  _ankan(seat,tileKey){
    const g=this.game;
    // Allow ankan in riichi only if waits don't change
    if(g.kanCount>=4) return;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===tileKey);
    if(matches.length<4) return;
    if(g.riichi[seat]){
      const before=waits(hand.filter(t=>key(t)!==tileKey));
      // After removing 3 copies, remaining hand (1 copy stays) — compute waits
      const after=waits(hand.filter(t=>!matches.slice(0,3).map(u=>u.id).includes(t.id)));
      const sameWaits=before.length===after.length&&before.every(w=>after.includes(w));
      if(!sameWaits) return;
    }
    g.hands[seat]=hand.filter(t=>key(t)!==tileKey);
    g.melds[seat].push({type:'kan',kanType:'ankan',tiles:[...matches],calledTileId:null,open:false});
    g.kanCount++;g.kanSeats.push(seat);
    this._openNewDora(g);
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'kan',seat,kanType:'ankan'});
    this._draw(true);
  }

  _kakan(seat,tileId){
    const g=this.game;
    if(g.kanCount>=4||g.riichi[seat]) return;
    const hand=g.hands[seat];
    const addTile=hand.find(t=>t.id===tileId);
    if(!addTile) return;
    const ponIdx=g.melds[seat].findIndex(m=>m.type==='pon'&&key(m.tiles[0])===key(addTile));
    if(ponIdx===-1) return;
    const reactions=this._checkChankan(seat,addTile);
    if(reactions.length){
      g.pending={tile:addTile,fromSeat:seat,seats:reactions.map(r=>r.seat),
        options:reactions,responses:{},isChankan:true,
        timer:setTimeout(()=>this._completeChankan(seat,addTile,ponIdx),3000)};
      this._sendState();
      for(const r of reactions){
        if(this.seats[r.seat]?.isBot){
          const dec=botReact(g.hands[r.seat],addTile,r.options);
          setTimeout(()=>{if(!g.pending)return;g.pending.responses[r.seat]=dec;this._checkChankanReacted(seat,addTile,ponIdx);},BOT_DELAY);
        }
      }
      return;
    }
    this._completeChankan(seat,addTile,ponIdx);
  }

  _checkChankan(fromSeat,tile){
    const g=this.game;
    const reactions=[];
    for(let seat=0;seat<4;seat++){
      if(seat===fromSeat) continue;
      const hand=g.hands[seat];
      if(!this._isFuriten(seat)&&isWin([...hand,tile],g.melds[seat])&&g.riichi[seat]){
        const sw=this._seatWindOf(seat);
        const {han}=detectYaku([...hand,tile],g.melds[seat],false,sw,this._roundWindValue(),
          true,g.ippatsu[seat],g.doubleRiichi[seat],false,true,false,false,false,false,key(tile));
        if(han>0) reactions.push({seat,options:[{type:'ron'}]});
      }
    }
    return reactions;
  }

  _checkChankanReacted(seat,addTile,ponIdx){
    const g=this.game;
    if(!g.pending) return;
    if(g.pending.seats.every(s=>g.pending.responses[s])){
      clearTimeout(g.pending.timer);
      const r=g.pending.responses;
      const ronSeats=g.pending.seats.filter(s=>(r[s]||{type:'pass'}).type==='ron');
      if(ronSeats.length>0){
        g.pending=null;
        this._multiRon(ronSeats,seat,addTile);
        return;
      }
      g.pending=null;
      this._completeChankan(seat,addTile,ponIdx);
    }
  }

  _completeChankan(seat,addTile,ponIdx){
    const g=this.game;
    if(g.pending){clearTimeout(g.pending.timer);g.pending=null;}
    g.hands[seat]=g.hands[seat].filter(t=>t.id!==addTile.id);
    const pon=g.melds[seat][ponIdx];
    pon.type='kan';pon.kanType='kakan';pon.tiles.push(addTile);
    g.kanCount++;g.kanSeats.push(seat);
    this._openNewDora(g);
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'kan',seat,kanType:'kakan'});
    this._draw(true);
  }

  // Suukaisan: 4 kans by different players = abortive draw
  _checkSuukaisan(){
    const g=this.game;
    if(g.kanCount<4) return false;
    if(new Set(g.kanSeats).size===1) return false;
    this._endRound('suukaisan');
    return true;
  }

  _openNewDora(g){
    const nextIdx=4+g.dora.length;
    if(nextIdx<g.deadWall.length) g.dora.push(g.deadWall[nextIdx]);
  }

  // Ura dora: indicators at deadWall[9-13], same count as kanDora reveals
  _countUraDora(hand){
    const g=this.game;
    // ura indicators: deadWall[9] through deadWall[9 + dora.length - 1]
    const uraIndicators=g.deadWall.slice(9,9+g.dora.length);
    return countDora(hand,uraIndicators);
  }

  // ── Riichi ─────────────────────────────────────────────────────────────────
  _riichi(seat,tileId){
    const g=this.game;
    if(g.riichi[seat]||g.scores[seat]<1000) return;
    const hand=g.hands[seat];
    if(waits(hand.filter(t=>t.id!==tileId),g.melds[seat]).length===0) return;
    g.riichi[seat]=true;
    g.ippatsu[seat]=true;
    // Double riichi: declared on first discard before any calls have been made
    const isDouble=g.firstRound&&g.melds.every(m=>m.length===0);
    g.doubleRiichi[seat]=isDouble;
    g.scores[seat]-=1000;g.riichiSticks++;
    if(!g.riichiTile) g.riichiTile={};
    g.riichiTile[seat]=tileId;
    this._broadcastAll({type:'riichi',seat,name:this.seats[seat]?.name,scores:g.scores,isDouble});
    this._discard(seat,tileId);
  }

  // ── Win ─────────────────────────────────────────────────────────────────────
  _tsumo(seat){
    const g=this.game;
    const hand=g.hands[seat];
    if(!isWin(hand,g.melds[seat])) return;
    if(this._isFuriten(seat)) return;
    const sw=this._seatWindOf(seat);
    const isHaitei=g.haiteiNext&&!g.isRinshan;
    // Tenhou: dealer tsumo on very first draw (no discards yet from anyone)
    const isTenhou=seat===g.dealer&&g.turnCount===0&&hand.length===14;
    // Chiihou: non-dealer tsumo on own first draw before any calls
    const isChiihou=seat!==g.dealer&&g.firstRound&&g.melds.every(m=>m.length===0)&&hand.length===14;
    const isDblRiichi=g.doubleRiichi[seat];

    const {han,yakuList}=detectYaku(hand,g.melds[seat],true,sw,this._roundWindValue(),
      g.riichi[seat],g.ippatsu[seat],isDblRiichi,g.isRinshan,false,isHaitei,false,isTenhou,isChiihou,
      g.drawTile?key(g.drawTile):null);
    if(han===0) return;

    // Ura dora (only on riichi)
    const uraDora=g.riichi[seat]?this._countUraDora(hand):0;
    const dc=countDora(hand,g.dora)+uraDora+countAkaDora(hand);
    const totalHan=han+dc;
    const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
    const decomps=decompose(hand);
    const winKey=g.drawTile?key(g.drawTile):null;
    const fu=decomps.length?calcFu(decomps[0],true,!g.melds[seat].length,winKey,hasPinfu):30;
    const bp=basePoints(totalHan,fu);
    const isDealer=seat===g.dealer;
    let gain=0;
    for(let i=0;i<4;i++){
      if(i===seat) continue;
      const pay=Math.ceil((isDealer?bp*2:i===g.dealer?bp*2:bp)/100)*100+g.honba*100;
      g.scores[i]-=pay;gain+=pay;
    }
    g.scores[seat]+=gain+g.riichiSticks*1000;
    const yl=dc>0?[...yakuList,{name:'Dora',jp:'ドラ',han:dc}]:yakuList;
    if(uraDora>0) yl.push({name:'Ura Dora',jp:'裏ドラ',han:uraDora});
    const akaDora=countAkaDora(hand);if(akaDora>0) yl.push({name:'Aka Dora',jp:'赤ドラ',han:akaDora});
    this._endRound('tsumo',seat,null,hand,yl,totalHan,fu,gain);
  }

  _ron(winSeat,loseSeat,tile,isChankan=false){
    const g=this.game;
    const hand=[...g.hands[winSeat],tile];
    const sw=this._seatWindOf(winSeat);
    const isHoutei=g.haiteiNext&&!g.isRinshan;
    const isDblRiichi=g.doubleRiichi[winSeat];
    const {han,yakuList}=detectYaku(hand,g.melds[winSeat],false,sw,this._roundWindValue(),
      g.riichi[winSeat],g.ippatsu[winSeat],isDblRiichi,false,isChankan,false,isHoutei,false,false,key(tile));
    if(han===0){this._sendState();return;}

    const uraDora=g.riichi[winSeat]?this._countUraDora(hand):0;
    const dc=countDora(hand,g.dora)+uraDora+countAkaDora(hand);
    const totalHan=han+dc;
    const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
    const decomps=decompose(hand);
    const fu=decomps.length?calcFu(decomps[0],false,!g.melds[winSeat].length,key(tile),hasPinfu):30;
    const bp=basePoints(totalHan,fu);
    const pay=Math.ceil(bp*4/100)*100+g.honba*300+g.riichiSticks*1000;
    g.scores[loseSeat]-=pay;g.scores[winSeat]+=pay;
    const yl=dc>0?[...yakuList,{name:'Dora',jp:'ドラ',han:dc}]:yakuList;
    if(uraDora>0) yl.push({name:'Ura Dora',jp:'裏ドラ',han:uraDora});
    const akaDora=countAkaDora(hand);if(akaDora>0) yl.push({name:'Aka Dora',jp:'赤ドラ',han:akaDora});
    this._endRound('ron',winSeat,loseSeat,hand,yl,totalHan,fu,pay);
  }

  // ── Round end ───────────────────────────────────────────────────────────────
  _endRound(reason,winner,loser,hand,yakuList,han,fu,payment,extraWinners){
    const g=this.game;
    // Tobi check (bankruptcy)
    const bust=g.scores.findIndex(s=>s<0);

    // Nagashi Mangan check (exhaustive draw only)
    if(reason==='draw'){
      const nagashiSeats=g.nagashi.map((ok,i)=>{
        if(!ok) return false;
        // Must have no melds
        if(g.melds[i].length>0) return false;
        // All discards must be terminals/honours (already tracked via nagashi flag)
        return true;
      });
      if(nagashiSeats.some(Boolean)){
        this._resolveNagashi(nagashiSeats);
        return;
      }

      // Tenpai payments
      this._resolveTenpaiPayments();
      return;
    }

    // Advance round / dealer
    const dealerWon = winner===g.dealer;
    let newHonba=g.honba;
    let newRiichiSticks=0;
    let newDealer=g.dealer;
    let newRound=g.round;
    let newRoundWind=g.roundWind;

    if(reason==='tsumo'||reason==='ron'){
      if(dealerWon){
        // Dealer wins → repeat (honba+1)
        newHonba=g.honba+1;
        newRiichiSticks=0;
      } else {
        // Non-dealer wins → advance dealer
        newHonba=0;
        newDealer=(g.dealer+1)%4;
        if(newDealer===0){
          // Full rotation complete — advance round wind
          newRound=g.round+1;
          newRoundWind=g.roundWind+1;
        }
      }
    } else {
      // Abortive draw → repeat with honba+1
      newHonba=g.honba+1;
      newRiichiSticks=g.riichiSticks;
    }

    this._broadcastAll({type:'round_end',reason,winner,loser,hand,yakuList,han,fu,payment,
      scores:g.scores,handLabel:han?handLabel(han):'',
      playerNames:this.seats.map(p=>p?.name||'—'),
      extraWinners:extraWinners||null,
      uraDora: g.deadWall.slice(9,9+g.dora.length),
      dora: g.dora,
    });

    // Game over conditions
    if(bust>=0){
      this.phase='done';
      this._broadcastAll({type:'game_over',reason:'tobi',bust,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      return;
    }

    // Hanchan: East round (winds 1-4) + South round (winds 5-8) = 8 rounds total
    // newRoundWind > 8 means South 4 complete → game over
    if(newRoundWind>(this.gameMode==="hanchan"?8:4)){
      this.phase='done';
      this._broadcastAll({type:'game_over',reason:'end',scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      return;
    }

    // Start next round after delay
    setTimeout(()=>{
      if(this.phase!=='playing') return;
      g.dealer=newDealer;
      g.round=newRound;
      g.roundWind=newRoundWind;
      g.honba=newHonba;
      g.riichiSticks=reason==='suukaisan'?g.riichiSticks:newRiichiSticks;
      g.turn=newDealer;
      this._initRound();
      this._broadcastAll({type:'round_start',round:newRound,roundWind:newRoundWind,displayWind:newRoundWind<=4?1:2,displayRound:((newRoundWind-1)%4)+1,
        dealer:newDealer,honba:newHonba,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      setTimeout(()=>this._draw(),300);
    },6000);
  }

  _resolveTenpaiPayments(){
    const g=this.game;
    const inTenpai=g.hands.map((hand,seat)=>{
      if(hand.length!==13) return false;
      return waits(hand,g.melds[i]).length>0;
    });
    const tenpaiCount=inTenpai.filter(Boolean).length;
    const notenCount=4-tenpaiCount;

    let payments=[0,0,0,0];
    if(tenpaiCount>0&&notenCount>0){
      // Standard: 3000 total split. Noten pays, tenpai receives.
      const totalPot=3000;
      const notPayEach=Math.floor(totalPot/notenCount);
      const tenpaiRecEach=Math.floor((notPayEach*notenCount)/tenpaiCount);
      for(let i=0;i<4;i++){
        if(inTenpai[i]) payments[i]=tenpaiRecEach;
        else { payments[i]=-notPayEach; g.scores[i]-=notPayEach; }
      }
      for(let i=0;i<4;i++){
        if(inTenpai[i]) g.scores[i]+=tenpaiRecEach;
      }
    }

    const tenpaiHands=g.hands.map((h,i)=>inTenpai[i]?h:null);
    this._broadcastAll({type:'round_end',reason:'draw',scores:g.scores,
      inTenpai,payments,tenpaiHands,
      playerNames:this.seats.map(p=>p?.name||'—'),
      dora:g.dora,
      uraDora:g.deadWall.slice(9,9+g.dora.length),
    });

    // Dealer tenpai = repeat; dealer noten = advance
    const dealerTenpai=inTenpai[g.dealer];
    const newHonba=g.honba+1;
    let newDealer=g.dealer;
    let newRound=g.round;
    let newRoundWind=g.roundWind;
    if(!dealerTenpai){
      newDealer=(g.dealer+1)%4;
      if(newDealer===0){newRound=g.round+1;newRoundWind=g.roundWind+1;}
    }

    const bust=g.scores.findIndex(s=>s<0);
    if(bust>=0){
      this.phase='done';
      setTimeout(()=>this._broadcastAll({type:'game_over',reason:'tobi',bust,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')}),1000);
      return;
    }
    if(newRoundWind>(this.gameMode==="hanchan"?8:4)){
      this.phase='done';
      setTimeout(()=>this._broadcastAll({type:'game_over',reason:'end',scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')}),1000);
      return;
    }

    setTimeout(()=>{
      if(this.phase!=='playing') return;
      g.dealer=newDealer;g.round=newRound;g.roundWind=newRoundWind;
      g.honba=newHonba;g.turn=newDealer;
      this._initRound();
      this._broadcastAll({type:'round_start',round:newRound,roundWind:newRoundWind,displayWind:newRoundWind<=4?1:2,displayRound:((newRoundWind-1)%4)+1,
        dealer:newDealer,honba:newHonba,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      setTimeout(()=>this._draw(),300);
    },6000);
  }

  _resolveNagashi(nagashiSeats){
    const g=this.game;
    // Nagashi Mangan: 8000 base. Dealer pays/receives double.
    for(let winner=0;winner<4;winner++){
      if(!nagashiSeats[winner]) continue;
      const isDealer=winner===g.dealer;
      let gain=0;
      for(let payer=0;payer<4;payer++){
        if(payer===winner) continue;
        const pay=Math.ceil((isDealer?8000*2:payer===g.dealer?8000*2:8000)/100)*100;
        g.scores[payer]-=pay; gain+=pay;
      }
      g.scores[winner]+=gain;
    }
    this._broadcastAll({type:'round_end',reason:'nagashi',nagashiSeats,scores:g.scores,
      playerNames:this.seats.map(p=>p?.name||'—'),dora:g.dora});

    // Nagashi: dealer repeat if dealer is nagashi winner
    const dealerNagashi=nagashiSeats[g.dealer];
    const newHonba=g.honba+1;
    let newDealer=g.dealer,newRound=g.round,newRoundWind=g.roundWind;
    if(!dealerNagashi){
      newDealer=(g.dealer+1)%4;
      if(newDealer===0){newRound++;newRoundWind++;}
    }
    if(newRoundWind>(this.gameMode==="hanchan"?8:4)){
      this.phase='done';
      setTimeout(()=>this._broadcastAll({type:'game_over',reason:'end',scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')}),1000);
      return;
    }
    setTimeout(()=>{
      if(this.phase!=='playing') return;
      g.dealer=newDealer;g.round=newRound;g.roundWind=newRoundWind;
      g.honba=newHonba;g.turn=newDealer;
      this._initRound();
      this._broadcastAll({type:'round_start',round:newRound,roundWind:newRoundWind,displayWind:newRoundWind<=4?1:2,displayRound:((newRoundWind-1)%4)+1,
        dealer:newDealer,honba:newHonba,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      setTimeout(()=>this._draw(),300);
    },6000);
  }

  _nextTurn(){
    const g=this.game;
    g.turn=(g.turn+1)%4;
    this._draw();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _seatWindOf(seat){
    // Seat wind relative to dealer: dealer=1(East), +1 each seat
    const g=this.game;
    return ((seat-g.dealer+4)%4)+1;
  }

  // Round wind for yaku: rounds 1-4 = East(1), rounds 5-8 = South(2)
  _roundWindValue(){
    return this.game.roundWind<=4?1:2;
  }

  // ── State broadcast ────────────────────────────────────────────────────────
  _sendState(){
    const g=this.game;
    if(!g) return;
    for(let seat=0;seat<4;seat++){
      const p=this.seats[seat];
      if(!p||p.isBot) continue;
      const hand=g.hands[seat];
      const w=waits(hand,g.melds[seat]);
      let canRiichi=[];
      if(hand.length===14&&!g.melds[seat].length&&!g.riichi[seat]&&g.scores[seat]>=1000){
        canRiichi=hand.filter(t=>waits(hand.filter(x=>x.id!==t.id)).length>0).map(t=>t.id);
      }
      let canAnkan=[];
      if(g.turn===seat&&hand.length===14){
        const c={};hand.forEach(t=>{c[key(t)]=(c[key(t)]||0)+1;});
        if(!g.riichi[seat]){
          canAnkan=Object.entries(c).filter(([k,n])=>n===4).map(([k])=>k);
        } else {
          // In riichi: only allow ankan if waits don't change
          canAnkan=Object.entries(c).filter(([k,n])=>{
            if(n!==4) return false;
            const before=waits(hand.filter(t=>key(t)!==k));
            const matches=hand.filter(t=>key(t)===k);
            const after=waits(hand.filter(t=>!matches.slice(0,3).map(u=>u.id).includes(t.id)));
            return before.length===after.length&&before.every(w=>after.includes(w));
          }).map(([k])=>k);
        }
      }
      let canKakan=[];
      if(g.turn===seat&&!g.riichi[seat]&&hand.length===14){
        const ponKeys=g.melds[seat].filter(m=>m.type==='pon').map(m=>key(m.tiles[0]));
        canKakan=hand.filter(t=>ponKeys.includes(key(t))).map(t=>t.id);
      }
      let pendingForMe=null;
      if(g.pending&&g.pending.seats.includes(seat)){
        const myR=g.pending.options.find(r=>r.seat===seat);
        pendingForMe={isForMe:true,discard:g.pending.tile,fromSeat:g.pending.fromSeat,
          options:myR?.options||[],isChankan:g.pending.isChankan||false};
      } else if(g.pending){
        pendingForMe={isForMe:false};
      }
      const sw=this._seatWindOf(seat);
      const canTsumo=(()=>{
        if(g.turn!==seat||!isWin(hand,g.melds[seat])||this._isFuriten(seat)) return false;
        const isDblRiichi=g.doubleRiichi[seat];
        const winKey=g.drawTile?key(g.drawTile):null;
        const {han}=detectYaku(hand,g.melds[seat],true,sw,this._roundWindValue(),
          g.riichi[seat],g.ippatsu[seat],isDblRiichi,g.isRinshan,false,g.haiteiNext,false,false,false,winKey);
        return han>0;
      })();
      // Send hand split: main hand (without draw tile) + draw tile separately
      // This avoids client-side ID-matching issues
      const fullHand=hand;
      const dt=g.turn===seat?g.drawTile:null;
      const mainHand=dt?fullHand.filter(t=>t.id!==dt.id):fullHand;
      this._send(p,{type:'game_state',seat,myHand:mainHand,drawTile:dt,myMelds:g.melds[seat],
        discards:g.discards,melds:g.melds,scores:g.scores,turn:g.turn,
        round:g.round,roundWind:g.roundWind,displayWind:g.roundWind<=4?1:2,displayRound:((g.roundWind-1)%4)+1,dealer:g.dealer,honba:g.honba,
        riichiSticks:g.riichiSticks,
        dora:g.dora,wallCount:g.wall.length,waits:w,riichi:g.riichi,
        doubleRiichi:g.doubleRiichi,
        furiten:g.furiten[seat]||g.tempFuriten[seat],
        pending:pendingForMe,canTsumo,canRiichi,canAnkan,canKakan,
        oppHandSizes:g.hands.map((h,i)=>i===seat?null:h.length),
        seatWinds:[0,1,2,3].map(s=>((s-g.dealer+4)%4))});
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
