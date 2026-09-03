'use strict';
// Bot AI, selectable per room as 'easy' | 'normal' | 'hard' (server/room.js
// stamps a difficulty onto each bot player object and passes it through to
// every decision call below, along with a per-decision table context object
// built by room.js's _botCtx).
//
//   'easy'   — the original crude heuristic, kept byte-for-byte as a
//              legitimate weak-bot option. No shanten math, no defense.
//   'normal' — real shanten (tiles-from-tenpai) minimisation for discards and
//              calls, plus value-aware tie-breaking (keeps dora / yakuhai
//              pairs / wider ukeire among equally-efficient discards). Folds
//              only lightly: leans on genbutsu against a declared riichi when
//              its own hand is still >=2 shanten.
//   'hard'   — everything 'normal' does, plus a real push/fold model: it
//              assesses every opponent (riichi, open-hand value threats, and
//              a mild late-game "silent tenpai" read), estimates a per-tile
//              deal-in cost from genbutsu / suji / wall (kabe) reads, and
//              weighs that against how close and how valuable its own hand is
//              before choosing a discard. It also picks its riichi-declaration
//              tile for wait quality + safety rather than "first tile that
//              keeps tenpai", and chooses damaten over riichi in the spots a
//              real player would (see _shouldRiichi).
//
// Call gating (normal/hard): a pon/chi is only taken if it strictly reduces
// shanten AND — when it would be the hand's FIRST meld — the resulting open
// hand still has a realistic path to a yaku (otherwise it's a hand that can
// reach tenpai but never legally win).
const {key,isWin,waits,canPon,canChi,shanten,detectYaku,countDora,countAkaDora,basePoints,isMenzen} = require('./mahjong');

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

// ── NORMAL/HARD: shared shape + value evaluation ────────────────────────────

const YAKUHAI_BASE=new Set(['5z','6z','7z']); // three dragons — always yakuhai

// Every tile type currently accounted for: opponents' ponds + everyone's
// melds + this bot's own hand + the dora indicators. Used both for ukeire
// (a draw type with 0 live copies left can't help) and for wall/kabe reads
// in the danger table. Keyed "<value><suit>" -> count seen.
function _visibleCounts(ctx, myHand, myMelds){
  const c={};
  const bump=k=>{ c[k]=(c[k]||0)+1; };
  for(const o of ctx.opponents||[]){
    for(const t of o.discards||[]) bump(key(t));
    for(const m of o.melds||[]) for(const t of (m.tiles||[])) bump(key(t));
  }
  for(const m of myMelds||[]) for(const t of (m.tiles||[])) bump(key(t));
  for(const t of myHand||[]) bump(key(t));
  for(const ind of ctx.dora||[]) bump(key(ind));
  return c;
}

// How many still-live tiles would advance this 13-tile hand's shanten —
// counts tile TYPES weighted by remaining copies (4 minus everything already
// visible), so a wait on a tile with 3 copies already gone barely counts.
// `cur` (the hand's current shanten) is passed in so it isn't recomputed.
// O(34) shanten() calls, so callers gate it to the few near-tenpai
// candidates where the tie-break actually matters (see _smartDiscard).
function _ukeire(hand13, melds, vis, cur){
  if(cur<0) return 0;
  let n=0;
  for(const s of ['m','p','s','z']){
    const max=s==='z'?7:9;
    for(let v=1;v<=max;v++){
      const k=`${v}${s}`;
      const live=Math.max(0, 4-(vis[k]||0));
      if(!live) continue;
      if(shanten([...hand13,{s,v,id:-2}], melds)<cur) n+=live;
    }
  }
  return n;
}

// Lower is better. A candidate discard's cost is: the cumulative "distance"
// added by whatever shanten it leaves (each step from tenpai matters far
// more than a step further out — being 3-vs-4 shanten barely changes your
// win odds), minus the value of what the 13-tile remainder keeps (dora,
// yakuhai pairs held for yaku + safety, and — among equally-efficient
// discards only — wider ukeire). The yakuhai-pair term is also the fix for
// "the AI only ever wins on an honour tile when it's chiitoitsu": pure
// shanten efficiency sheds honour pairs, so a standard hand never ends up on
// an honour shanpon/tanki. Valuing the pair lets it keep one.
const _SHANTEN_STEP=[1800,1000,400,120,50];
function _shapeScore(c, bestSh, melds, ctx, vis, withUkeire){
  let s=0;
  for(let i=bestSh;i<c.shanten;i++) s+=_SHANTEN_STEP[Math.min(i,4)];
  const rem=c.rem;
  s-=40*(countDora(rem, ctx.dora||[])+countAkaDora(rem));
  const yh=_yakuhaiSet(ctx);
  const cnt={};
  for(const t of rem){ const k=key(t); cnt[k]=(cnt[k]||0)+1; }
  for(const k of Object.keys(cnt)) if(yh.has(k)&&cnt[k]===2) s-=35;
  if(withUkeire) s-=6*_ukeire(rem, melds, vis, c.shanten);
  return s;
}

function _yakuhaiSet(ctx){
  const yh=new Set(YAKUHAI_BASE);
  if(ctx&&ctx.seatWind) yh.add(`${ctx.seatWind}z`);
  if(ctx&&ctx.roundWind) yh.add(`${ctx.roundWind}z`);
  return yh;
}

// ── HARD: threat assessment + danger table ─────────────────────────────────

// Does this opponent's OPEN hand have a realistic path to a yaku? An open
// hand with no yaku can reach tenpai but never win, so it isn't a threat.
function _openHasYaku(opp, ctx){
  const yh=_yakuhaiSet({seatWind:opp.seatWind, roundWind:ctx.roundWind});
  const mk=(opp.melds||[]).flatMap(m=>(m.tiles||[]).map(key));
  if(!mk.length) return false;
  if(mk.some(k=>yh.has(k))) return true;                                   // yakuhai
  if(ctx.kuitanAri!==false && mk.every(k=>!/^[19]/.test(k)&&!k.endsWith('z'))) return true; // tanyao
  const suits=new Set(mk.filter(k=>!k.endsWith('z')).map(k=>k.slice(-1)));
  if(suits.size<=1 && mk.length>=2) return true;                          // honitsu/chinitsu lean
  if(mk.length>=2 && mk.every(k=>/^[19]/.test(k)||k.endsWith('z'))) return true; // toitoi/chanta lean
  return false;
}

// Build a threat descriptor per opponent seat:
//   kind        'riichi' | 'open' | 'silent'
//   tenpaiProb  0..1 estimate that they're actually tenpai right now
//   value       rough points if they win (encodes riichi being bigger)
//   safe/pond   Set of tile keys sitting in their own discard pile — genbutsu
//               against them (furiten), the one provably-safe source used
//               here (post-riichi cross-player genbutsu is a deliberate
//               follow-up; room.js only tracks per-seat ponds today).
function _assessThreats(ctx, myHand, myMelds){
  const vis=_visibleCounts(ctx, myHand, myMelds);
  const threats=[];
  const seats=(ctx.opponents?ctx.opponents.length:3)+1;
  const perPlayerTurn=(ctx.turnCount||0)/Math.max(1,seats);
  for(const o of ctx.opponents||[]){
    const pond=new Set((o.discards||[]).map(key));
    const open=(o.melds||[]).some(m=>m.type!=='kan'||m.kanType!=='ankan');
    let kind,tp,val;
    if(o.riichi){
      kind='riichi'; tp=1; val=5800;
    } else if(open){
      kind='open';
      const nm=o.melds.length;
      tp=Math.max(0, Math.min(0.85, 0.2*nm + 0.04*Math.max(0,perPlayerTurn-5)));
      if(!_openHasYaku(o,ctx)) tp*=0.35;
      const mk=o.melds.flatMap(m=>(m.tiles||[]).map(key));
      const yh=_yakuhaiSet({seatWind:o.seatWind, roundWind:ctx.roundWind});
      val=1000;
      if(mk.some(k=>yh.has(k))) val+=2000;
      val+=1500*countDora(o.melds.flatMap(m=>m.tiles||[]), ctx.dora||[]);
      if(nm>=3) val+=1500;
    } else {
      kind='silent';
      tp=Math.max(0, Math.min(0.35, 0.05*(perPlayerTurn-8)));
      val=3900;
    }
    if(tp<=0.02) continue;
    threats.push({seat:o.seat, kind, tenpaiProb:tp, value:val, safe:pond, pond});
  }
  return {threats, vis};
}

// Estimated probability that discarding tile `k` deals directly into `threat`.
// Genbutsu is 0. Otherwise a base rate by tile class, cut by suji (against
// that opponent's own discards) and by kabe (a needed ryanmen partner tile
// being fully dead in the visible wall), and discounted for non-riichi
// threats (less certain, and no furiten guarantee working in our favour).
function _tileDanger(k, threat, vis){
  if(threat.safe.has(k)) return 0;
  const s=k.slice(-1), v=parseInt(k);
  if(s==='z'){
    const live=Math.max(0, 4-(vis[k]||0));
    const d = live>=3?0.09 : live===2?0.05 : live===1?0.02 : 0;
    return threat.kind==='riichi'?d:d*0.6;
  }
  const inPond=n=>(n>=1&&n<=9)&&threat.pond.has(`${n}${s}`);
  const dead=n=>(n>=1&&n<=9)&&(vis[`${n}${s}`]||0)>=4;
  let suji=false, halfSuji=false;
  if(v<=3) suji=inPond(v+3);
  else if(v>=7) suji=inPond(v-3);
  else { const lo=inPond(v-3), hi=inPond(v+3); suji=lo&&hi; halfSuji=lo||hi; }
  let base;
  if(v===1||v===9) base=0.045;
  else if(v===2||v===8) base=0.075;
  else if(v===3||v===7) base=0.10;
  else base=0.13;
  if(suji) base*=(v>=4&&v<=6)?0.42:0.5;
  else if(halfSuji) base*=0.62;
  if(v>=4&&v<=6 && (dead(v-1)||dead(v+1)||dead(v-2)||dead(v+2))) base*=0.6;
  if(threat.kind!=='riichi') base*=0.6;
  return base;
}

function _dealInCost(k, threats, vis){
  let c=0;
  for(const th of threats) c+=_tileDanger(k,th,vis)*th.tenpaiProb*th.value;
  return c;
}

function _han2pts(han, fu, dealer){
  if(han<=0) return 0;
  return Math.round((dealer?6:4)*basePoints(han,fu)/100)*100;
}

// Rough points our own hand is worth if it comes in. At tenpai: the best
// completion across the live wait, scored the same way room.js's advice hint
// and _shouldRiichi do (detectYaku with riichi off + dora), plus a closed-
// hand bump for the riichi/ura/ippatsu upside we'd realistically add. Not
// tenpai: a flat base scaled by dora held and closedness, docked per shanten.
function _estMyValue(cands, melds, ctx, bestSh){
  if(bestSh===0){
    let best=0;
    for(const c of cands){
      if(c.shanten!==0) continue;
      for(const wk of waits(c.rem, melds, ctx.sanma)){
        const v=parseInt(wk), s=wk.slice(-1);
        const h14=[...c.rem,{s,v,id:999901}];
        const yk=detectYaku(h14,melds,false,ctx.seatWind||1,ctx.roundWind||1,false,false,false,false,false,false,false,false,false,wk,{kuitanAri:ctx.kuitanAri!==false});
        let han=yk.han;
        if(han===0 && isMenzen(melds)) han=1;   // riichi would supply the yaku
        if(han===0) continue;
        han+=countDora(h14, ctx.dora||[])+countAkaDora(h14);
        if(isMenzen(melds)) han+=1;             // riichi + realistic ura/ippatsu upside
        best=Math.max(best, _han2pts(han,40,(ctx.seatWind||0)===1));
      }
    }
    return best||2000;
  }
  const rem=(cands[0]&&cands[0].rem)||[];
  const dora=countDora(rem, ctx.dora||[])+countAkaDora(rem);
  return Math.max(1000, 2000 + 1500*dora + (isMenzen(melds)?1200:0) - bestSh*300);
}

// ── Discard selection (normal + hard) ──────────────────────────────────────
function _smartDiscard(hand14, melds, ctx, difficulty){
  const cands=hand14.map(t=>{
    const rem=hand14.filter(x=>x.id!==t.id);
    return {id:t.id, tile:t, k:key(t), rem, shanten:shanten(rem, melds)};
  });
  const bestSh=Math.min(...cands.map(c=>c.shanten));
  const {threats, vis}=_assessThreats(ctx, hand14, melds);
  // The ukeire tie-break (O(34) shanten() calls each) only earns its cost
  // among a handful of near-tenpai candidates that are otherwise level —
  // deeper hands are decided by shanten + dora/yakuhai alone.
  const tiedCount=cands.filter(c=>c.shanten===bestSh).length;
  const ukeireOK=bestSh<=1 && tiedCount<=6;
  for(const c of cands) c.shape=_shapeScore(c, bestSh, melds, ctx, vis, ukeireOK && c.shanten===bestSh);

  // Nothing to defend against — pure efficiency (value-aware tie-breaking).
  if(!threats.length){
    cands.sort((a,b)=>a.shape-b.shape);
    return cands[0].id;
  }

  const anyRiichi=threats.some(t=>t.kind==='riichi');

  // 'normal': light fold only — prefer a genbutsu tile against a declared
  // riichi while our own hand is still far (>=2 shanten). Otherwise efficiency.
  if(difficulty!=='hard'){
    if(anyRiichi && bestSh>=2){
      const safe=cands.filter(c=>threats.every(th=>th.kind!=='riichi'||th.safe.has(c.k)));
      if(safe.length){ safe.sort((a,b)=>a.shape-b.shape); return safe[0].id; }
    }
    cands.sort((a,b)=>a.shape-b.shape);
    return cands[0].id;
  }

  // 'hard'. Close to a win (tenpai or 1-shanten): default to the SAFEST
  // discard that doesn't cost shape (keeps tenpai / keeps 1-shanten), with
  // the usual value tie-break folded in.
  if(bestSh<=1){
    const flat=cands.filter(c=>c.shanten===bestSh);
    const wc=bestSh===0?0.4:0.9;
    for(const c of flat){ c.danger=_dealInCost(c.k, threats, vis); c.total=c.shape + wc*c.danger; }
    flat.sort((a,b)=>a.total-b.total);
    const keep=flat[0];
    // Escape hatch: cheap hand, a riichi is out, and even our safest
    // shape-preserving tile is a live middle-ish tile — accept a one-step
    // fold to a clearly-safer discard rather than shove a bad hand.
    if(anyRiichi && keep.danger>450 && _estMyValue(cands, melds, ctx, bestSh)<3000){
      for(const c of cands) if(c.danger==null) c.danger=_dealInCost(c.k, threats, vis);
      const fold=cands.slice().sort((a,b)=>a.danger-b.danger)[0];
      if(fold.danger < keep.danger*0.4 && (fold.shanten-bestSh)<=1) return fold.id;
    }
    return keep.id;
  }

  // 2+ shanten with a live threat: genuine push/fold — trade shape points for
  // expected-deal-in points, and accept a shanten loss when the safety is
  // worth more than the (already slim) equity of pushing from this far out.
  // The exchange rate `w` rises with distance and falls with our hand value.
  const myValue=_estMyValue(cands, melds, ctx, bestSh);
  let w = bestSh===2 ? (myValue>=6000?1.1:1.6) : 2.4;
  if(anyRiichi) w*=1.15;
  for(const c of cands){
    c.danger=_dealInCost(c.k, threats, vis);
    c.total=c.shape + w*c.danger;
  }
  cands.sort((a,b)=>a.total-b.total);
  return cands[0].id;
}

// ── HARD: riichi-declaration tile choice ───────────────────────────────────
// Among the tiles that leave a tenpai shape, pick for wait quality (live tile
// count + best han across the wait) with danger as a minor tie-break — a
// declared riichi is a commitment, so wait strength dominates. Returns null
// if no discard keeps tenpai (caller then won't riichi).
function chooseRiichiTile(hand14, melds=[], ctx={}){
  const c=ctx||{};
  const cands=hand14
    .map(t=>({id:t.id, tile:t, rem:hand14.filter(x=>x.id!==t.id)}))
    .filter(x=>shanten(x.rem, melds)===0);
  if(!cands.length) return null;
  const {threats, vis}=_assessThreats(c, hand14, melds);
  let bestId=cands[0].id, bestScore=-Infinity;
  for(const x of cands){
    const w=waits(x.rem, melds, c.sanma);
    let live=0, val=0;
    for(const wk of w){
      const v=parseInt(wk), s=wk.slice(-1);
      live+=Math.max(0, 4-(vis[wk]||0));
      const h14=[...x.rem,{s,v,id:999902}];
      const yk=detectYaku(h14,melds,false,c.seatWind||1,c.roundWind||1,true,false,false,false,false,false,false,false,false,wk,{kuitanAri:c.kuitanAri!==false});
      val=Math.max(val, yk.han + countDora(h14, c.dora||[]) + countAkaDora(h14));
    }
    const danger=threats.length?_dealInCost(key(x.tile), threats, vis):0;
    const score=live*10 + val*6 - danger*0.4;
    if(score>bestScore){ bestScore=score; bestId=x.id; }
  }
  return bestId;
}

// ── NORMAL/HARD: call (pon/chi) reactions ──────────────────────────────────

// Would opening the hand with `melds` (the new meld included) leave a
// realistic path to a yaku? Only checked when this would be the FIRST meld —
// once a hand is already open the bot is committed and plays it out.
function _openYakuPossible(concealed, melds, ctx){
  const c=ctx||{};
  const yh=_yakuhaiSet(c);
  const mk=melds.flatMap(m=>(m.tiles||[]).map(key));
  const all=[...concealed.map(key), ...mk];
  if(mk.some(k=>yh.has(k))) return true;
  const cnt={};
  for(const t of concealed){ const k=key(t); cnt[k]=(cnt[k]||0)+1; }
  for(const k of Object.keys(cnt)) if(yh.has(k)&&cnt[k]>=2) return true;   // yakuhai still live in hand
  if(c.kuitanAri!==false && all.every(k=>!/^[19]/.test(k)&&!k.endsWith('z'))) return true; // tanyao
  const suits=new Set(all.filter(k=>!k.endsWith('z')).map(k=>k.slice(-1)));
  if(suits.size<=1) return true;                                          // honitsu/chinitsu
  // chanta/toitoi lean — only credible off 2+ melds that are ALL terminal/
  // honor AND with the concealed part not already locked into a plain
  // middle sequence (which rules both yaku out).
  if(mk.length>=2 && mk.every(k=>/^[19]/.test(k)||k.endsWith('z')) &&
     concealed.every(t=>/^[19]/.test(key(t))||t.s==='z')) return true;
  return false;
}

// Shanten-native "not already tenpai" gate: call pon/chi only if it strictly
// reduces shanten versus passing — and, for a first meld, only if the open
// hand can still have a yaku. Call acceptance doesn't otherwise vary by
// difficulty (defense is scoped to discard selection).
function _shantenBotReact(hand, disc, options, melds, ctx){
  const before=shanten(hand, melds);
  const firstMeld=melds.length===0;
  if(before>0 && options.some(o=>o.type==='pon')){
    const used=hand.filter(t=>key(t)===key(disc)).slice(0,2);
    const after=hand.filter(t=>!used.map(u=>u.id).includes(t.id));
    // shanten() only reads melds.length, but _openYakuPossible reads tiles.
    const newMelds=[...melds,{type:'pon',tiles:[disc,disc,disc]}];
    if(shanten(after,newMelds)<before && (!firstMeld || _openYakuPossible(after,newMelds,ctx)))
      return {type:'pon'};
  }
  if(before>0 && options.some(o=>o.type==='chi')){
    const chi=options.find(o=>o.type==='chi');
    const after=hand.filter(t=>!chi.sequences[0].includes(t.id));
    const seqTiles=hand.filter(t=>chi.sequences[0].includes(t.id)).concat([disc]);
    const newMelds=[...melds,{type:'chi',tiles:seqTiles}];
    if(shanten(after,newMelds)<before && (!firstMeld || _openYakuPossible(after,newMelds,ctx)))
      return {type:'chi',tileIds:chi.sequences[0]};
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
// `ctx` is room.js's _botCtx(seat) payload (opponents' visible state, dora,
// winds, rules, turn count). Absent/empty => no threats => pure efficiency.
function bestDiscard(hand14, melds=[], difficulty='normal', ctx={}){
  if(difficulty==='easy') return _legacyBestDiscard(hand14);
  return _smartDiscard(hand14, melds, ctx||{}, difficulty);
}

function botReact(hand, disc, options, melds=[], difficulty='normal', ctx={}){
  // valid:false marks a chonbo-only "attempt" option (rules.chonbo — see
  // room.js's _checkReactions), offered so a HUMAN could mis-declare a
  // false ron. Bots never misplay, so they must only ever take a ron
  // that's actually valid — options.some(o=>o.type==='ron') alone would
  // happily grab the false one and chonbo the bot against itself.
  if(options.some(o=>o.type==='ron'&&o.valid!==false)) return {type:'ron'};
  if(difficulty==='easy') return _legacyBotReact(hand, disc, options);
  return _shantenBotReact(hand, disc, options, melds, ctx||{});
}

module.exports={botName,bestDiscard,botReact,shouldRiichi:_shouldRiichi,chooseRiichiTile};
