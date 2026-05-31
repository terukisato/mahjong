'use strict';
const {key,isWin,waits,canPon,canChi} = require('./mahjong');

const BOT_NAMES=['Sakura AI','Yuki Bot','Hana CPU','Ryu AI','Kaze Bot','Tsuki AI','Hoshi CPU','Umi Bot'];
let _bi=0;
function botName(){ return BOT_NAMES[_bi++%BOT_NAMES.length]; }

function handScore(hand13){
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

function bestDiscard(hand14){
  let bestId=null,bestScore=-Infinity;
  for(let i=0;i<hand14.length;i++){
    const rem=hand14.filter((_,j)=>j!==i);
    const s=handScore(rem);
    if(s>bestScore){bestScore=s;bestId=hand14[i].id;}
  }
  return bestId;
}

function botReact(hand,disc,options){
  if(options.some(o=>o.type==='ron')) return {type:'ron'};
  const inTenpai=waits(hand).length>0;
  if(!inTenpai&&options.some(o=>o.type==='pon')){
    const matches=hand.filter(t=>key(t)===key(disc));
    const after=hand.filter(t=>!matches.slice(0,2).map(m=>m.id).includes(t.id));
    if(handScore(after)>handScore(hand)-20) return {type:'pon'};
  }
  if(!inTenpai&&options.some(o=>o.type==='chi')){
    const chi=options.find(o=>o.type==='chi');
    const after=hand.filter(t=>!chi.sequences[0].includes(t.id));
    if(handScore(after)>handScore(hand)-15) return {type:'chi',tileIds:chi.sequences[0]};
  }
  return {type:'pass'};
}

module.exports={botName,bestDiscard,botReact};
