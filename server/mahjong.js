'use strict';

// Pure game-logic module: tile/wall setup, hand decomposition, win checking,
// and yaku/fu/score calculation. No I/O or game-state — server/room.js owns
// turn flow and calls into these functions with plain data.
//
// Tile shape: {s, v, id} where s is suit ('m'=man, 'p'=pin, 's'=sou, 'z'=honor)
// and v is 1-9 for m/p/s or 1-7 for z (1-4=East/South/West/North, 5-7=White/
// Green/Red dragon). `key(t)` turns a tile into its "<value><suit>" string
// (e.g. "5m", "3z") — most functions below compare hands by these string
// keys rather than tile objects, since two tiles with the same key are
// interchangeable for hand-shape purposes (only `id` distinguishes physical
// tiles, e.g. for discarding a specific one).

const SUITS = ['m','p','s'];

function buildWall() {
  const tiles = []; let id = 0;
  for (const s of SUITS) {
    for (let v=1;v<=9;v++) {
      for (let c=0;c<4;c++) {
        // One copy of 5m, 5p, 5s is a red 5 (c===0)
        const red = (v===5 && c===0) ? true : undefined;
        tiles.push({s,v,id:id++, ...(red?{red:true}:{})});
      }
    }
  }
  for (let v=1;v<=7;v++) for (let c=0;c<4;c++) tiles.push({s:'z',v,id:id++});
  return tiles;
}

function shuffle(a) {
  const b=[...a];
  for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}
  return b;
}

function key(t){ return `${t.v}${t.s}`; }

function sort(hand){
  return [...hand].sort((a,b)=>{
    const o={m:0,p:1,s:2,z:3};
    return o[a.s]!==o[b.s] ? o[a.s]-o[b.s] : a.v-b.v;
  });
}

// Recursively splits a hand into every valid way to group it into
// pairs/triplets/sequences. Returns an array of "decompositions"; each
// decomposition is an array of groups shaped {t:'pair'|'tri'|'seq', k:[...]}
// where k holds the group's tile keys (e.g. a 'seq' of 4p-5p-6p is
// {t:'seq', k:['4p','5p','6p']}). A hand can decompose multiple valid ways
// (e.g. 6 identical-suit runs can form iipeiko two different ways) — callers
// that care about scoring (detectYaku) try all of them and keep the best.
// Only meant for hands whose length is a multiple of 3 (plus an optional
// pair) — chiitoitsu/kokushi are checked separately since they don't fit
// this pair+triplet/sequence shape.
function decompose(hand) {
  const counts = {};
  for(const t of hand){ const k=key(t); counts[k]=(counts[k]||0)+1; }
  const results = [];
  _dec(counts, [], results, hand.length);
  return results;
}

function _dec(counts, groups, results, total) {
  const keys = Object.keys(counts).filter(k=>counts[k]>0).sort((a,b)=>{
    const sa=a.slice(-1),sb=b.slice(-1);
    return sa!==sb ? (sa<sb?-1:1) : parseInt(a)-parseInt(b);
  });
  if(!keys.length){ results.push([...groups]); return; }
  const k=keys[0]; const suit=k.slice(-1); const val=parseInt(k);
  const rem=Object.values(counts).reduce((a,b)=>a+b,0);
  if(rem%3===2 && counts[k]>=2){
    counts[k]-=2; _dec(counts,[...groups,{t:'pair',k:[k,k]}],results,total); counts[k]+=2;
  }
  if(counts[k]>=3){
    counts[k]-=3; _dec(counts,[...groups,{t:'tri',k:[k,k,k]}],results,total); counts[k]+=3;
  }
  if(suit!=='z'){
    const k2=`${val+1}${suit}`,k3=`${val+2}${suit}`;
    if(counts[k2]>0&&counts[k3]>0){
      counts[k]--;counts[k2]--;counts[k3]--;
      _dec(counts,[...groups,{t:'seq',k:[k,k2,k3]}],results,total);
      counts[k]++;counts[k2]++;counts[k3]++;
    }
  }
}

// Shanten (tiles-away-from-tenpai) for the standard 4-sets+pair hand shape.
// Unlike decompose() (which only recognizes *complete* hands), this also
// scores partial groups (a spare pair held as a proto-triplet, or a
// two-tile run shape) so it works on any hand size. Exhaustive backtracking
// search, structurally mirroring _dec above, because a greedy single pass
// gets the "is this pair the head, or a partial triplet?" choice wrong for
// some hands — only exploring every branch and keeping the minimum shanten
// is reliable. `sets`/`partials` count logical groups (a meld — kan
// included — is exactly ONE set here, same convention decompose/isWin use),
// never physical tile counts.
function shantenStandard(hand, meldCount){
  const counts = {};
  for(const t of hand){ const k=key(t); counts[k]=(counts[k]||0)+1; }
  let best = Infinity;
  _shanten(counts, meldCount||0, 0, false);
  return best;

  function _shanten(counts, sets, partials, hasPair){
    const keys = Object.keys(counts).filter(k=>counts[k]>0).sort((a,b)=>{
      const sa=a.slice(-1),sb=b.slice(-1);
      return sa!==sb ? (sa<sb?-1:1) : parseInt(a)-parseInt(b);
    });
    if(!keys.length){
      const cap = Math.max(0, 4-sets);
      const usedPartials = Math.min(partials, cap);
      const s = 2*(4-sets) - usedPartials - (hasPair?1:0);
      if(s<best) best=s;
      return;
    }
    const k=keys[0], suit=k.slice(-1), val=parseInt(k);
    const canGrow = sets+partials < 4;

    // Complete triplet
    if(canGrow && counts[k]>=3){
      counts[k]-=3; _shanten(counts,sets+1,partials,hasPair); counts[k]+=3;
    }
    // Complete sequence
    if(canGrow && suit!=='z'){
      const k2=`${val+1}${suit}`,k3=`${val+2}${suit}`;
      if(counts[k2]>0&&counts[k3]>0){
        counts[k]--;counts[k2]--;counts[k3]--;
        _shanten(counts,sets+1,partials,hasPair);
        counts[k]++;counts[k2]++;counts[k3]++;
      }
    }
    // Pair as the head — a separate slot from the 4 sets, so not gated by
    // canGrow (a hand can already have 4 sets and still need its head pair).
    if(!hasPair && counts[k]>=2){
      counts[k]-=2; _shanten(counts,sets,partials,true); counts[k]+=2;
    }
    // Pair held as a proto-triplet (partial), distinct from the head-pair
    // branch above — explored separately since only the search itself can
    // tell, per hand, which use is better.
    if(canGrow && counts[k]>=2){
      counts[k]-=2; _shanten(counts,sets,partials+1,hasPair); counts[k]+=2;
    }
    // Partial sequence: ryanmen/penchan (k,k+1) or kanchan (k,k+2)
    if(canGrow && suit!=='z'){
      for(const off of [1,2]){
        const k1=`${val+off}${suit}`;
        if(counts[k1]>0){
          counts[k]--;counts[k1]--;
          _shanten(counts,sets,partials+1,hasPair);
          counts[k]++;counts[k1]++;
        }
      }
    }
    // Floater: leave one copy of this tile unused, recurse on the rest
    counts[k]--; _shanten(counts,sets,partials,hasPair); counts[k]++;
  }
}

// Chiitoitsu (7 distinct pairs) shanten — doesn't fit the sets+pair shape
// above, so scored separately. Closed hands only (chiitoitsu can never
// include a called meld).
function shantenChiitoi(hand){
  const c={}; for(const t of hand){ c[key(t)]=(c[key(t)]||0)+1; }
  const pairs = Object.values(c).filter(n=>n>=2).length;
  const kinds = Object.keys(c).length;
  return 6-pairs+Math.max(0,7-kinds);
}

// Public shanten entry point — minimum tiles-away-from-tenpai across every
// hand shape that applies (standard, plus chiitoitsu when the hand is
// closed). -1 means already a complete winning hand, 0 means tenpai.
function shanten(hand, melds){
  const meldCount = melds ? melds.length : 0;
  let s = shantenStandard(hand, meldCount);
  if(meldCount===0) s = Math.min(s, shantenChiitoi(hand));
  return s;
}

// Chiitoitsu (7 pairs): 14 tiles, exactly 7 distinct keys, each appearing twice.
function isChiitoitsu(hand){
  if(hand.length!==14) return false;
  const c={}; for(const t of hand){c[key(t)]=(c[key(t)]||0)+1;}
  return Object.keys(c).length===7 && Object.values(c).every(v=>v===2);
}

// Kokushi Musou (13 orphans): all 13 terminal/honor types present, plus one
// of them doubled as the pair. Always a closed (menzen) hand.
function isKokushi(hand){
  if(hand.length!==14) return false;
  const terms=['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
  const keys=hand.map(key);
  return terms.every(t=>keys.includes(t)) && terms.some(t=>keys.filter(k=>k===t).length>=2);
}

// Kokushi with 13-sided wait (all 13 terminals/honours in hand, pair from draw)
function isKokushi13(hand){
  if(hand.length!==14) return false;
  const terms=['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
  const c={}; for(const t of hand){c[key(t)]=(c[key(t)]||0)+1;}
  const keys=Object.keys(c);
  return keys.length===13 && keys.every(k=>terms.includes(k));
}

// Chuuren Poutou: 1112345678999 + any same suit tile (menzen only)
function isChuuren(hand){
  if(hand.length!==14) return false;
  const c={}; for(const t of hand){c[key(t)]=(c[key(t)]||0)+1;}
  const suits=new Set(hand.map(t=>t.s));
  if(suits.size!==1||suits.has('z')) return false;
  const s=[...suits][0];
  const base={[`1${s}`]:3,[`2${s}`]:1,[`3${s}`]:1,[`4${s}`]:1,[`5${s}`]:1,[`6${s}`]:1,[`7${s}`]:1,[`8${s}`]:1,[`9${s}`]:3};
  for(const [k,n] of Object.entries(base)){
    if((c[k]||0)<n) return false;
  }
  return true;
}
// 9-sided wait version: true only if the hand MINUS the winning tile is
// exactly the pure 13-tile shape (1112345678999), i.e. any of the 9 tiles
// 1-9 would have completed the wait.
function isChuuren9(hand,winTileKey){
  if(!isChuuren(hand)) return false;
  const c={}; for(const t of hand){c[key(t)]=(c[key(t)]||0)+1;}
  if(winTileKey) c[winTileKey]=(c[winTileKey]||0)-1;
  const suits=new Set(hand.map(t=>t.s));
  const s=[...suits][0];
  const base={[`1${s}`]:3,[`2${s}`]:1,[`3${s}`]:1,[`4${s}`]:1,[`5${s}`]:1,[`6${s}`]:1,[`7${s}`]:1,[`8${s}`]:1,[`9${s}`]:3};
  for(const [k,n] of Object.entries(base)){
    if((c[k]||0)!==n) return false; // exactly base = 9-sided wait
  }
  return true;
}

function isWin(hand, melds){
  // Physical tile accounting: melds hold 3 tiles (chi/pon) or 4 tiles (kan).
  // A kan's 4th tile is a "bonus" the player banked via their rinshan
  // replacement draw, so total physical tiles (hand + melds) for a complete
  // hand is 14 plus one extra per kan called.
  const physicalMeldTiles = melds ? melds.reduce((n,m)=>n+(m.type==='kan'?4:3),0) : 0;
  const numKans = melds ? melds.filter(m=>m.type==='kan').length : 0;
  const total = hand.length + physicalMeldTiles;
  if(total !== 14 + numKans) return false;
  if(melds && melds.length > 0){
    // Open hand: just check if remaining hand tiles form valid sets + pair.
    // Each meld — kan included — represents exactly ONE set (3 tiles) in
    // the logical 4-sets-plus-pair structure, regardless of its physical
    // tile count, so decompose() naturally needs no special-casing here:
    // hand.length is already correctly sized by the total check above.
    return decompose(hand).length > 0;
  }
  if(isKokushi(hand)||isChiitoitsu(hand)) return true;
  return decompose(hand).length>0;
}

function waits(hand, melds){
  const meldCount = melds ? melds.reduce((n,m)=>n+(m.type==='kan'?4:3),0) : 0;
  const numKans = melds ? melds.filter(m=>m.type==='kan').length : 0;
  const handLen = hand.length;
  // Each kan grants a bonus rinshan draw, shifting the expected hand size
  // up by one per kan relative to the normal 13/14 baseline.
  const base13 = 13 - meldCount + numKans;
  const base14 = 14 - meldCount + numKans;
  if(handLen !== base13 && handLen !== base14) return [];
  // If 14 tiles (draw turn or post-meld): compute waits for each possible discard
  if(handLen === base14){
    const waitSet = new Set();
    for(const t of hand){
      const reduced = hand.filter(x=>x.id!==t.id);
      for(const w of waits(reduced, melds)) waitSet.add(w);
    }
    return [...waitSet];
  }
  // 13 tiles: test all possible draws
  const w=[];
  for(const s of['m','p','s','z']){
    const max=s==='z'?7:9;
    for(let v=1;v<=max;v++){
      if(isWin([...hand,{s,v,id:99999}],melds)) w.push(`${v}${s}`);
    }
  }
  return w;
}

// Reaction checks against a just-discarded tile (`disc`). Pon/kan just need
// enough matching tiles in hand; chi additionally only allows honors=false
// and (per real rules, enforced by the caller) only from the player to your
// left. Returns the specific tile-id pairs so the UI can highlight them,
// since a hand can sometimes chi the same discard two different ways
// (e.g. holding 3m-4m-6m against a discarded 5m: 3-4 or 4-6 both work).
function canPon(hand,disc){ return hand.filter(t=>key(t)===key(disc)).length>=2; }
function canKan(hand,disc){ return hand.filter(t=>key(t)===key(disc)).length>=3; }
function canChi(hand,disc){
  if(disc.s==='z') return []; // honors have no sequences
  const seqs=[];
  const v=disc.v,s=disc.s;
  for(const [a,b] of [[v-2,v-1],[v-1,v+1],[v+1,v+2]]){
    if(a<1||b>9) continue;
    const ta=hand.find(t=>t.s===s&&t.v===a);
    const tb=hand.find(t=>t.s===s&&t.v===b);
    if(ta&&tb) seqs.push([ta.id,tb.id]);
  }
  return seqs;
}

// ── Constants ────────────────────────────────────────────────────────────────
const TERMINALS = new Set(['1m','9m','1p','9p','1s','9s']);
const HONORS    = new Set(['1z','2z','3z','4z','5z','6z','7z']);
const DRAGONS   = new Set(['5z','6z','7z']);
const WINDS     = new Set(['1z','2z','3z','4z']);
const GREEN_TILES = new Set(['2s','3s','4s','6s','8s','6z']); // Ryuuiisou

function isTermOrHon(k){ return TERMINALS.has(k)||HONORS.has(k); }
function isSimple(k){ return !isTermOrHon(k); }
function getSuit(k){ return k.slice(-1); }
function getVal(k){ return parseInt(k); }

// ── Main yaku detector ───────────────────────────────────────────────────────
// Entry point for scoring a completed hand. Returns {han, yakuList, yakuman?}
// where han=0 means "not actually a valid/legal win" (no yaku — callers must
// reject the win). Caller (room.js) is the source of truth for game state;
// this function just answers "given this exact situation, what yaku apply?"
// so keep it side-effect-free and re-callable (it's also used speculatively
// to decide whether to *offer* ron/tsumo before the player commits).
//
// Params (all positional — check call sites carefully when adding a new one):
//   hand14      concealed hand tiles INCLUDING the winning tile (melds are
//               passed separately in `melds`, not included here)
//   melds       this player's called pon/chi/kan melds, each
//               {type:'pon'|'chi'|'kan', tiles:[...], open, ...}
//   isTsumo     won by self-draw (true) vs ron (false)
//   seatWind    1-4 = this player's own seat wind (East..North)
//   roundWind   1 or 2 = current round wind (East or South)
//   isRiichi/isIppatsu/isDoubleRiichi   riichi-family state, see room.js
//   isRinshan   won on the replacement tile drawn after calling a kan
//   isChankan   won by robbing another player's added-kan tile
//   isHaitei/isHoutei   won on the very last tile of the wall (tsumo/ron resp.)
//   isTenhou/isChiihou  dealer/non-dealer first-uninterrupted-draw yakuman
//   winTileKey  "<value><suit>" key of the tile that completed the hand —
//               needed to tell ankou from ron-completed minkou, tanki from
//               shanpon, ryanmen from kanchan/penchan, etc.
// Ankan (concealed kan) does NOT break menzen/closed-hand status, unlike
// every other call type — a player can still declare/hold riichi after
// ankan-ing. Only a non-ankan meld actually opens the hand. Shared between
// detectYaku (menzen-gated yaku) and calcFu (menzen-ron fu bonus) so both
// agree on what counts as "still closed" — keep them using this, not their
// own melds.length checks, or they'll silently drift apart again.
function isMenzen(melds){
  return !melds.some(m=>m.type!=='kan'||m.kanType!=='ankan');
}

function detectYaku(hand14, melds, isTsumo, seatWind, roundWind, isRiichi, isIppatsu, isDoubleRiichi, isRinshan, isChankan, isHaitei, isHoutei, isTenhou, isChiihou, winTileKey){
  const menzen=isMenzen(melds);
  const allKeys=[...hand14.map(key),...melds.flatMap(m=>m.tiles.map(key))];

  // ── Tenhou / Chiihou (Yakuman, before anything else) ─────────────────────
  if(isTenhou) return ym('Tenhou','天和',13);
  if(isChiihou) return ym('Chiihou','地和',13);

  // ── Kokushi Musou ────────────────────────────────────────────────────────
  if(menzen && isKokushi(hand14)){
    if(isKokushi13(hand14)){
      // Juusanmen: pre-win hand already held all 13 types singly (tenpai on
      // any of the 13), so the winning tile itself creates the pair.
      // Regular Kokushi: pre-win hand was missing one type and already had a
      // different type paired, so the winning tile is the sole missing type
      // (not the pair) — a single-tile wait, not 13-sided.
      const c={};
      for(const t of hand14){ const k=`${t.v}${t.s}`; c[k]=(c[k]||0)+1; }
      const pairKey=Object.keys(c).find(k=>c[k]===2);
      if(winTileKey && pairKey && winTileKey===pairKey)
        return ym('Kokushi Juusanmen','国士無双十三面待ち',26);
      return ym('Kokushi Musou','国士無双',13);
    }
    return ym('Kokushi Musou','国士無双',13);
  }

  // ── Daisuushii / Shousuushii (must check before Tsuuiisou since all winds = all honours) ──
  if(menzen||true){ // open hands can also have Daisuushii/Shousuushii
    const allK=allKeys;
    const windCounts={};
    for(const k of allK) if(WINDS.has(k)){windCounts[k]=(windCounts[k]||0)+1;}
    const windKeys=Object.keys(windCounts);
    if(windKeys.length===4&&windKeys.every(k=>windCounts[k]>=3))
      return ym('Daisuushii','大四喜',26);
  }

  // ── Ryuuiisou (All Green) ────────────────────────────────────────────────
  if(allKeys.every(k=>GREEN_TILES.has(k))) return ym('Ryuuiisou','緑一色',13);

  // ── Tsuuiisou (All Honors) ───────────────────────────────────────────────
  if(allKeys.every(k=>HONORS.has(k))) return ym('Tsuuiisou','字一色',13);

  // ── Chinroutou (All Terminals) ───────────────────────────────────────────
  if(allKeys.every(k=>TERMINALS.has(k))) return ym('Chinroutou','清老頭',13);

  // ── Chuuren Poutou ───────────────────────────────────────────────────────
  if(menzen && isChuuren(hand14)){
    if(isChuuren9(hand14,winTileKey)) return ym('Junsei Chuuren','純正九蓮宝燈',26); // double
    return ym('Chuuren Poutou','九蓮宝燈',13);
  }

  const decomps=decompose(hand14);

  // ── Chiitoitsu ───────────────────────────────────────────────────────────
  // Only award if no regular decomp exists, or if chiitoi scores higher
  let chiitoi=null;
  if(menzen && isChiitoitsu(hand14)){
    const yl=[]; let h=2;
    yl.push({name:'Chiitoitsu',jp:'七対子',han:2});
    if(isDoubleRiichi){yl.push({name:'Double Riichi',jp:'ダブルリーチ',han:2});h+=2;}
    else if(isRiichi){yl.push({name:'Riichi',jp:'リーチ',han:1});h++;}
    if(isIppatsu&&isRiichi){yl.push({name:'Ippatsu',jp:'一発',han:1});h++;}
    if(isHaitei){yl.push({name:'Haitei',jp:'海底摸月',han:1});h++;}
    if(isHoutei){yl.push({name:'Houtei',jp:'河底撈魚',han:1});h++;}
    chiitoi={han:h,yakuList:yl};
    if(!decomps.length) return chiitoi;
  }

  if(!decomps.length) return {han:0,yakuList:[]};

  let best={han:0,yakuList:[]};
  if(chiitoi) best=chiitoi;
  for(const groups of decomps){
    const r=evalDecomp(groups,hand14,melds,isTsumo,seatWind,roundWind,isRiichi,isIppatsu,isDoubleRiichi,isRinshan,isChankan,isHaitei,isHoutei,menzen,winTileKey);
    if(r.yakuman||r.han>best.han) best=r;
    if(r.yakuman) break;
  }
  return best;
}

// Shorthand for building a single-yaku yakuman result (han is 13 for a
// single yakuman, 26 for a double yakuman like Kokushi Juusanmen).
function ym(name,jp,han){ return {han,yakuList:[{name,jp,han}],yakuman:true}; }

// Scores ONE specific way of grouping the concealed hand (`groups`, from
// decompose(hand14)) combined with the player's melds. detectYaku calls this
// once per candidate decomposition and keeps whichever scores highest, since
// e.g. a hand can be readable as either Iipeiko or a plain hand depending on
// how sequences are grouped.
//
// IMPORTANT group-list vocabulary used throughout this function — mixing
// these up is exactly how three of the bugs found in this file happened:
//   groups      concealed groups only (from decompose(hand14)), all closed
//   allGroups   groups + melds, melds normalized to the same {t,k} shape
//               (t is 'tri' for pon/kan, 'seq' for chi — a kan is 4 tiles
//               but still ONE logical triplet-equivalent group)
//   tris/seqs   triplets/sequences from allGroups (concealed AND called) —
//               use these for yaku that don't care about openness
//               (Toitoi, Yakuhai, Sanshoku, Ittsu, Chanta, ...)
//   closedTris  triplets from `groups`, MINUS any triplet whose last tile
//               was won by ron (a ron-completed triplet is a minkou, not an
//               ankou, even though its tiles are physically in the closed
//               hand), PLUS any ankan (concealed kan) melds — those never
//               appear in `groups` (their tiles were moved out of hand14
//               into `melds` the moment the kan was declared) but are still
//               fully concealed, unlike daiminkan/kakan which are genuinely
//               open. Use closedTris only for Sanankou/Suuankou.
function evalDecomp(groups,hand14,melds,isTsumo,seatWind,roundWind,isRiichi,isIppatsu,isDoubleRiichi,isRinshan,isChankan,isHaitei,isHoutei,menzen,winTileKey){
  const yl=[]; let han=0;
  const allKeys=[...hand14.map(key),...melds.flatMap(m=>m.tiles.map(key))];
  const allGroups=[...groups,...melds.map(m=>({t:m.type==='chi'?'seq':'tri',k:m.tiles.map(key),open:true}))];
  const pairs=groups.filter(g=>g.t==='pair');
  const seqs=allGroups.filter(g=>g.t==='seq');
  const closedSeqs=groups.filter(g=>g.t==='seq');
  const tris=allGroups.filter(g=>g.t==='tri');
  // A triplet completed by the winning tile via ron counts as open (minkou),
  // not concealed (ankou), even though its tiles sit in the closed hand.
  // Ankan melds are added back in separately since they're fully concealed
  // but live in `melds`, not `groups` (see closedTris comment above).
  const ankanTris=melds.filter(m=>m.type==='kan'&&m.kanType==='ankan').map(m=>({t:'tri',k:m.tiles.map(key)}));
  const closedTris=[...groups.filter(g=>g.t==='tri'&&!(!isTsumo&&g.k[0]===winTileKey)),...ankanTris];
  const pairKey=pairs[0]?.k[0];

  // ── Yakuman checks within decomp ──────────────────────────────────────────

  // Suu Kantsu — 4 kans (handled in game logic, checked via melds)
  const kanMelds=melds.filter(m=>m.type==='kan');
  if(kanMelds.length===4) return ym('Suu Kantsu','四槓子',13);

  // Suu Ankou — 4 closed triplets
  if(menzen&&closedTris.length===4){
    // Tanki = won on the pair tile (single wait on the pair)
    const pairK=pairs[0]?.k[0];
    const isTanki=winTileKey&&pairK&&winTileKey===pairK;
    if(isTanki) return ym('Suu Ankou Tanki','四暗刻単騎',26);
    return ym('Suu Ankou','四暗刻',13);
  }

  // Daisangen — 3 dragon triplets
  if(tris.filter(g=>DRAGONS.has(g.k[0])).length===3)
    return ym('Daisangen','大三元',13);

  // Shousuushii — 3 wind triplets + 1 wind pair
  const windTris=tris.filter(g=>WINDS.has(g.k[0]));
  const windPair=pairKey&&WINDS.has(pairKey);
  if(windTris.length===3&&windPair) return ym('Shousuushii','小四喜',13);

  // Daisuushii — 4 wind triplets (double yakuman in some rules, 13 in standard)
  if(windTris.length===4) return ym('Daisuushii','大四喜',26);

  // ── Regular yaku ─────────────────────────────────────────────────────────

  // Riichi / Double Riichi / Ippatsu
  if(menzen){
    if(isDoubleRiichi){yl.push({name:'Double Riichi',jp:'ダブルリーチ',han:2});han+=2;}
    else if(isRiichi){yl.push({name:'Riichi',jp:'リーチ',han:1});han++;}
    if(isIppatsu&&(isRiichi||isDoubleRiichi)){yl.push({name:'Ippatsu',jp:'一発',han:1});han++;}
  }

  // Menzen Tsumo
  if(isTsumo&&menzen&&!isRinshan){yl.push({name:'Menzen Tsumo',jp:'門前清自摸和',han:1});han++;}

  // Rinshan Kaihou
  if(isRinshan){yl.push({name:'Rinshan Kaihou',jp:'嶺上開花',han:1});han++;}

  // Chankan
  if(isChankan){yl.push({name:'Chankan',jp:'槍槓',han:1});han++;}

  // Haitei Raoyue (last tile tsumo)
  if(isHaitei&&isTsumo){yl.push({name:'Haitei',jp:'海底摸月',han:1});han++;}

  // Houtei Raoyui (last tile ron)
  if(isHoutei&&!isTsumo){yl.push({name:'Houtei',jp:'河底撈魚',han:1});han++;}

  // Tanyao
  if(allKeys.every(isSimple)&&melds.every(m=>m.tiles.every(t=>isSimple(key(t))))){
    yl.push({name:'Tanyao',jp:'断么九',han:1});han++;
  }

  // Pinfu (menzen only, 4 sequences, pair not yakuhai, two-sided wait)
  if(menzen&&seqs.length===4&&pairKey&&!DRAGONS.has(pairKey)&&pairKey!==`${seatWind}z`&&pairKey!==`${roundWind}z`&&
     winTileKey&&waitFu(groups,winTileKey)===0){
    yl.push({name:'Pinfu',jp:'平和',han:1});han++;
  }

  // Iipeiko (menzen only, two identical sequences)
  if(menzen&&closedSeqs.length>=2){
    const ss=closedSeqs.map(g=>g.k.join(','));
    const dupes=ss.filter((s,i)=>ss.indexOf(s)!==i);
    if(dupes.length>=1){yl.push({name:'Iipeiko',jp:'一盃口',han:1});han++;}
  }

  // Ryanpeiko (menzen only, two pairs of identical sequences)
  if(menzen&&closedSeqs.length===4){
    const ss=closedSeqs.map(g=>g.k.join(','));
    const counts={};ss.forEach(s=>counts[s]=(counts[s]||0)+1);
    if(Object.values(counts).filter(n=>n===2).length===2){
      // Remove iipeiko if awarded, replace with ryanpeiko
      const ii=yl.findIndex(y=>y.name==='Iipeiko');
      if(ii>=0){yl.splice(ii,1);han--;}
      yl.push({name:'Ryanpeiko',jp:'二盃口',han:3});han+=3;
    }
  }

  // Yakuhai (dragon/wind triplets)
  for(const g of tris){
    const k=g.k[0];
    if(k==='5z'){yl.push({name:'Haku',jp:'白',han:1});han++;}
    else if(k==='6z'){yl.push({name:'Hatsu',jp:'發',han:1});han++;}
    else if(k==='7z'){yl.push({name:'Chun',jp:'中',han:1});han++;}
    if(k===`${seatWind}z`){yl.push({name:'Seat Wind',jp:'自風',han:1});han++;}
    if(k===`${roundWind}z`){yl.push({name:'Round Wind',jp:'場風',han:1});han++;}
  }

  // Shousangen (2 dragon triplets + 1 dragon pair)
  const dragonTris=tris.filter(g=>DRAGONS.has(g.k[0]));
  if(dragonTris.length===2&&pairKey&&DRAGONS.has(pairKey)){
    yl.push({name:'Shousangen',jp:'小三元',han:2});han+=2;
  }

  // Sanshoku Doujun (same sequence in all 3 suits)
  if(seqs.length>=3){
    const byVal={};
    for(const g of seqs){
      const v=getVal(g.k[0]);
      if(!byVal[v])byVal[v]=new Set();
      byVal[v].add(getSuit(g.k[0]));
    }
    for(const suits of Object.values(byVal)){
      if(suits.has('m')&&suits.has('p')&&suits.has('s')){
        const h=menzen?2:1;yl.push({name:'Sanshoku Doujun',jp:'三色同順',han:h});han+=h;break;
      }
    }
  }

  // Sanshoku Doukou (same triplet in all 3 suits)
  if(tris.length>=3){
    const triVals={};
    for(const g of tris){
      if(getSuit(g.k[0])==='z') continue;
      const v=getVal(g.k[0]);
      if(!triVals[v])triVals[v]=new Set();
      triVals[v].add(getSuit(g.k[0]));
    }
    for(const suits of Object.values(triVals)){
      if(suits.has('m')&&suits.has('p')&&suits.has('s')){
        yl.push({name:'Sanshoku Doukou',jp:'三色同刻',han:2});han+=2;break;
      }
    }
  }

  // Ittsu (straight: 123, 456, 789 same suit)
  for(const suit of['m','p','s']){
    const vs=seqs.filter(g=>getSuit(g.k[0])===suit).map(g=>getVal(g.k[0]));
    if(vs.includes(1)&&vs.includes(4)&&vs.includes(7)){
      const h=menzen?2:1;yl.push({name:'Ittsu',jp:'一気通貫',han:h});han+=h;break;
    }
  }

  // Chanta (every group contains terminal or honour, at least 1 sequence)
  if(seqs.length>=1&&allGroups.every(g=>g.k.some(k=>isTermOrHon(k)))&&pairKey&&isTermOrHon(pairKey)){
    const h=menzen?2:1;yl.push({name:'Chanta',jp:'混全帯么九',han:h});han+=h;
  }

  // Toitoi
  if(tris.length===4){yl.push({name:'Toitoi',jp:'対々和',han:2});han+=2;}

  // San Ankou (3 closed triplets)
  if(closedTris.length===3){yl.push({name:'San Ankou',jp:'三暗刻',han:2});han+=2;}

  // Honitsu (one suit + honours)
  const nonHonorSuits=new Set(allKeys.filter(k=>!HONORS.has(k)).map(getSuit));
  if(nonHonorSuits.size===1&&allKeys.some(k=>HONORS.has(k))){
    const h=menzen?3:2;yl.push({name:'Honitsu',jp:'混一色',han:h});han+=h;
  }

  // Junchan (every group contains terminal, at least 1 sequence, no honours)
  if(!allKeys.some(k=>HONORS.has(k))&&seqs.length>=1&&
     allGroups.every(g=>g.k.some(k=>TERMINALS.has(k)))&&pairKey&&TERMINALS.has(pairKey)){
    // Remove chanta if awarded
    const ci=yl.findIndex(y=>y.name==='Chanta');
    if(ci>=0){yl.splice(ci,1);han-=(menzen?2:1);}
    const h=menzen?3:2;yl.push({name:'Junchan',jp:'純全帯么九',han:h});han+=h;
  }

  // Chinitsu (one suit, no honours)
  if(nonHonorSuits.size===1&&!allKeys.some(k=>HONORS.has(k))){
    const h=menzen?6:5;yl.push({name:'Chinitsu',jp:'清一色',han:h});han+=h;
  }

  if(han===0) return {han:0,yakuList:[]};
  return {han,yakuList:yl};
}

// Dora indicator -> actual dora is "next tile in sequence". For m/p/s that's
// a simple 1-9 wrap. Honors are two SEPARATE cycles, not one 1-7 loop: winds
// wrap 1(E)->2(S)->3(W)->4(N)->1, and dragons wrap independently
// 5(White)->6(Green)->7(Red)->5 — a North indicator must point to East, not
// spill over into White Dragon.
function countDora(hand,doraIndicators){
  let n=0;
  for(const ind of doraIndicators){
    let dv=ind.v+1;
    if(ind.s==='z'){
      if(ind.v<=4) dv=ind.v===4?1:dv;       // winds: 4(North) wraps to 1(East)
      else dv=ind.v===7?5:dv;               // dragons: 7(Chun) wraps to 5(Haku)
    } else dv=dv>9?1:dv;
    n+=hand.filter(t=>t.s===ind.s&&t.v===dv).length;
  }
  return n;
}

// Count red 5 tiles (aka dora) in hand — each red 5 = 1 han bonus
function countAkaDora(hand){
  return hand.filter(t=>t.red===true).length;
}

// waitFu: compute wait-type fu bonus given the winning tile and groups
// Returns 0 (ryanmen/shanpon), 2 (kanchan/penchan/tanki)
function waitFu(groups, winTileKey){
  const pair=groups.find(g=>g.t==='pair');
  // Tanki (pair wait)
  if(pair&&pair.k[0]===winTileKey) return 2;
  for(const g of groups){
    if(g.t!=='seq') continue;
    const [a,b,c]=g.k; // sorted low→high within suit
    if(a===winTileKey||c===winTileKey){
      // Penchan: 1-2 waiting on [3], or 8-9 waiting on [7]
      const val=getVal(a);
      if(winTileKey===c&&val===1) return 2; // 1-2 waiting on 3
      if(winTileKey===a&&val===7) return 2; // 8-9 waiting on 7
      return 0; // ryanmen
    }
    if(b===winTileKey) return 2; // kanchan
  }
  return 0; // shanpon or unknown
}

function calcFu(groups, isTsumo, menzen, winTileKey, isPinfu){
  // Pinfu tsumo = fixed 20 fu (no rounding needed)
  if(isPinfu && isTsumo) return 20;
  // Base fu is 20 across the board; the menzen-ron +10 bonus (up to the
  // familiar 30 floor) is applied by the "Minimum 30 for menzen ron" clamp
  // below, not here — open ron has no such bonus and stays at a 20 base.
  let fu = 20;
  for(const g of groups){
    if(g.t==='tri'||g.t==='kan'){
      const k=g.k[0];
      const isHon=isTermOrHon(k);
      const isClosed=!g.open;
      if(g.t==='kan'){
        // Kan fu: open=16/32, closed=32/64
        fu += isHon ? (isClosed?64:32) : (isClosed?32:16);
      } else {
        // Triplet fu: open=2/4, closed=4/8
        fu += isHon ? (isClosed?8:4) : (isClosed?4:2);
      }
    }
    if(g.t==='pair'){
      const k=g.k[0];
      if(DRAGONS.has(k)||WINDS.has(k)) fu+=2;
    }
  }
  // Wait fu
  if(winTileKey) fu += waitFu(groups, winTileKey);
  // Tsumo fu (not for pinfu — already handled above; not for open hand tsumo)
  if(isTsumo && !isPinfu) fu += 2;
  // Minimum 30 for menzen ron
  if(!isTsumo && menzen && fu<30) fu=30;
  return Math.ceil(fu/10)*10;
}

// "Base points" (basic score) per standard riichi scoring table. Callers
// (room.js) turn this into actual payments: ron = base*4 (non-dealer win) or
// base*6 (dealer win), rounded up to the nearest 100; tsumo splits it across
// the other three players individually. han>=5 is capped/fixed regardless of
// fu (mangan and up), which is why fu stops mattering past that point.
function basePoints(han,fu){
  if(han>=26) return 16000; // double yakuman (non-dealer ron 64000, dealer ron 96000)
  if(han>=13) return 8000;  // yakuman (non-dealer ron 32000, dealer ron 48000)
  if(han>=11) return 6000;  // sanbaiman
  if(han>=8)  return 4000;  // baiman
  if(han>=6)  return 3000;  // haneman
  if(han>=5)  return 2000;  // mangan
  return Math.min(fu*Math.pow(2,han+2),2000); // capped at 2000 = mangan boundary
}

// Display label for the score panel — purely cosmetic, mirrors the han
// thresholds in basePoints above (keep the two in sync if either changes).
function handLabel(han){
  if(han>=26) return 'Double Yakuman ダブル役満';
  if(han>=13) return 'Yakuman 役満';
  if(han>=11) return 'Sanbaiman 三倍満';
  if(han>=8)  return 'Baiman 倍満';
  if(han>=6)  return 'Haneman 跳満';
  if(han>=5)  return 'Mangan 満貫';
  return `${han} Han`;
}

module.exports = {buildWall,shuffle,sort,key,isWin,waits,canPon,canKan,canChi,
  detectYaku,countDora,countAkaDora,calcFu,waitFu,basePoints,handLabel,decompose,isMenzen,
  shanten,shantenStandard,shantenChiitoi};
