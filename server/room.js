'use strict';
const {buildWall,shuffle,sort,key,isWin,waits,canPon,canKan,canChi,
       detectYaku,countDora,countAkaDora,calcFu,waitFu,basePoints,handLabel,isMenzen,shanten} = require('./mahjong');
const {botName,bestDiscard,botReact,shouldRiichi} = require('./bot');
const {recordGameResult} = require('./stats');
const {recordGame} = require('./history');

// Cheap composition heuristics for "what's this hand shaping up toward" —
// not a full search over every possible completion (overkill for a
// beginner hint, and expensive to boot). Shared by getAdvice's own-hand
// potential-yaku block and its per-call-option "if you call this, what
// might it lead to" hint, so both read the same signal off a plain list of
// tile keys (works equally for the concealed hand's own keys or a
// what-if-I-called hand's keys, the caller decides which). `sw`/`rw` are
// this seat's seat-wind/round-wind values (1-4/1-2), needed to know which
// wind pair would count as yakuhai.
function _potentialYakuHints(keys,sw,rw){
  const potential=[];
  if(!keys.length) return potential;
  const isTermHon=k=>k.slice(-1)==='z'||k[0]==='1'||k[0]==='9';
  if(keys.every(k=>!isTermHon(k)))
    potential.push({name:'Tanyao',jp:'断么九',hint:'No terminal or honor tiles — stay all-simples for an easy 1 han.'});
  const nonHonorSuits=new Set(keys.filter(k=>k.slice(-1)!=='z').map(k=>k.slice(-1)));
  const hasHonor=keys.some(k=>k.slice(-1)==='z');
  if(nonHonorSuits.size===1)
    potential.push({name:hasHonor?'Honitsu':'Chinitsu',jp:hasHonor?'混一色':'清一色',
      hint:`Limited to one suit${hasHonor?' plus honors':''} — worth ${hasHonor?3:6} han if it stays that way.`});
  const counts={}; keys.forEach(k=>counts[k]=(counts[k]||0)+1);
  const yakuhaiPair=Object.keys(counts).find(k=>counts[k]>=2&&(k==='5z'||k==='6z'||k==='7z'||k===`${sw}z`||k===`${rw}z`));
  if(yakuhaiPair)
    potential.push({name:'Yakuhai',jp:'役牌',hint:`The pair of ${yakuhaiPair} would be worth a han as a triplet.`});
  // Toitoi potential: several tile types already sitting as pairs/triplets
  // rather than spread into sequence-shaped runs — a rough "leaning toward
  // all-triplets" signal, not a real shape check (that would need
  // decompose()), but cheap and directionally useful for a beginner hint.
  const pairPlusCount=Object.values(counts).filter(n=>n>=2).length;
  if(pairPlusCount>=3)
    potential.push({name:'Toitoi',jp:'対々和',hint:'Several pairs/triplets already — leaning toward an all-triplets hand.'});
  return potential;
}

let _roomId=0;
const BOT_DELAY=1200; // pause before a bot acts, so its move is readable on screen
// Must match roundStartBanner()'s 3400ms timer in public/script.js — the
// client blocks all clicks (human) for that long while the "東2局" card is
// up, but bots aren't aware of it and act on their own timers regardless.
// Holding the dealer's first draw off until the card would have cleared
// keeps a bot from drawing/discarding/calling while the card is still on
// screen, instead of just hiding the result until it clears.
const ROUND_START_DELAY=3400;
// How long the chat "is typing" nameplate indicator (see typing() below)
// stays up after the player's last keystroke, absent a newer one or an
// actually-sent message resetting/clearing it — long enough to survive a
// normal thinking-pause mid-sentence, short enough that it doesn't linger
// looking stale if they just abandoned the message unsent.
const TYPING_TIMEOUT_MS=3000;
// Chat message colour palette — must match CHAT_COLORS in public/script.js.
// Validated server-side rather than trusting the client's `color` field
// verbatim, since it gets echoed straight into another player's page.
const CHAT_COLORS=new Set(['#ffffff','#f0d080','#ff6b6b','#6bff8f','#6bb6ff','#ff8fd6','#6bfff0','#ffb366']);
// Seat-popup reaction set — must match SEAT_EMOJI in public/script.js.
// Same "validate against a server-side copy" reasoning as CHAT_COLORS above.
const SEAT_EMOJI=new Set(['😂','😢','😠','😱','😊','🤯','😏','👍','🔥','🏆','❤️','🙏']);
// Message-reaction set — must match MSG_REACTIONS in public/script.js.
const MSG_REACTIONS=new Set(['👍','❤️','😂','😮','😢']);

// ── Dead wall layout (14 tiles, 18 in sanma) ────────────────────────────────
// [0-3]   = rinshan tiles (drawn on kan)
// [4-8]   = dora indicators  (dora[0] = deadWall[4], revealed on kan = deadWall[5..8])
// [9-13]  = ura dora indicators (revealed only on riichi win)
// [14-17] = sanma only: kita rinshan tiles (drawn on kita — see _completeKita).
//           A SEPARATE 4-slot pool from kan's [0-3], not shared/counted
//           together — kan and kita both cap out at 4 (kan via suukaikan;
//           kita because only 4 North tiles physically exist in the game),
//           but nothing stops both caps being reached independently in the
//           same hand, so each needs its own reserved region rather than
//           racing for the same 4 slots.

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
    // Connection id of whoever called create_room (set by index.js right
    // after construction — never set for quick_match, so hostStartPlayAgain
    // below can never fire for those rooms). Stays this same id for the
    // room's whole lifetime, including into a playAgain() rematch — a
    // join_room room keeps the ORIGINAL creator's id, joiners never
    // overwrite it.
    this.hostId=null;
    // Seats (not player ids — a seat's occupant can change) that have
    // opted into a same-room rematch after game_over via playAgain() below.
    // Only meaningful while phase==='done'; cleared on every fresh
    // hostStartPlayAgain restart.
    this.playAgainVotes=new Set();
    // 'quick'|'room' — which stats bucket this game's results accumulate
    // into (see stats.js's per-variant quick/room split). Defaults to
    // 'room' since that's what a bare `new Room(...)` means everywhere
    // except quick_match, which stamps it to 'quick' right after
    // construction (see index.js).
    this.matchKind='room';
    // Monotonic per-room id stamped on every chat message (see chat()
    // below) — lets msg_react broadcasts (reactToMessage) unambiguously
    // reference "this specific message" on every client without needing
    // any actual chat history storage here (chat itself is never
    // persisted, purely relayed — see chat()'s own comment).
    this.chatSeq=0;
    // Chat "is typing" indicator (see typing() below) — seat -> the timeout
    // that clears it. A Map, not a Set, specifically so that timeout handle
    // is reachable to clearTimeout/reschedule on every fresh keystroke
    // rather than just tracking which seats are currently flagged.
    this._typingTimers=new Map();
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
    // Captured before _makeBot below overwrites this.seats[seat] — this is
    // the one place callers actually want to know a REAL player left (as
    // opposed to a seat simply being a bot, which is also true of a seat
    // that was never anything else), so the name has to be read now.
    const leavingName=this.seats[seat]?.name||'A player';
    // Excludes the leaving player's own connection — this.seats[seat] is
    // still them at this point (not yet overwritten by _makeBot below), so
    // a plain _broadcastAll would otherwise tell them their own name "left
    // the room" right as they're leaving it, both pointless (they know) and
    // confusing (it'd surface as a toast over the menu they just landed on,
    // since 'leave' keeps the socket open — see leaveCurrentRoom in index.js).
    for(const p of this.seats){
      if(p&&!p.isBot&&p.id!==playerId&&p.ws?.readyState===1)
        p.ws.send(JSON.stringify({type:'player_left',seat,name:leavingName}));
    }
    this.ready.delete(playerId);
    // A pending play-again vote is keyed by seat number, not player id — if
    // this seat leaves mid-'done' phase, its vote must go with it, or a
    // seat it never actually cast (now holding a fresh bot below) would
    // silently count as "wants to play again". roundReady (the between-
    // rounds "ready for next hand" vote — see _checkRoundReady) is keyed
    // the same way for the same reason: a stale ready vote sitting under
    // this seat number could otherwise silently count as consent from
    // whichever bot (or later, a different human) ends up occupying it.
    this.playAgainVotes.delete(seat);
    this.roundReady.delete(seat);
    // Same reasoning as playAgainVotes/roundReady above, for the typing
    // indicator (see typing() below) — without this, a player who
    // disconnects mid-keystroke leaves their nameplate stuck showing
    // "typing…" forever (nothing else was ever going to send the
    // clearing ping), and worse, that stale badge would now sit on
    // whichever bot/human ends up in this seat next.
    if(this._typingTimers.has(seat)){
      clearTimeout(this._typingTimers.get(seat));
      this._typingTimers.delete(seat);
      this._broadcastAll({type:'typing_status',seat,typing:false});
    }
    // Always refill with a fresh bot (not null) so the table stays full —
    // matches fillBots()/addHuman() always keeping every seat occupied.
    this.seats[seat]=this._makeBot(seat);
    this._broadcastRoomUpdate();
    // The turn/reaction state machine never re-evaluates itself on its own
    // (see _resumeAfterBotSwap's own comment) — without this, a human who
    // disconnects mid-turn or while sitting on a ron/pon/chi/kan decision
    // would strand the whole table forever, since nothing else was ever
    // going to prompt this now-bot seat to act.
    this._resumeAfterBotSwap(seat);
    // Same gap, different screen: the round-result "Ready" gate (see
    // _checkRoundReady) only ever re-evaluated itself from the
    // round_ready action handler — a human leaving AFTER every OTHER
    // human had already readied left this seat's now-bot occupant with
    // nothing left to ever check the gate again, stranding the whole
    // table on the results screen indefinitely (there's no timeout here
    // at all — an AFK human already freezes this screen by design; this
    // specifically closes the "they disconnected instead" case).
    this._checkRoundReady();
  }

  // Shared by the round_ready action handler and removeHuman (a seat
  // leaving can itself complete the "everyone's ready" condition, if it
  // was the last human still not-ready) — releases this.pendingNextRound
  // once every CURRENT human seat has voted ready. Bots never vote and are
  // excluded from the requirement entirely, so a seat that just became a
  // bot (removeHuman) is as good as an automatic "ready" from it.
  // Gated on pendingNextRound existing at all — removeHuman calls this on
  // EVERY disconnect, not just ones that happen to land on the round-end
  // screen (unlike the round_ready handler, which can only ever fire from
  // there), so without this guard a human disconnecting mid-gameplay would
  // broadcast a stray, meaningless "X/Y ready" status left over from
  // whatever roundReady last held.
  _checkRoundReady(){
    if(!this.pendingNextRound) return;
    const humanSeats=this.seats.map((p,i)=>p&&!p.isBot?i:-1).filter(i=>i>=0);
    this._broadcastAll({type:'ready_status',count:this.roundReady.size,total:humanSeats.length});
    if(humanSeats.every(i=>this.roundReady.has(i))){
      const fn=this.pendingNextRound;
      this.pendingNextRound=null;
      this.roundReady=new Set();
      fn();
    }
  }

  // Pokes the turn/reaction state machine forward for a seat that just got
  // swapped from human to bot mid-game (removeHuman above). Two situations
  // leave the game waiting specifically on THIS seat with no other timer
  // ever going to fire for it:
  //  1. g.pending (a ron/pon/chi/kan reaction window) is open and this seat
  //     is one of the reactors who hasn't answered yet. Bot seats normally
  //     either get an immediate setTimeout(BOT_DELAY) response scheduled in
  //     _discard(), or — if the window has ANY human reactor — no bot timer
  //     at all, since resolution was expected to come from that human's
  //     response. If THIS seat was that human, nothing else was ever going
  //     to call _resolveReactions() — and critically, if OTHER seats in the
  //     same window are ALSO bots that never got a timer for that same
  //     reason, filling in only this one seat's response still leaves the
  //     window stuck (every(...) never true). So this fills in every
  //     still-unanswered BOT seat in the window, not just this one — see
  //     the loop below. Chankan windows are excluded — _kakan already gives
  //     those their own unconditional watchdog timer (g.pending.timer) that
  //     completes the kan regardless of who's still outstanding.
  //  2. g.pending is clear and it's this seat's own turn (mid-draw, waiting
  //     on a discard/riichi/kan/tsumo decision) — _draw() only scheduled a
  //     bot timer if the seat was ALREADY a bot at the moment it drew, so a
  //     human who drew and then disconnected leaves nothing pending.
  _resumeAfterBotSwap(seat){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    if(g.pending&&!g.pending.isChankan&&g.pending.seats.includes(seat)&&!g.pending.responses[seat]){
      // Fill in a bot response for EVERY seat in this window that's now a
      // bot and hasn't answered yet — not just the seat that just swapped.
      // A window opened with a human reactor never scheduled a BOT_DELAY
      // timer for any OTHER bot seat in it either (see _discard's
      // humanInReactions check above) — it trusted resolution to come from
      // that human's own response. If THIS seat was that human, those other
      // bot seats would otherwise never get a response and every(...) below
      // would stay false forever, stranding the window even after this fix
      // fills in the seat that actually triggered it.
      for(const s of g.pending.seats){
        if(g.pending.responses[s]) continue;
        if(!this.seats[s]?.isBot) continue;
        const opts=g.pending.options.find(r=>r.seat===s)?.options||[];
        g.pending.responses[s]=this._safeBotReact(s,g.hands[s],g.pending.tile,opts,g.melds[s],this.seats[s].difficulty);
      }
      if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
      return;
    }
    if(!g.pending&&g.turn===seat){
      setTimeout(()=>this._botAct(seat),BOT_DELAY);
    }
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
    this._broadcastAll({type:'chat',seat:p.seat,name:p.name,text:msg,color:safeColor,id:++this.chatSeq});
    // A message actually SENT (not just typed) ends the typing indicator
    // immediately rather than leaving it hanging around for up to
    // TYPING_TIMEOUT_MS after the chat bubble itself already appeared —
    // sendChat() (script.js) clears the input on send, so no further
    // 'typing' ping would arrive to keep it alive anyway; this just closes
    // that visible gap instead of waiting for it to time out on its own.
    if(this._typingTimers.has(p.seat)){
      clearTimeout(this._typingTimers.get(p.seat));
      this._typingTimers.delete(p.seat);
      this._broadcastAll({type:'typing_status',seat:p.seat,typing:false});
    }
  }

  // Client pings this on every keystroke in the chat input (see the
  // chat-input 'input' listener in script.js) — throttling/debouncing
  // lives entirely here rather than on the client: only the FIRST ping in
  // a burst actually broadcasts typing:true, and every ping (first or not)
  // reschedules the same auto-clear timer, so a player who keeps typing
  // never flickers the indicator, and one who stops (without sending, or
  // by disconnecting — see removeHuman) has it clear itself
  // TYPING_TIMEOUT_MS after their last keystroke with no further action
  // needed from the client.
  typing(playerId){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p) return;
    const seat=p.seat;
    const alreadyTyping=this._typingTimers.has(seat);
    clearTimeout(this._typingTimers.get(seat));
    if(!alreadyTyping) this._broadcastAll({type:'typing_status',seat,typing:true});
    this._typingTimers.set(seat,setTimeout(()=>{
      this._typingTimers.delete(seat);
      this._broadcastAll({type:'typing_status',seat,typing:false});
    },TYPING_TIMEOUT_MS));
  }

  // Beginner-assist "Help" button — computed only on demand (never pushed
  // automatically) so it stays pure advice, not an autopilot. Read-only:
  // never touches game state, just re-runs the same shanten/yaku/score
  // logic the server already uses to decide canTsumo/canRiichi/bot moves
  // (see mahjong.js/bot.js) and reports the result back to the asker only.
  getAdvice(playerId){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p||!this.game||this.phase!=='playing') return;
    const seat=p.seat;
    const g=this.game;
    const hand=g.hands[seat];
    const melds=g.melds[seat];
    const sanma=this.rules.sanma;
    const sw=this._seatWindOf(seat);
    const rw=this._roundWindValue();
    const isRiichi=g.riichi[seat];
    const isDblRiichi=g.doubleRiichi[seat];
    const isDealer=seat===g.dealer;
    const kuitanAri=this.rules.kuitanAri;

    const meldTileCount=melds.reduce((n,m)=>n+(m.type==='kan'?4:3),0);
    const numKans=melds.filter(m=>m.type==='kan').length;
    const fullHandSize=14-meldTileCount+numKans;
    const canDiscardNow=g.turn===seat&&hand.length===fullHandSize&&!g.pending;

    // Discard ranking (only meaningful once a discard is actually legal
    // right now) — same shanten+wait-count ranking bot.js's _rankDiscards
    // uses, just reported as advice text instead of auto-played. Each
    // candidate also gets `lostYaku`: any potential yaku (per
    // _potentialYakuHints) the CURRENT hand has that discarding THIS tile
    // would give up — e.g. breaking a dragon pair you were holding toward
    // Yakuhai. Efficiency (shanten/waits) alone can silently recommend a
    // discard that throws away a developing yaku without ever saying so;
    // this is the "what would this action cost me" half of that picture.
    let discards=null;
    if(canDiscardNow){
      const beforeKeys=[...hand.map(key),...melds.flatMap(m=>m.tiles.map(key))];
      const beforePotential=_potentialYakuHints(beforeKeys,sw,rw).map(p=>p.name);
      const cands=hand.map(t=>{
        const rem=hand.filter(x=>x.id!==t.id);
        const sh=shanten(rem,melds);
        const w=sh===0?waits(rem,melds,sanma):[];
        const afterKeys=[...rem.map(key),...melds.flatMap(m=>m.tiles.map(key))];
        const afterPotential=new Set(_potentialYakuHints(afterKeys,sw,rw).map(p=>p.name));
        const lostYaku=beforePotential.filter(n=>!afterPotential.has(n));
        return {tileId:t.id,key:key(t),shanten:sh,waitCount:w.length,waitTiles:w,lostYaku};
      });
      cands.sort((a,b)=>a.shanten-b.shanten||b.waitCount-a.waitCount);
      discards=cands.slice(0,3);
    }

    // The 13-tile "base" hand to evaluate tenpai/yaku/score against: the
    // hand after the recommended discard (if one is on offer right now),
    // otherwise the hand as-is (already 13 tiles outside of your own turn).
    let hand13=hand;
    if(canDiscardNow&&discards&&discards.length) hand13=hand.filter(t=>t.id!==discards[0].tileId);
    const curShanten=shanten(hand13,melds);

    // Pending call decision (pon/chi/kan offered to this seat right now) —
    // mirrors bot.js's _shantenBotReact reasoning (does taking the call
    // actually reduce shanten?) but reported for a human to choose from,
    // PLUS what calling would actually score — a shanten improvement that
    // leaves the hand with no yaku at all (the classic beginner trap: an
    // open hand needs its own yaku, unlike a closed one that can fall back
    // on Riichi) is worse advice than it looks from shanten alone.
    let callAdvice=null;
    if(g.pending&&g.pending.seats.includes(seat)){
      const myR=g.pending.options.find(r=>r.seat===seat);
      const disc=g.pending.tile;
      const before=shanten(hand,melds);
      callAdvice=(myR?.options||[]).filter(o=>o.type!=='ron').map(o=>{
        // Build the REAL meld (with actual tile objects, not a bare
        // {type} placeholder) — detectYaku/waits both read melds[].tiles
        // to know the open hand's full tile set, so a placeholder here
        // would silently make every yaku check below ignore this meld.
        let matchedTiles=[];
        if(o.type==='pon') matchedTiles=hand.filter(t=>key(t)===key(disc)).slice(0,2);
        else if(o.type==='chi') matchedTiles=o.sequences[0].map(id=>hand.find(t=>t.id===id));
        else if(o.type==='kan') matchedTiles=hand.filter(t=>key(t)===key(disc)).slice(0,3);
        const realMeld={type:o.type,tiles:[...matchedTiles,disc]};
        const rem=hand.filter(t=>!matchedTiles.some(u=>u.id===t.id));
        const afterMelds=[...melds,realMeld];
        const after=shanten(rem,afterMelds);
        const recommend=after<before;
        const reason=recommend
          ?`Calling ${o.type} brings you from ${before}-away to ${after}-away from tenpai.`
          :`Calling ${o.type} wouldn't improve your shanten (still ${after}-away) and opens your hand — passing usually keeps more options.`;

        // Calling always opens the hand, so Riichi-family/Menzen Tsumo
        // never apply post-call regardless of this seat's CURRENT riichi
        // state — hence the hardcoded false's below (isRiichi/isIppatsu/
        // isDoubleRiichi), unlike the main waitInfo block which reads the
        // seat's real current values for its still-closed hand.
        let yaku=[],noYakuWarning=false,potential=[];
        if(after===0){
          // `rem` is still the pre-discard hand (calling pon/chi always
          // leaves one extra tile to discard, same as any own-turn draw)
          // — one tile oversized versus the concealed count detectYaku
          // actually expects for this meld count. Reduce to the best
          // (shanten-minimizing) discard first, same step the outer
          // hand13/discards[0] derivation does for the main hand, or
          // hand14 below ends up the wrong tile count and decompose()
          // silently finds no grouping at all (every wait reads as 0 han,
          // even a plain open dragon-triplet win).
          const meldTileCount2=afterMelds.reduce((n,mm)=>n+(mm.type==='kan'?4:3),0);
          const numKans2=afterMelds.filter(mm=>mm.type==='kan').length;
          const base13_2=13-meldTileCount2+numKans2;
          let remBase=rem;
          if(rem.length>base13_2){
            let bestId=null,bestSh=Infinity;
            for(const t of rem){
              const sh=shanten(rem.filter(x=>x.id!==t.id),afterMelds);
              if(sh<bestSh){bestSh=sh;bestId=t.id;}
            }
            remBase=rem.filter(t=>t.id!==bestId);
          }
          const w=waits(remBase,afterMelds,sanma);
          const yakuSet=new Set();
          let anyHan=false;
          for(const wk of w){
            const v=parseInt(wk),s=wk.slice(-1);
            const hand14=[...remBase,{s,v,id:999992}];
            const rTsumo=detectYaku(hand14,afterMelds,true,sw,rw,false,false,false,false,false,false,false,false,false,wk,{kuitanAri});
            const rRon=detectYaku(hand14,afterMelds,false,sw,rw,false,false,false,false,false,false,false,false,false,wk,{kuitanAri});
            if(rTsumo.han>0){anyHan=true;rTsumo.yakuList.forEach(y=>yakuSet.add(y.name));}
            if(rRon.han>0){anyHan=true;rRon.yakuList.forEach(y=>yakuSet.add(y.name));}
          }
          yaku=[...yakuSet];
          noYakuWarning=w.length>0&&!anyHan;
        } else if(after>0){
          const keys=[...rem.map(key),...afterMelds.flatMap(m=>m.tiles.map(key))];
          potential=_potentialYakuHints(keys,sw,rw);
        }
        return {type:o.type,beforeShanten:before,afterShanten:after,recommend,reason,yaku,noYakuWarning,potential};
      });
    }

    // Current waits + achievable yaku/score, only meaningful once tenpai.
    let waitInfo=null;
    if(curShanten===0){
      const w=waits(hand13,melds,sanma);
      waitInfo=w.map(wk=>{
        const v=parseInt(wk),s=wk.slice(-1);
        const hand14=[...hand13,{s,v,id:999990}];
        const rTsumo=detectYaku(hand14,melds,true,sw,rw,isRiichi,g.ippatsu[seat],isDblRiichi,false,false,false,false,false,false,wk,{kuitanAri});
        const rRon=detectYaku(hand14,melds,false,sw,rw,isRiichi,g.ippatsu[seat],isDblRiichi,false,false,false,false,false,false,wk,{kuitanAri});
        const dora=countDora(hand14,g.dora)+countAkaDora(hand14);
        const useTsumo=rTsumo.han>0&&(rRon.han===0||rTsumo.han>=rRon.han);
        const pick=useTsumo?rTsumo:rRon;
        if(pick.han===0) return {tile:wk,han:0,yaku:[],points:null,label:null};
        const totalHan=pick.han+dora;
        const isPinfu=pick.yakuList.some(y=>y.name==='Pinfu');
        const fu=pick.groups?calcFu(pick.groups,useTsumo,isMenzen(melds),wk,isPinfu):25;
        const bp=basePoints(totalHan,fu);
        const points=Math.ceil((isDealer?bp*6:bp*4)/100)*100;
        const yakuNames=[...pick.yakuList.map(y=>y.name)];
        if(dora>0) yakuNames.push(`Dora x${dora}`);
        return {tile:wk,han:totalHan,fu,yaku:yakuNames,points,label:handLabel(totalHan),isTsumo:useTsumo};
      }).filter(x=>x.han>0).sort((a,b)=>b.han-a.han);
    }

    // Not tenpai yet — cheap composition heuristics (see _potentialYakuHints)
    // for "what's this hand shaping up toward", not a full search over
    // every possible completion (overkill for a beginner hint).
    const potential=curShanten!==0
      ? _potentialYakuHints([...hand13.map(key),...melds.flatMap(m=>m.tiles.map(key))],sw,rw)
      : [];

    // Furiten — a beginner trap that isn't about hand shape at all: your
    // wait tiles are genuinely correct, but a matching tile already sitting
    // in your OWN discard pile (permanent) or a missed ron this go-around
    // (temporary, g.tempFuriten) blocks every ron until it clears, tsumo
    // only. Surfaced unconditionally (not just at tenpai) since it's easy
    // to not even realize you're in it.
    const furiten=!!(g.furiten[seat]||g.tempFuriten[seat]);

    // Kita (sanma only) — a North tile sitting in hand is dead weight for
    // every standard hand shape (winds can't form runs, and a lone 4z
    // needs two more just to become a triplet), while calling Kita banks
    // it for a free +1 han later AND draws a replacement — strictly better
    // than either discarding it or holding it hoping to pair it up. Same
    // gating as canKita in _sendState (this seat's own turn, full hand,
    // the shared kita-rinshan pool not yet exhausted).
    let kitaTip=null;
    if(sanma&&g.turn===seat&&hand.length===fullHandSize&&g.kitaCount<4&&hand.some(t=>key(t)==='4z')){
      kitaTip='You\'re holding North (北) — call Kita before discarding it. It banks a free bonus han and gives you a replacement draw, at no cost to your hand shape.';
    }

    // Riichi opportunity — only a nudge that it's AVAILABLE (not a "you
    // should", since folding defensively can be the right call too), using
    // the same eligibility gate _sendState's own canRiichi uses (own turn,
    // full hand, closed, not already in riichi, can still afford the stick).
    const riichiTip=(canDiscardNow&&curShanten===0&&isMenzen(melds)&&!isRiichi&&g.scores[seat]>=1000)
      ? 'You can declare Riichi with this discard — it locks in a guaranteed yaku, plus a chance at ura dora.'
      : null;

    // Defense awareness — any opponent already in riichi is committed to
    // their hand and will ron anything that completes it, so a beginner
    // pushing their own hand without checking this is the single most
    // common way to deal in. genbutsu (tiles already sitting in THAT
    // opponent's own discard pile, or discarded by anyone AFTER their
    // riichi) are provably safe against them; only the simpler
    // "in their own pond" rule is applied here, same safe-tile source
    // bot.js's hard-difficulty defense uses, not full multi-player suji/
    // kabe reading (real but too deep for a beginner hint).
    let dangerTip=null;
    const riichiOpponents=[];
    for(let s=0;s<this.numPlayers;s++){ if(s!==seat&&g.riichi[s]) riichiOpponents.push(s); }
    if(riichiOpponents.length){
      const names=riichiOpponents.map(s=>this.seats[s]?.name||`Seat ${s}`);
      const dangerSets=riichiOpponents.map(s=>g.discards[s].map(key));
      // Safe against EVERY riichi opponent at once, not just one of them —
      // a tile safe against one but not another isn't safe (same
      // convention bot.js's own hard-difficulty defense uses).
      const safeKeys=[...new Set(hand.filter(t=>dangerSets.every(ds=>ds.includes(key(t)))).map(key))];
      dangerTip={opponents:names,safeKeys};
    }

    // Dora count — easy to lose track of mid-hand since it never shows up
    // anywhere else in this panel except folded into a per-wait score
    // (waitInfo, only once tenpai). Counted against hand13 (the base hand
    // this whole response evaluates against, post-recommended-discard when
    // one's on offer) plus this seat's own melds, so it matches whatever
    // hand the rest of the panel is describing.
    const doraCount=countDora(hand13,g.dora)+countAkaDora(hand13)
      +countDora(melds.flatMap(m=>m.tiles),g.dora)+countAkaDora(melds.flatMap(m=>m.tiles));

    // Endgame awareness — a beginner will happily keep pushing a hand
    // that's nowhere close to tenpai right up until the wall runs out,
    // ending in an exhaustive draw (or worse, a deal-in on the way there)
    // with nothing to show for it. Only fires late (wall genuinely running
    // low) and only when still genuinely far off (2+ shanten) — a hand
    // that's already tenpai or one away has every reason to keep pushing
    // regardless of how little wall is left.
    const wallLowTip=(g.wall.length<=20&&curShanten>=2)
      ? `Only ${g.wall.length} tiles left in the wall and you're still ${curShanten} away from tenpai — this round may end in a draw. Consider folding to safe tiles instead of pushing.`
      : null;

    this._send(p,{type:'advice',seat,shanten:curShanten,isTenpai:curShanten===0,
      canDiscardNow,discards,callAdvice,waits:waitInfo,potential,
      furiten,kitaTip,riichiTip,dangerTip,doraCount,wallLowTip});
  }

  // Seat-popup emoji reaction (distinct from reactToMessage below, which
  // reacts to a specific chat message) — pops up over the sender's own
  // play area on every client, see showEmojiPopup in script.js.
  emojiReact(playerId, emoji){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p||!SEAT_EMOJI.has(emoji)) return;
    this._broadcastAll({type:'emoji_react',seat:p.seat,emoji});
  }

  // Attaches (or clears, if emoji is null/undefined) this player's reaction
  // to a specific chat message, identified by the `id` chat() stamped it
  // with. Purely relayed, same as chat() itself — no server-side storage,
  // so a client that joins/reconnects after a reaction was set won't see
  // it (consistent with chat history itself not being replayed either).
  // Re-sending the same emoji the player already reacted with is how the
  // client implements "long-press again to edit/clear" — it just resends
  // whatever the popup's current selection state resolves to.
  reactToMessage(playerId, msgId, emoji){
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p) return;
    if(!Number.isInteger(msgId)) return;
    const safeEmoji=MSG_REACTIONS.has(emoji)?emoji:null;
    this._broadcastAll({type:'msg_react',msgId,seat:p.seat,name:p.name,emoji:safeEmoji});
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
    // Tally the hand that just finished before its melds are wiped below —
    // skipped on the very first call (game start), where g.melds doesn't
    // exist yet because there's no previous hand to tally. isMenzen false
    // means the hand had at least one non-ankan meld (pon/chi/open kan),
    // i.e. it was called open ("huro'd") at some point this hand.
    if(g.melds){
      for(let seat=0;seat<n;seat++){
        if(!isMenzen(g.melds[seat])) g.stats[seat].huro++;
      }
    }
    g.handsPlayed++;
    const wall=shuffle(buildWall(this.rules.akaDora,this.rules.sanma));
    const hands=Array.from({length:n},()=>[]);
    for(let i=0;i<13*n;i++) hands[i%n].push(wall.shift());
    // Sanma's dead wall reserves 4 extra tiles for kita's own separate
    // rinshan pool (see the layout comment above) — yonma never calls
    // kita, so its dead wall stays the standard 14.
    const deadWall=wall.splice(-(this.rules.sanma?18:14));

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
    // _clearPending, not a bare assignment — this.game is reused in place
    // across rounds (this function mutates the SAME object, see its own
    // top-of-function comment), so a chankan window that somehow survived
    // to round-end still needs its 3s watchdog timer cancelled here, or it
    // fires into the new round and corrupts it (see _clearPending's own
    // comment for the exact mechanism).
    this._clearPending();
    g.drawTile=null;
    g.riichiTile={};
    g.riichiTileCalled={};
    g.kanCount=0;
    g.kanSeats=[];
    g.kitaCount=0; // sanma: how many of the 4 kita-rinshan slots ([14-17]) have been drawn
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
    // addHuman fills the lowest-numbered open seat purely for lobby-slot
    // display (join order, left to right) — actual table seating (who
    // ends up on whose right/left) is reshuffled fresh here every game, so
    // it's never just "host=seat0, then join order" the way the lobby
    // slots are. Runs before dealing, so it also reshuffles a same-room
    // Play Again rematch (hostStartPlayAgain also funnels through here).
    this.seats=shuffle(this.seats);
    this.seats.forEach((p,i)=>{if(p) p.seat=i;});
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
      // _finishGame/_recordHandWin. `huro` (hand opened via pon/chi/open
      // kan) is tallied in _initRound, not here, since it needs to inspect
      // each seat's melds right before they're wiped for the next hand.
      // `doubleBust` (tsumo wins that bankrupted 2+ opponents at once — see
      // _endRound) is bumped there, not here, since it needs prevScores vs.
      // post-payment g.scores from that specific win. `quadKita` (banked all
      // 4 of a round's kita tiles single-handedly, sanma only) is bumped in
      // _completeKita, the instant it happens — unlike doubleBust it doesn't
      // need any end-of-round context, just this seat's own g.kita length.
      stats:new Array(this.numPlayers).fill(0).map(()=>({riichi:0,wins:0,tsumo:0,ron:0,dealIn:0,huro:0,doubleBust:0,quadKita:0,bestHan:0,bestScore:0,yaku:{}})),
      // One entry per round_end this game (see _recordRoundHistory below) —
      // exactly the same payload each round already broadcasts to clients,
      // plus that round's own number/wind/dealer/honba context. Fed into
      // history.recordGame at game end (_finishGame) so the Play History
      // panel's per-game dropdown can show precisely what the round-results
      // screen showed at the time, not a re-derived summary.
      roundHistory:[],
      // Hands dealt this game so far — every _initRound() call is one more
      // hand played (win, draw, or abortive draw all count; nothing about
      // a hand's outcome excludes it). Used as the denominator for
      // rate-based stats (hora%/tsumo%/huro%/riichi% — see stats.js) that
      // need "how many hands did you actually play", not just "how many
      // games". Unlike `round` (the wind-round counter), this does
      // increment on dealer repeats too.
      handsPlayed:0,
    };
    this._initRound();
    // Personalized (not _broadcastAll) — each player's actual seat just got
    // reshuffled above, so unlike every other game_start field (identical
    // for everyone) `seat` has to be sent per-recipient. The client latches
    // this onto its own mySeat (see game_start handling in script.js),
    // overriding whatever lobby slot 'joined' gave it.
    for(let seat=0;seat<this.numPlayers;seat++){
      this._send(this.seats[seat],{type:'game_start',seat,seats:this._seatInfo(),gameMode:this.gameMode,dealer:this.game.dealer,numPlayers:this.numPlayers,sanma:this.rules.sanma,chonbo:this.rules.chonbo,scores:this.game.scores});
    }
    setTimeout(()=>this._draw(),2000);
  }

  // ── Turn flow ──────────────────────────────────────────────────────────────
    _draw(fromRinshan=false){
    const g=this.game;
    if(!g||this.phase!=='playing') return;
    if(g.wall.length===0&&!fromRinshan){this._sendState();this._endRound('draw');return;}
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

  // Wraps botReact() (bot.js) so a bug in the bot AI's reaction logic can
  // never leave a g.pending response permanently unfilled — every call site
  // below stores this return value straight into g.pending.responses[seat],
  // and that seat's slot is what every(...) waits on before resolving the
  // window (see _resolveReactions/_checkChankanReacted). An uncaught throw
  // here previously meant that seat's response was simply never written,
  // stranding the whole reaction window (and everyone waiting on it)
  // forever with nothing in the logs pointing at why. 'pass' is always a
  // legal response to any reaction offer, so it's a safe universal fallback
  // — worse than whatever the bot would have ideally chosen, but never
  // worse than a permanent stall.
  _safeBotReact(seat,hand,tile,options,melds,difficulty){
    try{
      return botReact(hand,tile,options,melds,difficulty);
    }catch(e){
      console.error(`[bot react error] seat=${seat} tile=${tile&&key(tile)}`,e.message,e.stack);
      return {type:'pass'};
    }
  }

  // Wraps bestDiscard() (bot.js) the same way, plus validates the result is
  // actually a tile this seat is holding — _discard() silently no-ops on an
  // unrecognized tileId (correct there: it's also the human-input validation
  // guard, rejecting a malicious/buggy client's tileId), which for a BOT
  // call means an invalid bestDiscard() result stalls that bot's turn
  // forever with no error at all, not even a thrown one. Falls back to the
  // just-drawn tile if present (river reasoning below), else the hand's own
  // first tile — always a legal discard, so this can never fail to advance
  // the turn.
  _botDiscardTile(seat){
    const g=this.game;
    const hand=g.hands[seat];
    try{
      const id=bestDiscard(hand,g.melds[seat],this.seats[seat].difficulty,this._dangerSetsFor(seat));
      if(hand.some(t=>t.id===id)) return id;
      console.error(`[bot discard error] seat=${seat} bestDiscard returned a tileId not in hand`);
    }catch(e){
      console.error(`[bot discard error] seat=${seat}`,e.message,e.stack);
    }
    // Prefer the just-drawn tile — always legal, and the only legal choice
    // at all for a riichi'd bot (see _botTurn's own forced-discard branch,
    // which normally never even reaches bestDiscard for that case, but this
    // fallback needs to hold even if THIS bot state is itself unusual).
    return (g.drawTile&&hand.some(t=>t.id===g.drawTile.id)?g.drawTile.id:hand[0]?.id);
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
    // The whole decision chain (ankan/tsumo/kita/riichi checks, each
    // calling into mahjong.js's win/yaku/wait logic) is wrapped here rather
    // than relying on individual try/catches lower down — an uncaught throw
    // ANYWHERE in this chain used to leave g.turn stuck on this bot forever
    // (nothing else was ever going to re-invoke this seat's turn), stalling
    // the whole table with nothing in the logs pointing at why. Falling
    // back to a forced discard — g.drawTile if present (also the only
    // legal choice for a riichi'd bot, same as the normal branch above),
    // else the hand's own first tile — is always legal, so the turn can
    // always still advance even when the "smart" decision path breaks.
    try{
      if(!g.riichi[seat]){
        const ankanTile=this._findAnkan(seat);
        if(ankanTile){this._ankan(seat,ankanTile);return;}
      }
      // Only tsumo if hand wins AND has valid yaku — furiten is NOT checked
      // here, same reasoning as _tsumo/canTsumo: it only ever blocks ron.
      if(isWin(hand,g.melds[seat])){
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
        // 'hard' bots weigh damaten against riichi here (see
        // _shouldRiichiDecision/bot.js's shouldRiichi); every other
        // difficulty keeps the original always-riichi-when-legal behavior.
        if(tid!==null&&(this.seats[seat]?.difficulty!=='hard'||this._shouldRiichiDecision(seat,tid))){
          this._riichi(seat,tid);return;
        }
        // Damaten: falls through to the normal discard branches below,
        // which independently pick the best (widest-wait, hard-difficulty-
        // defensive) tenpai-keeping discard — not necessarily the same
        // tile _findRiichiTile happened to land on first.
      }
      // In riichi: must discard the drawn tile
      if(g.riichi[seat]&&g.drawTile){
        this._discard(seat,g.drawTile.id);
        return;
      }
      this._discard(seat,this._botDiscardTile(seat));
    }catch(e){
      console.error(`[bot turn error] seat=${seat}`,e.message,e.stack);
      if(g.turn===seat&&!g.pending){
        const fallbackId=(g.drawTile&&hand.some(t=>t.id===g.drawTile.id))?g.drawTile.id:hand[0]?.id;
        if(fallbackId!=null) this._discard(seat,fallbackId);
      }
    }
  }

  _findRiichiTile(seat){
    const hand=this.game.hands[seat];
    for(const t of hand){if(waits(hand.filter(x=>x.id!==t.id),undefined,this.rules.sanma).length>0) return t.id;}
    return null;
  }

  // HARD bots only — builds the table context bot.js's shouldRiichi needs
  // (it has no access to `this.game`) and asks it whether to riichi on
  // candidateTid or stay damaten. See bot.js's _shouldRiichi for the actual
  // decision logic; this is just the context bridge.
  _shouldRiichiDecision(seat,candidateTid){
    const g=this.game;
    const hand13=g.hands[seat].filter(t=>t.id!==candidateTid);
    return shouldRiichi(hand13,g.melds[seat],{
      seatWind:this._seatWindOf(seat),
      roundWind:this._roundWindValue(),
      doraIndicators:g.dora,
      kuitanAri:this.rules.kuitanAri,
      sanma:this.rules.sanma,
      placement:this._placementFor(seat),
    });
  }

  // Coarse 'lead'|'behind'|'mid' read on this seat's table position, used
  // only to break ties in shouldRiichi when hand value/wait width alone
  // don't clearly favor either side. Margin scales with numPlayers since a
  // 3-player game's points move in bigger per-hand swings than a 4-player
  // one's (fewer opponents splitting payments) — the same 5000 gap means
  // less in sanma than in yonma.
  _placementFor(seat){
    const g=this.game;
    const scores=g.scores;
    const others=scores.filter((_,i)=>i!==seat);
    const margin=this.rules.sanma?6000:5000;
    if(scores[seat]>=Math.max(...others)+margin) return 'lead';
    if(scores[seat]<=Math.min(...others)-margin) return 'behind';
    return 'mid';
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
      this._checkRoundReady();
      return;
    }
    if(!g||this.phase!=='playing') return;
    // Own-turn actions (discard/kyuushu/tsumo/riichi/ankan/kakan/kita) were
    // gated on g.turn===seat alone — but a discard that offers someone else
    // a ron/pon/kan/chi deliberately leaves g.turn pointing at the
    // DISCARDER until that reaction window resolves (see _discard's
    // g.pending branch below), specifically so a late-arriving human
    // response can still be attributed to the right turn. That same
    // "still my turn" state was, until now, also accepted for a SECOND
    // own-turn action from this seat — a player could discard again (or
    // riichi/tsumo/kan) while their first discard's reaction window was
    // still open, silently discarding the pending reaction and stealing an
    // extra tile from their own hand. !g.pending closes that: none of
    // these are legal again until the current reaction window (if any) is
    // actually resolved. Reactions THEMSELVES (ron/pon/kan/chi/pass below)
    // are unaffected — those are exactly what's supposed to happen while
    // g.pending is set, validated separately via _reactResponse.
    const myTurnOpen=g.turn===seat&&!g.pending;
    if(act.type==='discard'&&myTurnOpen) this._discard(seat,act.tileId);
    // 'kyuushu', not 'draw': kyuushu kyuuhai is an abortive draw (like
    // suukaikan) — honba+1, dealer/round unchanged, no scoring. Passing
    // 'draw' here routed it through _endRound's exhaustive-draw branch,
    // which checks nagashi mangan eligibility; since kyuushu fires on
    // turn 1 before anyone's discarded a non-terminal tile, every seat's
    // nagashi flag was still true and it was incorrectly paying out a
    // mangan instead of ending scorelessly.
    else if(act.type==='kyuushu'&&myTurnOpen) this._endRound('kyuushu');
    else if(act.type==='tsumo'&&myTurnOpen) this._tsumo(seat);
    else if(act.type==='riichi'&&myTurnOpen) this._riichi(seat,act.tileId);
    else if(act.type==='ankan'&&myTurnOpen) this._ankan(seat,act.tileKey);
    else if(act.type==='kakan'&&myTurnOpen) this._kakan(seat,act.tileId);
    else if(act.type==='kita'&&myTurnOpen) this._kita(seat,act.tileId);
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
          const dec=this._safeBotReact(r.seat,g.hands[r.seat],tile,r.options,g.melds[r.seat],this.seats[r.seat].difficulty);
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
    // Validate the declared type against what THIS seat was actually
    // offered in the CURRENT window — g.pending.seats.includes(seat) above
    // only proves this seat is a reactor in *some* window right now, not
    // that this specific response type was ever legal in it. A stale
    // response (delayed by lag, or queued behind an earlier window that
    // already resolved before it arrived) could otherwise declare a type
    // this window never offered this seat — e.g. a queued 'kan' tap
    // arriving after the window that offered it closed, landing instead in
    // a NEW window that only offers this seat pon/chi/ron. _daiminkan/_pon/
    // _chi trust their caller and don't re-validate the call is legal
    // against the current hand/window — for 'kan' specifically, _daiminkan
    // early-returns on kanCount>=4 or <3 matching tiles, which (since this
    // clears g.pending BEFORE calling it) left g.pending null, g.turn stuck
    // on the discarder, and nothing left to ever resume the table: an
    // unrecoverable freeze. 'pass' is always legal and needs no offer.
    const myOpts=g.pending.options.find(r=>r.seat===seat)?.options||[];
    if(resp.type!=='pass'&&!myOpts.some(o=>o.type===resp.type)) return;
    g.pending.responses[seat]=resp;

    // If player passes a valid ron, set temporary furiten. A chonbo-only
    // "attempt anyway" option (valid:false) isn't a real ron opportunity —
    // it must NOT count here, or passing on it (as you should, every time
    // it isn't actually a win) wrongly sets furiten and hides every other
    // seat's declare/ron option until your next draw resets it. Since your
    // own draw always precedes your shimocha's discard, that bug made the
    // option only ever reappear for that one seat.
    if(resp.type==='pass'&&myOpts.some(o=>o.type==='ron'&&o.valid!==false)){
      g.tempFuriten[seat]=true;
    }

    if(resp.type==='ron'){this._resolveReactions();return;}
    if(resp.type==='kan'){const tile=g.pending.tile,fromSeat=g.pending.fromSeat;this._clearPending();this._daiminkan(seat,tile,fromSeat);return;}

    // A human just called pon/chi/pass — any other pending seat here is a bot
    // whose only role is to settle priority (a hidden ron always outranks a
    // pon/chi). There's no bot move being displayed to pace for readability,
    // so decide immediately instead of parking behind BOT_DELAY — that pause
    // exists for the bots'-own-turn path in _discard(), not this one.
    const tile=g.pending.tile;
    for(const r of g.pending.options){
      const s=r.seat;
      if(this.seats[s]?.isBot&&!g.pending.responses[s]){
        g.pending.responses[s]=this._safeBotReact(s,g.hands[s],tile,r.options,g.melds[s],this.seats[s].difficulty);
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
  // Clears g.pending, and — critically — the watchdog timer that may be
  // attached to it (see _kakan's 3s chankan timer, g.pending.timer). Every
  // site that discards a g.pending object must go through this rather than
  // a bare `g.pending=null`, or that timer keeps running and fires LATE
  // against whatever g.pending/g.turn/etc. now represents — this.game is
  // the SAME object reused for every round of the whole match (see
  // _initRound, which mutates it in place rather than replacing it), so a
  // leaked chankan timer from one round can fire deep into a LATER round
  // and corrupt ITS hands/melds using the original round's stale seat/tile
  // indices. clearTimeout(null) (every non-chankan g.pending sets
  // timer:null) is a documented no-op, so this is always safe to call.
  _clearPending(){
    const g=this.game;
    if(g.pending) clearTimeout(g.pending.timer);
    g.pending=null;
  }

  _resolveReactions(){
    const g=this.game;
    if(!g.pending) return;
    const {tile,fromSeat,seats,options,responses,kita,isChankan,ponIdx}=g.pending;
    const humanResponded=seats.filter(s=>!this.seats[s]?.isBot).every(s=>responses[s]);
    if(!humanResponded) return;

    this._clearPending();

    // Collect all ron winners (multiple ron supported)
    const ronSeats=seats.filter(s=>(responses[s]||{type:'pass'}).type==='ron');
    if(ronSeats.length>0){
      // Multiple ron: all win, loser pays each separately
      this._multiRon(ronSeats,fromSeat,tile);
      return;
    }

    // Kita reactions only ever offer ron (see _kita) — pon/kan/chi never
    // apply to a tile that never enters the discard pond. Nobody ronned:
    // the kita completes normally (bank + draw the bonus replacement),
    // turn stays with the same seat exactly as an uncontested kita always
    // has — NOT _nextTurn(), unlike an uncalled real discard.
    if(kita){
      this._completeKita(fromSeat,tile);
      return;
    }

    // Chankan (rob-the-kan) reactions are ron-only too, same shape as kita
    // above — nobody ronned means the kan completes normally (upgrade the
    // pon, open new dora, draw rinshan), NOT _nextTurn(). This branch used
    // to not exist at all: a human's 'pass' response reached this point via
    // _reactResponse's generic fallthrough and fell all the way through to
    // _nextTurn() below, silently dropping the kan while turn moved on —
    // and left _kakan's separate 3s watchdog timer armed (see
    // _clearPending's own comment) to fire later and retroactively
    // "complete" that kan against whatever the game had moved on to by
    // then, up to and including a later round.
    if(isChankan){
      this._completeChankan(fromSeat,tile,ponIdx);
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
      const result=detectYaku(hand,g.melds[winSeat],false,sw,this._roundWindValue(),
        g.riichi[winSeat],g.ippatsu[winSeat],isDblRiichi,false,false,false,isHoutei,false,false,key(tile),
        {kuitanAri:this.rules.kuitanAri});
      const {han,yakuList}=result;
      if(han===0) continue;
      // Ura dora for riichi players
      const doraPool=this._doraPool(winSeat,hand);
      const uraDora=g.riichi[winSeat]?this._countUraDora(doraPool):0;
      const kitaCount=g.kita[winSeat].length;
      const dc=countDora(doraPool,g.dora)+uraDora+countAkaDora(doraPool);
      const totalHan=han+dc+kitaCount;
      const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
      const fu=this._computeFu(result,false,isMenzen(g.melds[winSeat]),key(tile),hasPinfu);
      const isWinnerDealer = winSeat === g.dealer;
      const bp=basePoints(totalHan,fu);
      const pay=Math.ceil((isWinnerDealer?bp*6:bp*4)/100)*100+g.honba*300;
      results.push({winSeat,hand,yakuList,han:totalHan,rawHan:han,fu,pay,uraDora,dc,kitaCount});
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
    const primaryAkaDora=countAkaDora(this._doraPool(primary.winSeat,primary.hand));
    const yl=this._buildYakuList(primary.yakuList,primary.dc,primary.uraDora,primaryAkaDora,primary.kitaCount);
    this._endRound('ron',primary.winSeat,loseSeat,primary.hand,yl,primary.han,primary.fu,totalLoss,
      results.length>1?results.slice(1):null,prevScores,g.melds[primary.winSeat],this._isKazoeYakuman(primary.rawHan,primary.han));
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
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,this._botDiscardTile(seat)),BOT_DELAY);
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
    if(this.seats[seat]?.isBot) setTimeout(()=>this._discard(seat,this._botDiscardTile(seat)),BOT_DELAY);
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
        options:reactions,responses:{},isChankan:true,ponIdx,
        timer:setTimeout(()=>this._completeChankan(seat,addTile,ponIdx),3000)};
      this._sendState();
      for(const r of reactions){
        if(this.seats[r.seat]?.isBot){
          const dec=this._safeBotReact(r.seat,g.hands[r.seat],addTile,r.options,g.melds[r.seat],this.seats[r.seat].difficulty);
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
  // The replacement draw comes from the dead wall's OWN reserved 4-slot
  // kita pool (deadWall[14-17] — see the layout comment near the top of
  // this file), a real rinshan draw exactly like a kan's, just from a
  // separate 4 slots rather than kan's [0-3] — so a hand completed by it
  // correctly qualifies for Rinshan Kaihou (g.isRinshan, set in
  // _completeKita below). Capped at 4 (g.kitaCount) as a defensive bound
  // matching the pool's actual size — never reachable in real play anyway,
  // since only 4 North tiles exist in the whole game to begin with.
  _kita(seat,tileId){
    const g=this.game;
    if(!this.rules.sanma) return;
    if(g.kitaCount>=4) return; // exhausted the reserved kita-rinshan pool
    const hand=g.hands[seat];
    const tile=hand.find(t=>t.id===tileId&&key(t)==='4z');
    if(!tile) return;
    g.hands[seat]=hand.filter(t=>t.id!==tileId);
    g.nagashi[seat]=false; // self-initiated action, same precedent as calling pon/chi/kan on your own turn
    this._broadcastAll({type:'kita',seat,name:this.seats[seat]?.name,count:g.kita[seat].length+1});

    // "Robbing the kita" — like chankan, other seats get one chance to ron
    // this tile before it's banked and a replacement is drawn. Reuses the
    // normal discard-reaction checker (identical furiten/chonbo/win-check
    // logic) filtered down to ron only — pon/kan/chi never apply here,
    // since a kita tile never enters the discard pond for anyone to call a
    // set off. Previously this tile was banked into g.kita[seat] and a
    // replacement drawn immediately, with no reaction check at all — so a
    // hand made complete by a kita tile could never actually be ronned.
    const reactions=this._checkReactions(seat,tile)
      .map(r=>({seat:r.seat,options:r.options.filter(o=>o.type==='ron')}))
      .filter(r=>r.options.length>0);
    if(reactions.length){
      const humanInReactions=reactions.some(r=>!this.seats[r.seat]?.isBot);
      // `kita:true` is what tells _resolveReactions to bank+redraw (via
      // _completeKita) instead of _nextTurn() when nobody ends up ronning —
      // an uncontested kita keeps the same seat's turn, unlike an uncalled
      // real discard.
      g.pending={tile,fromSeat:seat,seats:reactions.map(r=>r.seat),options:reactions,responses:{},kita:true,timer:null};
      this._sendState();
      if(!humanInReactions){
        for(const r of reactions){
          const dec=this._safeBotReact(r.seat,g.hands[r.seat],tile,r.options,g.melds[r.seat],this.seats[r.seat].difficulty);
          setTimeout(()=>{
            if(!g.pending) return;
            g.pending.responses[r.seat]=dec;
            if(g.pending.seats.every(s=>g.pending.responses[s])) this._resolveReactions();
          },BOT_DELAY);
        }
      }
      return;
    }
    this._completeKita(seat,tile);
  }

  // Banks the kita tile and draws its bonus replacement — the "nobody
  // ronned it" completion of _kita, factored out so _resolveReactions can
  // reach the same result after an offered-but-declined reaction window.
  _completeKita(seat,tile){
    const g=this.game;
    g.kita[seat].push(tile);
    // "The South Pole" achievement (see achievements.js) — the whole
    // table only ever has 4 kita-rinshan slots to draw from IN TOTAL this
    // round (g.kitaCount above is capped at 4, shared across every seat),
    // so one seat's g.kita reaching length 4 means every single one of
    // them went to this player — nobody else at the table got so much as
    // one. Checked here, the instant it happens, rather than at round/game
    // end — no later point has an easy way to tell "all 4 came from one
    // seat" apart from "4 were drawn, spread across everyone" without
    // separately remembering this exact moment anyway.
    if(g.kita[seat].length===4) g.stats[seat].quadKita++;
    // Draws from the dead wall's dedicated kita pool (deadWall[14-17]), not
    // the live wall — same "rinshan draws don't touch g.wall" convention
    // kan's own _draw(fromRinshan=true) branch already follows, so
    // haiteiNext (last-live-wall-tile tracking) is correspondingly left
    // alone here too, exactly as it is for a kan's rinshan draw.
    const draw=g.deadWall[14+g.kitaCount];
    g.kitaCount++;
    g.drawTile=draw;
    g.hands[seat]=sort([...g.hands[seat],draw]);
    g.tempFuriten[seat]=false;
    // A real rinshan draw — eligible for Rinshan Kaihou if this tile
    // completes the hand (see g.isRinshan's use in _tsumo/_botTurn's own
    // tsumo pre-check).
    g.isRinshan=true;
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
      const r=g.pending.responses;
      const ronSeats=g.pending.seats.filter(s=>(r[s]||{type:'pass'}).type==='ron');
      this._clearPending();
      if(ronSeats.length>0){
        this._multiRon(ronSeats,seat,addTile);
        return;
      }
      this._completeChankan(seat,addTile,ponIdx);
    }
  }

  _completeChankan(seat,addTile,ponIdx){
    const g=this.game;
    this._clearPending();
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
    // Double riichi: declared on first discard before any calls have been
    // made — a sanma Kita swap counts as an interruption here too, same as
    // pon/chi/kan (it's a self-declared action that reveals/replaces a tile
    // out of turn order, standard sanma ruling), even though it never
    // touches g.melds (kita tiles bank into g.kita[seat], not a meld — see
    // _kita's own comment).
    const isDouble=g.firstRound&&g.melds.every(m=>m.length===0)&&g.kita.every(k=>k.length===0);
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
  // Tiles eligible for regular/ura/aka dora matching: the concealed hand,
  // plus every tile sitting in this seat's called melds (g.melds[seat] —
  // _pon/_chi/_daiminkan/_ankan all strip their tiles OUT of g.hands[seat]
  // the moment the call happens, so a called triplet/sequence is otherwise
  // entirely invisible to countDora/countAkaDora even though it's real and
  // face-up same as a concealed group), plus this seat's own banked kita
  // tiles (g.kita[seat] — set aside into their own array the moment kita is
  // declared, see _kita/_completeKita, same invisibility problem). If this
  // round's dora indicator happens to match a called meld's tile (or a
  // called meld happens to include a red 5), it should count exactly the
  // same as if that tile were still sitting in the concealed hand.
  _doraPool(seat,hand){
    const meldTiles=this.game.melds[seat].flatMap(m=>m.tiles);
    return [...hand,...meldTiles,...this.game.kita[seat]];
  }

  // Builds the display yaku list for a win: the regular yaku plus any Dora/
  // Ura Dora/Aka Dora/Kita breakdown lines — always the full itemized
  // breakdown, even when the hand only reaches yakuman-tier han (13+) once
  // dora is folded in (Kazoe Yakuman). basePoints/handLabel already SCORE
  // that case exactly like a real yakuman (their own han>=13 threshold
  // doesn't care where the han came from — see basePoints' own comment);
  // this just controls what the round-end panel actually lists, and
  // players want to see what got them there, not one opaque line — see
  // _isKazoeYakuman below for how the 'Kazoe Yakuman' NAME (which
  // achievements.js's YAKUMAN_NAMES/yakuman_hunter and stats.js's own copy
  // key off) still gets recorded despite not appearing in this list.
  _buildYakuList(yakuList,dc,uraDora,akaDora,kitaCount){
    const regularDc=dc-akaDora-uraDora;
    const yl=regularDc>0?[...yakuList,{name:'Dora',jp:'ドラ',han:regularDc}]:yakuList;
    if(uraDora>0) yl.push({name:'Ura Dora',jp:'裏ドラ',han:uraDora});
    if(akaDora>0) yl.push({name:'Aka Dora',jp:'赤ドラ',han:akaDora});
    if(kitaCount>0) yl.push({name:'Kita',jp:'北',han:kitaCount});
    return yl;
  }

  // True when a hand only reaches yakuman-tier han (13+) once dora is
  // folded in — i.e. `han` (detectYaku's own return, before dora) is under
  // 13, so no single yaku here was itself flagged yakuman (those return
  // >=13 han on their own — see mahjong.js's ym() calls, all of Tenhou/
  // Kokushi/Suuankou/etc). Used by _recordHandWin (via _endRound's trailing
  // arg) to tally a 'Kazoe Yakuman' stat entry alongside the real itemized
  // yaku breakdown _buildYakuList now always displays, rather than in place
  // of it.
  _isKazoeYakuman(han,totalHan){
    return han<13&&totalHan>=13;
  }

  // Fu for a win. Chiitoitsu is always a fixed 25 — real rule, and it
  // never goes through the set+pair grouping calcFu needs (see
  // mahjong.js's detectYaku, whose chiitoitsu branch never calls
  // evalDecomp/decompose at all). Otherwise uses the EXACT decomposition
  // detectYaku itself picked as the winning interpretation (`result.groups`
  // — see evalDecomp's own return) instead of independently recomputing
  // decompose(hand) and grabbing whichever grouping happens to come back
  // first. That used to silently disagree with detectYaku's own choice on
  // any hand with more than one valid grouping — breaking Pinfu-ron's
  // fixed-30-fu guarantee whenever the mismatched grouping had extra fu
  // (a triplet, a non-ryanmen wait) — and never included meld tiles at
  // all, since decompose(hand) only ever saw the concealed hand, so open
  // pon/chi/kan contributed zero fu regardless of hand shape.
  _computeFu(result,isTsumo,menzen,winKey,hasPinfu){
    if(result.isChiitoitsu) return 25;
    if(result.groups) return calcFu(result.groups,isTsumo,menzen,winKey,hasPinfu);
    return 30; // yakuman (or, in principle, no valid decomp) — basePoints ignores fu once han>=13 anyway
  }

  _tsumo(seat){
    const g=this.game;
    const hand=g.hands[seat];
    if(!isWin(hand,g.melds[seat])){
      if(this.rules.chonbo) this._chonboPenalty(seat);
      return;
    }
    // Furiten only ever blocks RON, never tsumo — a self-drawn winning hand
    // is always a legal win regardless of furiten state (permanent or
    // temporary). There used to be a stray _isFuriten(seat) check here that
    // silently no-opped a legitimate tsumo declaration; removed.
    const sw=this._seatWindOf(seat);
    const isHaitei=g.haiteiNext&&!g.isRinshan;
    // Tenhou: dealer tsumo on very first draw (no discards yet from anyone).
    // turnCount===0 alone can't rule out a call (none is possible before
    // any discard exists to call), but it can't rule out the dealer having
    // kita'd their own original hand before winning off the rinshan
    // replacement — same Kita-counts-as-an-interruption gate as double
    // riichi/Chiihou (see _riichi's comment).
    const isTenhou=seat===g.dealer&&g.turnCount===0&&g.kita.every(k=>k.length===0)&&hand.length===14;
    // Chiihou: non-dealer tsumo on own first draw before any calls — same
    // Kita-counts-as-an-interruption gate as double riichi above (see
    // _riichi's comment).
    const isChiihou=seat!==g.dealer&&g.firstRound&&g.melds.every(m=>m.length===0)&&g.kita.every(k=>k.length===0)&&hand.length===14;
    const isDblRiichi=g.doubleRiichi[seat];

    const result=detectYaku(hand,g.melds[seat],true,sw,this._roundWindValue(),
      g.riichi[seat],g.ippatsu[seat],isDblRiichi,g.isRinshan,false,isHaitei,false,isTenhou,isChiihou,
      g.drawTile?key(g.drawTile):null,{kuitanAri:this.rules.kuitanAri});
    const {han,yakuList}=result;
    if(han===0){
      if(this.rules.chonbo) this._chonboPenalty(seat);
      return;
    }

    // Ura dora (only on riichi)
    const doraPool=this._doraPool(seat,hand);
    const uraDora=g.riichi[seat]?this._countUraDora(doraPool):0;
    const kitaCount=g.kita[seat].length;
    const dc=countDora(doraPool,g.dora)+uraDora+countAkaDora(doraPool);
    const totalHan=han+dc+kitaCount;
    const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
    const winKey=g.drawTile?key(g.drawTile):null;
    const fu=this._computeFu(result,true,isMenzen(g.melds[seat]),winKey,hasPinfu);
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
    const akaDora=countAkaDora(doraPool);
    const yl=this._buildYakuList(yakuList,dc,uraDora,akaDora,kitaCount);
    this._endRound('tsumo',seat,null,hand,yl,totalHan,fu,gain,undefined,prevScores,g.melds[seat],this._isKazoeYakuman(han,totalHan));
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
    const result=detectYaku(hand,g.melds[winSeat],false,sw,this._roundWindValue(),
      g.riichi[winSeat],g.ippatsu[winSeat],isDblRiichi,false,isChankan,false,isHoutei,false,false,key(tile),
      {kuitanAri:this.rules.kuitanAri});
    const {han,yakuList}=result;
    if(han===0){this._sendState();return;}

    const doraPool=this._doraPool(winSeat,hand);
    const uraDora=g.riichi[winSeat]?this._countUraDora(doraPool):0;
    const kitaCount=g.kita[winSeat].length;
    const dc=countDora(doraPool,g.dora)+uraDora+countAkaDora(doraPool);
    const totalHan=han+dc+kitaCount;
    const hasPinfu=yakuList.some(y=>y.name==='Pinfu');
    const fu=this._computeFu(result,false,isMenzen(g.melds[winSeat]),key(tile),hasPinfu);
    const bp=basePoints(totalHan,fu);
    const isWinnerDealer=winSeat===g.dealer;
    const pay=Math.ceil((isWinnerDealer?bp*6:bp*4)/100)*100+g.honba*300+g.riichiSticks*1000;
    const prevScores=[...g.scores];
    g.scores[loseSeat]-=pay;g.scores[winSeat]+=pay;
    const akaDora=countAkaDora(doraPool);
    const yl=this._buildYakuList(yakuList,dc,uraDora,akaDora,kitaCount);
    this._endRound('ron',winSeat,loseSeat,hand,yl,totalHan,fu,pay,undefined,prevScores,g.melds[winSeat],this._isKazoeYakuman(han,totalHan));
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
  // Shared tail for every round_end broadcast (tsumo/ron via _endRound,
  // draw via _resolveTenpaiPayments, nagashi via _resolveNagashi) — stores
  // the exact same payload just sent to clients into g.roundHistory, tagged
  // with this round's own number/wind/dealer/honba (read from g.round/
  // g.dealer/g.honba, which the caller hasn't advanced yet at this point —
  // see each call site). _finishGame hands the whole array to
  // history.recordGame once the game ends.
  _recordRoundHistory(payload){
    const g=this.game;
    if(!g.roundHistory) g.roundHistory=[];
    // payload.honba (like payload.round/roundWind/dealer) is whatever the
    // caller broadcast for CARRYING FORWARD into the next round (see
    // roundEndPayload's own "Honba/riichi-stick pot carrying into the next
    // round" comment) — for a dealer win or abortive draw that's honba+1,
    // not the honba this round was actually played at. round/roundWind/
    // dealer already get overridden below with the pre-advance g.* values
    // for exactly this reason; honba needs the same override; the comment
    // above (from before this fix) claimed it already did.
    g.roundHistory.push({...payload,
      // payload.scores is a live reference to g.scores, which keeps
      // mutating in place for the rest of the game (see the g.scores[i]+=…
      // sites throughout this file) — snapshot it here or every past
      // round's history entry would silently end up showing the FINAL
      // game scores instead of that round's own scores.
      scores:payload.scores?[...payload.scores]:payload.scores,
      round:g.round,roundWind:g.roundWind,dealer:g.dealer,honba:g.honba,
      displayWind:Math.ceil(g.round/this.numPlayers),
      displayRound:((g.round-1)%this.numPlayers)+1,
      // Per-seat state at this round's end — not shown on any client screen
      // (added AFTER this round's own _broadcastAll already went out, so it
      // never reaches the live round-results payload), only read by
      // stats.js's recordGameResult when it walks g.roundHistory to build
      // the rolling "last 100 rounds" stats window. riichiSeats mirrors
      // g.riichi (reset fresh every hand in _initRound, so "true" here
      // means "declared THIS hand", not just "in riichi at some point
      // ever"); openSeats mirrors the exact isMenzen check _initRound's own
      // lifetime huro tally uses, just captured per-round instead of only
      // once at game end — g.melds isn't wiped until the NEXT _initRound,
      // so it's still this round's real final meld state right now.
      riichiSeats:g.riichi.slice(),
      openSeats:g.melds.map(ms=>!isMenzen(ms)),
    });
  }

  _recordHandWin(seat,reason,han,fu,yakuList,payment,isKazoeYakuman=false){
    const g=this.game;
    const st=g.stats[seat];
    st.wins++;
    if(reason==='tsumo') st.tsumo++; else st.ron++;
    if(han>st.bestHan) st.bestHan=han;
    if(payment>st.bestScore) st.bestScore=payment;
    if(yakuList) for(const y of yakuList) st.yaku[y.name]=(st.yaku[y.name]||0)+1;
    // Kazoe Yakuman no longer collapses the displayed breakdown (see
    // _buildYakuList/_isKazoeYakuman) — this is what still tallies the
    // 'Kazoe Yakuman' NAME itself for achievements.js's YAKUMAN_NAMES/
    // yakuman_hunter and stats.js's own copy, alongside (not instead of)
    // the real itemized yaku already counted just above.
    if(isKazoeYakuman) st.yaku['Kazoe Yakuman']=(st.yaku['Kazoe Yakuman']||0)+1;
    // Same pseudo-yaku-name pattern as 'Kazoe Yakuman' above — a hand where
    // 2+ different yakuman-tier entries genuinely stacked (see mahjong.js's
    // detectYaku, which now collects every yakuman condition a hand
    // satisfies instead of returning on the first, e.g. Suu Ankou +
    // Chinroutou: four concealed triplets that all happen to be
    // terminals). yakuList here is the display-augmented list (dora/ura
    // dora/aka dora/kita rows appended by _buildYakuList) — those rows are
    // excluded by name since an unusually large dora count could in
    // principle reach han:13+ on its own without representing a second
    // real yakuman. Used by achievements.js's 'yakuman_stack'.
    if(yakuList){
      const AUGMENT_NAMES=new Set(['Dora','Ura Dora','Aka Dora','Kita']);
      const yakumanEntries=yakuList.filter(y=>y.han>=13&&!AUGMENT_NAMES.has(y.name)).length;
      if(yakumanEntries>=2) st.yaku['Yakuman Stack']=(st.yaku['Yakuman Stack']||0)+1;
    }
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
      // Same for every seat — hands dealt isn't a per-seat thing, everyone
      // plays every hand. See stats.js's use as the rate denominator.
      handsPlayed:g.handsPlayed,
      // Only ever one seat, or none — a tobi ending busts exactly the one
      // seat that went negative (see the `bust` lookups above _finishGame
      // calls throughout this file).
      bustedSeat:reason==='tobi'?extra.bust:-1,
      matchKind:this.matchKind,
      // This game's own round-by-round detail (same array recordGame right
      // below already gets) — stats.js's rolling "last 100 rounds" window
      // needs the actual per-hand results, not just this game's final
      // tallies, to compute windowed Rankings/My Stats numbers.
      rounds:g.roundHistory||[],
    });
    // Play History — same seat-indexed arrays as recordGameResult above,
    // plus this game's full round-by-round detail (g.roundHistory, built up
    // by _recordRoundHistory as each round ended). See history.js.
    recordGame({
      playerIds:this.seats.map(p=>p?.profileId||null),
      isBot:this.seats.map(p=>!p||p.isBot),
      isGuest:this.seats.map(p=>!!p?.isGuest),
      variant:this.numPlayers===3?'sanma':'yonma',
      matchKind:this.matchKind,
      gameMode:this.gameMode,
      numPlayers:this.numPlayers,
      playerNames:this.seats.map(p=>p?.name||'—'),
      finalScores:g.scores,
      placements:this._computePlacements(g.scores),
      rounds:g.roundHistory||[],
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

  // ── Play Again (create_room/join_room rematch) ─────────────────────────────
  // One seated human's vote, after game_over, to keep playing in this SAME
  // room with the same mode/rules — see hostStartPlayAgain below for the
  // actual restart, which only this.hostId can trigger. Room-only: a
  // quick_match room never sets hostId or matchKind='room', so a rematch
  // here can never actually be started for one (this vote alone is
  // harmless either way, but gating it too keeps quick_match rooms from
  // silently accumulating dead state).
  playAgain(playerId){
    if(this.matchKind!=='room'||this.phase!=='done') return;
    const p=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!p) return;
    this.playAgainVotes.add(p.seat);
    this._broadcastAll({type:'play_again_status',seats:[...this.playAgainVotes]});
  }

  // Only the room's creator (this.hostId) may call this, and only after
  // voting playAgain() themself — deliberately no minimum vote count or
  // expiry beyond that: the host decides when to go, same as any other
  // "start with whoever's here" call the lobby's own Ready flow already
  // allows (_checkAllReady starts on just one human + bots). Every human
  // who did NOT vote gets bumped — index.js sends them 'play_again_left_behind'
  // and releases their seatedProfiles entry using the returned list, since
  // this class has no access to that map itself.
  hostStartPlayAgain(playerId){
    if(this.matchKind!=='room'||this.phase!=='done') return null;
    if(!this.hostId||playerId!==this.hostId) return null;
    const host=this.seats.find(p=>p&&!p.isBot&&p.id===playerId);
    if(!host||!this.playAgainVotes.has(host.seat)) return null;
    const booted=[];
    for(let seat=0;seat<this.numPlayers;seat++){
      const p=this.seats[seat];
      if(p&&!p.isBot&&!this.playAgainVotes.has(seat)){
        booted.push(p);
        this.seats[seat]=null;
      }
    }
    this.phase='waiting';
    this.ready=new Set();
    this.roundReady=new Set();
    this.pendingNextRound=null;
    this.playAgainVotes=new Set();
    this.game=null;
    this.fillBots();
    this.start();
    return booted;
  }

  _endRound(reason,winner,loser,hand,yakuList,han,fu,payment,extraWinners,prevScores,melds,isKazoeYakuman=false){
    const g=this.game;
    // Tobi check (bankruptcy)
    const bust=g.scores.findIndex(s=>s<0);

    // Per-game hand-stats bookkeeping (feeds recordGameResult at game end).
    if(reason==='tsumo'||reason==='ron'){
      this._recordHandWin(winner,reason,han,fu,yakuList,payment,isKazoeYakuman);
      if(reason==='ron') g.stats[loser].dealIn++;
      if(extraWinners) for(const r of extraWinners) this._recordHandWin(r.winSeat,'ron',r.han,r.fu,null,r.pay);
    }

    // How many opponents did THIS win newly bankrupt (were >=0 before,
    // negative now)? Only meaningful for tsumo — a self-drawn win pays from
    // EVERY other seat simultaneously (see _tsumo), so it's the only win
    // type that can bankrupt more than one opponent at once; ron only ever
    // has a single loser. Used for the sanma "bankrupts both opponents in
    // one tsumo" achievement (see achievements.js) — tracked here as a
    // per-seat counter rather than changing the single-value `bust`
    // detection above, which every OTHER caller (tobi ending, game_over
    // broadcast) still only needs one seat index from.
    if(reason==='tsumo'&&prevScores){
      const newlyBusted=g.scores.filter((sc,i)=>i!==winner&&prevScores[i]>=0&&sc<0).length;
      if(newlyBusted>=2) g.stats[winner].doubleBust++;
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
          const agariyamePayload={type:'round_end',reason,winner,loser,hand,yakuList,han,fu,payment,
            scores:g.scores,handLabel:han?handLabel(han):'',
            playerNames:this.seats.map(p=>p?.name||'—'),
            extraWinners:extraWinners||null,
            // Ura dora indicators stay hidden unless the win actually used
            // them — same gate _countUraDora scores against
            // (g.riichi[winSeat]). Sending the real tiles here regardless of
            // riichi used to leak them into the results screen even on a
            // plain non-riichi win, where they're not part of the score at
            // all (see the matching fix on roundEndPayload/drawPayload below).
            uraDora:g.riichi[winner]?g.deadWall.slice(9,9+g.dora.length):[],
            dora:g.dora,
            prevScores:prevScores||null,
            melds:melds||[],
            gameOver:true,
          };
          this._broadcastAll(agariyamePayload);
          this._recordRoundHistory(agariyamePayload);
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

    const roundEndPayload={type:'round_end',reason,winner,loser,hand,yakuList,han,fu,payment,
      scores:g.scores,handLabel:han?handLabel(han):'',
      playerNames:this.seats.map(p=>p?.name||'—'),
      extraWinners:extraWinners||null,
      // See the matching comment on agariyamePayload above — only reveal
      // the actual indicators when the win used them (g.riichi[winner]),
      // otherwise an empty array so the client's results screen doesn't
      // show an "Ura Dora" section for a plain (non-riichi) win.
      uraDora: g.riichi[winner]?g.deadWall.slice(9,9+g.dora.length):[],
      dora: g.dora,
      prevScores:prevScores||null,
      melds:melds||[],
      gameOver:isGameOver,
      // Honba/riichi-stick pot carrying into the next round — a win always
      // claims every riichi stick on the table (newRiichiSticks is 0 here
      // regardless of who won), computed above before this broadcast.
      honba:newHonba,riichiSticks:newRiichiSticks,
    };
    this._broadcastAll(roundEndPayload);
    this._recordRoundHistory(roundEndPayload);

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
    const drawPayload={type:'round_end',reason:'draw',scores:g.scores,
      inTenpai,payments,tenpaiHands,tenpaiMelds:g.melds,
      playerNames:this.seats.map(p=>p?.name||'—'),
      dora:g.dora,
      // An exhaustive draw has no winner at all, so ura dora (only ever
      // relevant to a riichi win) is never applicable here — see the
      // matching fix on agariyamePayload/roundEndPayload above.
      uraDora:[],
      prevScores,
      gameOver:drawGameOver,
      honba:newHonba,riichiSticks:g.riichiSticks,
    };
    this._broadcastAll(drawPayload);
    this._recordRoundHistory(drawPayload);

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
      // Nagashi Mangan never goes through _recordHandWin/detectYaku (it's a
      // draw-resolution mechanic, not a real yaku match), so unlike every
      // other win path it wouldn't otherwise leave any st.yaku entry at
      // all — needed for the achievement/leaderboard tracking that already
      // reads yaku names for every other win type (see achievements.js).
      g.stats[winner].yaku['Nagashi Mangan']=(g.stats[winner].yaku['Nagashi Mangan']||0)+1;
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
    const nagashiPayload={type:'round_end',reason:'nagashi',nagashiSeats,scores:g.scores,
      playerNames:this.seats.map(p=>p?.name||'—'),dora:g.dora,gameOver:nagashiGameOver,
      honba:newHonba,riichiSticks:g.riichiSticks};
    this._broadcastAll(nagashiPayload);
    this._recordRoundHistory(nagashiPayload);

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
        const riichiCandidates=hand.filter(t=>waits(hand.filter(x=>x.id!==t.id),g.melds[seat],this.rules.sanma).length>0);
        // Dedupe by (v,s,red) — discarding either of two identical 3m keeps
        // the exact same wait either way, so listing both as separate
        // picker options (see showRiichiPicker in script.js) was just
        // showing the same tile twice for no real choice. `red` stays part
        // of the key deliberately: a red 5 and a plain 5 share (v,s) but
        // are NOT interchangeable (one's an extra han of aka dora), so
        // those must stay distinct options, not collapse into one.
        const seenKeys=new Set();
        canRiichi=riichiCandidates.filter(t=>{
          const k=key(t)+(t.red?'r':'');
          if(seenKeys.has(k)) return false;
          seenKeys.add(k);
          return true;
        }).map(t=>t.id);
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
      // g.wall.length is irrelevant now — the replacement draw comes from
      // the dead wall's own reserved kita pool (see _completeKita), not
      // the live wall. g.kitaCount<4 is the real bound (also matches
      // _kita's own guard), though in practice it can never actually be
      // reached — only 4 North tiles exist in the whole game to begin with.
      if(this.rules.sanma&&g.turn===seat&&hand.length===fullHandSize&&g.kitaCount<4){
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
        // Furiten deliberately NOT checked here — it only blocks ron, never
        // tsumo (see _tsumo's own comment on this same point).
        if(g.turn!==seat||!isWin(hand,g.melds[seat])) return false;
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
