'use strict';
// Bot AI, selectable per room as 'easy' | 'normal' | 'hard' (server/room.js
// stamps a difficulty onto each bot player object and passes it through to
// every decision call below). 'easy' is the original crude heuristic, kept
// byte-for-byte as a legitimate weak-bot option. 'normal'/'hard' use a real
// shanten (tiles-from-tenpai) calculation instead. 'hard' additionally adds
// a minimal genbutsu-based defense when the bot's own hand isn't close and
// an opponent is in riichi, and is the only difficulty that ever chooses
// damaten over riichi on reaching tenpai (see _shouldRiichi below) — 'easy'/
// 'normal' still riichi unconditionally whenever legal. None of the three
// difficulties change the riichi-tile-choice or kan-reaction gaps documented
// in room.js's _botTurn — those are a deliberate, separate simplicity
// tradeoff, out of scope here.
const {key,isWin,waits,canPon,canChi,shanten,detectYaku,countDora,countAkaDora} = require('./mahjong');

const BOT_NAMES=['Sakura AI','Yuki Bot','Hana CPU','Ryu AI','Kaze Bot','Tsuki AI','Hoshi CPU','Umi Bot'];
let _bi=0;
function botName(){ return BOT_NAMES[_bi++%BOT_NAMES.length]; }

// ── EASY: original crude heuristic (unchanged) ──────────────────────────────
// Rough "how good is this 13-tile shape" score, used to compare candidate
// hands (never to compare against an absolute threshold). Tenpai always
// wins outright (huge flat bonus, further reward for having more waits =
// wider tenpai); otherwise score triplets/pairs and partial runs (an
// adjacent tile is worth more than a 2-away tile) as a cheap substitute for
// real shanten counting.
function _legacyHandScore(hand13){
  const w=waits(hand13);
  if(w.length) return 1000+w.length*10;
  const c={};
  for(const t of hand13){const k=key(t);c[k]=(c[k]||0)+1;}
  let s=0;
  for(const [k,n] of Object.entries(c)){
    if(n>=3) s+=30; else if(n===2) s+=15;
  }
  for(const t of hand13){
    if(t.s==='z') continue;
    for(const d of[1,2]){
      if(c[`${t.v+d}${t.s}`]) s+=d===1?10:5;
    }
  }
  return s;
}

// Try discarding each tile in turn, keep whichever leaves the best-scoring
// 13-tile remainder. O(n) calls to _legacyHandScore (each O(n) itself) per
// discard decision — fine at hand-sized n, not something to scale up.
function _legacyBestDiscard(hand14){
  let bestId=null,bestScore=-Infinity;
  for(let i=0;i<hand14.length;i++){
    const rem=hand14.filter((_,j)=>j!==i);
    const s=_legacyHandScore(rem);
    if(s>bestScore){bestScore=s;bestId=hand14[i].id;}
  }
  return bestId;
}

// Reaction to another player's discard. Always ron if offered (never sandbag
// for a bigger hand). Otherwise only pon/chi if NOT already tenpai — a bot
// that's already tenpai never breaks it to call, since calling here is only
// evaluated as a shape improvement, not as "does this get me to tenpai
// faster" (which it can't, already being there) — and only if the resulting
// hand doesn't lose too much shape value (the -20/-15 fudge factors let it
// accept a modest score dip in exchange for advancing the hand). Never
// considers kan reactions — the options array may include one but it's
// simply not checked, so bots always pass on kan-on-discard.
function _legacyBotReact(hand,disc,options){
  if(options.some(o=>o.type==='ron'&&o.valid!==false)) return {type:'ron'};
  const inTenpai=waits(hand).length>0;
  if(!inTenpai&&options.some(o=>o.type==='pon')){
    const matches=hand.filter(t=>key(t)===key(disc));
    const after=hand.filter(t=>!matches.slice(0,2).map(m=>m.id).includes(t.id));
    if(_legacyHandScore(after)>_legacyHandScore(hand)-20) return {type:'pon'};
  }
  if(!inTenpai&&options.some(o=>o.type==='chi')){
    const chi=options.find(o=>o.type==='chi');
    const after=hand.filter(t=>!chi.sequences[0].includes(t.id));
    if(_legacyHandScore(after)>_legacyHandScore(hand)-15) return {type:'chi',tileIds:chi.sequences[0]};
  }
  return {type:'pass'};
}

// ── NORMAL/HARD: shanten-based candidate ranking ────────────────────────────
// For every possible discard, the resulting shanten (lower is better) and,
// among discards tied on shanten, how many distinct tiles that resulting
// hand waits on (wider tenpai is better) — dropping this tie-break would
// make the bot pick arbitrarily among equally-efficient discards instead of
// preferring the widest wait. Sorted best-first.
function _rankDiscards(hand14, melds){
  const cands=hand14.map(t=>{
    const rem=hand14.filter(x=>x.id!==t.id);
    const sh=shanten(rem, melds);
    const waitCount=sh===0?waits(rem, melds).length:0;
    return {id:t.id, tile:t, shanten:sh, waitCount};
  });
  cands.sort((a,b)=>a.shanten-b.shanten || b.waitCount-a.waitCount);
  return cands;
}

function _shantenBestDiscard(hand14, melds){
  return _rankDiscards(hand14, melds)[0].id;
}

// HARD only: if the bot's own best-achievable shanten is still >=2 (hand
// isn't close) and at least one opponent is in riichi, prefer a genbutsu
// tile — one that's already in EVERY currently-riichi opponent's own
// discard pile (safe under furiten against all of them at once; a tile
// safe against one riichi opponent but not another isn't safe) — over the
// efficiency-best discard, even at a shanten cost. Falls back to the
// efficiency pick if no such tile exists in hand, or if the hand is already
// close (don't fold when close to a good result).
function _defensiveBestDiscard(hand14, melds, dangerSets){
  const cands=_rankDiscards(hand14, melds);
  const bestShanten=cands[0].shanten;
  if(dangerSets && dangerSets.length>0 && bestShanten>=2){
    const safe=cands.filter(c=>dangerSets.every(ds=>ds.includes(key(c.tile))));
    if(safe.length) return safe[0].id;
  }
  return cands[0].id;
}

// Shanten-native equivalent of the legacy "not already tenpai" gate: only
// call pon/chi if doing so strictly reduces shanten versus passing. Call
// acceptance itself doesn't vary by difficulty (defense is scoped to
// discard selection only, per the plan this bot AI was built from) — hard
// and normal share this reaction logic.
function _shantenBotReact(hand, disc, options, melds){
  const before=shanten(hand, melds);
  if(before>0 && options.some(o=>o.type==='pon')){
    const used=hand.filter(t=>key(t)===key(disc)).slice(0,2);
    const after=hand.filter(t=>!used.map(u=>u.id).includes(t.id));
    // Only .length of the synthetic meld matters to shanten() (it never
    // reads .tiles, unlike isWin/waits) — no need to build a real meld here.
    const afterMelds=[...melds,{type:'pon'}];
    if(shanten(after, afterMelds)<before) return {type:'pon'};
  }
  if(before>0 && options.some(o=>o.type==='chi')){
    const chi=options.find(o=>o.type==='chi');
    const after=hand.filter(t=>!chi.sequences[0].includes(t.id));
    const afterMelds=[...melds,{type:'chi'}];
    if(shanten(after, afterMelds)<before) return {type:'chi',tileIds:chi.sequences[0]};
  }
  return {type:'pass'};
}

// HARD only: riichi vs damaten (silent tenpai). Real players don't riichi on
// every tenpai — damaten is chosen when the hand already carries its own
// yaku (so it can still legally win without declaring) and the situation
// favors staying quiet: the hand's already big enough that announcing it
// would just scare opponents into folding around it, or the wait's wide
// enough that opponents will keep feeding it without riichi's pressure
// doing any extra work. A cheap hand or a narrow wait gets the opposite
// call — riichi's guaranteed +1 han (plus ippatsu/ura dora upside) is worth
// more than the concealment. `hand13` is the hand AFTER the candidate
// riichi discard (i.e. the tenpai shape itself); `ctx` carries the table
// context bot.js otherwise has no access to (see room.js's _shouldRiichi).
function _shouldRiichi(hand13, melds, ctx){
  const {seatWind,roundWind,doraIndicators,kuitanAri,sanma,placement}=ctx;
  const w=waits(hand13,melds,sanma);
  if(!w.length) return true; // caller only calls this once already-tenpai; riichi is always a safe fallback

  let bestHan=0, uncoveredRon=0;
  for(const wk of w){
    const v=parseInt(wk),s=wk.slice(-1);
    const hand14=[...hand13,{s,v,id:999993}];
    // isRiichi forced false — "what would this hand be worth won WITHOUT
    // riichi", the same computation room.js's getAdvice uses for its
    // waitInfo hint. Checked separately by win method: a closed hand always
    // has Menzen Tsumo as a fallback on a self-draw, so tsumo is never the
    // risk — it's RON specifically that has nothing to fall back on. That
    // makes rRon (not the max of the two) the right gate for "can this tile
    // even be called without riichi", while the max of the two is still the
    // right read on potential VALUE (a self-draw could still land here).
    const rTsumo=detectYaku(hand14,melds,true,seatWind,roundWind,false,false,false,false,false,false,false,false,false,wk,{kuitanAri});
    const rRon=detectYaku(hand14,melds,false,seatWind,roundWind,false,false,false,false,false,false,false,false,false,wk,{kuitanAri});
    if(rRon.han===0) uncoveredRon++;
    const yakuHan=Math.max(rTsumo.han,rRon.han);
    if(yakuHan===0) continue;
    const dora=countDora(hand14,doraIndicators)+countAkaDora(hand14);
    bestHan=Math.max(bestHan,yakuHan+dora);
  }

  // At least one wait tile can't legally be RON'd without riichi (Menzen
  // Tsumo still covers drawing it yourself, but a discard landing on that
  // tile would have to be passed on) — too big a hole in the wait to gamble
  // on damaten. Riichi outright covers every tile in the wait either way.
  if(uncoveredRon>0) return true;

  const waitCount=w.length;
  if(bestHan>=5) return false; // already mangan-class — don't scare opponents off a hand this big
  if(bestHan<=2) return true;  // cheap hand — riichi's bump is worth more than staying hidden

  // Middling hand (3-4 han): a wide, live wait keeps opponents feeding it
  // on its own; a narrow one doesn't get that benefit, so take the
  // guaranteed value instead. (Standard-shape waits rarely exceed ~5 live
  // tile types outside chiitoitsu's always-1 tanki, so the wide/narrow
  // bands are deliberately tight around that ceiling rather than mirrored.)
  if(waitCount>=5) return false;
  if(waitCount<=2) return true;

  // Still genuinely on the fence (mid value, mid width) — table position
  // breaks the tie: a comfortable lead has more to lose than gain from
  // announcing tenpai (opponents fold AND riichi locks out defense for the
  // rest of the hand), while trailing badly wants the pressure and the
  // ura-dora upside more than it wants to stay hidden.
  if(placement==='lead') return false;
  if(placement==='behind') return true;
  return true; // default matches the pre-damaten always-riichi behavior
}

// ── Public dispatch ──────────────────────────────────────────────────────────
function bestDiscard(hand14, melds=[], difficulty='normal', dangerSets=[]){
  if(difficulty==='easy') return _legacyBestDiscard(hand14);
  if(difficulty==='hard') return _defensiveBestDiscard(hand14, melds, dangerSets);
  return _shantenBestDiscard(hand14, melds);
}

function botReact(hand, disc, options, melds=[], difficulty='normal'){
  // valid:false marks a chonbo-only "attempt" option (rules.chonbo — see
  // room.js's _checkReactions), offered so a HUMAN could mis-declare a
  // false ron. Bots never misplay, so they must only ever take a ron
  // that's actually valid — options.some(o=>o.type==='ron') alone would
  // happily grab the false one and chonbo the bot against itself.
  if(options.some(o=>o.type==='ron'&&o.valid!==false)) return {type:'ron'};
  if(difficulty==='easy') return _legacyBotReact(hand, disc, options);
  return _shantenBotReact(hand, disc, options, melds);
}

module.exports={botName,bestDiscard,botReact,shouldRiichi:_shouldRiichi};
