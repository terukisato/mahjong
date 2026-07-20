'use strict';
// Bot AI, selectable per room as 'easy' | 'normal' | 'hard' (server/room.js
// stamps a difficulty onto each bot player object and passes it through to
// every decision call below). 'easy' is the original crude heuristic, kept
// byte-for-byte as a legitimate weak-bot option. 'normal'/'hard' use a real
// shanten (tiles-from-tenpai) calculation instead. 'hard' additionally adds
// a minimal genbutsu-based defense when the bot's own hand isn't close and
// an opponent is in riichi. None of the three difficulties change the
// riichi-tile-choice or kan-reaction gaps documented in room.js's _botTurn —
// those are a deliberate, separate simplicity tradeoff, out of scope here.
const {key,isWin,waits,canPon,canChi,shanten} = require('./mahjong');

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
  if(options.some(o=>o.type==='ron')) return {type:'ron'};
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

// ── Public dispatch ──────────────────────────────────────────────────────────
function bestDiscard(hand14, melds=[], difficulty='normal', dangerSets=[]){
  if(difficulty==='easy') return _legacyBestDiscard(hand14);
  if(difficulty==='hard') return _defensiveBestDiscard(hand14, melds, dangerSets);
  return _shantenBestDiscard(hand14, melds);
}

function botReact(hand, disc, options, melds=[], difficulty='normal'){
  if(options.some(o=>o.type==='ron')) return {type:'ron'};
  if(difficulty==='easy') return _legacyBotReact(hand, disc, options);
  return _shantenBotReact(hand, disc, options, melds);
}

module.exports={botName,bestDiscard,botReact};
