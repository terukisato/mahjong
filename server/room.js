'use strict';
const {buildWall,shuffle,sort,key,isWin,waits,canPon,canKan,canChi,
       detectYaku,countDora,calcFu,basePoints,handLabel,decompose} = require('./mahjong');
const {botName,bestDiscard,botReact} = require('./bot');

let _roomId=0;
const BOT_DELAY=1200;

class Room {
  constructor(){
    this.id=++_roomId;
    this.phase='waiting';
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
      riichiTile:{},
      kanCount:0,           // total kans this round (max 4)
      kanSeats:[],          // which seat made each kan (for suukaisan check)
      isRinshan:false,      // next tsumo is rinshan
      haiteiNext:false,     // next draw is last tile
    };
    this.game.dora.push(this.game.deadWall[4]);
    this._broadcastAll({type:'game_start',seats:this._seatInfo()});
    setTimeout(()=>this._draw(),150);
  }

  // ── Turn flow ──────────────────────────────────────────────────────────
  _draw(fromRinshan=false){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    if(g.wall.length===0 && !fromRinshan){this._endRound('draw');return;}
    let t;
    if(fromRinshan){
      // Draw from dead wall (rinshan tile)
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
    this._sendState();
    const seat=this.seats[g.turn];
    if(seat?.isBot) setTimeout(()=>{if(!g.pending)this._botTurn(g.turn);},BOT_DELAY);
  }

  _botTurn(seat){
    const g=this.game;
    if(!g||g.turn!==seat||this.phase!=='playing') return;
    if(g.pending) return; // don't act while reactions are pending
    const hand=g.hands[seat];
    // Bot checks ankan
    if(!g.riichi[seat]){
      const ankanTile=this._findAnkan(seat);
      if(ankanTile){this._ankan(seat,ankanTile);return;}
    }
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

  // Find a tile in hand that can be ankaned (4 in hand)
  _findAnkan(seat){
    const g=this.game;
    const hand=g.hands[seat];
    const c={};
    for(const t of hand) c[key(t)]=(c[key(t)]||0)+1;
    for(const [k,n] of Object.entries(c)) if(n===4) return k;
    return null;
  }

  // ── Actions ─────────────────────────────────────────────────────────────
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

  // ── Discard ──────────────────────────────────────────────────────────────
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

    const reactions=this._checkReactions(seat,tile);
    if(reactions.length){
      const humanInReactions=reactions.some(r=>!this.seats[r.seat]?.isBot);
      g.pending={tile,fromSeat:seat,seats:reactions.map(r=>r.seat),options:reactions,responses:{},timer:null};
      this._sendState();
      if(!humanInReactions){
        // No humans — bots respond with delay then resolve
        for(const r of reactions){
          const dec=botReact(g.hands[r.seat],tile,r.options);
          setTimeout(()=>{
            if(!g.pending) return;
            g.pending.responses[r.seat]=dec;
            if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
          },BOT_DELAY);
        }
      }
      // If humans are in reactions: wait for human to call _reactResponse
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
      if(isWin([...hand,tile])){
        const sw=(seat+g.roundWind-1)%4+1;
        const {han}=detectYaku([...hand,tile],g.melds[seat],false,sw,g.roundWind,g.riichi[seat],g.ippatsu[seat]);
        if(han>0) opts.push({type:'ron'});
      }
      if(!g.riichi[seat]){
        if(canPon(hand,tile)) opts.push({type:'pon'});
        // Daiminkan (called kan from discard)
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
    if(resp.type==='ron'){this._resolveReactions();return;}
    if(resp.type==='kan'){const tile=g.pending.tile;g.pending=null;this._daiminkan(seat,tile);return;}
    // Human responded — now get bots to respond with a delay, then resolve
    const tile=g.pending.tile;
    for(const r of g.pending.options){
      const s=r.seat;
      if(this.seats[s]?.isBot&&!g.pending.responses[s]){
        const dec=botReact(g.hands[s],tile,r.options);
        setTimeout(()=>{
          if(!g.pending) return;
          g.pending.responses[s]=dec;
          // Resolve only when ALL seats have responded
          if(g.pending.seats.every(s2=>g.pending.responses[s2])) this._resolveReactions();
        },BOT_DELAY);
      }
    }
    // If no bots remain, resolve immediately
    if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
  }

  _resolveReactions(){
    const g=this.game;
    if(!g.pending) return;
    const {tile,fromSeat,seats,options,responses}=g.pending;
    const humanResponded=seats.filter(s=>!this.seats[s]?.isBot).every(s=>responses[s]);
    if(!humanResponded){
      console.error('[RESOLVE BLOCKED] Human has not responded yet! responses=',JSON.stringify(responses),'seats=',seats,'humanSeats=',seats.filter(s=>!this.seats[s]?.isBot));
      console.trace();
      return;
    }
    g.pending=null;
    let ronSeat=null,ponSeat=null,chiSeat=null;
    for(const seat of seats){
      const r=responses[seat]||{type:'pass'};
      if(r.type==='ron'){ronSeat=seat;break;}
      if(r.type==='pon') ponSeat=seat;
      if(r.type==='chi') chiSeat=seat;
    }
    if(ronSeat!==null) this._ron(ronSeat,fromSeat,tile);
    else if(ponSeat!==null) this._pon(ponSeat,tile,fromSeat);
    else if(chiSeat!==null) this._chi(chiSeat,tile,responses[chiSeat].tileIds,fromSeat);
    else {
      if(this._checkSuukaisan()) return;
      this._nextTurn();
    }
  }

  _pon(seat,tile,fromSeat){
    const g=this.game;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===key(tile));
    const used=matches.slice(0,2);
    g.hands[seat]=hand.filter(t=>!used.map(u=>u.id).includes(t.id));
    g.melds[seat].push({type:'pon',tiles:[...used,tile],calledTileId:tile.id,fromSeat});
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
    g.turn=seat;
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,bestDiscard(g.hands[seat])),BOT_DELAY);
  }

  // ── Kan types ─────────────────────────────────────────────────────────────

  // Daiminkan: called from another player's discard (4 tiles, open)
  _daiminkan(seat,tile){
    const g=this.game;
    if(g.kanCount>=4) return;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===key(tile));
    if(matches.length<3) return;
    g.hands[seat]=hand.filter(t=>!matches.map(u=>u.id).includes(t.id));
    g.melds[seat].push({type:'kan',kanType:'daiminkan',tiles:[...matches,tile],calledTileId:tile.id});
    g.kanCount++;g.kanSeats.push(seat);
    this._openNewDora(g);
    g.turn=seat;
    g.ippatsu=g.ippatsu.map(()=>false); // kan breaks ippatsu
    this._broadcastAll({type:'kan',seat,kanType:'daiminkan'});
    this._draw(true); // draw rinshan tile
  }

  // Ankan: closed kan from own hand (4 tiles in hand)
  _ankan(seat,tileKey){
    const g=this.game;
    if(g.kanCount>=4||g.riichi[seat]) return; // riichi players can't ankan unless it doesn't change waits
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===tileKey);
    if(matches.length<4) return;
    // If in riichi, only allow if waits don't change
    if(g.riichi[seat]){
      const before=waits(hand.filter(t=>key(t)!==tileKey));
      const after=waits(hand.filter(t=>!matches.slice(0,3).map(u=>u.id).includes(t.id)));
      const sameWaits=before.length===after.length&&before.every(w=>after.includes(w));
      if(!sameWaits) return;
    }
    g.hands[seat]=hand.filter(t=>key(t)!==tileKey);
    g.melds[seat].push({type:'kan',kanType:'ankan',tiles:[...matches],calledTileId:null});
    g.kanCount++;g.kanSeats.push(seat);
    // Ankan reveals new dora after draw (flip ura dora indicator for ankan)
    this._openNewDora(g);
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'kan',seat,kanType:'ankan'});
    this._draw(true);
  }

  // Kakan: add tile to existing pon to make kan
  _kakan(seat,tileId){
    const g=this.game;
    if(g.kanCount>=4||g.riichi[seat]) return;
    const hand=g.hands[seat];
    const addTile=hand.find(t=>t.id===tileId);
    if(!addTile) return;
    const ponIdx=g.melds[seat].findIndex(m=>m.type==='pon'&&key(m.tiles[0])===key(addTile));
    if(ponIdx===-1) return;
    // Check chankan: other players can ron on this tile
    const reactions=this._checkChankan(seat,addTile);
    if(reactions.length){
      // Offer chankan ron first
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
      if(isWin([...hand,tile])&&g.riichi[seat]){ // only riichi players can chankan
        const sw=(seat+g.roundWind-1)%4+1;
        const {han}=detectYaku([...hand,tile],g.melds[seat],false,sw,g.roundWind,true,g.ippatsu[seat],false,false,true);
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
      for(const s of g.pending.seats){
        if((r[s]||{type:'pass'}).type==='ron'){
          g.pending=null;
          this._ron(s,seat,addTile,true);// isChankan=true
          return;
        }
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
    // All 4 kans by the same player = NOT suukaisan (that player may win with suu kantsu)
    if(new Set(g.kanSeats).size===1) return false;
    // 4 kans by multiple players = abortive draw
    this._endRound('suukaisan');
    return true;
  }

  // Reveal next dora indicator from dead wall
  _openNewDora(g){
    const nextIdx=4+g.dora.length; // dead wall layout: [0-3]=rinshan, [4-8]=dora indicators
    if(nextIdx<g.deadWall.length) g.dora.push(g.deadWall[nextIdx]);
  }

  // ── Win ────────────────────────────────────────────────────────────────
  _tsumo(seat){
    const g=this.game;
    const hand=g.hands[seat];
    if(!isWin(hand)) return;
    const sw=(seat+g.roundWind-1)%4+1;
    const isHaitei=g.haiteiNext&&!g.isRinshan;
    const {han,yakuList}=detectYaku(hand,g.melds[seat],true,sw,g.roundWind,
      g.riichi[seat],g.ippatsu[seat],false,g.isRinshan,false,isHaitei,false);
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

  _ron(winSeat,loseSeat,tile,isChankan=false){
    const g=this.game;
    const hand=[...g.hands[winSeat],tile];
    const sw=(winSeat+g.roundWind-1)%4+1;
    const isHoutei=g.haiteiNext&&!g.isRinshan;
    const {han,yakuList}=detectYaku(hand,g.melds[winSeat],false,sw,g.roundWind,
      g.riichi[winSeat],g.ippatsu[winSeat],false,false,isChankan,false,isHoutei);
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
    if(!g.riichiTile) g.riichiTile={};
    g.riichiTile[seat]=tileId;
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
    if(g.pending) console.log('[sendState] pending=true seats=',g.pending.seats,'responses=',Object.keys(g.pending.responses));
    else console.log('[sendState] pending=null, stack:', new Error().stack.split('\n').slice(1,4).join(' | '));
    for(let seat=0;seat<4;seat++){
      const p=this.seats[seat];
      if(!p||p.isBot) continue;
      const hand=g.hands[seat];
      const w=hand.length===13?waits(hand):[];
      let canRiichi=[];
      if(hand.length===14&&!g.melds[seat].length&&!g.riichi[seat]&&g.scores[seat]>=1000){
        canRiichi=hand.filter(t=>waits(hand.filter(x=>x.id!==t.id)).length>0).map(t=>t.id);
      }
      // Ankan: tiles in hand with 4 copies (only on your turn, not in riichi)
      let canAnkan=[];
      if(g.turn===seat&&!g.riichi[seat]&&hand.length===14){
        const c={};hand.forEach(t=>{c[key(t)]=(c[key(t)]||0)+1;});
        canAnkan=Object.entries(c).filter(([k,n])=>n===4).map(([k])=>k);
      }
      // Kakan: tiles in hand that match an existing pon
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
      const sw=(seat+g.roundWind-1)%4+1;
      const canTsumo=(()=>{
        if(g.turn!==seat||!isWin(hand)) return false;
        const {han}=detectYaku(hand,g.melds[seat],true,sw,g.roundWind,g.riichi[seat],g.ippatsu[seat]);
        return han>0;
      })();
      this._send(p,{type:'game_state',seat,myHand:hand,myMelds:g.melds[seat],
        discards:g.discards,melds:g.melds,scores:g.scores,turn:g.turn,
        round:g.round,roundWind:g.roundWind,honba:g.honba,riichiSticks:g.riichiSticks,
        dora:g.dora,wallCount:g.wall.length,waits:w,riichi:g.riichi,pending:pendingForMe,
        canTsumo,canRiichi,canAnkan,canKakan,
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
