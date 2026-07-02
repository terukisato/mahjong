// SVG TILE RENDERER
// Draws each tile (man/pin/sou/honours) as inline SVG
// Pixel-faithful recreation of authentic Japanese riichi mahjong tiles.

function tsvg(t,w,h){
  if(!t) return '';
  const s=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  const e='</svg>';
  const red=!!t.red;
  if(t.s==='m') return s+svgMan(t.v,w,h,red)+e;
  if(t.s==='p') return s+svgPin(t.v,w,h,red)+e;
  if(t.s==='s') return s+svgSou(t.v,w,h,red)+e;
  if(t.s==='z') return s+svgHon(t.v,w,h)+e;
  return '';
}

// MAN (マンズ) — Characters
// Numeral: black by default, red only for aka dora (red:true)
// 萬: always red
const MAN_K=['','一','二','三','四','伍','六','七','八','九'];
function svgMan(v,w,h,red=false){
  const fs=Math.round(h*.36);
  const numColor=red?'#c82020':'#1a1a1a';
  return (
    `<text x="${w*.5}" y="${h*.30}" text-anchor="middle" dominant-baseline="central" `+
    `font-family="'Yuji Syuku',serif" font-size="${fs}px" font-weight="400" fill="${numColor}">`+
    MAN_K[v]+`</text>`+
    `<text x="${w*.5}" y="${h*.70}" text-anchor="middle" dominant-baseline="central" `+
    `font-family="'Yuji Syuku',serif" font-size="${fs}px" font-weight="400" fill="#c82020">萬</text>`
  );
}

// PIN (ピンズ) — Circles
// From image: thick dark navy outer ring, white gap, thinner inner ring, white centre with flower
// 1-pin: large decorative circle (bigger rings, inner flower)
// 5-pin: red circles instead of navy
// PIN (ピンズ) — Circles with flower/petal design from image
// Each circle: outer ring, 6-petal inner ring, small centre dot
// Colours: 1=red outer+blue inner, 2-4=blue, 5=red, 6-9=blue with red accent
function svgPin(v,w,h,red=false){
  const pos=pinPos(v,w,h);
  const base=Math.min(w,h);
  const rMap={1:.30,2:.22,3:.20,4:.17,5:.155,6:.14,7:.128,8:.118,9:.110};
  const r=base*(rMap[v]||.11);
  const isRed=(v===5);
  const hasRedOuter=false;
  const hasRedInner=(v===1);
  const circles=pos.map(([cx,cy,forceRed])=>pinCircle(cx,cy,r,isRed,hasRedOuter,hasRedInner,forceRed)).join('');
  // Red corner marker for aka dora
  const marker=red?`<circle cx="${w*.18}" cy="${h*.15}" r="${base*.07}" fill="#c82020" opacity="0.9"/>`:'' ;
  return circles+marker;
}

function pinCircle(cx,cy,r,isRed,hasRedOuter,hasRedInner,forceRedInner){
  const ringCol=(isRed||hasRedInner||forceRedInner)?'#c82020':'#1a3a8a';
  const outerCol=hasRedOuter?'#c82020':'#1a3a8a';
  const outerSW=Math.max(1.2,r*.25);
  const petalR=r*.60;
  const petalCount=6;
  let petals='';
  for(let i=0;i<petalCount;i++){
    const angle=(i/petalCount)*Math.PI*2 - Math.PI/2;
    const px=cx+Math.cos(angle)*petalR*.52;
    const py=cy+Math.sin(angle)*petalR*.52;
    const pr=petalR*.38;
    petals+=`<circle cx="${px}" cy="${py}" r="${pr}" fill="${ringCol}" opacity="0.85"/>`;
  }
  return (
    // White background
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/>`+
    // Outer ring
    `<circle cx="${cx}" cy="${cy}" r="${r-outerSW*.5}" fill="none" stroke="${outerCol}" stroke-width="${outerSW}"/>`+
    // Petal circles
    petals+
    // Centre dot
    `<circle cx="${cx}" cy="${cy}" r="${r*.18}" fill="${ringCol}"/>`+
    // White centre hole
    `<circle cx="${cx}" cy="${cy}" r="${r*.10}" fill="#ffffff"/>`
  );
}

function pinPos(v,w,h){
  const pw=w*.84, ph=h*.88;
  const ox=(w-pw)/2, oy=(h-ph)/2;
  const cx=w/2, cy=h/2;

  function col1(n){
    if(n===1) return [[cx,cy]];
    const step=ph/(n+0.4);
    return Array.from({length:n},(_,i)=>([cx, oy+step*(i+0.7)]));
  }
  function col2(nL,nR){
    const lx=ox+pw*.27, rx=ox+pw*.73;
    const stepL=ph/(nL+0.4), stepR=ph/(nR+0.4);
    const L=Array.from({length:nL},(_,i)=>([lx,oy+stepL*(i+0.7)]));
    const R=Array.from({length:nR},(_,i)=>([rx,oy+stepR*(i+0.7)]));
    return [...L,...R];
  }
  function col3(n){
    const lx=ox+pw*.17, mx=cx, rx=ox+pw*.83;
    const step=ph/(n+0.4);
    const pts=[];
    for(let i=0;i<n;i++) for(const x of[lx,mx,rx]) pts.push([x,oy+step*(i+0.7)]);
    return pts;
  }

  if(v===1) return [[cx,cy]];
  if(v===2) return col1(2);
  if(v===3){
    // Diagonal: top-left, centre (red), bottom-right
    const r3=Math.min(w,h)*.20;
    const off=Math.min(pw,ph)*.26;
    return [[cx-off,cy-off,false],[cx,cy,true],[cx+off,cy+off,false]];
  }
  if(v===4) return col2(2,2);
  if(v===5){ const g=col2(2,2); g.push([cx,cy]); return g; }
  if(v===6) return col2(3,3);
  if(v===7){
    const lx=ox+pw*.27, rx=ox+pw*.73;
    const L=Array.from({length:3},(_,i)=>([lx,oy+ph/(3+.4)*(i+.7)]));
    const R=Array.from({length:4},(_,i)=>([rx,oy+ph/(4+.4)*(i+.7)]));
    return [...L,...R];
  }
  if(v===8) return col2(4,4);
  if(v===9) return col3(3);
  return [];
}

// SOU (ソウズ) — Bamboo hourglass/bobbin sticks
// From image: wider top+bottom, narrow waist — like a bobbin/spool
// Green with red band at waist. 5-sou centre = red.
// 1-sou: kiwi bird
function souBird(w,h){
  const cx=w/2, cy=h/2;
  // Large round body — dominates tile
  const bx=cx*0.82, by=cy*0.92, br=Math.min(w,h)*0.342;
  // Small head — tucked right
  const hx=bx+br*0.82, hy=by-br*0.28, hr=br*0.38;
  // Beak tip
  const beakX1=hx+hr*0.72, beakY1=hy+hr*0.14;
  const beakX2=hx+hr*1.38, beakY2=hy+hr*1.38;
  const beakW=hr*0.18;
  // Back leg
  const lbx=bx-br*0.28, lby=by+br*0.82;
  // Front leg
  const lfx=bx+br*0.12, lfy=by+br*0.82;

  const clipId=`kb${Math.floor(Math.random()*9999)}`;

  return [
    `<clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath>`,
    // Body
    `<circle cx="${bx}" cy="${by}" r="${br}" fill="#1c7530" clip-path="url(#${clipId})"/>`,
    // Highlight
    `<ellipse cx="${bx+br*0.3}" cy="${by-br*0.42}" rx="${br*0.42}" ry="${br*0.28}" fill="#2db848" opacity="0.3" transform="rotate(15,${bx+br*0.3},${by-br*0.42})"/>`,
    // Head
    `<circle cx="${hx}" cy="${hy}" r="${hr}" fill="#1c7530"/>`,
    // Eye
    `<circle cx="${hx+hr*0.38}" cy="${hy-hr*0.28}" r="${hr*0.23}" fill="#111"/>`,
    `<circle cx="${hx+hr*0.42}" cy="${hy-hr*0.31}" r="${hr*0.08}" fill="#fff" opacity="0.8"/>`,
    // Beak — long thin, angling down
    `<path d="M${beakX1},${beakY1} L${beakX2},${beakY2} L${beakX2-beakW},${beakY2+beakW*0.5} L${beakX1-beakW*0.3},${beakY1+beakW*0.5} Z" fill="#c8a020" clip-path="url(#${clipId})"/>`,
    `<path d="M${beakX1},${beakY1} L${beakX2},${beakY2} L${beakX2-beakW*0.2},${beakY2} L${beakX1-beakW*0.1},${beakY1} Z" fill="#e8d060" opacity="0.4" clip-path="url(#${clipId})"/>`,
    // Back leg
    `<rect x="${lbx-w*.04}" y="${lby}" width="${w*.07}" height="${h*.12}" rx="${w*.03}" fill="#0e4018" opacity="0.55"/>`,
    `<path d="M${lbx},${lby+h*.12} L${lbx+w*.14},${lby+h*.13} L${lbx+w*.14},${lby+h*.16} L${lbx-w*.01},${lby+h*.15} Z" fill="#0e4018" opacity="0.5"/>`,
    `<path d="M${lbx},${lby+h*.12} L${lbx+w*.13},${lby+h*.10} L${lbx+w*.14},${lby+h*.13} L${lbx},${lby+h*.14} Z" fill="#0e4018" opacity="0.45"/>`,
    `<path d="M${lbx},${lby+h*.12} L${lbx+w*.13},${lby+h*.15} L${lbx+w*.12},${lby+h*.18} L${lbx-w*.01},${lby+h*.15} Z" fill="#0e4018" opacity="0.4"/>`,
    // Front leg
    `<path d="M${lfx},${lfy} L${lfx+w*.06},${lfy+h*.10} L${lfx+w*.10},${lfy+h*.09} L${lfx+w*.04},${lfy-h*.01} Z" fill="#c82020"/>`,
    `<path d="M${lfx+w*.06},${lfy+h*.10} L${lfx+w*.20},${lfy+h*.11} L${lfx+w*.20},${lfy+h*.14} L${lfx+w*.05},${lfy+h*.13} Z" fill="#c82020"/>`,
    `<path d="M${lfx+w*.06},${lfy+h*.10} L${lfx+w*.19},${lfy+h*.08} L${lfx+w*.20},${lfy+h*.11} L${lfx+w*.07},${lfy+h*.12} Z" fill="#c82020"/>`,
    `<path d="M${lfx+w*.06},${lfy+h*.10} L${lfx+w*.19},${lfy+h*.13} L${lfx+w*.18},${lfy+h*.16} L${lfx+w*.05},${lfy+h*.13} Z" fill="#c82020"/>`,
  ].join('');
}

function svgSou(v,w,h,red=false){
  const base=Math.min(w,h);
  const sticks=(v===1)?souBird(w,h):souLayout(v,w,h).map(([cx,cy,sw,sh,isRed])=>souStick(cx,cy,sw,sh,isRed)).join('');
  // Red corner marker for aka dora
  const marker=red?`<circle cx="${w*.18}" cy="${h*.15}" r="${base*.07}" fill="#c82020" opacity="0.9"/>`:'' ;
  return sticks+marker;
}

function souStick(cx,cy,sw,sh,isRed){
  const x=cx-sw/2, y=cy-sh/2;
  const capH=sh*.22;   // top/bottom cap height
  const waistW=sw*.62; // narrow waist width
  const waistY=y+capH;
  const waistH=sh-capH*2;
  const bandH=Math.max(1.5,sh*.10);
  const bandY=cy-bandH/2;
  const fill=isRed?'#c82020':'#1c7530';
  const stroke=isRed?'#8a1010':'#0e4018';
  const hlCol=isRed?'#e86060':'#2db848';

  // Hourglass shape via path: wide top cap, narrow waist, wide bottom cap
  const tw=sw/2, ww=waistW/2;
  const path=`M${cx-tw},${y} Q${cx-tw},${waistY} ${cx-ww},${waistY} L${cx-ww},${waistY+waistH} Q${cx-tw},${waistY+waistH} ${cx-tw},${y+sh} L${cx+tw},${y+sh} Q${cx+tw},${waistY+waistH} ${cx+ww},${waistY+waistH} L${cx+ww},${waistY} Q${cx+tw},${waistY} ${cx+tw},${y} Z`;

  return (
    `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>`+
    // Highlight on top cap
    `<rect x="${cx-sw*.28}" y="${y+sh*.04}" width="${sw*.22}" height="${capH*.55}" rx="${sw*.08}" fill="${hlCol}" opacity="0.5"/>`+
    // Red centre band
    (!isRed?`<rect x="${cx-ww}" y="${bandY}" width="${waistW}" height="${bandH}" fill="#c82020"/>`:'')
  );
}

function souLayout(v,w,h){
  const pad=w*.07;
  const uw=w-pad*2, uh=h-pad*2;
  const midX=w/2;
  const out=[];

  // GAP_RATIO: fraction of slot height that is empty gap between sticks
  const GAP=0.28;

  function placeCol(x, n, sw, startY, totalH){
    // Divide totalH into n equal slots, place stick in centre of each slot with gap
    const slot=totalH/n;
    const sh=slot*(1-GAP);
    for(let i=0;i<n;i++){
      const cy=startY+slot*(i+0.5);
      out.push([x, cy, sw, sh, false]);
    }
  }

  function col1(n){
    const sw=uw*.40;
    placeCol(midX, n, sw, pad, uh);
  }

  function col2(nL,nR,redCentre=false){
    const sw=uw*.22;
    const lx=midX-uw*.25, rx=midX+uw*.25;
    placeCol(lx, nL, sw, pad, uh);
    placeCol(rx, nR, sw, pad, uh);
    if(redCentre){
      // Red centre stick: fits in the middle gap of the 2-col layout
      const slot=uh/nL;
      const sh=slot*(1-GAP);
      out.push([midX, h/2, sw, sh, true]);
    }
  }

  function col3(n){
    const sw=uw*.16;
    const xs=[midX-uw*.28, midX, midX+uw*.28];
    for(const x of xs) placeCol(x, n, sw, pad, uh);
  }

  if(v===2) col1(2);
  else if(v===3) col1(3);
  else if(v===4) col2(2,2);
  else if(v===5) col2(2,2,true);
  else if(v===6) col2(3,3);
  else if(v===7) col2(3,4);
  else if(v===8){
    // 8-sou: 2 cols × 4 rows, tighter gap so hourglasses form W on top, M on bottom
    const sw=uw*.22;
    const lx=midX-uw*.25, rx=midX+uw*.25;
    const n=4;
    const slot=uh/n;
    const sh=slot*.88; // very small gap — sticks nearly touch so W/M emerges from hourglass waists
    for(let i=0;i<n;i++){
      const cy=pad+slot*(i+0.5);
      out.push([lx, cy, sw, sh, false]);
      out.push([rx, cy, sw, sh, false]);
    }
  }
  else if(v===9) col3(3);
  return out;
}

// HONOURS (字牌)
// Winds (東南西北): large near-black kanji, fills ~55% height
// Haku (白): plain white fill — no markings
// Hatsu (發): green kanji
// Chun (中): red kanji
function svgHon(v,w,h){
  if(v===5){
    return '';
  }
  const fs=Math.round(h*.52);
  const scaleY=1.45; // vertical stretch factor
  const COLORS={1:'#1a1a1a',2:'#1a1a1a',3:'#1a1a1a',4:'#1a1a1a',6:'#1a7a30',7:'#c82020'};
  const CHARS ={1:'東',2:'南',3:'西',4:'北',6:'發',7:'中'};
  const cy=h*.56;
  return (
    `<g transform="translate(${w*.5},${cy}) scale(1,${scaleY}) translate(-${w*.5},-${cy})">`+
    `<text x="${w*.5}" y="${cy}" text-anchor="middle" dominant-baseline="middle" `+
    `font-family="'Yuji Syuku',serif" font-size="${fs}px" font-weight="400" fill="${COLORS[v]}">${CHARS[v]}</text>`+
    `</g>`
  );
}

// APP STATE
const W=['東','南','西','北'];
// Position IDs indexed by (absSeat - mySeat + 4) % 4
// 0=bottom(me), 1=right, 2=top, 3=left
const P=['b','r','t','l'];

let ws=null, mySeat=-1, inGame=false, selId=null, lastState=null, isReady=false, discarding=false, pendingGameOver=null;

function show(id){['s-start','s-lobby','s-game','s-end'].forEach(s=>$(s).classList.toggle('hidden',s!==id));}
function $(id){return document.getElementById(id);}


// WEBSOCKET — connection + message dispatch
function connect(){
  if(!location.host){
    console.warn('No server host — open via http://localhost:3000');
    return;
  }
  const url=(location.protocol==='https:'?'wss':'ws')+'://'+location.host;
  try{ ws=new WebSocket(url); } catch(e){ setTimeout(connect,3000); return; }
  ws.onopen=()=>{};
  ws.onmessage=e=>{try{onMsg(JSON.parse(e.data));}catch(ex){console.error(ex);}};
  ws.onclose=()=>{setTimeout(connect,2000);};
  ws.onerror=()=>{try{ws.close();}catch{}};
}
function wss(d){if(ws&&ws.readyState===1)ws.send(JSON.stringify(d));}

function onMsg(m){
  if(m.type==='hello') return;
  if(m.type==='joined'){mySeat=m.seat;showWaiting();return;}
  if(m.type==='room_update'){updateSlots(m.seats);return;}
  if(m.type==='game_start'){startGame(m);return;}
  if(m.type==='round_start'){onRoundStart(m);return;}
  if(m.type==='round_end'){onEnd(m);return;}
  if(m.type==='game_over'){
    pendingGameOver=m;
    const btn=$('bview-results'); if(btn) btn.style.display='';
    return;
  }
  if(m.type==='ready_status'){onReadyStatus(m);return;}
  if(!inGame) return;
  if(m.type==='game_state'){const prev=lastState;lastState=m;discarding=false;renderState(m,prev);}
  else if(m.type==='riichi'){onRiichi(m);}
  else if(m.type==='kan'){toast(W[(m.seat-mySeat+4)%4]+' カン！');}
  else if(m.type==='chat'){showChatMsg(m.seat,m.name,m.text);}
}


// ════════════════════════════════════════════════════════════
// SETTINGS PANEL
// ════════════════════════════════════════════════════════════
function toggleSettings(){
  const panel=$('settings-panel');
  const backdrop=$('settings-backdrop');
  const open=panel.style.transform==='translateX(0%)';
  panel.style.transform=open?'translateX(100%)':'translateX(0%)';
  backdrop.style.display=open?'none':'block';
}

function toggleAbout(){
  const modal=$('about-modal');
  const backdrop=$('about-backdrop');
  const open=modal.classList.contains('visible');
  modal.classList.toggle('visible',!open);
  backdrop.classList.toggle('visible',!open);
}

// ════════════════════════════════════════════════════════════
// MUSIC
// ════════════════════════════════════════════════════════════
let musicEnabled=true;
let musicVolume=0.35;

function allTracks(){
  return [$('lobby-music'),$('game-music-1')].filter(Boolean);
}

function setVolume(val){
  musicVolume=val/100;
  const lbl=$('vol-label'); if(lbl) lbl.textContent=val+'%';
  allTracks().forEach(t=>{ t.volume=musicVolume; });
  try{ localStorage.setItem('mj-vol',val); }catch(e){}
}

function playLobbyMusic(){
  const m=$('lobby-music');
  if(!m||!musicEnabled) return;
  m.volume=musicVolume;
  m.play().catch(()=>{});
}

function stopLobbyMusic(){
  const m=$('lobby-music');
  if(!m) return;
  m.pause(); m.currentTime=0;
}

function playGameMusic(){
  if(!musicEnabled) return;
  const t1=$('game-music-1');
  if(!t1) return;
  t1.pause(); t1.currentTime=0;
  t1.volume=musicVolume;
  t1.play().catch(()=>{});
}

function stopGameMusic(){
  const t1=$('game-music-1');
  if(t1){ t1.pause(); t1.currentTime=0; }
}

// Voice theme system
const voiceThemes=[
  {id:'Default', label:'Default'},
  {id:'Natsu', label:'Natsu'},
];
let currentVoiceTheme='Default';

const fxFiles=['Pon','Chii','Kan','Riichi','Double_riichi','Ron','Tsumo'];
const fxExts={Pon:'mp3',Chii:'mp3',Kan:'mp3',Riichi:'mp3',Double_riichi:'mp3',Ron:'mp3',Tsumo:'mp3'};

function applyVoiceTheme(themeId){
  currentVoiceTheme=themeId;
  document.querySelectorAll('.theme-btn').forEach(b=>{
    b.style.background=b.dataset.theme===themeId?'rgba(201,168,76,.25)':'rgba(42,58,42,.3)';
    b.style.borderColor=b.dataset.theme===themeId?'var(--gold)':'rgba(201,168,76,.2)';
  });
  try{ localStorage.setItem('mj-voice-theme',themeId); }catch(e){}
}

function renderVoiceThemes(){
  const list=$('voice-theme-list'); if(!list) return;
  list.innerHTML='';
  voiceThemes.forEach(t=>{
    const btn=document.createElement('button');
    btn.className='theme-btn';
    btn.dataset.theme=t.id;
    btn.textContent=t.label;
    btn.style.cssText=`padding:7px 12px;border-radius:4px;font-size:11px;cursor:pointer;
      letter-spacing:1px;transition:all .2s;text-align:left;width:100%;
      background:rgba(42,58,42,.3);border:1px solid rgba(201,168,76,.2);
      color:var(--cream);font-family:'Cinzel Decorative',serif;`;
    btn.onclick=()=>applyVoiceTheme(t.id);
    list.appendChild(btn);
  });
  applyVoiceTheme(currentVoiceTheme);
}

let fxEnabled=true;
let fxVolume=1.6; // default 40% display = 1.6 gain (x4 mapping)
let discardSfxEnabled=true;
let discardSfxVolume=0.6;
let discardGainNode=null;

// Web Audio API context for FX gain boost (allows volume >100%)
let fxAudioCtx=null;
let fxGainNode=null;

function getFxAudioCtx(){
  if(!fxAudioCtx){
    fxAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    fxGainNode=fxAudioCtx.createGain();
    fxGainNode.connect(fxAudioCtx.destination);
    fxGainNode.gain.value=fxVolume;
  }
  return {ctx:fxAudioCtx, gain:fxGainNode};
}

function allFxTracks(){
  return ['sfx-pon','sfx-chii','sfx-kan','sfx-riichi','sfx-double-riichi','sfx-ron','sfx-tsumo'].map(id=>$(id)).filter(Boolean);
}

// Track which audio elements have already been connected to the gain node
// (a MediaElementSource can only be created once per <audio> element)
const _fxConnectedEls = new WeakSet();

function getSeatVoiceTheme(seat){
  // Returns the voice theme for a given absolute seat index.
  // Main player uses their own selected theme; others use their stored theme from game state.
  if(seat===mySeat) return currentVoiceTheme;
  return lastState?.seatVoiceThemes?.[seat]||'Default';
}

function playSfx(id, seat=null){
  if(!fxEnabled) return;
  const el=$(id);
  if(!el) return;
  const fname=id.replace('sfx-','').replace(/-/g,'_');
  const capName=fname.charAt(0).toUpperCase()+fname.slice(1);
  // Determine theme: if seat provided use that seat's theme, else Default
  const theme=seat!==null?getSeatVoiceTheme(seat):'Default';
  const ext=fxExts[capName]||'mp3';
  el.src=`/audio/Voice/${theme}/${capName}.${ext}`;
  try{
    const ctx=getFxAudioCtx().ctx;
    if(!_fxConnectedEls.has(el)){
      const src=ctx.createMediaElementSource(el);
      src.connect(fxGainNode);
      _fxConnectedEls.add(el);
    }
    if(ctx.state==='suspended') ctx.resume();
  }catch(e){}
  el.currentTime=0;
  el.volume=1.0;
  el.play().catch(()=>{});
}

function setFxVolume(val){
  fxVolume=(val/100)*4; // 0-100 slider maps to 0-4.0 gain
  if(fxGainNode) fxGainNode.gain.value=fxVolume;
  const lbl=$('fx-vol-label'); if(lbl) lbl.textContent=val+'%';
  try{ localStorage.setItem('mj-fx-vol',val); }catch(e){}
}

function toggleFx(){
  fxEnabled=!fxEnabled;
  const btn=$('bfx');
  if(fxEnabled){
    if(btn){ btn.textContent='ON'; btn.style.background='rgba(42,158,103,.3)'; btn.style.borderColor='var(--jl)'; }
  } else {
    if(btn){ btn.textContent='OFF'; btn.style.background='rgba(80,0,0,.3)'; btn.style.borderColor='#c82020'; }
  }
  try{ localStorage.setItem('mj-fx',fxEnabled?'1':'0'); }catch(e){}
}

function toggleDiscardSfx(){
  discardSfxEnabled=!discardSfxEnabled;
  const btn=$('bdiscard-sfx');
  if(discardSfxEnabled){
    if(btn){ btn.textContent='ON'; btn.style.background='rgba(42,158,103,.3)'; btn.style.borderColor='var(--jl)'; }
  } else {
    if(btn){ btn.textContent='OFF'; btn.style.background='rgba(80,0,0,.3)'; btn.style.borderColor='#c82020'; }
  }
  try{ localStorage.setItem('mj-discard-sfx',discardSfxEnabled?'1':'0'); }catch(e){}
}

function setDiscardVolume(val){
  discardSfxVolume=(val/100)*2;
  if(discardGainNode) discardGainNode.gain.value=discardSfxVolume;
  const lbl=$('discard-vol-label'); if(lbl) lbl.textContent=val+'%';
  try{ localStorage.setItem('mj-discard-vol',val); }catch(e){}
}

function playDiscardSfx(){
  if(!discardSfxEnabled) return;
  const el=$('sfx-discard');
  if(!el) return;
  try{
    if(!discardGainNode){
      const ctx=getFxAudioCtx().ctx;
      discardGainNode=ctx.createGain();
      discardGainNode.gain.value=discardSfxVolume;
      discardGainNode.connect(ctx.destination);
      const src=ctx.createMediaElementSource(el);
      src.connect(discardGainNode);
    }
    if(getFxAudioCtx().ctx.state==='suspended') getFxAudioCtx().ctx.resume();
  }catch(e){}
  el.currentTime=0;
  el.volume=1.0;
  el.play().catch(()=>{});
}

function toggleMusic(){
  musicEnabled=!musicEnabled;
  const btn=$('bmute');
  if(musicEnabled){
    if(btn){ btn.textContent='ON'; btn.style.background='rgba(42,158,103,.3)'; btn.style.borderColor='var(--jl)'; }
    if(inGame) playGameMusic(); else playLobbyMusic();
  } else {
    stopLobbyMusic(); stopGameMusic();
    if(btn){ btn.textContent='OFF'; btn.style.background='rgba(80,0,0,.3)'; btn.style.borderColor='#c82020'; }
  }
  try{ localStorage.setItem('mj-music',musicEnabled?'1':'0'); }catch(e){}
}

// LOBBY
let gameMode='tonpuu'; // 'tonpuu' or 'hanchan'

function setMode(mode){
  gameMode=mode;
  $('btn-tonpuu').classList.toggle('active', mode==='tonpuu');
  $('btn-hanchan').classList.toggle('active', mode==='hanchan');
}

function findMatch(){
  playLobbyMusic();
  wss({type:'join',name:($('iname').value.trim()||'Player'),gameMode,voiceTheme:currentVoiceTheme});
}

function showWaiting(){
  $('wa').style.display='block';
  $('bfind').style.display='none';
  $('lobby-inputs').style.display='none';
  $('cdiv').textContent='Press Ready when you are set to start';
}

function updateSlots(seats){
  $('wmsg').textContent=`${seats.filter(Boolean).length}/4 players`;
  document.querySelectorAll('.slot').forEach((sl,i)=>{
    const p=seats[i]; sl.innerHTML='';sl.className='slot';
    if(p){
      sl.classList.add('filled');
      if(p.isBot) sl.classList.add('bot');
      if(p.ready) sl.classList.add('rdy');
      const icon=p.isBot?'🤖':p.name[0].toUpperCase();
      const rdyTxt=p.isBot?'<span class="sr" style="color:#4eff9a">✓ BOT</span>':(p.ready?'<span class="sr" style="color:#4eff9a">✓ Ready</span>':'<span class="sr" style="color:rgba(245,237,216,.4)">Not ready</span>');
      sl.innerHTML=`<span class="si">${icon}</span><span class="sn">${p.isBot?p.name.slice(0,8):p.name.slice(0,8)}</span>${rdyTxt}`;
    } else {
      sl.innerHTML='<span class="si">🀄</span>';
    }
  });
}

function pressReady(){
  if(isReady) return;
  isReady=true;
  $('bready').classList.add('pressed');
  $('bready').disabled=true;
  wss({type:'ready'});
}

function resetLobby(){
  mySeat=-1;inGame=false;selId=null;lastState=null;isReady=false;discarding=false;
  $('wa').style.display='none';
  $('bfind').style.display='block';
  $('lobby-inputs').style.display='block';
  $('cdiv').textContent='';
  $('bready').classList.remove('pressed');
  $('bready').disabled=false;
  document.querySelectorAll('.slot').forEach(sl=>{sl.innerHTML='<span class="si">🀄</span>';sl.className='slot';});
  // Hide dora panel and reset chat badge
  $('dora-panel').style.display='none';
  $('chat-bar').style.display='none';
  $('chat-panel').classList.remove('open');
  chatOpen=false;
  unreadCount=0;
  const badge=$('chat-badge');
  badge.textContent='0';
  badge.classList.remove('show');
  show('s-lobby');
}

function goLobby(){
  if(inGame){ showLeaveConfirm(); return; }
  _leaveGame();
}
function showLeaveConfirm(){
  $('leave-modal').classList.add('visible');
  $('leave-backdrop').classList.add('visible');
}
function cancelLeaveConfirm(){
  $('leave-modal').classList.remove('visible');
  $('leave-backdrop').classList.remove('visible');
}
function confirmLeaveGame(){
  cancelLeaveConfirm();
  _leaveGame();
}
function _leaveGame(){
  inGame=false;
  pendingGameOver=null;
  wss({type:'leave'});
  if(ws){ws.onclose=null;ws.close();}
  resetLobby();
  setTimeout(connect,200);
  stopGameMusic();
  playLobbyMusic();
}


// GAME START
function startGame(m){
  stopLobbyMusic();
  playGameMusic();
  inGame=true;selId=null;lastState=null;
  // Restore Ready button visibility for new game
  const btn=$('bround-ready'); if(btn){ btn.style.display=''; btn.disabled=false; btn.textContent='✓ Ready'; btn.style.opacity='1'; }
  const menuBtn=$('bend-menu'); if(menuBtn) menuBtn.style.display='none';
  const vrBtn=$('bview-results'); if(vrBtn) vrBtn.style.display='none';
  pendingGameOver=null;
  const status=$('ready-status'); if(status) status.textContent='';
  const seats=m.seats;
  for(let i=0;i<4;i++){
    const abs=(mySeat+i)%4,id=P[i],p=seats[abs];
    $('pn'+id).textContent=i===0?($('iname').value.trim()||'Player'):(p?.name||'—');
    if(i>0){const bt=$('bt'+id);if(bt)bt.textContent=p?.isBot?'CPU':'';}
    $('rs'+id).style.display='none';
  }
  // Clear board (same as onRoundStart)
  ['hdb','hdt','hdl','hdr','mlb','mlt','mll','mlr'].forEach(id=>{const el=$(id);if(el)el.innerHTML='';});
  ['dzb','dzt','dzl','dzr'].forEach(id=>{const el=$(id);if(el)el.innerHTML='';});
  // Set seat winds based on dealer
  const windLabels=['東','南','西','北'];
  const dealer=m.dealer??0;
  for(let i=0;i<4;i++){
    const abs=(mySeat+i)%4, id=P[i];
    const wb=$('wb'+id);
    if(wb) wb.textContent=windLabels[(abs-dealer+4)%4];
  }
  // Show game mode in topbar
  const modeLabel=m.gameMode==='hanchan'?'半荘戦':'東風戦';
  $('tb-mode').textContent=modeLabel;
  $('chat-bar').style.display='flex'; chatOpen=false; unreadCount=0; $('chat-history').innerHTML='';
  $('dora-panel').style.display='flex';
  show('s-game');
  // Show loading overlay until first game_state arrives
  $('game-loading').style.display='flex';
}

function pid(abs){return P[(abs-mySeat+4)%4];}


// RENDER STATE — called every time a game_state message arrives
function renderState(m, prev){
  // Hide loading overlay on first state
  const loader=$('game-loading');
  if(loader) loader.style.display='none';

  const windChar=['東','南','西','北'];
  const dispWind=m.displayWind||m.roundWind||1;
  const dispRound=m.displayRound||m.round||1;
  $('cw-wind').textContent = windChar[dispWind-1];
  $('cw-kyoku').textContent = dispRound;
  $('ci').textContent = '';
  $('cwl').textContent=`${m.wallCount} tiles`;
  const h=m.honba||0,rs=m.riichiSticks||0;
  $('chonba').textContent=h?`${h} Honba` :'';

  // Dora
  // Fill up to 5 fixed dora slots
  for(let di=0;di<5;di++){
    const slot=$('dora-slot-'+di);
    if(!slot) continue;
    const d=(m.dora||[])[di];
    if(d){
      slot.innerHTML='';slot.className='dora-slot filled';
      slot.appendChild(mkElDora(d));
    } else {
      slot.innerHTML='';slot.className='dora-slot';
    }
  }
  $('dora-panel').style.display='flex';
  $('dora-panel').style.flexDirection='column';

  // Scores in centre panel (compass layout: b=bottom=me, t=top, l=left, r=right)
  // P = ['b','r','t','l'], indexed by (abs - mySeat + 4) % 4
  const ctrIds={b:'ctr-s-b',r:'ctr-s-r',t:'ctr-s-t',l:'ctr-s-l'};
  const windLabels=['東','南','西','北'];
  for(let i=0;i<4;i++){
    const abs=(mySeat+i)%4,id=P[i];
    if(m.scores?.[abs]!==undefined){
      const ctrEl=$(ctrIds[id]);
      if(ctrEl) ctrEl.textContent=m.scores[abs];
    }
    $('np'+id).classList.toggle('active',m.turn===abs);
    if(m.riichi?.[abs]) $('rs'+id).style.display='block';
    // Seat wind: server sends seatWinds[absIndex] = wind index (0=East..3=North)
    if(m.seatWinds){
      const wb=$('wb'+id);
      if(wb) wb.textContent=windLabels[m.seatWinds[abs]];
    }
  }

  // Status bar
  const mine=m.turn===mySeat,react=m.pending?.isForMe;
  const si=$('tst');
  si.className=m.turn===mySeat||react?'tb-st my':'tb-st';
  si.textContent=($('pn'+pid(m.turn))?.textContent||'—')+"'s turn";

  // My hand — server sends mainHand (13 tiles) and drawTile separately
  const hc=$('hdb');hc.innerHTML='';
  const mainHand=m.myHand||[];
  const drawTile=m.drawTile||null;
  // Clear selId if selected tile no longer in hand (e.g. after meld)
  const allTileIds=new Set([...mainHand.map(t=>t.id),...(drawTile?[drawTile.id]:[])]);
  if(selId!=null&&!allTileIds.has(selId)) selId=null;
  const root=document.documentElement;
  const tw=parseInt(root.style.getPropertyValue('--tlg-w'))||40;
  const th=parseInt(root.style.getPropertyValue('--tlg-h'))||56;
  mainHand.forEach(t=>{
    const el=mkEl(t,'tlg',tw,th);
    if(mine) el.classList.add('play');
    if(t.id===selId) el.classList.add('sel');
    el.dataset.tid=t.id;
    if(mine && !m.riichi?.[mySeat]) el.onclick=()=>clickTile(t.id);
    hc.appendChild(el);
  });
  if(drawTile&&mine){
    // Separator gap between main hand and draw tile
    const sep=document.createElement('div');sep.className='draw-sep';hc.appendChild(sep);
    const el=mkEl(drawTile,'tlg',tw,th);
    el.classList.add('play','drw');
    el.dataset.tid=drawTile.id;
    el.onclick=()=>clickTile(drawTile.id);
    // Auto-select draw tile when in riichi
    if(m.riichi?.[mySeat]) el.classList.add('sel');
    hc.appendChild(el);
    // Auto-discard after riichi — unless tsumo or ankan available
    if(m.riichi?.[mySeat] && !m.canTsumo && !(m.canAnkan?.length) && !m.canKyuushu){
      setTimeout(()=>{
        if(lastState===m) wss({type:'action',action:{type:'discard',tileId:drawTile.id}});
      }, 600);
    }
  }

  // Opponent hands — back tiles
  // top: rot180. left/right: now column-layout rotated in CSS, tiles horizontal
  [[1,'r'],[2,'t'],[3,'l']].forEach(([i,id])=>{
    const abs=(mySeat+i)%4;
    const hd=$('hd'+id);
    if(!hd) return;
    hd.innerHTML='';
    const cnt=m.oppHandSizes?.[abs];
    if(cnt==null||cnt<=0) return;
    for(let j=0;j<Math.min(cnt,16);j++){
      const b=document.createElement('div');
      b.className='tile tsm';
      hd.appendChild(b);
    }
  });

  // Discards — 6 tiles per row, riichi tile rotated 90° from player's perspective
  const dzMap={b:'dzb',r:'dzr',t:'dzt',l:'dzl'};
  // Count total discards before re-render to detect new discard from any player
  let prevDiscardCount=0;
  if(prev?.discards) prev.discards.forEach(d=>{ prevDiscardCount+=(d?.length||0); });
  let newDiscardCount=0;
  if(m.discards) m.discards.forEach(d=>{ newDiscardCount+=(d?.length||0); });
  if(newDiscardCount>prevDiscardCount) playDiscardSfx();

  // Detect new pon — check if main player's melds changed
  const prevMyPon=(prev?.myMelds||[]).filter(mel=>mel?.type==='pon').length;
  const newMyPon=(m.myMelds||[]).filter(mel=>mel?.type==='pon').length;
  const prevOppPon=(prev?.melds||[]).flat().filter(mel=>mel?.type==='pon').length;
  const newOppPon=(m.melds||[]).flat().filter(mel=>mel?.type==='pon').length;
  const allMelds=[...(m.melds?.flat()||[]),...(m.myMelds||[])];
  if(newMyPon>prevMyPon) playSfx('sfx-pon',mySeat);
  else if(newOppPon>prevOppPon){
    const seat=m.melds?.findIndex((ms,i)=>i!==mySeat&&(ms?.filter(ml=>ml?.type==='pon').length||0)>(prev?.melds?.[i]?.filter(ml=>ml?.type==='pon').length||0));
    playSfx('sfx-pon',seat>=0?seat:null);
  }

  // Chi
  const prevMyChi=(prev?.myMelds||[]).filter(mel=>mel?.type==='chi').length;
  const newMyChi=(m.myMelds||[]).filter(mel=>mel?.type==='chi').length;
  const prevOppChi=(prev?.melds||[]).flat().filter(mel=>mel?.type==='chi').length;
  const newOppChi=(m.melds||[]).flat().filter(mel=>mel?.type==='chi').length;
  if(newMyChi>prevMyChi) playSfx('sfx-chii',mySeat);
  else if(newOppChi>prevOppChi){
    const seat=m.melds?.findIndex((ms,i)=>i!==mySeat&&(ms?.filter(ml=>ml?.type==='chi').length||0)>(prev?.melds?.[i]?.filter(ml=>ml?.type==='chi').length||0));
    playSfx('sfx-chii',seat>=0?seat:null);
  }

  // Kan
  const prevMyKan=(prev?.myMelds||[]).filter(mel=>mel?.type==='kan').length;
  const newMyKan=(m.myMelds||[]).filter(mel=>mel?.type==='kan').length;
  const prevOppKan=(prev?.melds||[]).flat().filter(mel=>mel?.type==='kan').length;
  const newOppKan=(m.melds||[]).flat().filter(mel=>mel?.type==='kan').length;
  if(newMyKan>prevMyKan) playSfx('sfx-kan',mySeat);
  else if(newOppKan>prevOppKan){
    const seat=m.melds?.findIndex((ms,i)=>i!==mySeat&&(ms?.filter(ml=>ml?.type==='kan').length||0)>(prev?.melds?.[i]?.filter(ml=>ml?.type==='kan').length||0));
    playSfx('sfx-kan',seat>=0?seat:null);
  }

  // Riichi
  const prevRiichiCount=(prev?.riichi||[]).filter(Boolean).length;
  const newRiichiCount=(m.riichi||[]).filter(Boolean).length;
  if(newRiichiCount>prevRiichiCount){
    const riichiSeat=(m.riichi||[]).findIndex((v,i)=>v&&!prev?.riichi?.[i]);
    const prevDblCount=(prev?.doubleRiichi||[]).filter(Boolean).length;
    const newDblCount=(m.doubleRiichi||[]).filter(Boolean).length;
    if(newDblCount>prevDblCount) playSfx('sfx-double-riichi',riichiSeat>=0?riichiSeat:null);
    else playSfx('sfx-riichi',riichiSeat>=0?riichiSeat:null);
  }
  for(let i=0;i<4;i++){
    const abs=(mySeat+i)%4,id=P[i];
    const dz=$(dzMap[id]);dz.innerHTML='';
    const tiles=m.discards?.[abs]||[];
    let row=null;
    tiles.forEach((t,idx)=>{
      if(idx%6===0){
        row=document.createElement('div');
        row.className='dz-row';
        dz.appendChild(row);
      }
      const el=mkElMd(t);
      if(t.riichi){
        // Wrap in a rotated container — the 90° rotation is in player's own perspective
        // CSS class handles the rotation; margin compensates for size change
        el.classList.add('dz-riichi');
      }
      row.appendChild(el);
    });
  }

  // My melds (bottom) — anchor bottom-right, first meld rightmost, grows leftward
  const ml=$('mlb');ml.innerHTML='';
  for(const meld of(m.myMelds||[])){
    const g=document.createElement('div');g.className='mg';
    renderMeld(g, meld, mySeat);
    ml.prepend(g);
  }
  // Opponent melds
  [[1,'r'],[2,'t'],[3,'l']].forEach(([i,id])=>{
    const abs=(mySeat+i)%4;
    const ml2=$('ml'+id);
    if(!ml2) return;
    ml2.innerHTML='';
    const melds=m.melds?.[abs]||[];
    for(const meld of melds){
      const g=document.createElement('div');g.className='mg';
      // top/left/right all need dir 1↔3 swapped due to their container rotation
      renderMeld(g, meld, abs);
      if(id==='t') ml2.prepend(g); // top: anchor top-left, first meld leftmost, grows right
      else if(id==='l') ml2.prepend(g); // left: anchor bottom-left, first meld at bottom, grows up
      else ml2.prepend(g);          // right: anchor top-right, first meld at top, grows down
    }
  });

  $('tpb').style.display=(m.waits?.length>0&&!m.riichi?.[mySeat]&&!m.furiten)?'':'none';
  let furitenEl=$('furiten-badge');
  if(!furitenEl){
    furitenEl=document.createElement('span');
    furitenEl.id='furiten-badge';
    furitenEl.className='furiten-badge';
    furitenEl.textContent='Furiten';
    document.querySelector('.felt').appendChild(furitenEl);
  }
  furitenEl.style.display=m.furiten?'block':'none';
  drawActions(m);
}

function clickTile(id){
  if(discarding) return;
  if(selId===id){
    wss({type:'action',action:{type:'discard',tileId:id}});
    discarding=true;
    selId=null;
  } else {
    selId=id;
    $('hdb').querySelectorAll('.tlg').forEach(el=>{
      el.classList.toggle('sel',parseInt(el.dataset.tid)===id);
    });
    drawActions(lastState);
  }
}


// MELD RENDERING
// Draws chi/pon/kan groups with correct orientation per player
function renderMeld(container, meld, viewerSeat, flipped=false){
  const tiles = meld.tiles;
  const calledId = meld.calledTileId;
  const fromSeat = meld.fromSeat;
  let dir = fromSeat !== undefined ? (fromSeat - viewerSeat + 4) % 4 : 1;
  // flip dir 1↔3 for all rotated containers (top 180°, left 90°, right -90°)
  if(flipped){
    if(dir===1) dir=3;
    else if(dir===3) dir=1;
  }
  // tile order only reverses for top player (180° rotation)
  const add = (el) => container.appendChild(el);
  const mkC = t => { const el=mkElMd(t); el.classList.add('called'); return el; };

  if(meld.type === 'chi'){
    const called = tiles.find(t=>t.id===calledId) || tiles[0];
    const own = tiles.filter(t=>t.id!==calledId);
    add(mkC(called));
    own.forEach(t=>add(mkElMd(t)));

  } else if(meld.type === 'pon'){
    const called = tiles.find(t=>t.id===calledId) || tiles[2];
    const own = tiles.filter(t=>t.id!==calledId);
    const ownEls = own.map(t=>mkElMd(t));
    const calledEl = mkC(called);
    if(dir===1){ ownEls.forEach(el=>add(el)); add(calledEl); }
    else if(dir===2){ add(ownEls[0]); add(calledEl); add(ownEls[1]); }
    else { add(calledEl); ownEls.forEach(el=>add(el)); }

  } else if(meld.type === 'kan'){
    const kanType = meld.kanType;
    if(kanType === 'ankan'){
      const back = () => { const d=document.createElement('div'); d.className='kan-back'; return d; };
      add(back());
      add(mkElMd(meld.tiles[1]));
      add(mkElMd(meld.tiles[2]));
      add(back());

    } else if(kanType === 'kakan'){
      const kakanAdded = meld.tiles[3];
      const ponCalled = meld.tiles[2];
      const ponOwn = meld.tiles.slice(0, 2); // always first 2 tiles
      const stack = document.createElement('div');
      stack.className = 'called-stack';
      const baseEl = mkElMd(ponCalled); baseEl.classList.add('kakan-base');
      const addEl = mkElMd(kakanAdded); addEl.classList.add('kakan-add');stack.appendChild(baseEl); stack.appendChild(addEl);// ponOwn should have 2 tiles (original pon had 3, minus the called = 2)
      const ownEls = ponOwn.map(t=>mkElMd(t));
      if(dir===1){ ownEls.forEach(el=>add(el)); add(stack); }
      else if(dir===2){ add(ownEls[0]); add(stack); if(ownEls[1]) add(ownEls[1]); }
      else { add(stack); ownEls.forEach(el=>add(el)); }

    } else {
      const called = tiles.find(t=>t.id===calledId) || tiles[3];
      const own = tiles.filter(t=>t.id!==calledId);
      const ownEls = own.map(t=>mkElMd(t));
      const calledEl = mkC(called);
      if(dir===1){ ownEls.forEach(el=>add(el)); add(calledEl); }
      else if(dir===2){ add(ownEls[0]); add(calledEl); ownEls.slice(1).forEach(el=>add(el)); }
      else { add(calledEl); ownEls.forEach(el=>add(el)); }
    }
  } else {
    tiles.forEach(t=>add(mkElMd(t)));
  }
}


// ACTION BAR — buttons shown on player's turn
function drawActions(m){
  const bar=$('actbar'); bar.innerHTML='';
  const stalePicker=$('chi-picker'); if(stalePicker) stalePicker.remove();
  if(!m) return;
  bar.className='act-overlay';
  const mine=m.turn===mySeat, react=m.pending?.isForMe;

  if(mine){
    // LEFT: TSUMO
    if(m.canTsumo)
      ab(bar,'TSUMO','btsu',()=>wss({type:'action',action:{type:'tsumo'}}));

    // LEFT: ANKAN
    const canAnkan=m.canAnkan||[];
    canAnkan.forEach(tileKey=>{
      ab(bar,'ANKAN','bkan',()=>wss({type:'action',action:{type:'ankan',tileKey}}));
    });

    // LEFT: KAKAN
    const canKakan=m.canKakan||[];
    if(canKakan.length>0){
      if(selId&&canKakan.includes(selId))
        ab(bar,'KAN','bkan',()=>wss({type:'action',action:{type:'kakan',tileId:selId}}));
      else if(canKakan.length===1&&!selId)
        ab(bar,'KAN','bkan',()=>wss({type:'action',action:{type:'kakan',tileId:canKakan[0]}}));
    }

    // LEFT: RIICHI
    const canRiichi=m.canRiichi||[];
    if(canRiichi.length>0&&selId&&canRiichi.includes(selId))
      ab(bar,'RIICHI','brii',()=>{wss({type:'action',action:{type:'riichi',tileId:selId}});selId=null;});

    // RIGHT: DISCARD
    if(selId)
      ab(bar,'DISCARD','bdis',()=>{if(discarding)return;wss({type:'action',action:{type:'discard',tileId:selId}});discarding=true;selId=null;});

    // RIGHT: KYUUSHU
    if(m.canKyuushu)
      ab(bar,'Kyuushu Kyuuhai','bkyu',()=>wss({type:'action',action:{type:'kyuushu'}}));

    if(bar.children.length>0) bar.classList.add('visible');

  } else if(react){
    const opts=m.pending.options||[];
    // LEFT: RON, PON, KAN, CHI
    if(opts.some(o=>o.type==='ron'))
      ab(bar,'RON','bron',()=>wss({type:'action',action:{type:'ron'}}));
    if(opts.some(o=>o.type==='pon'))
      ab(bar,'PON','bpon',()=>wss({type:'action',action:{type:'pon'}}));
    if(opts.some(o=>o.type==='kan'))
      ab(bar,'KAN','bkan',()=>wss({type:'action',action:{type:'kan'}}));
    if(opts.some(o=>o.type==='chi')){
      const c=opts.find(o=>o.type==='chi');
      const discTile=m.pending.discard;
      const myHand=m.myHand||[];
      if(c.sequences.length===1){
        ab(bar,'CHI','bchi',()=>wss({type:'action',action:{type:'chi',tileIds:c.sequences[0]}}));
      } else {
        ab(bar,'CHI','bchi',()=>showChiPicker(c.sequences,discTile,myHand));
      }
    }
    // RIGHT: SKIP
    ab(bar,'SKIP','bpas',()=>wss({type:'action',action:{type:'pass'}}));
    if(bar.children.length>0) bar.classList.add('visible');
  }
  if(!bar.classList.contains('visible')) bar.classList.remove('visible');
}

// Builds a short readable label for a chi sequence button, e.g. "3-4-5m"
// so the player can tell multiple sequence options apart (e.g. 3m4m5m vs
// 5m6m7m when discarding 5m and holding both 3m4m and 6m7m).
const SUIT_LABEL={m:'m',p:'p',s:'s'};
function chiSeqLabel(seqTileIds,discTile,myHand){
  const tiles=seqTileIds.map(id=>myHand.find(t=>t.id===id)).filter(Boolean);
  if(tiles.length<2||!discTile) return 'CHI';
  const vals=[...tiles.map(t=>t.v),discTile.v].sort((a,b)=>a-b);
  const suit=SUIT_LABEL[discTile.s]||'';
  return `${vals[0]}-${vals[1]}-${vals[2]}${suit}`;
}

// Shows a small overlay letting the player pick which chi sequence to call
// when a discard offers more than one valid combination. Each option is
// rendered as the actual three tiles (the two hand tiles + the discard)
// rather than a text label.
function showChiPicker(sequences,discTile,myHand){
  let picker=$('chi-picker');
  if(picker) picker.remove();
  picker=document.createElement('div');
  picker.id='chi-picker';
  picker.className='chi-picker';
  sequences.forEach(seq=>{
    const tiles=seq.map(id=>myHand.find(t=>t.id===id)).filter(Boolean);
    const group=[...tiles,discTile].sort((a,b)=>a.v-b.v);
    const optBtn=document.createElement('button');
    optBtn.className='chi-picker-opt';
    optBtn.onclick=()=>{
      wss({type:'action',action:{type:'chi',tileIds:seq}});
      picker.remove();
    };
    group.forEach(t=>{
      const el=mkElMd(t);
      if(t.id===discTile.id) el.classList.add('chi-picker-disc');
      optBtn.appendChild(el);
    });
    picker.appendChild(optBtn);
  });
  const cancelBtn=document.createElement('button');
  cancelBtn.className='ba bpas chi-picker-cancel';
  cancelBtn.textContent='✕';
  cancelBtn.onclick=()=>picker.remove();
  picker.appendChild(cancelBtn);
  document.body.appendChild(picker);
}

function ab(c,l,cls,fn){const b=document.createElement('button');b.className='ba '+cls;b.textContent=l;b.onclick=fn;c.appendChild(b);}
function hint(c,t){const h=document.createElement('span');h.className='hint';h.textContent=t;c.appendChild(h);}

function mkEl(tile,cls,w,h){
  const el=document.createElement('div');el.className='tile '+cls;
  // If w/h not provided, read from CSS vars
  const root=document.documentElement;
  if(!w) w=parseInt(root.style.getPropertyValue('--tmd-w'))||26;
  if(!h) h=parseInt(root.style.getPropertyValue('--tmd-h'))||36;
  const svgStr=tsvg(tile,w,h);
  el.innerHTML=svgStr?svgStr.replace('<svg ','<svg style="pointer-events:none" '):'';
  return el;
}
function mkElMd(tile){
  const r=document.documentElement;
  const w=parseInt(r.style.getPropertyValue('--tmd-w'))||26;
  const h=parseInt(r.style.getPropertyValue('--tmd-h'))||36;
  return mkEl(tile,'tmd',w,h);
}
function mkElDora(tile){
  const r=document.documentElement;
  const w=parseInt(r.style.getPropertyValue('--tlg-w'))||46;
  const h=parseInt(r.style.getPropertyValue('--tlg-h'))||64;
  return mkEl(tile,'tdora',w,h);
}


// CHAT
const SEAT_COLORS=['#ffdd44','#ff8844','#44ddff','#88ff88'];
let chatOpen=false, unreadCount=0;

function toggleChat(){
  chatOpen=!chatOpen;
  $('chat-panel').classList.toggle('open',chatOpen);
  $('chat-hist-btn').classList.toggle('open',chatOpen);
  if(chatOpen){
    unreadCount=0;
    const badge=$('chat-badge');
    badge.classList.remove('show');
    badge.textContent='0';
    const h=$('chat-history');
    h.scrollTop=h.scrollHeight;
  }
}

function sendChat(){
  const inp=$('chat-input');
  const text=inp.value.trim();
  if(!text) return;
  wss({type:'chat',text});
  inp.value='';
}

function showChatMsg(seat,name,text){
  const relSeat=(seat-mySeat+4)%4;
  const color=SEAT_COLORS[relSeat]||'#fff';

  // ── Floating big message — top of mat, centred ──
  const cf=$('chat-float');
  cf.className='chat-float';
  const div=document.createElement('div');
  div.className='chat-msg';
  div.style.color=color;
  div.innerHTML=`<span class="chat-who">${escHtml(name)}</span>${escHtml(text)}`;
  div.style.whiteSpace='nowrap';
  cf.appendChild(div);
  setTimeout(()=>div.remove(),5200);

  // ── History entry ──
  const history=$('chat-history');
  const now=new Date();
  const time=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const entry=document.createElement('div');
  entry.className='chat-entry';
  entry.innerHTML=
    `<span class="chat-entry-who" style="color:${color}">${escHtml(name)}</span>`+
    `<span class="chat-entry-text">${escHtml(text)}</span>`+
    `<span class="chat-entry-time">${time}</span>`;
  history.appendChild(entry);
  history.scrollTop=history.scrollHeight;

  // ── Unread badge ──
  if(!chatOpen){
    unreadCount++;
    const badge=$('chat-badge');
    badge.textContent=unreadCount;
    badge.classList.add('show');
  }
}

function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}


// NOTIFICATIONS — riichi announcements, toasts
function onRiichi(m){
  $('rs'+pid(m.seat)).style.display='block';
  const label=m.isDouble?'ダブルリーチ':'リーチ';
  toast(label+' — '+(m.name||'Player'));
}
function toast(msg){
  const tc=$('tc'),t=document.createElement('div');
  t.className='toast';t.textContent=msg;
  tc.appendChild(t);setTimeout(()=>t.remove(),3000);
}


// ════════════════════════════════════════════════════════════
// ROUND READY
// ════════════════════════════════════════════════════════════
function sendRoundReady(){
  wss({type:'action',action:{type:'round_ready'}});
  const btn=$('bround-ready');
  if(btn){ btn.disabled=true; btn.textContent='✓ Waiting...'; btn.style.opacity='0.5'; }
}

function onReadyStatus(m){
  const status=$('ready-status');
  if(status) status.textContent=`${m.count}/${m.total} players ready`;
}

// ════════════════════════════════════════════════════════════
// ROUND LIFECYCLE — start / end / game over
// ════════════════════════════════════════════════════════════
function onRoundStart(m){
  inGame=true;
  show('s-game');
  // Reset Ready button for next round
  const btn=$('bround-ready');
  if(btn){ btn.disabled=false; btn.textContent='✓ Ready'; btn.style.opacity='1'; }
  const status=$('ready-status'); if(status) status.textContent='';
  $('chat-bar').style.display='flex';
  $('dora-panel').style.display='flex';
  // Show loading overlay until next game_state arrives
  const loader=$('game-loading');
  if(loader) loader.style.display='flex';

  // ── Update seat winds based on new dealer ────────────────────────────────
  const windLabels2=['東','南','西','北'];
  const dealer=m.dealer??0;
  for(let i=0;i<4;i++){
    const abs=(mySeat+i)%4, id=P[i];
    const wb=$('wb'+id);
    if(wb) wb.textContent=windLabels2[(abs-dealer+4)%4];
  }

  // ── Full board reset ──────────────────────────────────────────────────────
  // Clear all hand tiles
  $('hdb').innerHTML='';
  $('hdt').innerHTML='';
  $('hdl').innerHTML='';
  $('hdr').innerHTML='';
  // Clear all meld tiles
  $('mlb').innerHTML='';
  $('mlt').innerHTML='';
  $('mll').innerHTML='';
  $('mlr').innerHTML='';
  // Clear all discard zones
  ['dzb','dzt','dzl','dzr'].forEach(id=>{ const el=$(id); if(el) el.innerHTML=''; });
  // Clear riichi sticks
  ['b','r','t','l'].forEach(p=>{ const el=$('rs'+p); if(el) el.style.display='none'; });
  // Clear dora panel
  const doraPanel=$('dora-panel');
  if(doraPanel) doraPanel.querySelectorAll('.dora-slot').forEach(s=>{s.innerHTML='';s.className='dora-slot';});
  // Clear action bar
  const bar=$('actbar'); if(bar){bar.innerHTML='';bar.classList.remove('visible');}
  // Clear selection
  selId=null;

  // ── Round announcement ────────────────────────────────────────────────────
  const windChar=['東','南','西','北'];
  const wind=m.displayWind||m.roundWind||1;
  const rnd=m.displayRound||m.round||1;
  $('cw-wind').textContent = windChar[wind-1];
  $('cw-kyoku').textContent = rnd + '局';
  $('ci').textContent = '';
  toast(windChar[wind-1]+rnd+'局 · '+(m.honba||0)+'本場 開始');
}

function onGameOver(m){
  inGame=false;
  const loader=$('game-loading'); if(loader) loader.style.display='none';
  // Hide Ready, show Main Menu — game fully over
  const btn=$('bround-ready'); if(btn) btn.style.display='none';
  const vrBtn=$('bview-results'); if(vrBtn) vrBtn.style.display='none';
  const menuBtn=$('bend-menu'); if(menuBtn) menuBtn.style.display='';
  const status=$('ready-status'); if(status) status.textContent='';
  stopGameMusic();
  playLobbyMusic();
  $('chat-bar').style.display='none';$('chat-panel').classList.remove('open');chatOpen=false;
  $('dora-panel').style.display='none';
  const sorted=[...((m.scores||[]).map((s,i)=>({s,i})))].sort((a,b)=>b.s-a.s);
  let rows='';
  sorted.forEach(({s,i},rank)=>{
    const name=i===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[i]||`Seat ${i}`);
    rows+=`<tr class="${rank===0?'w':''}"><td>${rank+1}. ${escHtml(name)}</td><td>${s}</td></tr>`;
  });
  $('ret').textContent=m.reason==='tobi'?'飛び - Bankruptcy':'終局 - Game Over';
  $('rehn').textContent='';$('reyl').innerHTML='';$('rewt').innerHTML='';
  $('rest').innerHTML=rows;
  show('s-end');
}

function limitLabel(han,fu){
  if(han>=26) return {label:'ダブル役満',en:'Double Yakuman',cls:'lbl-double-yakuman'};
  if(han>=13) return {label:'役満',en:'Yakuman',cls:'lbl-yakuman'};
  if(han>=11) return {label:'三倍満',en:'Sanbaiman',cls:'lbl-sanbaiman'};
  if(han>=8)  return {label:'倍満',en:'Baiman',cls:'lbl-baiman'};
  if(han>=6)  return {label:'跳満',en:'Haneman',cls:'lbl-haneman'};
  if(han>=5)  return {label:'満貫',en:'Mangan',cls:'lbl-mangan'};
  if(han===4&&fu>=30) return {label:'満貫',en:'Mangan',cls:'lbl-mangan'};
  if(han===3&&fu>=70) return {label:'満貫',en:'Mangan',cls:'lbl-mangan'};
  return null;
}


function onEnd(m){
  try{
  inGame=false;
  const loader=$('game-loading'); if(loader) loader.style.display='none';
  $('chat-bar').style.display='none';$('chat-panel').classList.remove('open');chatOpen=false;
  $('dora-panel').style.display='none';
  const reasonLabels={tsumo:'ツモ - TSUMO',ron:'ロン - RON',draw:'流局 - Exhaustive Draw',suukaikan:'四開槓 - Suukaikan',nagashi:'流し満貫 - Mangan at Draw'};
  $('ret').textContent=reasonLabels[m.reason]||'Round Over';
  if(m.reason==='tsumo'||m.reason==='ron'){
    if(m.reason==='ron') playSfx('sfx-ron', m.winner);
    if(m.reason==='tsumo') playSfx('sfx-tsumo', m.winner);
    const winnerName=m.winner===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[m.winner]||`Seat ${m.winner}`);
    // FIX 1: strip han count from handLabel line — it's shown in the yaku pills below.
    // Only show fu here; total han is redundant.
    const limit=limitLabel(m.han||0,m.fu||0);
    const limitHtml=limit?`<span class="re-limit ${limit.cls}">${limit.en} · ${limit.label}</span>`:'';
    const handInfo=(m.fu&&!limit)?`<span class="re-hand"> · ${m.han} Han · ${m.fu} Fu</span>`
      :(m.fu&&limit)?`<span class="re-hand"> · ${m.han} Han · ${m.fu} Fu</span>`:'';
    $('rehn').innerHTML=`<span class="re-winner">${escHtml(winnerName)}</span>${limitHtml}${handInfo}`;
  } else if(m.reason==='draw'){
    $('rehn').textContent='';
  } else { $('rehn').textContent=''; }
  // FIX 2: yaku pills only — dora tiles move to sit directly above the winning hand tiles
  const yl=$('reyl');yl.innerHTML='';
  for(const y of(m.yakuList||[])){
    const c=document.createElement('div');c.className='yc';
    c.innerHTML=`${escHtml(y.name)}<span class="yh">${y.han}Han</span><span class="yj">${escHtml(y.jp||'')}</span>`;
    yl.appendChild(c);
  }
  // Hand tiles + dora grouped together in rewt
  const wt=$('rewt');wt.innerHTML='';
  // Collect aka dora tiles from hand + melds
  const allHandTiles=[...(m.hand||[]),...(m.melds||[]).flatMap(ml=>ml.tiles||[])];
  if((m.dora||[]).length||(m.uraDora||[]).length){
    const dr=document.createElement('div');dr.className='re-dora-row';
    if((m.dora||[]).length){
      const lbl=document.createElement('span');lbl.className='re-dora-lbl';lbl.textContent='Dora';
      dr.appendChild(lbl);
      for(const t of m.dora) dr.appendChild(mkElMd(t));
    }
    if((m.uraDora||[]).length){
      const lbl2=document.createElement('span');lbl2.className='re-dora-lbl re-ura-lbl';lbl2.textContent='Ura Dora';
      dr.appendChild(lbl2);
      for(const t of m.uraDora) dr.appendChild(mkElMd(t));
    }
    wt.appendChild(dr);
  }
  const tileRow=document.createElement('div');tileRow.className='re-tile-row';
  for(const t of(m.hand||[])) if(t) tileRow.appendChild(mkElMd(t));
  // Render melds right of closed hand, separated by a gap
  for(const meld of(m.melds||[])){
    const sep=document.createElement('div');sep.className='re-meld-sep';
    tileRow.appendChild(sep);
    // For the win panel we show melds flat (winner's perspective, no rotation)
    // Reuse renderMeld logic but simplified: called tile gets .called class for visual marker
    const calledId=meld.calledTileId;
    const kanType=meld.kanType;
    if(meld.type==='ankan'){
      // Ankan: show face-down / face-up / face-up / face-down
      const back=()=>{const d=document.createElement('div');d.className='kan-back re-kan-back';return d;};
      tileRow.appendChild(back());
      tileRow.appendChild(mkElMd(meld.tiles[1]));
      tileRow.appendChild(mkElMd(meld.tiles[2]));
      tileRow.appendChild(back());
    } else {
      // Chi, pon, daiminkan, kakan — show all tiles face-up, mark called tile
      for(const t of meld.tiles){
        const el=mkElMd(t);
        if(t.id===calledId) el.classList.add('called');
        tileRow.appendChild(el);
      }
    }
  }
  wt.appendChild(tileRow);
  // Score table with delta column
  const tbl=$('rest');tbl.innerHTML='';
  const sorted=[...(m.scores||[]).map((sc,seat)=>({sc,seat}))].sort((a,b)=>b.sc-a.sc);
  sorted.forEach(({sc,seat},rank)=>{
    const name=seat===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[seat]||`Seat ${seat}`);
    const row=document.createElement('tr');if(seat===m.winner)row.className='w';
    const ordinal=['1st','2nd','3rd','4th'][rank]||`${rank+1}th`;
    const colours=['#f0d080','#c0c0c0','#cd7f32','var(--cream)'];
    const colour=colours[rank]||'var(--cream)';
    const delta=m.prevScores?sc-m.prevScores[seat]:null;
    const startScore=m.prevScores?m.prevScores[seat]:sc;
    const scoreSpanId=`re-sc-${seat}`;
    const deltaHtml=delta!=null&&delta!==0
      ?`<span class="re-delta ${delta>0?'re-delta-pos':'re-delta-neg'}">${delta>0?'+':''}${delta.toLocaleString()}</span>`
      :`<span class="re-delta re-delta-nil">—</span>`;
    row.innerHTML=`<td><span style="color:${colour};font-weight:700;margin-right:10px;">${ordinal}</span>${escHtml(name)}</td><td><span id="${scoreSpanId}">${startScore.toLocaleString()}</span></td><td class="re-td-delta">${deltaHtml}</td>`;
    tbl.appendChild(row);
  });
  // Animate score count-up after a short delay
  setTimeout(()=>{
    (m.scores||[]).forEach((sc,seat)=>{
      const startScore=m.prevScores?m.prevScores[seat]:sc;
      if(startScore===sc) return;
      const span=document.getElementById(`re-sc-${seat}`);
      if(!span) return;
      const duration=900;
      const start=performance.now();
      const ease=t=>t<.5?2*t*t:(-1+(4-2*t)*t);
      function frame(now){
        const t=Math.min((now-start)/duration,1);
        const val=Math.round(startScore+(sc-startScore)*ease(t));
        span.textContent=val.toLocaleString();
        if(t<1) requestAnimationFrame(frame);
        else span.textContent=sc.toLocaleString();
      }
      requestAnimationFrame(frame);
    });
  }, 400);
  if(m.gameOver){
    const btn=$('bround-ready'); if(btn) btn.style.display='none';
    const vrBtn=$('bview-results'); if(vrBtn) vrBtn.style.display=pendingGameOver?'':'none';
  }
  show('s-end');
  setTimeout(()=>{ inGame=true; },5500);
  }catch(e){ show('s-end'); }
}

function showGameOverResults(){
  if(!pendingGameOver) return;
  const m=pendingGameOver; pendingGameOver=null;
  onGameOver(m);
}



// RESPONSIVE TILE SIZING
// Recalculates --tlg/tmd/tsm CSS vars on window resize
function updateTileSizes(){
  // Read felt size from CSS variable — available immediately, no layout needed
  const root=document.documentElement;
  const feltSizeStr=getComputedStyle(root).getPropertyValue('--felt-size').trim();
  // Parse the computed value (may be in px after calc resolution)
  const felt=document.querySelector('.felt');
  const feltSize=felt?felt.getBoundingClientRect().width:
    parseFloat(feltSizeStr)||Math.min(window.innerWidth,window.innerHeight)*0.86;
  const base=feltSize>0?feltSize:Math.min(window.innerWidth,window.innerHeight)*0.86;
  // Max 14 tiles must fit in ~74% of felt width (remaining for melds/padding)
  const maxByFit=Math.floor((base*0.74)/14);
  // Cap at 6% of base for aesthetics
  const lgW=Math.round(Math.min(base*0.060,maxByFit));
  const lgH=Math.round(lgW*1.38);
  const dzWidth=base*0.26;          // discard zone is ~26% of felt width
  const mdW=Math.floor(dzWidth/6);  // 6 tiles per row
  const mdH=Math.round(mdW*1.38);   // maintain tile aspect ratio
  const smW=Math.round(lgW*0.65);
  const smH=Math.round(lgH*0.65);
  root.style.setProperty('--tlg-w',lgW+'px');
  root.style.setProperty('--tlg-h',lgH+'px');
  root.style.setProperty('--tmd-w',mdW+'px');
  root.style.setProperty('--tmd-h',mdH+'px');
  root.style.setProperty('--tsm-w',smW+'px');
  root.style.setProperty('--tsm-h',smH+'px');
}
window.addEventListener('resize',updateTileSizes);
updateTileSizes();
setTimeout(updateTileSizes,100);


// BOOT — initialise on page load
// Restore music & volume preferences
try{
  const savedMusic=localStorage.getItem('mj-music');
  const savedVol=localStorage.getItem('mj-vol');
  if(savedVol){
    const v=parseInt(savedVol);
    musicVolume=v/100;
    const sl=$('vol-slider'); if(sl) sl.value=v;
    const lbl=$('vol-label'); if(lbl) lbl.textContent=v+'%';
  }
  if(savedMusic==='0'){
    musicEnabled=false;
    const b=$('bmute');
    if(b){ b.textContent='OFF'; b.style.background='rgba(80,0,0,.3)'; b.style.borderColor='#c82020'; }
  }
  const savedFx=localStorage.getItem('mj-fx');
  const savedFxVol=localStorage.getItem('mj-fx-vol');
  if(savedFxVol){
    const v=parseInt(savedFxVol);
    fxVolume=(v/100)*4;
    if(fxGainNode) fxGainNode.gain.value=fxVolume;
    const sl=$('fx-vol-slider'); if(sl) sl.value=v;
    const lbl=$('fx-vol-label'); if(lbl) lbl.textContent=v+'%';
  }
  if(savedFx==='0'){
    fxEnabled=false;
    const b=$('bfx');
    if(b){ b.textContent='OFF'; b.style.background='rgba(80,0,0,.3)'; b.style.borderColor='#c82020'; }
  }
  const savedDiscardSfx=localStorage.getItem('mj-discard-sfx');
  const savedDiscardVol=localStorage.getItem('mj-discard-vol');
  if(savedDiscardVol){
    const v=parseInt(savedDiscardVol);
    discardSfxVolume=(v/100)*2;
    const sl=$('discard-vol-slider'); if(sl) sl.value=v;
    const lbl=$('discard-vol-label'); if(lbl) lbl.textContent=v+'%';
  }
  if(savedDiscardSfx==='0'){
    discardSfxEnabled=false;
    const b=$('bdiscard-sfx');
    if(b){ b.textContent='OFF'; b.style.background='rgba(80,0,0,.3)'; b.style.borderColor='#c82020'; }
  }
  const savedTheme=localStorage.getItem('mj-voice-theme');
  if(savedTheme) currentVoiceTheme=savedTheme;
}catch(e){}
renderVoiceThemes();
// Start music on first user interaction — via Press Start button
function enterLobby(){
  playLobbyMusic();
  show('s-lobby');
}
$('bstart').onclick=enterLobby;
$('bfind').onclick=findMatch;
$('bready').onclick=pressReady;
$('bcancel').onclick=()=>{wss({type:'leave'});resetLobby();};
$('bleave').onclick=goLobby;
$('bsettings').onclick=toggleSettings;
$('iname').onkeydown=e=>{if(e.key==='Enter')findMatch();};
$('chat-send').onclick=sendChat;
$('chat-input').onkeydown=e=>{if(e.key==='Enter')sendChat();};
$('chat-hist-btn').onclick=toggleChat;
$('chat-close').onclick=toggleChat;
connect();