'use strict';
// Game replays — the compact per-round move log room.js records while a
// game is played (see Room's _rlStart/_rl/_rlEnd), and the one piece of
// logic every consumer of that log shares: stepping through it to rebuild
// the table at any point. analysis.js walks it to review a player's
// decisions; public/script.js has its own copy of applyEvent (no bundler —
// same "two small copies, kept in step by hand" arrangement as the
// client/server reason-label tables) to draw the replay viewer.
//
// One round's log:
//   {dealer, round, roundWind, honba, riichiSticks,
//    scores:[...at deal], hands:[[tile codes]...per seat], dora:[code],
//    ev:[event...], res:{...how it ended}}
//
// Tile codes are "<value><suit>" strings (same as mahjong.js's key()), with
// a red five written as value 0 ("0p") — the usual paifu convention, and
// what keeps an aka dora distinguishable from its plain twin in the log.
//
// Events (s = acting seat):
//   {t:'d',  s, k, r?}        draw (r:1 = rinshan/kita replacement draw)
//   {t:'x',  s, k, tg?, ri?}  discard (tg:1 = tsumogiri — the tile just
//                             drawn; ri:1 = this discard declared riichi)
//   {t:'pon'|'chi', s, f, k, u:[codes]}  call — k = the called tile, u =
//                             the tiles taken from hand, f = discarder
//   {t:'mk', s, f, k, u}      open kan on a discard (daiminkan)
//   {t:'ak', s, u}            concealed kan (ankan)
//   {t:'kk', s, k}            added kan (kakan) — upgrades s's pon of k
//   {t:'kita', s, k}          sanma North bank
//   {t:'dora', k}             new kan-dora indicator
//   {t:'pass', s, o:[types]}  a human seat declined an offered call/ron
//   {t:'tsumo', s} / {t:'ron', s, f}  the winning declaration(s)

function enc(t){ return (t.red?0:t.v)+t.s; }
function dec(code){
  const v=parseInt(code), s=code.slice(-1);
  return v===0?{v:5,s,red:true}:{v,s};
}
function codeKey(code){ return code[0]==='0'?'5'+code.slice(-1):code; }

const SUIT_ORDER={m:0,p:1,s:2,z:3};
function sortCodes(codes){
  return codes.slice().sort((a,b)=>{
    const sa=a.slice(-1), sb=b.slice(-1);
    if(sa!==sb) return SUIT_ORDER[sa]-SUIT_ORDER[sb];
    const va=parseInt(a)||5, vb=parseInt(b)||5;
    return va-vb || (a[0]==='0'?-1:b[0]==='0'?1:0);
  });
}

// Removes one copy of `code` from a list of codes — exact match first (so a
// red five leaves as the red five), then same key (a log entry can only
// ever disagree on red-ness if something upstream mis-encoded it; dropping
// the plain twin keeps the hand the right size rather than silently
// growing).
function _take(list, code){
  let i=list.indexOf(code);
  if(i===-1) i=list.findIndex(c=>codeKey(c)===codeKey(code));
  if(i!==-1) list.splice(i,1);
  return i!==-1;
}

// Table state at the start of a round (before any event).
function initialState(round, numPlayers){
  const n=numPlayers||round.hands.length;
  return {
    n,
    hands:round.hands.map(h=>sortCodes(h)),
    discards:Array.from({length:n},()=>[]),   // [{k, tg, ri, called}]
    melds:Array.from({length:n},()=>[]),      // [{type, tiles:[codes], called, f}]
    kita:Array.from({length:n},()=>[]),
    dora:(round.dora||[]).slice(),
    riichi:new Array(n).fill(false),
    scores:(round.scores||[]).slice(),
    riichiSticks:round.riichiSticks||0,
    drawn:null,          // the tile `turn` just drew (code), until they discard
    turn:round.dealer,
    turnCount:0,
    wallUsed:0,          // live-wall draws so far (rinshan draws excluded)
  };
}

// Applies one event to `st` in place. Mirrors room.js's own state changes
// for the same action closely enough to draw the table and evaluate a
// decision — not a rules engine (nothing here validates legality).
function applyEvent(st, e){
  const s=e.s;
  switch(e.t){
    case 'd':
      st.hands[s].push(e.k); st.hands[s]=sortCodes(st.hands[s]);
      st.drawn=e.k; st.turn=s;
      if(!e.r) st.wallUsed++;
      break;
    case 'x': {
      _take(st.hands[s], e.k);
      // A riichi marker whose tile got called away moves to the next
      // discard (see room.js's _removeFromDiscards) — tracked the same way.
      const ri=!!e.ri || !!st._riichiMoved?.[s];
      if(st._riichiMoved) st._riichiMoved[s]=false;
      st.discards[s].push({k:e.k, tg:!!e.tg, ri});
      if(e.ri){ st.riichi[s]=true; st.scores[s]-=1000; st.riichiSticks++; }
      st.drawn=null; st.turn=s; st.turnCount++;
      break;
    }
    case 'pon': case 'chi': case 'mk': {
      for(const c of e.u) _take(st.hands[s], c);
      const pond=st.discards[e.f];
      const last=pond[pond.length-1];
      if(last){
        last.called=true;
        if(last.ri){ st._riichiMoved=st._riichiMoved||{}; st._riichiMoved[e.f]=true; }
      }
      const type=e.t==='mk'?'kan':e.t;
      const tiles=e.t==='chi'?sortCodes([...e.u,e.k]):[...e.u,e.k];
      st.melds[s].push({type, kanType:e.t==='mk'?'daiminkan':undefined, tiles, called:e.k, f:e.f});
      st.drawn=null; st.turn=s;
      break;
    }
    case 'ak':
      for(const c of e.u) _take(st.hands[s], c);
      st.melds[s].push({type:'kan', kanType:'ankan', tiles:e.u.slice()});
      st.drawn=null;
      break;
    case 'kk': {
      _take(st.hands[s], e.k);
      const m=st.melds[s].find(m=>m.type==='pon'&&codeKey(m.tiles[0])===codeKey(e.k));
      if(m){ m.type='kan'; m.kanType='kakan'; m.tiles.push(e.k); }
      st.drawn=null;
      break;
    }
    case 'kita':
      _take(st.hands[s], e.k);
      st.kita[s].push(e.k);
      st.drawn=null;
      break;
    case 'dora':
      st.dora.push(e.k);
      break;
    default: break; // pass / tsumo / ron don't move tiles
  }
  return st;
}

// Plain tile objects (same {v,s,red,id} shape mahjong.js works with) for a
// list of codes — ids are synthetic, only unique within the call.
let _sid=-1000;
function toTiles(codes){ return codes.map(c=>({...dec(c), id:_sid--})); }

// The round's ending, in a compact shape the viewer and the analysis both
// read — pulled from the same round_end payload room.js broadcast (and
// stored in Play History's `rounds`), so the replay never disagrees with
// what the results screen showed.
function summarizeResult(payload){
  const p=payload||{};
  const winners=[];
  if(p.reason==='tsumo'||p.reason==='ron'){
    if(p.winner!=null) winners.push({s:p.winner, han:p.han||0, fu:p.fu||0, pay:p.payment||0});
    for(const x of p.extraWinners||[]) winners.push({s:x.winSeat, han:x.han||0, fu:x.fu||0, pay:x.pay||0});
  }
  return {
    reason:p.reason||'draw',
    winners,
    loser:p.reason==='ron'?p.loser:null,
    scores:Array.isArray(p.scores)?p.scores.slice():null,
    prevScores:Array.isArray(p.prevScores)?p.prevScores.slice():null,
    tenpai:Array.isArray(p.inTenpai)?p.inTenpai.slice():null,
    uraDora:(p.uraDora||[]).map(enc),
    offender:p.reason==='chonbo'?p.winner:null,
  };
}

module.exports={enc,dec,codeKey,sortCodes,initialState,applyEvent,toTiles,summarizeResult};
