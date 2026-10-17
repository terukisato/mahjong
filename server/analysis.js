'use strict';
// Replay review — walks one finished game's move log (see replay.js) from
// one player's seat and grades every decision they made: each discard
// (efficiency, hand value, and push/fold against a live threat), each
// riichi-or-not choice, each call taken or passed, and any win left on the
// table. The judgement leans on the hard bot's own table model (bot.js's
// `internals` — threat reads, per-tile deal-in danger, open-hand yaku
// paths), so "what you could have done instead" is what Janshin's strongest
// AI would have done, explained in plain words.
//
// Only ever runs on a finished game — it sees every hand, but each decision
// is judged strictly on what that seat could see at the time (own hand,
// every pond/meld, dora indicators); opponents' concealed tiles are never
// used.
const {isWin,waits,detectYaku,countDora,countAkaDora,isMenzen,shantenCounts,countsOf}=require('./mahjong');
const {internals:B}=require('./bot');
const R=require('./replay');

// Bump whenever the grading changes — cached reviews (history.js's
// game_analysis) made by an older version are recomputed on next open.
const ANALYSIS_VERSION=1;

const SUIT_OFF={m:0,p:9,s:18,z:27};
function idxCode(i){
  const s=i<9?'m':i<18?'p':i<27?'s':'z';
  return `${i-SUIT_OFF[s]+1}${s}`;
}

// Tiles that would lower this 13-tile shape's shanten, weighted by how many
// copies this seat can't see yet. `vis` is a 34-slot count of everything
// visible to the seat (own hand included).
function ukeire(c,meldCount,cur,vis,sanma){
  let n=0; const tiles=[];
  if(cur<0) return {n,tiles};
  for(let i=0;i<34;i++){
    if(sanma&&i>=1&&i<=7) continue; // 2m-8m don't exist in sanma
    const live=4-vis[i];
    if(live<=0||c[i]>=4) continue;
    c[i]++;
    if(shantenCounts(c,meldCount)<cur){ n+=live; tiles.push(idxCode(i)); }
    c[i]--;
  }
  return {n,tiles};
}

// ── Table reading helpers ───────────────────────────────────────────────────
const tileOf=code=>R.toTiles([code])[0];
const meldTiles=m=>({type:m.type,kanType:m.kanType,tiles:R.toTiles(m.tiles)});
const seatWindOf=(seat,dealer,n)=>((seat-dealer+n)%n)+1;
const isOpen=melds=>melds.some(m=>m.type!=='kan'||m.kanType!=='ankan');

function shName(sh){ return sh<0?'a complete hand':sh===0?'tenpai':`${sh}-shanten`; }
const T=code=>`[[${code}]]`; // inline tile token — rendered as a mini tile by the client

// Everything `seat` can see: own hand, every pond (minus called tiles —
// those are counted once, in the caller's meld), every meld, kita banks,
// dora indicators.
function visibleCounts(st,seat){
  const vis=new Array(34).fill(0);
  const bump=code=>{ const k=R.codeKey(code); vis[SUIT_OFF[k.slice(-1)]+parseInt(k)-1]++; };
  st.hands[seat].forEach(bump);
  for(let s=0;s<st.n;s++){
    for(const d of st.discards[s]) if(!d.called) bump(d.k);
    for(const m of st.melds[s]) m.tiles.forEach(bump);
    st.kita[s].forEach(bump);
  }
  st.dora.forEach(bump);
  return vis;
}

// The same table context room.js's _botCtx hands the bots, rebuilt from the
// replay state — so bot.js's threat/danger reads work unchanged.
function botCtx(st,seat,round,rules){
  const opponents=[];
  for(let s=0;s<st.n;s++){
    if(s===seat) continue;
    opponents.push({seat:s,seatWind:seatWindOf(s,round.dealer,st.n),riichi:st.riichi[s],
      discards:R.toTiles(st.discards[s].filter(d=>!d.called).map(d=>d.k)),
      melds:st.melds[s].map(meldTiles)});
  }
  return {seat,seatWind:seatWindOf(seat,round.dealer,st.n),roundWind:round.roundWind||1,
    kuitanAri:rules.kuitanAri!==false,sanma:!!rules.sanma,turnCount:st.turnCount,
    dora:R.toTiles(st.dora),scores:st.scores.slice(),opponents};
}

// Han this 13-tile tenpai shape would score by RON on its best wait with no
// riichi (0 = no yaku to ron with). Same shape getAdvice/_shouldRiichi use.
function bestRonHanNoRiichi(rem,melds,ctx){
  let best=0;
  for(const wk of waits(rem,melds,ctx.sanma)){
    const v=parseInt(wk),s=wk.slice(-1);
    const r=detectYaku([...rem,{s,v,id:-99}],melds,false,ctx.seatWind,ctx.roundWind,
      false,false,false,false,false,false,false,false,false,wk,{kuitanAri:ctx.kuitanAri});
    if(r.han>best) best=r.han;
  }
  return best;
}

const SEV_RANK={best:0,good:1,tip:1,inaccuracy:2,mistake:3,blunder:4};
function worse(a,b){ return SEV_RANK[b]>SEV_RANK[a]?b:a; }
function sevForLoss(loss){
  if(loss<=0.5) return 'best';
  if(loss<30) return 'good';
  if(loss<150) return 'inaccuracy';
  if(loss<700) return 'mistake';
  return 'blunder';
}

// ── Discard decision ───────────────────────────────────────────────────────
function analyzeDiscard(st,e,round,rules,names,nextEv){
  const seat=e.s;
  const sanma=!!rules.sanma;
  const codes=st.hands[seat];
  const handTiles=R.toTiles(codes);
  const melds=st.melds[seat].map(meldTiles);
  const meldCount=melds.length;
  const ctx=botCtx(st,seat,round,rules);
  const vis=visibleCounts(st,seat);
  const notes=[];
  let sev='best';

  // A win sitting in hand that was discarded instead of declared.
  if(isWin(handTiles,melds)){
    const r=detectYaku(handTiles,melds,true,ctx.seatWind,ctx.roundWind,st.riichi[seat],false,false,false,false,false,false,false,false,
      st.drawn?R.codeKey(st.drawn):null,{kuitanAri:ctx.kuitanAri});
    if(r.han>0){
      sev='blunder';
      notes.push(`You had a complete winning hand — declaring Tsumo would have won the round (${r.han} han before dora).`);
    }
  }

  // Already in riichi: the discard is forced (the drawn tile), nothing to grade.
  if(st.riichi[seat]){
    if(sev==='best') return null;
    return {kind:'discard',sev,text:notes.join(' '),chosen:{k:e.k},cands:[]};
  }

  // One candidate per distinct tile code (a red five is its own candidate —
  // throwing it away throws away a dora).
  const seen=new Set();
  const cands=[];
  for(const code of codes){
    if(seen.has(code)) continue;
    seen.add(code);
    const remCodes=codes.slice(); remCodes.splice(remCodes.indexOf(code),1);
    const rem=R.toTiles(remCodes);
    const c=countsOf(rem);
    const sh=shantenCounts(c,meldCount);
    const uk=ukeire(c,meldCount,sh,vis,sanma);
    cands.push({k:code,key:R.codeKey(code),rem,sh,uk:uk.n,ukt:uk.tiles});
  }
  const bestSh=Math.min(...cands.map(x=>x.sh));
  const yh=B.yakuhaiSet(ctx);
  for(const x of cands){
    let s=0;
    for(let i=bestSh;i<x.sh;i++) s+=B.SHANTEN_STEP[Math.min(i,4)];
    x.dora=countDora(x.rem,ctx.dora,sanma)+countAkaDora(x.rem);
    s-=40*x.dora;
    const cnt={};
    for(const t of x.rem){ const k=`${t.v}${t.s}`; cnt[k]=(cnt[k]||0)+1; }
    x.yhPairs=Object.keys(cnt).filter(k=>yh.has(k)&&cnt[k]===2).length;
    s-=35*x.yhPairs;
    // Ukeire only separates candidates at the SAME shanten — a hand one
    // step further back naturally "accepts" more tiles, which says nothing
    // about it being better (same reason bot.js gates its own tie-break).
    if(x.sh===bestSh) s-=6*x.uk;
    // An open hand's tenpai with no yaku on any wait can't actually win —
    // it's priced close to being a step back, not as real tenpai.
    x.noYaku=false;
    if(x.sh===0&&isOpen(st.melds[seat])&&waits(x.rem,melds,sanma).length&&bestRonHanNoRiichi(x.rem,melds,ctx)===0){
      x.noYaku=true;
      s+=1000;
    }
    x.shape=s;
  }

  // Threats — the hard bot's read: who's in riichi / looks tenpai, and the
  // estimated cost of each tile dealing into them.
  const {threats,vis:bvis}=B.assessThreats(ctx,handTiles,melds);
  const anyRiichi=threats.some(t=>t.kind==='riichi');
  let w=0;
  if(threats.length){
    if(bestSh===0) w=0.4;
    else if(bestSh===1) w=0.9;
    else {
      const myValue=B.estMyValue(cands.map(x=>({shanten:x.sh,rem:x.rem})),melds,ctx,bestSh);
      w=bestSh===2?(myValue>=6000?1.1:1.6):2.4;
    }
    if(anyRiichi) w*=1.15;
  }
  for(const x of cands){
    x.danger=threats.length?B.dealInCost(x.key,threats,bvis):0;
    let safe=1;
    for(const th of threats) safe*=1-B.tileDanger(x.key,th,bvis)*th.tenpaiProb;
    x.risk=1-safe;
    x.total=x.shape+w*x.danger;
  }
  // The hard bot's escape hatch: close to tenpai but the hand is cheap, a
  // riichi is out, and even the safest shape-keeping tile is a live one —
  // dropping one step to a much safer tile is a fair fold, not a mistake.
  if(anyRiichi&&bestSh<=1){
    const flat=cands.filter(x=>x.sh===bestSh).sort((a,b)=>a.total-b.total);
    const keep=flat[0];
    if(keep&&keep.danger>450&&B.estMyValue(cands.map(x=>({shanten:x.sh,rem:x.rem})),melds,ctx,bestSh)<3000){
      const fold=cands.filter(x=>x.sh-bestSh<=1).sort((a,b)=>a.danger-b.danger)[0];
      if(fold&&fold!==keep&&fold.danger<keep.danger*0.4) fold.total=Math.min(fold.total,keep.total-1);
    }
  }
  cands.sort((a,b)=>a.total-b.total||a.sh-b.sh||b.uk-a.uk);
  const best=cands[0];
  const chosen=cands.find(x=>x.k===e.k)||cands.find(x=>x.key===R.codeKey(e.k));
  if(!chosen) return null;
  const dealtIn=!!(nextEv&&nextEv.t==='ron'&&nextEv.f===seat);

  const loss=chosen.total-best.total;
  let dsev=sevForLoss(loss);
  // The danger model is an estimate — a risky push that got away with it
  // reads as a mistake, not a blunder. An actual deal-in keeps the full grade.
  if(dsev==='blunder'&&chosen.sh<=best.sh&&!dealtIn) dsev='mistake';
  sev=worse(sev,dsev);

  const threatNames=threats.filter(t=>t.kind==='riichi').map(t=>`${names[t.seat]}'s riichi`);
  const otherThreat=threats.filter(t=>t.kind==='open').map(t=>`${names[t.seat]}'s open hand`);
  const against=[...threatNames,...otherThreat].join(' and ')||'the table';
  const riskTxt=x=>x.risk<0.005?'completely safe (already discarded against them)':`about ${Math.round(x.risk*100)}% deal-in risk`;

  const lines=[];
  if(chosen===best||dsev==='best'){
    let l;
    if(chosen.sh===0) l=chosen.uk?`Best move — keeps you tenpai with ${chosen.uk} winning tiles left.`:'Best move — keeps you tenpai.';
    else l=`Best move — keeps you at ${shName(chosen.sh)}`+(chosen.uk?`, with ${chosen.uk} tiles that improve your hand.`:'.');
    lines.push(l);
    if(threats.length&&chosen.risk<0.005) lines.push(`It's also safe against ${against}.`);
  } else {
    lines.push(`${dsev==='good'?'Fine, but slightly better':'Better'}: discard ${T(best.k)} instead of ${T(chosen.k)}.`);
    if(chosen.noYaku&&!best.noYaku){
      lines.push(`${T(chosen.k)} leaves you tenpai, but with no yaku on any wait — an open hand can't win like that. ${T(best.k)} keeps a hand that can.`);
    } else if(best.sh>chosen.sh&&!threats.length){
      const kept=[best.dora>chosen.dora?'a dora':null,best.yhPairs>chosen.yhPairs?'a yakuhai pair':null].filter(Boolean).join(' and ')||'more value';
      lines.push(`At ${shName(chosen.sh)} it's still early — keeping ${kept} is worth more than one step of speed.`);
    } else if(best.sh>chosen.sh){
      lines.push(`Folding is the stronger play: you're only ${shName(chosen.sh)} against ${against}, so the safer ${T(best.k)} (${riskTxt(best)}) is worth more than hand speed — ${T(chosen.k)} carries ${riskTxt(chosen)}.`);
    } else {
      if(chosen.sh>best.sh) lines.push(`${T(chosen.k)} sets you back to ${shName(chosen.sh)}; ${T(best.k)} keeps you at ${shName(best.sh)}.`);
      else if(best.uk-chosen.uk>=2) lines.push(`${T(best.k)} leaves ${best.uk} tiles that move your hand forward, versus ${chosen.uk} after ${T(chosen.k)}.`);
      if(threats.length&&chosen.risk-best.risk>=0.02) lines.push(`${T(chosen.k)} is risky against ${against} (${riskTxt(chosen)}); ${T(best.k)} is ${riskTxt(best).replace(/^about /,'only about ')}.`);
      if(chosen.dora<best.dora) lines.push(`${T(chosen.k)} is a dora — keeping it is worth more than the small gain.`);
      if(chosen.yhPairs<best.yhPairs) lines.push(`Discarding ${T(chosen.k)} breaks a yakuhai pair, one of your sources of yaku.`);
    }
  }
  if(dealtIn) lines.push(`This tile dealt in.`);

  // Riichi or damaten — only once the chosen discard actually leaves tenpai
  // with a closed hand that can afford the stick.
  if(chosen.sh===0&&!isOpen(st.melds[seat])&&st.scores[seat]>=1000){
    const w2=waits(chosen.rem,melds,sanma);
    const left=w2.reduce((n,wk)=>{ const i=SUIT_OFF[wk.slice(-1)]+parseInt(wk)-1; return n+Math.max(0,4-vis[i]); },0);
    const waitTxt=w2.length?`Waiting on ${w2.map(T).join('')} (${left} left).`:'';
    if(e.ri){
      notes.push(`Riichi declared. ${waitTxt}`.trim());
    } else if(w2.length){
      const han=bestRonHanNoRiichi(chosen.rem,melds,ctx);
      if(han===0){
        sev=worse(sev,'mistake');
        notes.push(`You stayed silent (damaten) with no yaku, so this hand could only win by tsumo. Declaring riichi would have given it a yaku for ron. ${waitTxt}`.trim());
      } else {
        notes.push(`Damaten — fine here, the hand already has a yaku (${han} han without riichi). ${waitTxt}`.trim());
      }
    }
  }

  const pack=x=>({k:x.k,sh:x.sh,uk:x.uk,ukt:x.ukt,risk:Math.round(x.risk*100)/100});
  const shown=cands.slice(0,4);
  if(!shown.includes(chosen)) shown.push(chosen);
  return {kind:'discard',sev,text:[...lines,...notes].join(' '),chosen:pack(chosen),best:pack(best),
    cands:shown.map(pack),threat:threats.length>0,dealtIn,shAfter:chosen.sh,bestSh};
}

// ── Call decisions (pon/chi taken, or passed) ──────────────────────────────
// Best shanten reachable right after calling: take `use` out of the hand,
// add the meld, then discard the best tile.
function shAfterCall(codes,melds,use,calledCode,type){
  const rem=codes.slice();
  for(const u of use){ const i=rem.indexOf(u); if(i!==-1) rem.splice(i,1); else return null; }
  const meldCount=melds.length+1;
  let best=99;
  const c=countsOf(R.toTiles(rem));
  for(let i=0;i<34;i++){
    if(!c[i]) continue;
    c[i]--; const s=shantenCounts(c,meldCount); c[i]++;
    if(s<best) best=s;
  }
  return {sh:best,rem,meld:{type,tiles:R.toTiles([...use,calledCode])}};
}

function callOptions(codes,calledCode,type){
  const k=R.codeKey(calledCode), v=parseInt(k), s=k.slice(-1);
  const byKey=kk=>codes.filter(c=>R.codeKey(c)===kk);
  if(type==='pon'){
    const m=byKey(k);
    // Prefer giving up plain fives over the red one.
    m.sort((a,b)=>(a[0]==='0')-(b[0]==='0'));
    return m.length>=2?[m.slice(0,2)]:[];
  }
  if(type!=='chi'||s==='z') return [];
  const out=[];
  for(const [a,b] of [[v-2,v-1],[v-1,v+1],[v+1,v+2]]){
    if(a<1||b>9) continue;
    const ca=byKey(`${a}${s}`)[0], cb=byKey(`${b}${s}`)[0];
    if(ca&&cb) out.push([ca,cb]);
  }
  return out;
}

function analyzeCall(st,e,round,rules,names,offer){
  const seat=e.s;
  const codes=st.hands[seat];
  const melds=st.melds[seat];
  const before=shantenCounts(countsOf(R.toTiles(codes)),melds.length);
  const ctx=botCtx(st,seat,round,rules);
  const firstOpen=!isOpen(melds);
  const yakuOK=r=>!firstOpen||B.openYakuPossible(R.toTiles(r.rem),[...melds.map(meldTiles),r.meld],ctx);
  const label={pon:'Pon',chi:'Chi',mk:'Kan'};

  if(e.t==='pass'){
    if(e.o.includes('ron')){
      return {kind:'pass',sev:'blunder',
        text:`You passed on a Ron off ${names[offer.s]}'s ${T(offer.k)} — a win left on the table, and passing also puts you in furiten until your next draw.`};
    }
    // Only flag a pass when calling clearly helped: it advanced the hand
    // and the open hand would still have a yaku. Calling is a style choice,
    // so this is a tip, never a mistake.
    let bestOpt=null;
    for(const type of ['pon','chi']){
      if(!e.o.includes(type)) continue;
      for(const use of callOptions(codes,offer.k,type)){
        const r=shAfterCall(codes,melds,use,offer.k,type);
        if(r&&r.sh<before&&yakuOK(r)&&(!bestOpt||r.sh<bestOpt.sh)) bestOpt={...r,type,use};
      }
    }
    if(!bestOpt) return null;
    const yh=B.yakuhaiSet(ctx).has(R.codeKey(offer.k))&&bestOpt.type==='pon';
    if(!yh&&before>2) return null;
    return {kind:'pass',sev:'tip',
      text:`Calling ${label[bestOpt.type]} on ${T(offer.k)} would have taken you from ${shName(before)} to ${shName(bestOpt.sh)}${yh?' and locked in a yakuhai yaku':''}. Passing to stay closed is also reasonable.`};
  }

  // A call that was made.
  if(e.t==='mk') return null;
  const r=shAfterCall(codes,melds,e.u,e.k,e.t);
  if(!r) return null;
  if(firstOpen&&!yakuOK(r)){
    return {kind:'call',sev:'mistake',
      text:`This ${label[e.t]} opens your hand with no realistic yaku left — an open hand can reach tenpai but can't win without one, and riichi is no longer possible.`};
  }
  if(r.sh>=before&&before>0){
    return {kind:'call',sev:'inaccuracy',
      text:`This ${label[e.t]} didn't bring you closer to tenpai (${shName(before)} either way) and gave up your closed hand.`};
  }
  return {kind:'call',sev:'good',text:`Good call — ${label[e.t]} takes you from ${shName(before)} to ${shName(r.sh)}.`};
}

// ── Whole game ─────────────────────────────────────────────────────────────
// Returns {version, seat, rounds:[{decisions, summary}], summary}.
// `decisions[i].i` is the index (in that round's `ev`) of the event the
// decision was made at — the client's viewer keys its review panel on it.
function analyzeGame(replay,seat,playerNames){
  const rules=replay.rules||{};
  const names=(playerNames||[]).map((n,i)=>i===seat?'your':n||`Seat ${i+1}`);
  const outRounds=[];
  const tally={best:0,good:0,tip:0,inaccuracy:0,mistake:0,blunder:0};
  let graded=0,wins=0,dealIns=0,riichis=0,calls=0,tenpaiRounds=0,winPts=0,dealInPts=0;
  const moments=[];

  replay.rounds.forEach((round,ri)=>{
    const st=R.initialState(round);
    const decisions=[];
    let lastOffer=null,firstTenpai=null,ownDiscards=0,rRiichi=false,rCalls=0;
    round.ev.forEach((e,i)=>{
      let d=null;
      try{
        if(e.s===seat){
          if(e.t==='x'){
            d=analyzeDiscard(st,e,round,rules,names,round.ev[i+1]);
            ownDiscards++;
            if(d&&d.shAfter===0&&firstTenpai===null) firstTenpai=ownDiscards;
            if(e.ri) rRiichi=true;
          } else if(e.t==='pass'&&lastOffer){
            d=analyzeCall(st,e,round,rules,names,lastOffer);
          } else if(e.t==='pon'||e.t==='chi'||e.t==='mk'){
            d=analyzeCall(st,e,round,rules,names,lastOffer);
            rCalls++;
          }
        }
      }catch(err){ d=null; console.error('[analysis error]',err.message); }
      if(d){ d.i=i; decisions.push(d); }
      if(e.t==='x'||e.t==='kk'||e.t==='kita') lastOffer={s:e.s,k:e.k};
      R.applyEvent(st,e);
    });

    // How the round went for this seat.
    const res=round.res||{};
    const start=round.scores||[];
    const end=res.scores||st.scores;
    const delta=(end[seat]??0)-(start[seat]??0);
    let outcome='draw';
    const won=(res.winners||[]).find(w=>w.s===seat);
    if(won) outcome=res.reason==='tsumo'?'tsumo':'ron';
    else if(res.reason==='ron'&&res.loser===seat) outcome='dealin';
    else if(res.reason==='tsumo') outcome='tsumoed';
    else if(res.reason==='ron') outcome='otherwin';
    else if(res.reason==='draw') outcome=res.tenpai&&res.tenpai[seat]?'tenpai':'noten';
    else outcome=res.reason||'draw';

    const counts={best:0,good:0,tip:0,inaccuracy:0,mistake:0,blunder:0};
    for(const d of decisions){
      counts[d.sev]++; tally[d.sev]++;
      if(d.kind==='discard'&&d.cands&&d.cands.length) graded++;
      if(SEV_RANK[d.sev]>=3) moments.push({r:ri,i:d.i,type:d.sev,text:d.text});
    }
    if(won){ wins++; winPts+=Math.max(0,delta); moments.push({r:ri,i:round.ev.length-1,type:'win',delta}); }
    if(outcome==='dealin'){ dealIns++; dealInPts+=Math.max(0,-delta); moments.push({r:ri,i:round.ev.length-1,type:'dealin',delta}); }
    if(rRiichi) riichis++;
    calls+=rCalls;
    if(firstTenpai!==null) tenpaiRounds++;
    outRounds.push({decisions,summary:{outcome,delta,tenpaiAt:firstTenpai,riichi:rRiichi,calls:rCalls,counts}});
  });

  const goodMoves=tally.best+tally.good;
  const gradedMoves=goodMoves+tally.inaccuracy+tally.mistake+tally.blunder;
  // A single 0-100 headline number: start from the share of good-or-best
  // moves, then charge extra for the costly ones so two games with the same
  // hit rate but different blunder counts don't score the same.
  const rating=gradedMoves?Math.max(0,Math.round(100*goodMoves/gradedMoves-2*tally.mistake-5*tally.blunder)):null;
  return {version:ANALYSIS_VERSION,seat,rounds:outRounds,summary:{
    rounds:replay.rounds.length,decisions:gradedMoves,graded,tally,
    accuracy:gradedMoves?Math.round(100*goodMoves/gradedMoves):null,
    bestRate:gradedMoves?Math.round(100*tally.best/gradedMoves):null,
    rating,wins,dealIns,riichis,calls,tenpaiRounds,
    avgWin:wins?Math.round(winPts/wins):0,avgDealIn:dealIns?Math.round(dealInPts/dealIns):0,
    moments,
  }};
}

module.exports={ANALYSIS_VERSION,analyzeGame};
