'use strict';
const {buildWall,shuffle,sort,key,isWin,waits,canPon,canKan,canChi,
       detectYaku,countDora,countAkaDora,calcFu,waitFu,basePoints,handLabel,decompose,isMenzen} = require('./mahjong');
const {botName,bestDiscard,botReact} = require('./bot');
const {recordGameResult} = require('./stats');

let _roomId=0;
const BOT_DELAY=1200; // pause before a bot acts, so its move is readable on screen
// Must match roundStartBanner()'s 3400ms timer in public/script.js — the
// client blocks all clicks (human) for that long while the "東2局" card is
// up, but bots aren't aware of it and act on their own timers regardless.
// Holding the dealer's first draw off until the card would have cleared
// keeps a bot from drawing/discarding/calling while the card is still on
// screen, instead of just hiding the result until it clears.
const ROUND_START_DELAY=3400;
// Chat message colour palette — must match CHAT_COLORS in public/script.js.
// Validated server-side rather than trusting the client's `color` field
// verbatim, since it gets echoed straight into another player's page.
const CHAT_COLORS=new Set(['#ffffff','#f0d080','#ff6b6b','#6bff8f','#6bb6ff','#ff8fd6','#6bfff0','#ffb366']);

// ── Dead wall layout (14 tiles) ─────────────────────────────────────────────
// [0-3]  = rinshan tiles (drawn on kan)
// [4-8]  = dora indicators  (dora[0] = deadWall[4], revealed on kan = deadWall[5..8])
// [9-13] = ura dora indicators (revealed only on riichi win)

// One Room = one table (this.numPlayers seats — 4 for standard yonma, 3 for
// sanma) for a full game (tonpuu/hanchan). `this.seats` holds up to
// numPlayers player-or-bot entries (index = seat number, stable for the
// whole game); `this.game` holds all per-game/per-round mutable state and is
// null until start() is called. mahjong.js has no knowledge of turn order or
// the wall — this class owns the state machine and calls into mahjong.js
// (imported above) purely for "is this a win / what yaku / how many fu"
// questions given a snapshot of tiles.
//
// Call priority when a discard can be reacted to (ron/pon/kan/chi): ron
// always wins if anyone can ron; among calls, pon/kan (either) beat chi;
// chi is further restricted to the player sitting immediately after the
// discarder — and is disabled entirely in sanma (this.rules.sanma). See
// _checkReactions/_resolveReactions.
//
// `g.pending` (set while waiting on ron/pon/chi/kan responses to a discard,
// or on chankan responses to an added kan) has the shape:
//   {tile, fromSeat, seats:[...reacting seats], options:[{seat,options}],
//    responses:{seat: {type, ...}}, timer, isChankan?}
class Room {
  constructor(gameMode='tonpuu', difficulty='normal', rules={}, numPlayers=4){
    this.id=++_roomId;
    this.phase='waiting';
    this.gameMode=gameMode; // 'tonpuu' (3/4 rounds) or 'hanchan' (6/8 rounds)
    this.difficulty=difficulty; // 'easy'|'normal'|'hard', stamped onto bots at _makeBot time
    this.numPlayers=numPlayers===3?3:4; // 3 (sanma) or 4 (yonma, default)
    // Rule variants, picked once in the lobby before the match starts (like
    // gameMode) — !==false means anything other than an explicit `false`
    // (including undefined) stays on, matching each toggle's "opt out" framing.
    // `sanma` is derived from numPlayers, not independently settable — it's
    // the single source of truth every 3-vs-4-seat branch reads from.
    // `chonbo` is the one exception to the opt-out framing: it removes a
    // safety net (Tsumo/Ron become declarable even when not yet confirmed
    // valid — see _tsumo/_checkReactions/_chonboPenalty), so it defaults
    // OFF and needs an explicit `true`, not just "anything but false".
    this.rules={
      akaDora: rules.akaDora!==false,
      kuitanAri: rules.kuitanAri!==false,
      doubleRon: rules.doubleRon!==false,
      nagashiMangan: rules.nagashiMangan!==false,
      sanma: this.numPlayers===3,
      chonbo: rules.chonbo===true,
    };
    this.seats=new Array(this.numPlayers).fill(null);
    this.ready=new Set();
    this.roundReady=new Set();
    this.pendingNextRound=null;
    this.game=null;
  }

  // Hands per wind round = number of dealers = numPlayers (3 for sanma, 4
  // for yonma). tonpuu (East only) = numPlayers hands; hanchan (East+South)
  // = numPlayers*2. Centralizing this avoids the `gameMode==="hanchan"?8:4`
  // ternary (previously repeated verbatim at every round/game-end site)
  // silently drifting out of sync with numPlayers.
  _maxRound(){
    return this.numPlayers*(this.gameMode==='hanchan'?2:1);
  }

  addHuman(player){
    // Fill the lowest-numbered open seat first — the lobby's matchmaking
    // slots (public/index.html #slots) render seats[i] straight into
    // .slot #i left-to-right, so this fills the panel from the left as
    // players join instead of dropping them into a random slot. Seats are
    // always kept bot-filled while waiting (see fillBots() below and
    // removeHuman()), so a truly empty (null) seat is rare — when there
    // isn't one, evict the lowest-numbered BOT seat instead, so a second
    // real human can still join an already-bot-filled room rather than
    // being bounced into a brand-new one.
    let seat=this.seats.findIndex(s=>s===null);
    if(seat===-1) seat=this.seats.findIndex(s=>s&&s.isBot);
    if(seat===-1) return false;
    player.seat=seat;
    this.seats[seat]=player;
    this.fillBots(); // also broadcasts room_update — top up any other empty seats immediately
    return true;
  }

  removeHuman(playerId){
    const seat=this.seats.findIndex(p=>p&&!p.isBot&&p.id===playerId);
    if(seat===-1) return;
    this.ready.delete(playerId);
    // Always refill with a fresh bot (not null) so the table stays full —
    // matches fillBots()/addHuman() always keeping every seat occupied.
    this.seats[seat]=this._makeBot(seat);
    this._broadcastRoomUpdate();
  }

  humanCount(){ return this.seats.filter(p=>p&&!p.isBot).length; }
  totalCount(){ return this.seats.filter(Boolean).length; }

  fillBots(){
    for(let i=0;i<this.numPlayers;i++){
      if(!this.seats[i]) this.seats[i]=this._makeBot(i);
    }
    this._broadcastRoomUpdate();
  }

  _makeBot(seat){
    return {id:`bot-${seat}-${Date.now()}`,name:botName(),seat,isBot:true,difficulty:this.difficulty};
  }

  setReady(playerId){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p||this.phase!=='waiting') return;
    this.ready.add(playerId);
    this._broadcastRoomUpdate();
    this._checkAllReady();
  }

  // Any seated human may adjust any bot's difficulty pre-game — a shared
  // table setting, not exclusive to whoever's "closest" to that seat. Takes
  // effect immediately: every bot-decision call site (_botTurn, botReact,
  // the post-pon/chi discards, the kakan reaction loop) reads
  // this.seats[seat].difficulty fresh at decision time, no caching.
  setBotDifficulty(playerId, seat, difficulty){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p||this.phase!=='waiting') return;
    if(!Number.isInteger(seat)||seat<0||seat>=this.numPlayers) return;
    if(!['easy','normal','hard'].includes(difficulty)) return;
    const bot=this.seats[seat];
    if(!bot||!bot.isBot) return;
    bot.difficulty=difficulty;
    this._broadcastRoomUpdate();
  }

  _checkAllReady(){
    const humans=this.seats.filter(p=>p&&!p.isBot);
    if(humans.length>0 && humans.every(p=>this.ready.has(p.id))){
      this.fillBots();
      this.start();
    }
  }

  chat(playerId, text, color){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p) return;
    const msg=text.trim().slice(0,60);
    if(!msg) return;
    const safeColor=CHAT_COLORS.has(color)?color:'#ffffff';
    this._broadcastAll({type:'chat',seat:p.seat,name:p.name,text:msg,color:safeColor});
  }

  // ── Game lifecycle ─────────────────────────────────────────────────────────
  // Resets everything that's scoped to a single round (hand) — deals a fresh
  // wall, clears riichi/furiten/melds/etc. Does NOT touch scores, dealer,
  // round number, or honba/riichiSticks carried over from the previous round
  // — those live on `this.game` directly and are set by start() (new game)
  // or by the pendingNextRound closures in _endRound/_resolveTenpaiPayments/
  // _resolveNagashi (next round after a win/draw).
  _initRound(){
    const g=this.game;
    const n=this.numPlayers;
    const wall=shuffle(buildWall(this.rules.akaDora,this.rules.sanma));
    const hands=Array.from({length:n},()=>[]);
    for(let i=0;i<13*n;i++) hands[i%n].push(wall.shift());
    const deadWall=wall.splice(-14);

    g.wall=wall;
    g.deadWall=deadWall;
    g.hands=hands.map(h=>sort(h));
    g.discards=Array.from({length:n},()=>[]);
    g.melds=Array.from({length:n},()=>[]);
    g.dora=[deadWall[4]];
    g.riichi=new Array(n).fill(false);
    g.doubleRiichi=new Array(n).fill(false); // track double riichi separately
    g.ippatsu=new Array(n).fill(false);
    g.furiten=new Array(n).fill(false);     // permanent furiten (discarded own wait)
    g.tempFuriten=new Array(n).fill(false); // temporary furiten (passed a ron opportunity)
    g.pending=null;
    g.drawTile=null;
    g.riichiTile={};
    g.riichiTileCalled={};
    g.kanCount=0;
    g.kanSeats=[];
    g.isRinshan=false;
    g.haiteiNext=false;
    g.firstRound=true;   // for double riichi / tenhou / chiihou detection
    g.turnCount=0;       // total discards this round
    g.nagashi=new Array(n).fill(true); // nagashi eligibility per seat
    g.kita=Array.from({length:n},()=>[]); // sanma: banked North-tile bonus draws per seat
  }

  start(){
    if(this.phase!=='waiting'||this.totalCount()<this.numPlayers) return;
    this.phase='playing';
    const startDealer=Math.floor(Math.random()*this.numPlayers);
    // Sanma conventionally starts with more points per player (one fewer
    // opponent to redistribute among) — 35000 is the standard Tenhou/club
    // default; yonma keeps the existing 25000.
    const startScore=this.rules.sanma?35000:25000;
    this.game={
      scores:new Array(this.numPlayers).fill(startScore),
      turn:startDealer,
      dealer:startDealer,
      round:1,        // overall hand counter: 1..numPlayers=East round, next numPlayers=South (hanchan)
      roundWind:1,    // derived from round: 1=East, 2=South (see _roundWindValue)
      honba:0,
      riichiSticks:0,
      // Per-game (not per-round — persists across _initRound calls) hand
      // stats accumulator, fed into recordGameResult() at game end. See
      // _finishGame/_recordHandWin.
      stats:new Array(this.numPlayers).fill(0).map(()=>({riichi:0,wins:0,tsumo:0,ron:0,dealIn:0,bestHan:0,bestScore:0,yaku:{}})),
    };
    this._initRound();
    this._broadcastAll({type:'game_start',seats:this._seatInfo(),gameMode:this.gameMode,dealer:this.game.dealer,numPlayers:this.numPlayers,sanma:this.rules.sanma,chonbo:this.rules.chonbo});
    setTimeout(()=>this._draw(),2000);
  }

  // ── Turn flow ──────────────────────────────────────────────────────────────
    _draw(fromRinshan=false){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    if(g.wall.length===0&&!fromRinshan){this._endRound('draw');return;}
    let t;
    if(fromRinshan){
      t=g.deadWall[g.kanCount-1];
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

  // Bot's own-turn decision priority: ankan > tsumo > kita (sanma only) >
  // riichi > (forced discard of the drawn tile if already in riichi) > best
  // discard. Note a riichi'd bot never attempts ankan here even though it
  // can be legal (see _ankan's wait-preserving check) — this is a
  // deliberate simplicity tradeoff in the bot AI, not a rules bug. Kita is
  // checked after tsumo (never forgo an available win to bank a bonus
  // tile first) but before riichi — it's strictly beneficial (free future
  // han, no downside) whenever available, REGARDLESS of riichi (see _kita's
  // own comment for why banking a 4z can't affect a locked wait), and ends
  // in a fresh replacement draw that re-enters _botTurn via the BOT_DELAY
  // callback _kita schedules, so this function runs again on the new tile —
  // including a riichi'd bot's own forced-discard branch below, once that
  // replacement draw isn't itself another kita candidate.
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
        g.riichi[seat],g.ippatsu[seat],g.doubleRiichi[seat],g.isRinshan,false,isHaitei,false,false,false,winKey,
        {kuitanAri:this.rules.kuitanAri});
      if(han>0){this._tsumo(seat);return;}
    }
    if(this.rules.sanma){
      const kitaTile=hand.find(t=>key(t)==='4z');
      if(kitaTile){this._kita(seat,kitaTile.id);return;}
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
    this._discard(seat,bestDiscard(hand,g.melds[seat],this.seats[seat].difficulty,this._dangerSetsFor(seat)));
  }

  _findRiichiTile(seat){
    const hand=this.game.hands[seat];
    for(const t of hand){if(waits(hand.filter(x=>x.id!==t.id),undefined,this.rules.sanma).length>0) return t.id;}
    return null;
  }

  // Discard-key piles of every OTHER seat currently in riichi — used by
  // bot.js's 'hard' difficulty to find genbutsu-safe tiles. A tile is only
  // treated as safe if it's genbutsu against every riichi opponent at once
  // (bot.js itself enforces the "every" part; this just gathers the piles).
  _dangerSetsFor(seat){
    const g=this.game;
    return g.riichi.map((r,s)=>(r&&s!==seat)?g.discards[s].map(key):null).filter(Boolean);
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
    // Recalculate permanent furiten based on discards vs current waits.
    // Always reassign (never bail out early) — if the hand isn't tenpai
    // right now, ws is empty and ws.some(...) is naturally false, which is
    // correct (furiten doesn't apply without a wait). An early return here
    // used to leave a stale `true` from an earlier tenpai shape in place
    // while passing through a non-tenpai stretch of the hand.
    const g=this.game;
    const hand=g.hands[seat];
    const ws=waits(hand,g.melds[seat],this.rules.sanma);
    const myDiscards=g.discards[seat].map(key);
    g.furiten[seat]=ws.some(w=>myDiscards.includes(w));
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  action(playerId,act){
    try{
    const g=this.game;
    const seat=this.seats.findIndex(p=>p&&!p.isBot&&p.id===playerId);
    if(seat===-1) return;
    // round_ready: player signals ready for next round
    if(act.type==='round_ready'){
      if(this.phase==='done') return;
      this.roundReady.add(seat);
      const humanSeats=this.seats.map((p,i)=>p&&!p.isBot?i:-1).filter(i=>i>=0);
      // Broadcast how many are ready
      this._broadcastAll({type:'ready_status',count:this.roundReady.size,total:humanSeats.length});
      if(humanSeats.every(i=>this.roundReady.has(i))&&this.pendingNextRound){
        const fn=this.pendingNextRound;
        this.pendingNextRound=null;
        this.roundReady=new Set();
        fn();
      }
      return;
    }
    if(!g||this.phase!=='playing') return;
    if(act.type==='discard'&&g.turn===seat) this._discard(seat,act.tileId);
    // 'kyuushu', not 'draw': kyuushu kyuuhai is an abortive draw (like
    // suukaikan) — honba+1, dealer/round unchanged, no scoring. Passing
    // 'draw' here routed it through _endRound's exhaustive-draw branch,
    // which checks nagashi mangan eligibility; since kyuushu fires on
    // turn 1 before anyone's discarded a non-terminal tile, every seat's
    // nagashi flag was still true and it was incorrectly paying out a
    // mangan instead of ending scorelessly.
    else if(act.type==='kyuushu'&&g.turn===seat) this._endRound('kyuushu');
    else if(act.type==='tsumo'&&g.turn===seat) this._tsumo(seat);
    else if(act.type==='riichi'&&g.turn===seat) this._riichi(seat,act.tileId);
    else if(act.type==='ankan'&&g.turn===seat) this._ankan(seat,act.tileKey);
    else if(act.type==='kakan'&&g.turn===seat) this._kakan(seat,act.tileId);
    else if(act.type==='kita'&&g.turn===seat) this._kita(seat,act.tileId);
    else if(act.type==='ron') this._reactResponse(seat,{type:'ron'});
    else if(act.type==='pon') this._reactResponse(seat,{type:'pon'});
    else if(act.type==='kan') this._reactResponse(seat,{type:'kan'});
    else if(act.type==='chi') this._reactResponse(seat,{type:'chi',tileIds:act.tileIds});
    else if(act.type==='pass') this._reactResponse(seat,{type:'pass'});
    // DEBUG ONLY — forces a player's hand to specific tiles for testing win conditions.
    // Remove this block before production deployment.
    else if(act.type==='debug_set_hand'&&Array.isArray(act.tiles)){
      let nextId=10000;
      g.hands[seat]=act.tiles.map(t=>({id:nextId++,s:t.s,v:t.v}));
      if(act.drawTile){
        g.drawTile={id:nextId++,s:act.drawTile.s,v:act.drawTile.v};
        g.hands[seat].push(g.drawTile);
        g.turn=seat;
      }
      this._sendState();
      console.log('[DEBUG] Set hand for seat',seat,':',g.hands[seat].map(t=>t.s+t.v).join(' '));
    }
    }catch(e){ console.error('[action error]',e.message,e.stack); }
  }

  // ── Discard ────────────────────────────────────────────────────────────────
    _discard(seat,tileId){
    const g=this.game;
    const idx=g.hands[seat].findIndex(t=>t.id===tileId);
    if(idx===-1) return;
    const [tile]=g.hands[seat].splice(idx,1);
    // Normally the marker is the tile riichi was declared on. If that tile
    // was since called away by another player, the marker moves to this
    // (the next) discard instead — the sideways tile records *when* riichi
    // was declared, so calling it away can't erase the record.
    const isRiichiDiscard=(g.riichiTile&&g.riichiTile[seat]===tile.id)||(g.riichiTileCalled&&g.riichiTileCalled[seat]);
    if(isRiichiDiscard){
      tile.riichi=true;
      g.riichiTile[seat]=tile.id;
      if(g.riichiTileCalled) g.riichiTileCalled[seat]=false;
    }
    g.discards[seat].push(tile);
    g.drawTile=null;
    g.isRinshan=false;
    // Ippatsu rule: only broken by a call, never by a plain discard from another player.
    // The discarding player's own ippatsu is cancelled here only if this discard is NOT
    // their riichi declaration discard (i.e. they already had their ippatsu draw and missed it).
    if(g.ippatsu[seat]&&!isRiichiDiscard) g.ippatsu[seat]=false;
    g.turnCount++;

    // After discard, check nagashi (any non-terminal/honour or called tile = loses nagashi)
    const k=key(tile);
    const isTermHon=['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'].includes(k);
    if(!isTermHon) g.nagashi[seat]=false;

    // After first discard by all players, firstRound ends
    if(g.turnCount>=this.numPlayers) g.firstRound=false;

    // Update permanent furiten for this player
    this._updateFuriten(seat);

    const reactions=this._checkReactions(seat,tile);
    if(reactions.length){
      const humanInReactions=reactions.some(r=>!this.seats[r.seat]?.isBot);
      g.pending={tile,fromSeat:seat,seats:reactions.map(r=>r.seat),options:reactions,responses:{},timer:null};
      this._sendState();
      if(!humanInReactions){
        for(const r of reactions){
          const dec=botReact(g.hands[r.seat],tile,r.options,g.melds[r.seat],this.seats[r.seat].difficulty);
          setTimeout(()=>{
            if(!g.pending) return;
            g.pending.responses[r.seat]=dec;
            if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
          },BOT_DELAY);
        }
      }
    } else {
      if(this._checkSuukaikan()) return;
      this._nextTurn();
    }
  }

  // Collects every seat's available reaction options to a just-discarded
  // tile (ron/pon/kan/chi). This only computes what's *offered* to each
  // seat — it does not resolve priority between them; that happens once all
  // responses are in, in _resolveReactions. seat===(fromSeat+1)%numPlayers is
  // the discarder's shimocha (the seat that plays right after them in turn
  // order) — the discarder is THAT player's kamicha, and chi may only be
  // called from your kamicha, so this is the only seat ever offered chi
  // (sanma disables chi outright — see the sanma check below).
  _checkReactions(fromSeat,tile){
    const g=this.game;
    const reactions=[];
    for(let seat=0;seat<this.numPlayers;seat++){
      if(seat===fromSeat) continue;
      const hand=g.hands[seat],opts=[];

      // Ron: furiten is an absolute block regardless of rules.chonbo — a
      // furiten ron attempt isn't offered at all, chonbo or not.
      if(!this._isFuriten(seat)){
        if(this.rules.chonbo){
          // Chonbo removes the safety net entirely — the client is never
          // told whether this is actually a winning hand, even when it
          // genuinely is. Every non-furiten seat always gets the same
          // "attempt" (valid:false) option and must manually declare +
          // confirm; the server still validates for real once the ron
          // action actually arrives (see _multiRon), so a correct declare
          // still wins normally, it just isn't hinted here.
          opts.push({type:'ron',valid:false});
        } else {
          const handWithTile=[...hand,tile];
          if(isWin(handWithTile,g.melds[seat])){
            const sw=this._seatWindOf(seat);
            const isDblRiichi=g.doubleRiichi[seat];
            const {han}=detectYaku(handWithTile,g.melds[seat],false,sw,this._roundWindValue(),
              g.riichi[seat],g.ippatsu[seat],isDblRiichi,false,false,false,g.haiteiNext,false,false,key(tile),
              {kuitanAri:this.rules.kuitanAri});
            // A legitimate (safe, one-tap) ron option only if it actually
            // has han — without chonbo on, a no-yaku hand isn't offered at
            // all, since there's no "attempt anyway" path to fall back to.
            if(han>0) opts.push({type:'ron',valid:true});
          }
        }
      }
      if(!g.riichi[seat]){
        if(canPon(hand,tile)) opts.push({type:'pon'});
        if(canKan(hand,tile)&&g.kanCount<4) opts.push({type:'kan'});
        // Chi is disabled entirely in sanma (standard rule — there's no
        // well-defined "player to your left" call worth keeping with only
        // 3 seats), so this branch is skipped outright rather than just
        // narrowing eligibility.
        if(!this.rules.sanma&&seat===(fromSeat+1)%this.numPlayers){
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

    // If player passes a valid ron, set temporary furiten. A chonbo-only
    // "attempt anyway" option (valid:false) isn't a real ron opportunity —
    // it must NOT count here, or passing on it (as you should, every time
    // it isn't actually a win) wrongly sets furiten and hides every other
    // seat's declare/ron option until your next draw resets it. Since your
    // own draw always precedes your shimocha's discard, that bug made the
    // option only ever reappear for that one seat.
    if(resp.type==='pass'){
      const myOpts=g.pending.options.find(r=>r.seat===seat);
      if(myOpts&&myOpts.options.some(o=>o.type==='ron'&&o.valid!==false)){
        g.tempFuriten[seat]=true;
      }
    }

    if(resp.type==='ron'){this._resolveReactions();return;}
    if(resp.type==='kan'){const tile=g.pending.tile,fromSeat=g.pending.fromSeat;g.pending=null;this._daiminkan(seat,tile,fromSeat);return;}

    // A human just called pon/chi/pass — any other pending seat here is a bot
    // whose only role is to settle priority (a hidden ron always outranks a
    // pon/chi). There's no bot move being displayed to pace for readability,
    // so decide immediately instead of parking behind BOT_DELAY — that pause
    // exists for the bots'-own-turn path in _discard(), not this one.
    const tile=g.pending.tile;
    for(const r of g.pending.options){
      const s=r.seat;
      if(this.seats[s]?.isBot&&!g.pending.responses[s]){
        g.pending.responses[s]=botReact(g.hands[s],tile,r.options,g.melds[s],this.seats[s].difficulty);
      }
    }
    if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
  }

  // Once every reacting seat has responded (or we've at least heard back
  // from all humans — bots may still be "thinking" on their BOT_DELAY
  // timer, but their eventual response can't outrank a human's), apply
  // priority: any ron wins outright (multiple simultaneous ron supported);
  // otherwise pon/kan (checked together, first one found wins — in
  // practice at most one seat can pon/kan the same discard) beats chi;
  // if nobody called anything, play just continues to the next seat.
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
      if(this._checkSuukaikan()) return;
      this._nextTurn();
    }
  }

  // ── Multiple Ron ───────────────────────────────────────────────────────────
  _multiRon(winSeats,loseSeat,tile){
    const g=this.game;
    // Atama-hane: when double/triple ron is disabled, only the winner
    // closest to the discarder (in turn order) actually wins — the others
    // are dropped before any scoring happens. Same distance formula the
    // riichi-stick assignment below already uses for this same "closest to
    // loseSeat" question.
    if(!this.rules.doubleRon && winSeats.length>1){
      winSeats=[winSeats.reduce((best,s)=>{
        const dist=(s-loseSeat+this.numPlayers)%this.numPlayers, bestDist=(best-loseSeat+this.numPlayers)%this.numPlayers;
        return dist<bestDist?s:best;
      },winSeats[0])];
    }
    const results=[];
    for(const winSeat of winSeats){
      const hand=[...g.hands[winSeat],tile];
      const sw=this._seatWindOf(winSeat);
      const isHoutei=g.haiteiNext&&!g.isRinshan;
      const isDblRiichi=g.doubleRiichi[winSeat];
      const {han,yakuList}=detectYaku(hand,g.melds[winSeat],false,sw,this._roundWindValue(),
        g.riichi[winSeat],g.ippatsu[winSeat],isDblRiichi,false,false,false,isHoutei,false,false,key(tile),
        {kuitanAri:this.rules.kuitanAri});
      if(han===0) continue;
      // Ura dora for riichi players
      const uraDora=g.riichi[winSeat]?this._countUraDora(hand):0;
      const kitaCount=g.kita[winSeat].length;
      const dc=countDora(hand,g.dora)+uraDora+countAkaDora(hand);
      const totalHan=han+dc+kitaCount;
      const decomps=decompose(hand);
      const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
      const fu=decomps.length?calcFu(decomps[0],false,isMenzen(g.melds[winSeat]),key(tile),hasPinfu):30;
      const isWinnerDealer = winSeat === g.dealer;
      const bp=basePoints(totalHan,fu);
      const pay=Math.ceil((isWinnerDealer?bp*6:bp*4)/100)*100+g.honba*300;
      results.push({winSeat,hand,yakuList,han:totalHan,fu,pay,uraDora,dc,kitaCount});
    }
    if(!results.length){
      // Every declarer turned out invalid. Scoped to the common case — a
      // LONE false ron — so exactly one offender is unambiguous; if
      // multiple players simultaneously declared and all were wrong, fall
      // through to the existing silent no-op rather than picking one to
      // blame (a rare edge case, not worth the extra complexity here).
      if(this.rules.chonbo && winSeats.length===1){
        this._chonboPenalty(winSeats[0]);
        return;
      }
      this._sendState();return;
    }

    // Each winner gets paid separately by loser; riichi sticks go to closest winner
    const totalRiichiSticks=g.riichiSticks;
    // Winner closest to loser in turn order gets the riichi sticks
    const closestWinner=winSeats.reduce((best,s)=>{
      const dist=(s-loseSeat+this.numPlayers)%this.numPlayers;
      const bestDist=(best-loseSeat+this.numPlayers)%this.numPlayers;
      return dist<bestDist?s:best;
    },winSeats[0]);

    let totalLoss=0;
    const winGains={};
    for(const r of results){
      totalLoss+=r.pay;
      winGains[r.winSeat]=(winGains[r.winSeat]||0)+r.pay;
    }
    const prevScores=[...g.scores];
    g.scores[loseSeat]-=totalLoss;
    for(const r of results){
      g.scores[r.winSeat]+=winGains[r.winSeat];
    }
    g.scores[closestWinner]+=totalRiichiSticks*1000;

    // Build combined yaku display (show first winner's hand info in round_end, extras in extras)
    const primary=results[0];
    const primaryAkaDora=countAkaDora(primary.hand);
    const primaryRegularDc=primary.dc-primaryAkaDora-primary.uraDora;
    const yl=primaryRegularDc>0?[...primary.yakuList,{name:'Dora',jp:'ドラ',han:primaryRegularDc}]:[...primary.yakuList];
    if(primary.uraDora>0) yl.push({name:'Ura Dora',jp:'裏ドラ',han:primary.uraDora});
    if(primaryAkaDora>0) yl.push({name:'Aka Dora',jp:'赤ドラ',han:primaryAkaDora});
    if(primary.kitaCount>0) yl.push({name:'Kita',jp:'北',han:primary.kitaCount});
    this._endRound('ron',primary.winSeat,loseSeat,primary.hand,yl,primary.han,primary.fu,totalLoss,
      results.length>1?results.slice(1):null,prevScores,g.melds[primary.winSeat]);
  }

  // Removes a called tile from its discarder's pond. If it was their rotated
  // riichi-declaration marker, flag the seat so their *next* discard picks up
  // the marker instead — the sideways tile records when riichi was declared,
  // so calling that discard away can't erase the record, just relocate it.
  _removeFromDiscards(fromSeat,tile){
    const g=this.game;
    if(tile.riichi){
      if(!g.riichiTileCalled) g.riichiTileCalled={};
      g.riichiTileCalled[fromSeat]=true;
    }
    g.discards[fromSeat]=g.discards[fromSeat].filter(t=>t.id!==tile.id);
  }

  // ── Pon / Chi ──────────────────────────────────────────────────────────────
  _pon(seat,tile,fromSeat){
    const g=this.game;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===key(tile));
    const used=matches.slice(0,2);
    g.hands[seat]=hand.filter(t=>!used.map(u=>u.id).includes(t.id));
    g.melds[seat].push({type:'pon',tiles:[...used,tile],calledTileId:tile.id,fromSeat});
    this._removeFromDiscards(fromSeat,tile); // called tile leaves their pond
    g.nagashi[seat]=false;
    g.nagashi[fromSeat]=false; // their discard was called — nagashi requires no discard ever be taken
    g.turn=seat;
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'pon',seat,name:this.seats[seat]?.name});
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,bestDiscard(g.hands[seat],g.melds[seat],this.seats[seat].difficulty,this._dangerSetsFor(seat))),BOT_DELAY);
  }

  _chi(seat,tile,tileIds,fromSeat){
    const g=this.game;
    const hand=g.hands[seat];
    const used=hand.filter(t=>tileIds.includes(t.id));
    g.hands[seat]=hand.filter(t=>!tileIds.includes(t.id));
    g.melds[seat].push({type:'chi',tiles:sort([...used,tile]),calledTileId:tile.id,fromSeat});
    this._removeFromDiscards(fromSeat,tile); // called tile leaves their pond
    g.nagashi[seat]=false;
    g.nagashi[fromSeat]=false; // their discard was called — nagashi requires no discard ever be taken
    g.turn=seat;
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'chi',seat,name:this.seats[seat]?.name});
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,bestDiscard(g.hands[seat],g.melds[seat],this.seats[seat].difficulty,this._dangerSetsFor(seat))),BOT_DELAY);
  }

  // ── Kan types ──────────────────────────────────────────────────────────────
  // Three ways to form a kan, all converge on the same "draw a rinshan
  // replacement tile" tail (_draw(true)) and reveal a new kan-dora indicator:
  //   daiminkan  called on another player's discard (like a pon, but 4 tiles)
  //   ankan      self-declared from 4 concealed copies already in hand;
  //              during riichi only legal if it doesn't change your waits
  //              (checked below) — a closed kan, so `open:false`
  //              (matters for fu — see calcFu in mahjong.js)
  //   kakan      "added kan": upgrading an existing pon by drawing/holding
  //              the 4th copy. Exposed to chankan (robbing the kan) since,
  //              unlike ankan, the tile becoming a kan was never concealed
  //              this whole time — an opponent could be waiting on it.
  _daiminkan(seat,tile,fromSeat){
    const g=this.game;
    if(g.kanCount>=4) return;
    const hand=g.hands[seat];
    const matches=hand.filter(t=>key(t)===key(tile));
    if(matches.length<3) return;
    g.hands[seat]=hand.filter(t=>!matches.map(u=>u.id).includes(t.id));
    g.melds[seat].push({type:'kan',kanType:'daiminkan',tiles:[...matches,tile],calledTileId:tile.id,fromSeat,open:true});
    if(fromSeat!=null) this._removeFromDiscards(fromSeat,tile); // called tile leaves their pond
    g.kanCount++;g.kanSeats.push(seat);
    g.nagashi[seat]=false;
    if(fromSeat!=null) g.nagashi[fromSeat]=false; // their discard was called — nagashi requires no discard ever be taken
    this._openNewDora(g);
    g.turn=seat;
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'kan',seat,name:this.seats[seat]?.name,kanType:'daiminkan'});
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
      const before=waits(hand.filter(t=>key(t)!==tileKey),undefined,this.rules.sanma);
      // After removing 3 copies, remaining hand (1 copy stays) — compute waits
      const after=waits(hand.filter(t=>!matches.slice(0,3).map(u=>u.id).includes(t.id)),undefined,this.rules.sanma);
      const sameWaits=before.length===after.length&&before.every(w=>after.includes(w));
      if(!sameWaits) return;
    }
    g.hands[seat]=hand.filter(t=>key(t)!==tileKey);
    g.melds[seat].push({type:'kan',kanType:'ankan',tiles:[...matches],calledTileId:null,open:false});
    g.kanCount++;g.kanSeats.push(seat);
    this._openNewDora(g);
    g.ippatsu=g.ippatsu.map(()=>false);
    this._broadcastAll({type:'kan',seat,name:this.seats[seat]?.name,kanType:'ankan'});
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
          const dec=botReact(g.hands[r.seat],addTile,r.options,g.melds[r.seat],this.seats[r.seat].difficulty);
          setTimeout(()=>{if(!g.pending)return;g.pending.responses[r.seat]=dec;this._checkChankanReacted(seat,addTile,ponIdx);},BOT_DELAY);
        }
      }
      return;
    }
    this._completeChankan(seat,addTile,ponIdx);
  }

  // ── Kita (sanma only) ────────────────────────────────────────────────────
  // Banking a North (4z) tile: set it face-up (removed from hand, not part
  // of any meld), then take an immediate bonus draw. Each banked kita tile
  // is a flat +1 han bonus on this seat's eventual winning hand (applied in
  // _tsumo/_multiRon/_ron alongside dora), never a yaku on its own.
  //
  // Still allowed once in riichi, unlike kakan (see _kakan above) — kakan's
  // restriction exists because upgrading a pon to a kan can reveal a new
  // dora indicator and change what's waited on, which is exactly what a
  // riichi lock forbids. A 4z tile is never part of any wait/yaku structure
  // in the first place (it can't complete a sequence or triplet-based wait
  // the way a kakan candidate can), so banking one and drawing a
  // replacement can't change the locked hand's wait at all — there's
  // nothing here that actually needs re-deriving. The replacement draw
  // itself still follows normal riichi tsumogiri rules (auto-discarded
  // unless it's the winning tile) — see the auto-discard skip in
  // script.js, which now checks canKita too so a post-riichi kita draw
  // isn't auto-discarded before the player gets to bank it.
  //
  // The replacement draw is popped from the TAIL of the live wall, not the
  // dead wall's 4 rinshan slots — those are reserved for kan and capped at
  // exactly 4 kans; sourcing kita from the same slots risks running past
  // that cap (kan count + kita count could exceed 4) and colliding with the
  // dora-indicator slots just past them. This mirrors how the dead wall
  // itself was carved from the wall's tail at round start (_initRound) — a
  // real, once-only tile, just sourced differently than a kan's rinshan
  // draw. Deliberately does NOT set g.isRinshan: kita isn't a kan, so it
  // carries no Rinshan Kaihou eligibility.
  _kita(seat,tileId){
    const g=this.game;
    if(!this.rules.sanma) return;
    if(g.wall.length===0) return; // nothing left to draw as a replacement
    const hand=g.hands[seat];
    const tile=hand.find(t=>t.id===tileId&&key(t)==='4z');
    if(!tile) return;
    g.hands[seat]=hand.filter(t=>t.id!==tileId);
    g.kita[seat].push(tile);
    g.nagashi[seat]=false; // self-initiated action, same precedent as calling pon/chi/kan on your own turn
    this._broadcastAll({type:'kita',seat,name:this.seats[seat]?.name,count:g.kita[seat].length});
    const draw=g.wall.pop();
    if(g.wall.length===0) g.haiteiNext=true;
    g.drawTile=draw;
    g.hands[seat]=sort([...g.hands[seat],draw]);
    g.tempFuriten[seat]=false;
    // Not a rinshan draw — clear any stale flag from an earlier kan this
    // same turn so a win off this replacement tile can't wrongly claim
    // Rinshan Kaihou.
    g.isRinshan=false;
    this._sendState();
    if(this.seats[seat]?.isBot) setTimeout(()=>this._botAct(seat),BOT_DELAY);
  }

  // Any tenpai (non-furiten) player waiting on the tile being added to a kan
  // may rob it, not just players in riichi — riichi is just one of several
  // ways to have a valid yaku, same as for a normal ron.
  _checkChankan(fromSeat,tile){
    const g=this.game;
    const reactions=[];
    for(let seat=0;seat<this.numPlayers;seat++){
      if(seat===fromSeat) continue;
      const hand=g.hands[seat];
      if(!this._isFuriten(seat)&&isWin([...hand,tile],g.melds[seat])){
        const sw=this._seatWindOf(seat);
        const {han}=detectYaku([...hand,tile],g.melds[seat],false,sw,this._roundWindValue(),
          g.riichi[seat],g.ippatsu[seat],g.doubleRiichi[seat],false,true,false,false,false,false,key(tile),
          {kuitanAri:this.rules.kuitanAri});
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
    this._broadcastAll({type:'kan',seat,name:this.seats[seat]?.name,kanType:'kakan'});
    this._draw(true);
  }

  // Suukaikan: 4 kans by different players = abortive draw
  _checkSuukaikan(){
    const g=this.game;
    if(g.kanCount<4) return false;
    if(new Set(g.kanSeats).size===1) return false;
    this._endRound('suukaikan');
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
    if(waits(hand.filter(t=>t.id!==tileId),g.melds[seat],this.rules.sanma).length===0) return;
    g.riichi[seat]=true;
    g.ippatsu[seat]=true;
    g.stats[seat].riichi++;
    // Double riichi: declared on first discard before any calls have been made
    const isDouble=g.firstRound&&g.melds.every(m=>m.length===0);
    g.doubleRiichi[seat]=isDouble;
    g.scores[seat]-=1000;g.riichiSticks++;
    if(!g.riichiTile) g.riichiTile={};
    g.riichiTile[seat]=tileId;
    this._broadcastAll({type:'riichi',seat,name:this.seats[seat]?.name,scores:g.scores,isDouble});
    this._discard(seat,tileId);
  }

  // ── Chonbo (rules.chonbo only) ───────────────────────────────────────────────
  // Penalizes a false tsumo/ron declaration. Off by default: normally the
  // client only ever offers Tsumo/Ron once the server has already confirmed
  // the hand is a legal win (canTsumo / _checkReactions' ron option both
  // fully validate first), so a false declaration can't happen at all. With
  // this rule on, _tsumo/_checkReactions additionally let a player declare
  // any time it's structurally possible to ATTEMPT one (see canAttemptTsumo
  // in _sendState and the ron `valid:false` option below) — this is what
  // fires when that attempt turns out to be wrong. Offender pays every
  // other seat a mangan-equivalent amount (same dealer-pays/receives-double
  // convention as a real mangan tsumo, just with the money flowing the
  // other way), then the hand is treated as an abortive draw — honba+1,
  // dealer/riichi-sticks unchanged — via _endRound's generic fallback
  // branch (anything that isn't 'tsumo'/'ron'/'draw' lands there already,
  // same as kyuushu/suukaikan).
  _chonboPenalty(offenderSeat){
    const g=this.game;
    const isDealer=offenderSeat===g.dealer;
    const bp=basePoints(5,30); // mangan base — fu is irrelevant once han>=5
    const prevScores=[...g.scores];
    let total=0;
    for(let i=0;i<this.numPlayers;i++){
      if(i===offenderSeat) continue;
      const pay=Math.ceil((isDealer?bp*2:i===g.dealer?bp*2:bp)/100)*100;
      g.scores[i]+=pay; g.scores[offenderSeat]-=pay; total+=pay;
    }
    this._endRound('chonbo',offenderSeat,null,null,null,null,null,total,undefined,prevScores,undefined);
  }

  // ── Win ─────────────────────────────────────────────────────────────────────
  _tsumo(seat){
    const g=this.game;
    const hand=g.hands[seat];
    if(!isWin(hand,g.melds[seat])){
      if(this.rules.chonbo) this._chonboPenalty(seat);
      return;
    }
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
      g.drawTile?key(g.drawTile):null,{kuitanAri:this.rules.kuitanAri});
    if(han===0){
      if(this.rules.chonbo) this._chonboPenalty(seat);
      return;
    }

    // Ura dora (only on riichi)
    const uraDora=g.riichi[seat]?this._countUraDora(hand):0;
    const kitaCount=g.kita[seat].length;
    const dc=countDora(hand,g.dora)+uraDora+countAkaDora(hand);
    const totalHan=han+dc+kitaCount;
    const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
    const decomps=decompose(hand);
    const winKey=g.drawTile?key(g.drawTile):null;
    const fu=decomps.length?calcFu(decomps[0],true,isMenzen(g.melds[seat]),winKey,hasPinfu):30;
    const bp=basePoints(totalHan,fu);
    const isDealer=seat===g.dealer;
    const prevScores=[...g.scores];
    let gain=0;
    for(let i=0;i<this.numPlayers;i++){
      if(i===seat) continue;
      const pay=Math.ceil((isDealer?bp*2:i===g.dealer?bp*2:bp)/100)*100+g.honba*100;
      g.scores[i]-=pay;gain+=pay;
    }
    g.scores[seat]+=gain+g.riichiSticks*1000;
    const akaDora=countAkaDora(hand);
    const regularDc=dc-akaDora-uraDora;
    const yl=regularDc>0?[...yakuList,{name:'Dora',jp:'ドラ',han:regularDc}]:yakuList;
    if(uraDora>0) yl.push({name:'Ura Dora',jp:'裏ドラ',han:uraDora});
    if(akaDora>0) yl.push({name:'Aka Dora',jp:'赤ドラ',han:akaDora});
    if(kitaCount>0) yl.push({name:'Kita',jp:'北',han:kitaCount});
    this._endRound('tsumo',seat,null,hand,yl,totalHan,fu,gain,undefined,prevScores,g.melds[seat]);
  }

  // NOTE: appears unused — _resolveReactions/_checkChankanReacted both route
  // through _multiRon (which handles the single-winner case fine too), so
  // this single-winner path is currently dead code. Left in place rather
  // than removed since that wasn't asked for; flag before relying on it.
  _ron(winSeat,loseSeat,tile,isChankan=false){
    const g=this.game;
    const hand=[...g.hands[winSeat],tile];
    const sw=this._seatWindOf(winSeat);
    const isHoutei=g.haiteiNext&&!g.isRinshan;
    const isDblRiichi=g.doubleRiichi[winSeat];
    const {han,yakuList}=detectYaku(hand,g.melds[winSeat],false,sw,this._roundWindValue(),
      g.riichi[winSeat],g.ippatsu[winSeat],isDblRiichi,false,isChankan,false,isHoutei,false,false,key(tile),
      {kuitanAri:this.rules.kuitanAri});
    if(han===0){this._sendState();return;}

    const uraDora=g.riichi[winSeat]?this._countUraDora(hand):0;
    const kitaCount=g.kita[winSeat].length;
    const dc=countDora(hand,g.dora)+uraDora+countAkaDora(hand);
    const totalHan=han+dc+kitaCount;
    const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
    const decomps=decompose(hand);
    const fu=decomps.length?calcFu(decomps[0],false,isMenzen(g.melds[winSeat]),key(tile),hasPinfu):30;
    const bp=basePoints(totalHan,fu);
    const isWinnerDealer=winSeat===g.dealer;
    const pay=Math.ceil((isWinnerDealer?bp*6:bp*4)/100)*100+g.honba*300+g.riichiSticks*1000;
    const prevScores=[...g.scores];
    g.scores[loseSeat]-=pay;g.scores[winSeat]+=pay;
    const akaDora=countAkaDora(hand);
    const regularDc=dc-akaDora-uraDora;
    const yl=regularDc>0?[...yakuList,{name:'Dora',jp:'ドラ',han:regularDc}]:yakuList;
    if(uraDora>0) yl.push({name:'Ura Dora',jp:'裏ドラ',han:uraDora});
    if(akaDora>0) yl.push({name:'Aka Dora',jp:'赤ドラ',han:akaDora});
    if(kitaCount>0) yl.push({name:'Kita',jp:'北',han:kitaCount});
    this._endRound('ron',winSeat,loseSeat,hand,yl,totalHan,fu,pay,undefined,prevScores,g.melds[winSeat]);
  }

  // ── Round end ───────────────────────────────────────────────────────────────
  // Common tail for tsumo/ron: figures out what happens to dealer/round/honba
  // and whether the game itself is over, then broadcasts round_end and either
  // queues the next round (via pendingNextRound, released once every human
  // clicks Ready — see the 'round_ready' action) or ends the game.
  // `reason` is one of: 'tsumo' | 'ron' | 'draw' (exhaustive, wall ran out —
  // handled specially below for nagashi mangan / tenpai payments) |
  // 'suukaikan' (abortive draw: 4 kans by more than one player).
  // Dealer-repeat rule: dealer keeps their seat (honba+1, same round number)
  // whenever they win; otherwise the dealer seat rotates and round advances.
  // Agariyame: if this is the last kyoku of the game and the dealer both won
  // and is already in the lead, the game ends immediately instead of
  // offering an honba repeat.
  // Records one won hand into this game's per-seat stats accumulator
  // (g.stats — see start()). yakuList may be null (multi-ron secondary
  // winners don't carry a full yaku breakdown, only han/fu/payment).
  _recordHandWin(seat,reason,han,fu,yakuList,payment){
    const g=this.game;
    const st=g.stats[seat];
    st.wins++;
    if(reason==='tsumo') st.tsumo++; else st.ron++;
    if(han>st.bestHan) st.bestHan=han;
    if(payment>st.bestScore) st.bestScore=payment;
    if(yakuList) for(const y of yakuList) st.yaku[y.name]=(st.yaku[y.name]||0)+1;
  }

  // Ranks seats by final score, descending; ties keep seat order (stable
  // sort), matching the client's own placement sort in onGameOver.
  _computePlacements(scores){
    const order=scores.map((s,i)=>i).sort((a,b)=>scores[b]-scores[a]);
    const placements=new Array(scores.length);
    order.forEach((seat,rank)=>{placements[seat]=rank+1;});
    return placements;
  }

  // Single place every "the game is over" path funnels through — guarantees
  // recordGameResult fires exactly once per game regardless of which ending
  // triggered it (bust/tobi, normal end-of-match, agariyame, draw-out,
  // nagashi). `extra` carries reason-specific fields (e.g. {bust}).
  _finishGame(reason,extra={}){
    const g=this.game;
    this.phase='done';
    this._broadcastAll({type:'game_over',reason,scores:g.scores,
      playerNames:this.seats.map(p=>p?.name||'—'),...extra});
    const unlocked=recordGameResult({
      playerIds:this.seats.map(p=>p?.profileId||null),
      isBot:this.seats.map(p=>!p||p.isBot),
      // Guests hold no data — see index.js's 'join' handler for why.
      isGuest:this.seats.map(p=>!!p?.isGuest),
      finalScores:g.scores,
      placements:this._computePlacements(g.scores),
      handStats:g.stats,
    });
    // Each seat only ever hears about ITS OWN newly-earned achievements
    // (see recordGameResult's return shape) — sent directly to that
    // seat's own connection, not broadcast, so nobody sees an opponent's
    // unlock notification.
    unlocked.forEach((list,seat)=>{
      if(!list||!list.length) return;
      const p=this.seats[seat];
      if(p&&!p.isBot&&p.ws?.readyState===1) p.ws.send(JSON.stringify({type:'achievements_unlocked',achievements:list}));
    });
  }

  _endRound(reason,winner,loser,hand,yakuList,han,fu,payment,extraWinners,prevScores,melds){
    const g=this.game;
    // Tobi check (bankruptcy)
    const bust=g.scores.findIndex(s=>s<0);

    // Per-game hand-stats bookkeeping (feeds recordGameResult at game end).
    if(reason==='tsumo'||reason==='ron'){
      this._recordHandWin(winner,reason,han,fu,yakuList,payment);
      if(reason==='ron') g.stats[loser].dealIn++;
      if(extraWinners) for(const r of extraWinners) this._recordHandWin(r.winSeat,'ron',r.han,r.fu,null,r.pay);
    }

    // Nagashi Mangan check (exhaustive draw only)
    if(reason==='draw'){
      const nagashiSeats=g.nagashi.map((ok,i)=>{
        if(!ok) return false;
        // Must have no melds
        if(g.melds[i].length>0) return false;
        // All discards must be terminals/honours (already tracked via nagashi flag)
        return true;
      });
      if(this.rules.nagashiMangan && nagashiSeats.some(Boolean)){
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

    if(reason==='tsumo'||reason==='ron'){
      if(dealerWon){
        // Dealer wins → normally repeat (honba+1)
        // Agariyame: if it's the final kyoku and dealer is in 1st place, end instead
        const isLastKyoku=g.round>=this._maxRound();
        const dealerScore=g.scores[g.dealer];
        const dealerIsFirst=g.scores.every(s=>s<=dealerScore);
        if(isLastKyoku&&dealerIsFirst){
          // End game — dealer wins and is already first, no need to continue.
          // This is agariyame, NOT a bust — `bust` was computed above from
          // the CURRENT g.scores regardless of why we're ending, so it's
          // only >=0 here in the rare case this exact winning hand also
          // happened to send some other seat negative. Blindly finishing
          // with 'tobi' unconditionally (as this used to) mislabelled every
          // ordinary agariyame ending as "飛び - Bankruptcy" on the client
          // (see m.reason==='tobi' in script.js) even though nobody busted.
          this._broadcastAll({type:'round_end',reason,winner,loser,hand,yakuList,han,fu,payment,
            scores:g.scores,handLabel:han?handLabel(han):'',
            playerNames:this.seats.map(p=>p?.name||'—'),
            extraWinners:extraWinners||null,
            uraDora:g.deadWall.slice(9,9+g.dora.length),
            dora:g.dora,
            prevScores:prevScores||null,
            melds:melds||[],
            gameOver:true,
          });
          if(bust>=0) this._finishGame('tobi',{bust});
          else this._finishGame('end');
          return;
        }
        newHonba=g.honba+1;
        newRiichiSticks=0;
      } else {
        // Non-dealer wins → advance dealer and kyoku
        newHonba=0;
        newDealer=(g.dealer+1)%this.numPlayers;
        newRound=g.round+1;
      }
    } else {
      // Abortive draw → repeat with honba+1
      newHonba=g.honba+1;
      newRiichiSticks=g.riichiSticks;
    }

    // Derive wind from round number: first numPlayers hands=East, next numPlayers=South
    const newRoundWind=Math.ceil(newRound/this.numPlayers);
    const maxRound=this._maxRound();
    const isGameOver=bust>=0||newRound>maxRound;

    this._broadcastAll({type:'round_end',reason,winner,loser,hand,yakuList,han,fu,payment,
      scores:g.scores,handLabel:han?handLabel(han):'',
      playerNames:this.seats.map(p=>p?.name||'—'),
      extraWinners:extraWinners||null,
      uraDora: g.deadWall.slice(9,9+g.dora.length),
      dora: g.dora,
      prevScores:prevScores||null,
      melds:melds||[],
      gameOver:isGameOver,
      // Honba/riichi-stick pot carrying into the next round — a win always
      // claims every riichi stick on the table (newRiichiSticks is 0 here
      // regardless of who won), computed above before this broadcast.
      honba:newHonba,riichiSticks:newRiichiSticks,
    });

    // Game over conditions
    if(bust>=0){
      this._finishGame('tobi',{bust});
      return;
    }

    if(newRound>maxRound){
      this._finishGame('end');
      return;
    }

    // Apply round state immediately so subsequent _endRound calls see correct g.round
    g.dealer=newDealer;
    g.round=newRound;
    g.roundWind=newRoundWind;
    g.honba=newHonba;
    g.riichiSticks=reason==='suukaikan'?g.riichiSticks:newRiichiSticks;

    // Wait for all players to click Ready before starting next round
    this.roundReady=new Set();
    this.pendingNextRound=()=>{
      if(this.phase!=='playing') return;
      g.turn=newDealer;
      this._initRound();
      const dispWind=Math.ceil(newRound/this.numPlayers);
      const dispRound=((newRound-1)%this.numPlayers)+1;
      this._broadcastAll({type:'round_start',round:newRound,roundWind:newRoundWind,displayWind:dispWind,displayRound:dispRound,
        dealer:newDealer,honba:newHonba,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      setTimeout(()=>this._draw(),ROUND_START_DELAY);
    };
  }

  // Exhaustive draw (wall ran out), no nagashi mangan: noten (not-tenpai)
  // players pay a flat 3000 total, split evenly among tenpai players. Called
  // from _endRound only when reason==='draw' and nobody qualified for
  // nagashi. Dealer-repeat rule for draws: dealer stays if THEY were tenpai,
  // regardless of anyone else's tenpai state.
  _resolveTenpaiPayments(){
    const g=this.game;
    const inTenpai=g.hands.map((hand,seat)=>{
      return waits(hand,g.melds[seat],this.rules.sanma).length>0;
    });
    const tenpaiCount=inTenpai.filter(Boolean).length;
    const notenCount=this.numPlayers-tenpaiCount;

    let payments=new Array(this.numPlayers).fill(0);
    const prevScores=[...g.scores];
    if(tenpaiCount>0&&notenCount>0){
      // Standard: 3000 total split. Noten pays, tenpai receives.
      const totalPot=3000;
      const notPayEach=Math.floor(totalPot/notenCount);
      const tenpaiRecEach=Math.floor((notPayEach*notenCount)/tenpaiCount);
      for(let i=0;i<this.numPlayers;i++){
        if(inTenpai[i]) payments[i]=tenpaiRecEach;
        else { payments[i]=-notPayEach; g.scores[i]-=notPayEach; }
      }
      for(let i=0;i<this.numPlayers;i++){
        if(inTenpai[i]) g.scores[i]+=tenpaiRecEach;
      }
    }

    const tenpaiHands=g.hands.map((h,i)=>inTenpai[i]?h:null);
    const drawBust=g.scores.findIndex(s=>s<0);
    const drawMaxRound=this._maxRound();
    let drawNewRound=g.round; if(!inTenpai[g.dealer]) drawNewRound=g.round+1;
    const drawGameOver=drawBust>=0||drawNewRound>drawMaxRound;
    // Every draw adds a honba regardless of dealer-repeat/advance; riichi
    // sticks are never claimed on a draw, so they carry over unchanged.
    const newHonba=g.honba+1;
    this._broadcastAll({type:'round_end',reason:'draw',scores:g.scores,
      inTenpai,payments,tenpaiHands,tenpaiMelds:g.melds,
      playerNames:this.seats.map(p=>p?.name||'—'),
      dora:g.dora,
      uraDora:g.deadWall.slice(9,9+g.dora.length),
      prevScores,
      gameOver:drawGameOver,
      honba:newHonba,riichiSticks:g.riichiSticks,
    });

    // Dealer tenpai = repeat; dealer noten = advance
    const dealerTenpai=inTenpai[g.dealer];
    let newDealer=g.dealer;
    let newRound=g.round;
    if(!dealerTenpai){
      newDealer=(g.dealer+1)%this.numPlayers;
      newRound=g.round+1;
    }
    const newRoundWind=Math.ceil(newRound/this.numPlayers);

    const bust=g.scores.findIndex(s=>s<0);
    if(bust>=0){
      this._finishGame('tobi',{bust});
      return;
    }
    const maxRound=this._maxRound();
    if(newRound>maxRound){
      this._finishGame('end');
      return;
    }

    g.dealer=newDealer;g.round=newRound;g.roundWind=newRoundWind;
    g.honba=newHonba;

    this.roundReady=new Set();
    this.pendingNextRound=()=>{
      if(this.phase!=='playing') return;
      g.turn=newDealer;
      this._initRound();
      const dispWind=Math.ceil(newRound/this.numPlayers);
      const dispRound=((newRound-1)%this.numPlayers)+1;
      this._broadcastAll({type:'round_start',round:newRound,roundWind:newRoundWind,displayWind:dispWind,displayRound:dispRound,
        dealer:newDealer,honba:newHonba,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      setTimeout(()=>this._draw(),ROUND_START_DELAY);
    };
  }

  // Nagashi Mangan: a player who reached the exhaustive draw having discarded
  // only terminals/honors, with none of those discards called by anyone
  // (tracked incrementally via g.nagashi in _discard/_pon/_chi/_daiminkan),
  // is paid as if they'd won a mangan by tsumo. Multiple seats can qualify
  // simultaneously. Dealer-repeat rule: dealer stays if THEY qualified.
  _resolveNagashi(nagashiSeats){
    const g=this.game;
    // Nagashi Mangan: scored exactly like a tsumo mangan (2000 base points,
    // same ×1/×2 tsumo split as any other tsumo win) — dealer-as-winner
    // collects double from everyone, dealer-as-payer pays double.
    for(let winner=0;winner<this.numPlayers;winner++){
      if(!nagashiSeats[winner]) continue;
      g.stats[winner].wins++;
      const isDealer=winner===g.dealer;
      let gain=0;
      for(let payer=0;payer<this.numPlayers;payer++){
        if(payer===winner) continue;
        const pay=Math.ceil((isDealer?2000*2:payer===g.dealer?2000*2:2000)/100)*100;
        g.scores[payer]-=pay; gain+=pay;
      }
      g.scores[winner]+=gain;
    }
    // Tobi check (bankruptcy) — unlike every other _endRound/tenpai-payment
    // path, this used to be missing entirely, so a player sent negative by
    // a nagashi mangan payment (up to 4000 points to a dealer-as-winner)
    // wouldn't end the game as a bust at all.
    const bust=g.scores.findIndex(s=>s<0);
    const nagashiMaxRound=this._maxRound();
    const nagashiNewRound=nagashiSeats[g.dealer]?g.round:g.round+1;
    const nagashiGameOver=bust>=0||nagashiNewRound>nagashiMaxRound;
    // Nagashi mangan is scored as a tsumo but is still fundamentally a draw
    // outcome — every seat's discards were exhausted, nobody called ron/
    // tsumo on a discard — so riichi sticks are never claimed here either.
    const newHonba=g.honba+1;
    this._broadcastAll({type:'round_end',reason:'nagashi',nagashiSeats,scores:g.scores,
      playerNames:this.seats.map(p=>p?.name||'—'),dora:g.dora,gameOver:nagashiGameOver,
      honba:newHonba,riichiSticks:g.riichiSticks});

    // Nagashi: dealer repeat if dealer is nagashi winner
    const dealerNagashi=nagashiSeats[g.dealer];
    let newDealer=g.dealer,newRound=g.round;
    if(!dealerNagashi){
      newDealer=(g.dealer+1)%this.numPlayers;
      newRound=g.round+1;
    }
    const newRoundWind=Math.ceil(newRound/this.numPlayers);
    const maxRound=this._maxRound();
    if(bust>=0){
      this._finishGame('tobi',{bust});
      return;
    }
    if(newRound>maxRound){
      this._finishGame('end');
      return;
    }
    g.dealer=newDealer;g.round=newRound;g.roundWind=newRoundWind;
    g.honba=newHonba;

    this.roundReady=new Set();
    this.pendingNextRound=()=>{
      if(this.phase!=='playing') return;
      g.turn=newDealer;
      this._initRound();
      const dispWind=Math.ceil(newRound/this.numPlayers);
      const dispRound=((newRound-1)%this.numPlayers)+1;
      this._broadcastAll({type:'round_start',round:newRound,roundWind:newRoundWind,displayWind:dispWind,displayRound:dispRound,
        dealer:newDealer,honba:newHonba,scores:g.scores,
        playerNames:this.seats.map(p=>p?.name||'—')});
      setTimeout(()=>this._draw(),ROUND_START_DELAY);
    };
  }

  _nextTurn(){
    const g=this.game;
    g.turn=(g.turn+1)%this.numPlayers;
    this._draw();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _seatWindOf(seat){
    // Seat wind relative to dealer: dealer=1(East), +1 each seat. In sanma
    // this naturally only ever produces 1-3 (East/South/West) — seat 4
    // (North) simply never exists as a seat to compute a wind for.
    const g=this.game;
    return ((seat-g.dealer+this.numPlayers)%this.numPlayers)+1;
  }

  // Round wind for yaku (1=East, 2=South). g.roundWind is already stored as
  // this converted 1/2 value everywhere it's set (see the Math.ceil(round/4)
  // calls in _endRound/_resolveTenpaiPayments/_resolveNagashi) — it is NOT
  // the raw 1-8 hand-within-wind counter (that's g.round), so just return it
  // directly. (Previously this re-derived it with a `<=4?1:2` check meant
  // for a raw 1-8 value, which was always true once roundWind was already
  // 1 or 2 — so Round Wind yaku was silently always East, even in a
  // hanchan's South round.)
  _roundWindValue(){
    return this.game.roundWind;
  }

  // ── State broadcast ────────────────────────────────────────────────────────
  // Called after almost every state-changing action. Builds and sends a
  // SEPARATE game_state payload per human seat (bots are skipped — they act
  // synchronously off `this.game` directly, no message needed) so each
  // player only ever sees their own concealed hand; opponents' hands are
  // sent as bare counts (oppHandSizes) for rendering face-down tiles. Also
  // where all the "can I ___ right now" client hints are computed
  // (canRiichi/canAnkan/canKakan/canTsumo/canKyuushu) — these are advisory
  // for the UI only, the server re-validates independently when the actual
  // action arrives (see action() and the individual handlers).
  _sendState(){
    const g=this.game;
    if(!g) return;
    for(let seat=0;seat<this.numPlayers;seat++){
      const p=this.seats[seat];
      if(!p||p.isBot) continue;
      const hand=g.hands[seat];
      // Calculate waits from 13-tile hand (excluding draw tile if present)
      const dt=g.turn===seat?g.drawTile:null;
      const w=waits(hand,g.melds[seat],this.rules.sanma);
      // "Full" (post-draw) hand size shrinks below 14 once any kan has been
      // called this hand — same accounting as isWin/waits in mahjong.js:
      // hand.length === 14 - physicalMeldTiles + numKans. A flat 14 check
      // here would wrongly hide Riichi/further-Ankan right after the first
      // kan of the hand, even mid-turn with more kans still available.
      const meldTileCount=g.melds[seat].reduce((n,m)=>n+(m.type==='kan'?4:3),0);
      const numKans=g.melds[seat].filter(m=>m.type==='kan').length;
      const fullHandSize=14-meldTileCount+numKans;
      let canRiichi=[];
      if(hand.length===fullHandSize&&isMenzen(g.melds[seat])&&!g.riichi[seat]&&g.scores[seat]>=1000){
        canRiichi=hand.filter(t=>waits(hand.filter(x=>x.id!==t.id),g.melds[seat],this.rules.sanma).length>0).map(t=>t.id);
      }
      let canAnkan=[];
      if(g.turn===seat&&hand.length===fullHandSize){
        const c={};hand.forEach(t=>{c[key(t)]=(c[key(t)]||0)+1;});
        if(!g.riichi[seat]){
          canAnkan=Object.entries(c).filter(([k,n])=>n===4).map(([k])=>k);
        } else {
          // In riichi: only allow ankan if waits don't change
          canAnkan=Object.entries(c).filter(([k,n])=>{
            if(n!==4) return false;
            const before=waits(hand.filter(t=>key(t)!==k),undefined,this.rules.sanma);
            const matches=hand.filter(t=>key(t)===k);
            const after=waits(hand.filter(t=>!matches.slice(0,3).map(u=>u.id).includes(t.id)),undefined,this.rules.sanma);
            return before.length===after.length&&before.every(w=>after.includes(w));
          }).map(([k])=>k);
        }
      }
      let canKita=[];
      if(this.rules.sanma&&g.turn===seat&&hand.length===fullHandSize&&g.wall.length>0){
        canKita=hand.filter(t=>key(t)==='4z').map(t=>t.id);
      }
      let canKakan=[];
      if(g.turn===seat&&!g.riichi[seat]&&g.drawTile){
        const ponKeys=g.melds[seat].filter(m=>m.type==='pon').map(m=>key(m.tiles[0]));
        canKakan=hand.filter(t=>ponKeys.includes(key(t))&&t.id===g.drawTile.id).map(t=>t.id);
        // Also allow kakan with any tile in hand matching a pon (not just draw tile)
        if(canKakan.length===0)
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
          g.riichi[seat],g.ippatsu[seat],isDblRiichi,g.isRinshan,false,g.haiteiNext,false,false,false,winKey,
          {kuitanAri:this.rules.kuitanAri});
        return han>0;
      })();
      // Chonbo-only: lets the client offer a deliberately-recessed "attempt
      // a declare anyway" control any time it's this seat's turn with a
      // full hand — including when canTsumo is actually true. Chonbo
      // removes the safety net entirely, so the client is never told a
      // hand is a genuine win either; see drawActions in script.js, which
      // gates the safe one-tap canTsumo button on !m.chonbo for this reason.
      const canAttemptTsumo=this.rules.chonbo&&g.turn===seat&&hand.length===fullHandSize;
      // Send hand split: main hand (without draw tile) + draw tile separately
      const fullHand=hand;
      const mainHand=dt?fullHand.filter(t=>t.id!==dt.id):fullHand;
      // Kyuushu Kyuuhai: 9+ unique terminals/honours on first draw
      const TERMINALS=['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
      const canKyuushu=g.turn===seat&&g.firstRound&&hand.length===14&&
        !g.melds[seat].length&&!g.riichi[seat]&&
        new Set(hand.map(t=>key(t)).filter(k=>TERMINALS.includes(k))).size>=9;
      this._send(p,{type:'game_state',seat,myHand:mainHand,drawTile:dt,myMelds:g.melds[seat],
        discards:g.discards,melds:g.melds,scores:g.scores,turn:g.turn,
        round:g.round,roundWind:g.roundWind,displayWind:Math.ceil(g.round/this.numPlayers),displayRound:((g.round-1)%this.numPlayers)+1,dealer:g.dealer,honba:g.honba,
        seatVoiceThemes:this.seats.map(p=>p?.voiceTheme||'Default'),
        seatIcons:this.seats.map(p=>p?.icon||'default'),
        riichiSticks:g.riichiSticks,
        dora:g.dora,wallCount:g.wall.length,waits:w,riichi:g.riichi,
        doubleRiichi:g.doubleRiichi,
        furiten:g.furiten[seat]||g.tempFuriten[seat],
        pending:pendingForMe,canTsumo,canAttemptTsumo,canRiichi,canAnkan,canKakan,canKyuushu,canKita,
        numPlayers:this.numPlayers,sanma:this.rules.sanma,kita:g.kita,chonbo:this.rules.chonbo,
        oppHandSizes:g.hands.map((h,i)=>i===seat?null:h.length),
        seatWinds:Array.from({length:this.numPlayers},(_,s)=>((s-g.dealer+this.numPlayers)%this.numPlayers))});
    }
  }

  _seatInfo(){ return this.seats.map(p=>p?{name:p.name,isBot:!!p.isBot,voiceTheme:p.voiceTheme||'Default',icon:p.icon||'default',title:p.title||null,difficulty:p.difficulty||null}:null); }

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
