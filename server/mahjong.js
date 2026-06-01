'use strict';

const SUITS = ['m','p','s'];

function buildWall() {
  const tiles = []; let id = 0;
  for (const s of SUITS) for (let v=1;v<=9;v++) for (let c=0;c<4;c++) tiles.push({s,v,id:id++});
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

// Full hand decomposition — returns array of group-arrays or []
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

  // pair (only when remaining tiles mod 3 == 2)
  if(rem%3===2 && counts[k]>=2){
    counts[k]-=2; _dec(counts,[...groups,{t:'pair',k:[k,k]}],results,total); counts[k]+=2;
  }
  // triplet
  if(counts[k]>=3){
    counts[k]-=3; _dec(counts,[...groups,{t:'tri',k:[k,k,k]}],results,total); counts[k]+=3;
  }
  // sequence
  if(suit!=='z'){
    const k2=`${val+1}${suit}`,k3=`${val+2}${suit}`;
    if(counts[k2]>0&&counts[k3]>0){
      counts[k]--;counts[k2]--;counts[k3]--;
      _dec(counts,[...groups,{t:'seq',k:[k,k2,k3]}],results,total);
      counts[k]++;counts[k2]++;counts[k3]++;
    }
  }
}

function isChiitoitsu(hand){
  if(hand.length!==14) return false;
  const c={}; for(const t of hand){c[key(t)]=(c[key(t)]||0)+1;}
  return Object.keys(c).length===7 && Object.values(c).every(v=>v===2);
}

function isKokushi(hand){
  if(hand.length!==14) return false;
  const terms=['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'];
  const keys=hand.map(key);
  return terms.every(t=>keys.includes(t)) && terms.some(t=>keys.filter(k=>k===t).length>=2);
}

function isWin(hand){
  if(hand.length!==14) return false;
  if(isKokushi(hand)||isChiitoitsu(hand)) return true;
  return decompose(hand).length>0;
}

function waits(hand13){
  const w=[];
  for(const s of['m','p','s','z']){
    const max=s==='z'?7:9;
    for(let v=1;v<=max;v++){
      if(isWin([...hand13,{s,v,id:99999}])) w.push(`${v}${s}`);
    }
  }
  return w;
}

function canPon(hand,disc){ return hand.filter(t=>key(t)===key(disc)).length>=2; }
function canKan(hand,disc){ return hand.filter(t=>key(t)===key(disc)).length>=3; }
function canChi(hand,disc){
  if(disc.s==='z') return [];
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

// ── Yaku detection ──────────────────────────────────────────────────────────
const TERMINALS = new Set(['1m','9m','1p','9p','1s','9s']);
const HONORS    = new Set(['1z','2z','3z','4z','5z','6z','7z']);
const DRAGONS   = new Set(['5z','6z','7z']);

function isTermOrHon(k){ return TERMINALS.has(k)||HONORS.has(k); }
function isSimple(k){ return !isTermOrHon(k); }
function getSuit(k){ return k.slice(-1); }
function getVal(k){ return parseInt(k); }

function detectYaku(hand14, melds, isTsumo, seatWind, roundWind, isRiichi, isIppatsu){
  const open=melds.length>0;
  const menzen=!open;
  const allKeys=hand14.map(key);

  // Yakuman checks first
  if(menzen && isKokushi(hand14)) return {han:13,yakuList:[{name:'Kokushi Musou',jp:'国士無双',han:13}],yakuman:true};
  if(allKeys.every(k=>HONORS.has(k)))  return {han:13,yakuList:[{name:'Tsuuiisou',jp:'字一色',han:13}],yakuman:true};
  if(allKeys.every(k=>TERMINALS.has(k))) return {han:13,yakuList:[{name:'Chinroutou',jp:'清老頭',han:13}],yakuman:true};

  // Chiitoitsu
  if(menzen && isChiitoitsu(hand14)){
    const yl=[{name:'Chiitoitsu',jp:'七対子',han:2}];
    let h=2;
    if(isRiichi){yl.push({name:'Riichi',jp:'リーチ',han:1});h++;}
    if(isIppatsu){yl.push({name:'Ippatsu',jp:'一発',han:1});h++;}
    return {han:h,yakuList:yl};
  }

  const decomps=decompose(hand14);
  if(!decomps.length) return {han:0,yakuList:[]};

  let best={han:0,yakuList:[]};
  for(const groups of decomps){
    const r=evalDecomp(groups,hand14,melds,isTsumo,seatWind,roundWind,isRiichi,isIppatsu,menzen);
    if(r.han>best.han) best=r;
  }
  return best;
}

function evalDecomp(groups,hand14,melds,isTsumo,seatWind,roundWind,isRiichi,isIppatsu,menzen){
  const yl=[]; let han=0;
  const allKeys=hand14.map(key);
  const open=melds.length>0;
  const allGroups=[...groups,...melds.map(m=>({t:m.type==='pon'?'tri':'seq',k:m.tiles.map(key),open:true}))];
  const pairs=groups.filter(g=>g.t==='pair');
  const seqs=groups.filter(g=>g.t==='seq');
  const tris=allGroups.filter(g=>g.t==='tri');
  const closedTris=groups.filter(g=>g.t==='tri');
  const pairKey=pairs[0]?.k[0];

  if(isRiichi&&menzen){yl.push({name:'Riichi',jp:'リーチ',han:1});han++;}
  if(isIppatsu&&menzen){yl.push({name:'Ippatsu',jp:'一発',han:1});han++;}
  if(isTsumo&&menzen){yl.push({name:'Menzen Tsumo',jp:'門前清自摸和',han:1});han++;}

  // Tanyao
  if(allKeys.every(isSimple)&&melds.every(m=>m.tiles.every(t=>isSimple(key(t))))){
    yl.push({name:'Tanyao',jp:'断么九',han:1});han++;
  }

  // Pinfu
  if(menzen&&seqs.length===4&&pairKey&&!DRAGONS.has(pairKey)&&!HONORS.has(pairKey)){
    yl.push({name:'Pinfu',jp:'平和',han:1});han++;
  }

  // Iipeiko
  if(menzen&&seqs.length>=2){
    const ss=seqs.map(g=>g.k.join());
    if(new Set(ss).size<ss.length){yl.push({name:'Iipeiko',jp:'一盃口',han:1});han++;}
  }

  // Yakuhai
  for(const g of tris){
    const k=g.k[0];
    if(DRAGONS.has(k)){const nm={5:'Haku',6:'Hatsu',7:'Chun'}[getVal(k)];yl.push({name:nm,jp:{5:'白',6:'發',7:'中'}[getVal(k)],han:1});han++;}
    if(k===`${seatWind}z`){yl.push({name:'Seat Wind',jp:'自風',han:1});han++;}
    if(k===`${roundWind}z`&&seatWind!==roundWind){yl.push({name:'Round Wind',jp:'場風',han:1});han++;}
  }

  // Sanshoku Doujun
  if(seqs.length>=3){
    const byVal={};
    for(const g of seqs){const v=g.k[0];if(!byVal[v])byVal[v]=new Set();byVal[v].add(getSuit(g.k[0]));}
    for(const suits of Object.values(byVal)){
      if(suits.has('m')&&suits.has('p')&&suits.has('s')){const h=menzen?2:1;yl.push({name:'Sanshoku Doujun',jp:'三色同順',han:h});han+=h;break;}
    }
  }

  // Ittsu
  for(const suit of['m','p','s']){
    const vs=seqs.filter(g=>getSuit(g.k[0])===suit).map(g=>getVal(g.k[0]));
    if(vs.includes(1)&&vs.includes(4)&&vs.includes(7)){const h=menzen?2:1;yl.push({name:'Ittsu',jp:'一気通貫',han:h});han+=h;break;}
  }

  // Toitoi
  if(tris.length===4){yl.push({name:'Toitoi',jp:'対々和',han:2});han+=2;}

  // San Ankou
  if(closedTris.length>=3){yl.push({name:'San Ankou',jp:'三暗刻',han:2});han+=2;}

  // Suu Ankou (Yakuman)
  if(menzen&&closedTris.length===4) return {han:13,yakuList:[{name:'Suu Ankou',jp:'四暗刻',han:13}],yakuman:true};

  // Honitsu
  const suits=new Set(allKeys.filter(k=>!HONORS.has(k)).map(getSuit));
  if(suits.size===1&&allKeys.some(k=>HONORS.has(k))){const h=menzen?3:2;yl.push({name:'Honitsu',jp:'混一色',han:h});han+=h;}

  // Chinitsu
  if(suits.size===1&&!allKeys.some(k=>HONORS.has(k))){const h=menzen?6:5;yl.push({name:'Chinitsu',jp:'清一色',han:h});han+=h;}

  // Daisangen (Yakuman)
  if(tris.filter(g=>DRAGONS.has(g.k[0])).length===3) return {han:13,yakuList:[{name:'Daisangen',jp:'大三元',han:13}],yakuman:true};

  if(han===0) return {han:0,yakuList:[]};
  return {han,yakuList:yl};
}

function countDora(hand,doraIndicators){
  let n=0;
  for(const ind of doraIndicators){
    let dv=ind.v+1;
    if(ind.s==='z') dv=dv>7?1:dv; else dv=dv>9?1:dv;
    n+=hand.filter(t=>t.s===ind.s&&t.v===dv).length;
  }
  return n;
}

function calcFu(groups,isTsumo,menzen){
  let fu=isTsumo?20:menzen?30:30;
  for(const g of groups){
    if(g.t==='tri'){const k=g.k[0];fu+=isTermOrHon(k)?8:4;}
    if(g.t==='pair'){const k=g.k[0];if(DRAGONS.has(k)||HONORS.has(k))fu+=2;}
  }
  if(isTsumo) fu+=2;
  return Math.ceil(fu/10)*10;
}

function basePoints(han,fu){
  if(han>=13) return 8000;
  if(han>=11) return 6000;
  if(han>=8)  return 4000;
  if(han>=6)  return 3000;
  if(han>=5)  return 2000;
  return Math.min(fu*Math.pow(2,han+2),2000);
}

function handLabel(han){
  if(han>=13) return 'Yakuman 役満';
  if(han>=11) return 'Sanbaiman 三倍満';
  if(han>=8)  return 'Baiman 倍満';
  if(han>=6)  return 'Haneman 跳満';
  if(han>=5)  return 'Mangan 満貫';
  return `${han} Han`;
}

module.exports = {buildWall,shuffle,sort,key,isWin,waits,canPon,canKan,canChi,
  detectYaku,countDora,calcFu,basePoints,handLabel,decompose};
