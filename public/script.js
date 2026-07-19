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
  const fs=Math.round(h*.45);
  const numColor=red?'#c82020':'#1a1a1a';
  const base=Math.min(w,h);
  // Red dotted marker in the top-left corner (5-man)
  const marker=red?`<circle cx="${w*.18}" cy="${h*.15}" r="${base*.06}" fill="#c82020" opacity="0.9"/>`:'';
  return (
    `<text x="${w*.5}" y="${h*.25}" text-anchor="middle" dominant-baseline="central" `+
    `font-family="'Yuji Syuku',serif" font-size="${fs}px" font-weight="570" fill="${numColor}">`+
    MAN_K[v]+`</text>`+
    `<text x="${w*.5}" y="${h*.70}" text-anchor="middle" dominant-baseline="central" `+
    `font-family="'Yuji Syuku',serif" font-size="${fs}px" font-weight="570
    " fill="#c82020">萬</text>`+marker
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
  const rMap={1:.44,2:.29,3:.22,4:.22,5:.22,6:.20,7:.18,8:.17,9:.17};
  const r=base*(rMap[v]||.11);
  const hasRedOuter=red;
  const hasRedInner=(v===1);
  const circles=pos.map(([cx,cy,forceRed])=>pinCircle(cx,cy,r,red,hasRedOuter,hasRedInner,forceRed)).join('');
  // Red dotted marker to the right of the middle circle (5-pin)
  let marker='';
  if(red){
    const mid=pos.find(([,,forceRed])=>forceRed) || [w/2,h/2];
    const[mcx,mcy]=mid;
    marker=`<circle cx="${mcx+r+base*.1}" cy="${mcy}" r="${base*.06}" fill="#c82020" opacity="0.9"/>`;
  }
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
    const step=ph/(n-0.1);
    return Array.from({length:n},(_,i)=>([cx, oy+step*(i+0.45)]));
  }
  function col2(nL,nR,colGap,rowGap){
    const gx=colGap!=null?colGap:.23;
    const lx=ox+pw*(.5-gx), rx=ox+pw*(.5+gx);
    function colYs(n,gap){
      if(n===2){
        const g=(gap!=null?gap:.4)*ph;
        return [cy-g/2, cy+g/2];
      }
      const step=ph/(n+(gap!=null?gap:0.4));
      return Array.from({length:n},(_,i)=>oy+step*(i+0.55));
    }
    const L=colYs(nL,rowGap).map(y=>[lx,y]);
    const R=colYs(nR,rowGap).map(y=>[rx,y]);
    return [...L,...R];
  }
  function col3(n){
    const lx=ox+pw*.13, mx=cx, rx=ox+pw*.86;
    const step=ph/(n - 0.15);
    const midRow=Math.floor(n/2);
    const pts=[];
    for(let i=0;i<n;i++) for(const x of[lx,mx,rx]) pts.push([x,oy+step*(i+0.45),i===midRow]);
    return pts;
  }

  if(v===1) return [[cx,cy]];
  if(v===2) return col1(2);
  if(v===3){
    // Diagonal: top-left, centre (red), bottom-right
    const offX=Math.min(pw,ph)*.28;
    const offY=Math.min(pw,ph)*.48;
    return [[cx-offX,cy-offY,false],[cx,cy,true],[cx+offX,cy+offY,false]];
  }
  if(v===4) return col2(2,2,.28,0.66);
  if(v===5){ const g=col2(2,2,.28,0.66); g.push([cx,cy,true]); return g; }
  if(v===6){
    const gx=.23;
    const lx=ox+pw*(.5-gx), rx=ox+pw*(.5+gx);
    const gapTop=0.40;   // gap between the top blue pair and the red 2x2 grid — ADJUST THIS
    const gapGrid=0.30;  // gap between the two rows inside the red 2x2 grid
    const totalSpan=(gapTop+gapGrid)*ph;
    const yTop=cy-totalSpan/2;
    const yMid=yTop+gapTop*ph;
    const yBot=yMid+gapGrid*ph;
    return [
      [lx,yTop,false],[rx,yTop,false],
      [lx,yMid,true],[rx,yMid,true],
      [lx,yBot,true],[rx,yBot,true],
    ];
  }
  if(v===7){
    const gx=.20;
    const lx=ox+pw*(.5-gx), rx=ox+pw*(.5+gx);
    const diagSpan=0.20; // vertical span of the diagonal-3 cluster above the grid
    const gapTop=0.26;   // gap between the diagonal-3 and the red 2x2 grid below — ADJUST THIS
    const gapGrid=0.28;  // gap between the two rows inside the red 2x2 grid
    const totalSpan=(diagSpan+gapTop+gapGrid)*ph;
    const yDiagTop=cy-totalSpan/2;
    const yDiagBot=yDiagTop+diagSpan*ph;
    const yDiagMid=(yDiagTop+yDiagBot)/2;
    const yMid=yDiagBot+gapTop*ph;
    const yBot=yMid+gapGrid*ph;
    const diagOffX=pw*.34; // horizontal spread of the diagonal-3 — wide enough to avoid overlap
    return [
      [cx-diagOffX,yDiagTop,false],[cx,yDiagMid,false],[cx+diagOffX,yDiagBot,false],
      [lx,yMid,true],[rx,yMid,true],
      [lx,yBot,true],[rx,yBot,true],
    ];
  }
  if(v===8) return col2(4,4,.20,0.14);
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
  let marker='';
  let sticks;
  if(v===1) sticks=souBird(w,h);
  else if(v===8) sticks=souWM(w,h);
  else{
    const layout=souLayout(v,w,h,red);
    sticks=layout.map(([cx,cy,sw,sh,isRed,centerSquareSh])=>souStick(cx,cy,sw,sh,isRed,false,false,false,centerSquareSh)).join('');
    if(red){
      // Red dotted marker just above the centre bamboo (5-sou). col2 always
      // pushes the centre stick last, so grab it by position rather than by
      // "is it red" — now that aka dora reddens every stick, that search
      // would just match the first (outer) one instead.
      const centreStick=layout[layout.length-1];
      if(centreStick){
        const[cx,cy,,sh]=centreStick;
        marker=`<circle cx="${cx}" cy="${cy-sh/2-base*.10}" r="${base*.06}" fill="#c82020" opacity="0.9"/>`;
      }
    }
  }
  return sticks+marker;
}

// 8-sou: a "W" (top) and a mirrored "M" (bottom), each built from 2 upright
// bamboo canes (outer legs) + 2 canes leaning in from the sides that meet at
// a point in the middle, with a short white "joint" rod smoothing the seam
// where the two leaning canes meet. Hand-tuned on a fixed 220x300 reference
// canvas per motif (600 tall for W+M together), then scaled onto the tile.
function souMMotif(caneW){
  const stickLen=145.6;
  const leftX=30, rightX=190, topY=150-stickLen/2;
  const leanLeftX=25, leanRightX=195, leanY=154, leanPivotY=topY+4;
  const leanAngle=38;
  const leanLeftBody=`<g transform="rotate(${-leanAngle},${leanLeftX},${leanPivotY})">${souStick(leanLeftX, leanY, caneW, stickLen, false, true, false, true)}</g>`;
  const leanLeftTip=`<g transform="rotate(${-leanAngle},${leanLeftX},${leanPivotY})">${souStickBottomCap(leanLeftX, leanY, caneW, stickLen, false)}</g>`;
  const leanRightBody=`<g transform="rotate(${leanAngle},${leanRightX},${leanPivotY})">${souStick(leanRightX, leanY, caneW, stickLen, false, true, false, true)}</g>`;
  const leanRightTip=`<g transform="rotate(${leanAngle},${leanRightX},${leanPivotY})">${souStickBottomCap(leanRightX, leanY, caneW, stickLen, false)}</g>`;
  const jointRod=`<rect x="105" y="185" width="10" height="13" rx="5.5" fill="#ffffff"/>`;
  return leanLeftTip+leanRightTip+leanLeftBody+leanRightBody+jointRod+
    souStick(leftX, 150, caneW, stickLen, false)+souStick(rightX, 150, caneW, stickLen, false);
}
function souWM(w,h){
  // Tweak these to reshape the W/M design (all within the fixed 220x600
  // reference frame, before it gets fit onto the actual tile size):
  const glyphScaleX=0.8;  // width of each W/M glyph
  const glyphScaleY=1.63;  // height of each W/M glyph
  const gap=-250;         // vertical gap between the W and the M
  const topY=18;           // extra vertical offset for the W (top) piece
  const bottomY=45;        // extra vertical offset for the M (bottom) piece

  // Match 2-sou's rendered stick width. 2-sou's stick is uw*.40*0.7*0.9 wide
  // (uw = 0.86*w, since souLayout's pad = w*.07) and its visible rod is 60%
  // of that; solving backwards through this glyph's scale(glyphScaleX,...)
  // and the final scale(w/220,...) below gives the reference-frame cane
  // width that renders at the same final pixel width.
  const caneW=(0.86*.40*0.7*0.9*220)/glyphScaleX;

  const refCx=110, refCy=150;
  const m=souMMotif(caneW);
  const resized=`<g transform="translate(${refCx},${refCy}) scale(${glyphScaleX},${glyphScaleY}) translate(${-refCx},${-refCy})">${m}</g>`;
  const wTop=`<g transform="translate(0,${topY}) rotate(180,${refCx},${refCy})">${resized}</g>`;
  const mBottom=`<g transform="translate(0,${300*glyphScaleY+gap+bottomY})">${resized}</g>`;
  return `<g transform="scale(${w/220},${h/600})">${wTop}${mBottom}</g>`;
}

// Bamboo stick built from 6 flat shapes, hand-tuned at a 220x840 reference
// canvas (rendered bbox: x 20-220, y 90.948-738.012) and reproduced here by
// wrapping that exact template in a transform that maps its bbox onto the
// (cx,cy,sw,sh) slot given by souLayout.
const SOU_STICK_CAP_PATH='M54.72,45 L165.28,45 Q179.28,45 190.90,52.81 A100,70 0 1 1 29.10,52.81 Q40.72,45 54.72,45 Z';
function souStick(cx,cy,sw,sh,isRed,hideTopCap=false,bottomCapOnTop=false,hideBottomCap=false,centerSquareSh=null){
  const fill=isRed?'#c8262a':'#1c7530';
  const scaleX=sw/200, scaleY=sh/647.064;
  const outer=`translate(${cx-sw/2},${cy-sh/2}) scale(${scaleX},${scaleY}) translate(-20,-90.948)`;
  // Centre square and both end caps normally get squished by the same
  // scaleY as the rest of the stick, but when centerSquareSh is given (e.g.
  // matching a different value's stick length) they're each rescaled about
  // their own centre so they render at the same absolute size as that
  // reference stick's — only the straight rod actually gets shorter.
  const sizeCompensation=centerSquareSh?centerSquareSh/sh:1;
  const topCapShape=`<path d="${SOU_STICK_CAP_PATH}" fill="${fill}" transform="translate(10,10)"/>`;
  const topCap=hideTopCap?'':(sizeCompensation===1?topCapShape:
    `<g transform="translate(0,114.48) scale(1,${sizeCompensation}) translate(0,-114.48)">${topCapShape}</g>`);
  const bottomCapShape=`<path d="${SOU_STICK_CAP_PATH}" fill="${fill}" transform="translate(10,610) rotate(180,110,104.48)"/>`;
  const bottomCap=hideBottomCap?'':(sizeCompensation===1?bottomCapShape:
    `<g transform="translate(0,714.48) scale(1,${sizeCompensation}) translate(0,-714.48)">${bottomCapShape}</g>`);
  const rod=`<rect x="60" y="140" width="120" height="548.96" fill="${fill}"/>`+
    `<rect x="97.4" y="86" width="45.2" height="656.96" rx="22.6" fill="#ffffff"/>`;
  const squareShape=`<rect x="20" y="353.48" width="200" height="122" rx="50" fill="${fill}"/>`+
    `<rect x="58.8" y="385.648" width="122.4" height="57.664" rx="30.6" fill="#ffffff"/>`;
  const square=sizeCompensation===1?squareShape:
    `<g transform="translate(0,414.48) scale(1,${sizeCompensation}) translate(0,-414.48)">${squareShape}</g>`;
  const body=rod+square;
  const inner=bottomCapOnTop?(topCap+body+bottomCap):(topCap+bottomCap+body);
  return `<g transform="${outer}"><g transform="translate(0,41.448) scale(1,0.9)">${inner}</g></g>`;
}

// Just the bottom cap alone, positioned/scaled exactly as it would be inside
// souStick — for pulling a cane's tip out to render as a separate top layer.
function souStickBottomCap(cx,cy,sw,sh,isRed){
  const fill=isRed?'#c8262a':'#1c7530';
  const scaleX=sw/200, scaleY=sh/647.064;
  const outer=`translate(${cx-sw/2},${cy-sh/2}) scale(${scaleX},${scaleY}) translate(-20,-90.948)`;
  return `<g transform="${outer}"><g transform="translate(0,41.448) scale(1,0.9)">`+
    `<path d="${SOU_STICK_CAP_PATH}" fill="${fill}" transform="translate(10,610) rotate(180,110,104.48)"/>`+
    `</g></g>`;
}

function souLayout(v,w,h,red=false){
  const pad=w*.07;
  const uw=w-pad*2, uh=h-pad*2;
  const midX=w/2;
  const out=[];

  // GAP_RATIO: fraction of slot height that is empty gap between sticks
  const GAP=0.28;

  function placeCol(x, n, sw, startY, totalH, hMult=1, allRed=false, shOverride=null, centerSquareSh=null){
    // Divide totalH into n equal slots, place stick in centre of each slot with gap
    const slot=totalH/n;
    const sh=shOverride ?? (slot*(1-GAP)*hMult);
    for(let i=0;i<n;i++){
      const cy=startY+slot*(i+0.5);
      out.push([x, cy, sw, sh, allRed, centerSquareSh]);
    }
  }

  function col1(n, hMult=1, wMult=1){
    const sw=uw*.40*wMult;
    placeCol(midX, n, sw, pad, uh, hMult);
  }

  function col2(nL,nR,redCentre=false,swOverride=null,shOverride=null,xOffset=uw*.25,allRed=false){
    const sw=swOverride ?? uw*.33;
    const lx=midX-xOffset, rx=midX+xOffset;
    placeCol(lx, nL, sw, pad, uh, 1, allRed, shOverride);
    placeCol(rx, nR, sw, pad, uh, 1, allRed, shOverride);
    if(redCentre){
      // Centre stick: always red — this is the traditional single red pip
      // that a normal (non-bonus) 5-sou tile has. When allRed is also set
      // (the aka dora / bonus red-5 tile), every OTHER stick is red too
      // (via placeCol above), matching how the red flag turns every pip/
      // numeral red on the man/pin tiles.
      const slot=uh/nL;
      const sh=shOverride ?? (slot*(1-GAP));
      out.push([midX, h/2, sw, sh, true]);
    }
  }

  function col3(n, redCol=-1, swOverride=null, centerSquareSh=null){
    const sw=swOverride ?? uw*.23*0.9;
    const xs=[midX-uw*.35, midX, midX+uw*.35];
    xs.forEach((x,i)=>placeCol(x, n, sw, pad, uh, 1, i===redCol, null, centerSquareSh));
  }

  function triangle3(swOverride=null, shOverride=null){
    // One stick on top, two side-by-side below it — triangular arrangement
    const sw=swOverride ?? uw*.30;
    const rowH=uh/2;
    const sh=shOverride ?? (rowH*(1-GAP));
    const topCy=pad+rowH*0.5;
    const botCy=pad+rowH*1.5;
    const offsetX=uw*.35;
    out.push([midX, topCy, sw, sh, false]);
    out.push([midX-offsetX, botCy, sw, sh, false]);
    out.push([midX+offsetX, botCy, sw, sh, false]);
  }

  function grid3x2(shOverride=null,swOverride=null){
    // 3 columns x 2 rows — width kept narrower than the 2-sou stick since
    // three of them must fit side-by-side without overflowing the tile
    const sw=swOverride ?? uw*.30;
    const xs=[midX-uw*.35, midX, midX+uw*.35];
    const rowH=uh/2;
    const sh=shOverride ?? (rowH*(1-GAP));
    for(const x of xs){
      out.push([x, pad+rowH*0.5, sw, sh, false]);
      out.push([x, pad+rowH*1.5, sw, sh, false]);
    }
  }

  function oneOnTopOf3x2(swOverride=null,centerSquareSh=null){
    // One stick on top, then two rows of three side-by-side below it (7 total)
    const sw=swOverride ?? uw*.23;
    const rowH=uh/3;
    const sh=rowH*(1-GAP);
    const xs=[midX-uw*.35, midX, midX+uw*.35];
    out.push([midX, pad+rowH*0.5, sw, sh, true, centerSquareSh]); // top stick is red
    for(const x of xs) out.push([x, pad+rowH*1.5, sw, sh, false, centerSquareSh]);
    for(const x of xs) out.push([x, pad+rowH*2.5, sw, sh, false, centerSquareSh]);
  }

  // 2-sou's per-stick size (col1's sw*wMult, sh*hMult with n=2) — 3-6 sou match this exactly
  const stick2W=uw*.40*0.7*0.9;
  const stick2H=(uh/2)*(1-GAP)*1.2;
  // Horizontal distance from centre to each pair of bamboos — tweak these for 4s/5s
  const pairXOffset4=uw*.25;
  const pairXOffset5=uw*.35;
  // 6-sou's stick width — 7-sou and 9-sou reuse this (scaled down further)
  // so their sticks (and their centre squares) match each other, just
  // narrower and shorter than 6-sou's.
  const stick6W=uw*.30*0.9;
  const stick79W=stick6W*0.9;

  if(v===2) col1(2, 1.2, 0.7*0.9);
  else if(v===3) triangle3(stick2W, stick2H);
  else if(v===4) col2(2,2,false,stick2W,stick2H,pairXOffset4);
  else if(v===5) col2(2,2,true,stick2W,stick2H,pairXOffset5,red);
  else if(v===6) grid3x2(stick2H,stick6W);
  else if(v===7) oneOnTopOf3x2(stick79W, stick2H);
  else if(v===9) col3(3, 1, stick79W, stick2H);
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
  const fs=Math.round(h*.65);
  const scaleY=1.2; // vertical stretch factor
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
// Table layout: every seat-indexed value from the server (scores, discards,
// melds, riichi flags, ...) is in ABSOLUTE seat order (0-3, stable for the
// whole game). To place a player at a screen position, rotate by your own
// seat: abs=(mySeat+i)%4, id=P[i] — i.e. P[0]='b' is always mySeat itself
// (bottom), P[1]='r' is mySeat+1 (your shimocha / next player, drawn on your
// right per real mahjong table convention), P[2]='t' is across (toimen),
// P[3]='l' is mySeat+3 (your kamicha / previous player, on your left). This
// exact `abs=(mySeat+i)%4, id=P[i]` pattern repeats throughout this file
// (renderState, onRoundStart, etc.) — keep it consistent if you touch it, a
// mismatch here silently shows the wrong player's info in the wrong seat.
const P=['b','r','t','l'];

// Core client state — mostly set by onMsg's handlers below. `lastState` is
// the previous game_state message, kept around so renderState can diff
// against it (e.g. "did a new pon just happen" for sound effects).
let ws=null, mySeat=-1, inGame=false, selId=null, lastState=null, isReady=false, discarding=false, pendingGameOver=null;

function show(id){['s-start','s-lobby','s-game','s-end'].forEach(s=>$(s).classList.toggle('hidden',s!==id));}
function $(id){return document.getElementById(id);}


// WEBSOCKET — connection + message dispatch. Auto-reconnects on close/error
// with a flat 2s retry (no backoff) — fine for a small self-hosted game, not
// meant to survive a real network partition gracefully.
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

// Server -> client message router. Lobby/lifecycle messages (joined,
// room_update, game_start, round_start/end, game_over, ready_status) are
// handled regardless of state; the `if(!inGame) return;` gate below that
// means the remaining message types (game_state, riichi, kan, chat) are
// only meaningful — and only processed — once actually seated at a table.
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
  else if(m.type==='kan'){callBanner('kan',m.name||'Player','カン');}
  else if(m.type==='pon'){callBanner('pon',m.name||'Player','ポン');}
  else if(m.type==='chi'){callBanner('chi',m.name||'Player','チー');}
  else if(m.type==='chat'){showChatMsg(m.name,m.text,m.color);}
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

// Absolute seat -> screen position id ('b'/'r'/'t'/'l'). The inverse of the
// `abs=(mySeat+i)%4` pattern used everywhere else — use this one when you
// have an absolute seat number and need to know where on screen it lives.
function pid(abs){return P[(abs-mySeat+4)%4];}


// RENDER STATE — called every time a game_state message arrives (`m` = new
// state, `prev` = the previous game_state, or undefined on the first call).
// This is a full re-render, not a diff/patch — every seat's UI panel, hand,
// discards, and melds are rebuilt from scratch each call. `prev` exists only
// so specific bits of code below can detect "what just changed" (new pon/
// chi/kan, new discard, new riichi) purely to decide which sound effect to
// play; it's not used to skip any rendering work. Roughly in order: topbar
// (wind/round/wall count/honba) -> dora -> per-seat scores/wind/turn
// indicator -> my hand -> opponent hands (face-down count only) -> discard
// piles -> meld sfx-diffing -> discard piles for real -> action buttons
// (drawActions, called at the very end once all the above state is settled).
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

// Tap-to-select, tap-again-to-discard: first click on a tile just selects
// it (highlights + shows available action buttons for that selection);
// clicking the SAME tile again is what actually sends the discard. `discarding`
// is a one-shot latch to swallow extra clicks between sending the action and
// the next game_state confirming it, so a slow network can't double-discard.
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
// Draws chi/pon/kan groups with correct orientation per player. Real riichi
// tables sideways-rotate the called tile within the group to show which
// neighbor it was called from: `dir` (called-from seat, relative to whoever
// owns this meld) is 1=kamicha(left) -> called tile goes on the left end,
// 2=toimen(across) -> called tile goes in the middle, 3=shimocha(right) ->
// called tile goes on the right end. `viewerSeat` is the OWNER of the meld
// (not the person looking at the screen) — ankan has no `fromSeat` (self-
// declared) so it defaults to dir=1, though ankan's rendering below doesn't
// actually use dir since all 4 tiles are drawn face-down/symmetric anyway.
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


// ACTION BAR — buttons shown on player's turn. Two mutually-exclusive
// branches driven straight off server-computed flags (this file never
// re-derives legality itself, it just renders whatever the server already
// said is available — see _sendState in room.js for canTsumo/canRiichi/
// canAnkan/canKakan/canKyuushu, and _checkReactions for pending.options):
//   mine   it's your own turn — tsumo/ankan/kakan/riichi/discard/kyuushu
//   react  someone else just discarded and you can ron/pon/kan/chi/pass
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

    // LEFT: ANKAN — one button per candidate tile, each showing the tile's
    // face so multiple candidates (rare, but possible) aren't just two
    // identically-labeled buttons.
    const canAnkan=m.canAnkan||[];
    canAnkan.forEach(tileKey=>{
      abTile(bar,keyToTile(tileKey),'ANKAN','bkan',()=>wss({type:'action',action:{type:'ankan',tileKey}}));
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

// "<v><suit>" tile key (e.g. "3m") -> a plain tile object usable by tsvg/mkEl.
function keyToTile(k){ return {v:parseInt(k), s:k.slice(-1)}; }

// Same as ab(), but shows the tile's face next to the label — used where
// multiple same-labeled buttons could otherwise be indistinguishable (e.g.
// two ANKAN candidates at once).
function abTile(c,tile,l,cls,fn){
  const b=document.createElement('button');b.className='ba ba-tile '+cls;
  // mkElMd gives the tile its usual ivory face + gold border (same as
  // discards/melds) — a bare tsvg() string has a transparent background and
  // is unreadable against a dark button like .bkan's purple gradient.
  b.appendChild(mkElMd(tile));
  const span=document.createElement('span');span.textContent=l;
  b.appendChild(span);
  b.onclick=fn;c.appendChild(b);
}

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

// Shared meld renderer for the round-end panel (winner's hand reveal, and
// tenpai-hand reveal at an exhaustive draw) — flat, no rotation, since
// there's no "seat" to orient toward here. Ankan stays half face-down even
// at final reveal, matching table convention; every other meld type shows
// fully face-up with the originally-called tile marked.
function appendEndPanelMeld(container,meld){
  const calledId=meld.calledTileId;
  if(meld.kanType==='ankan'){
    const back=()=>{const d=document.createElement('div');d.className='kan-back re-kan-back';return d;};
    container.appendChild(back());
    container.appendChild(mkElMd(meld.tiles[1]));
    container.appendChild(mkElMd(meld.tiles[2]));
    container.appendChild(back());
  } else {
    for(const t of meld.tiles){
      const el=mkElMd(t);
      if(t.id===calledId) el.classList.add('called');
      container.appendChild(el);
    }
  }
}


// CHAT
// Palette for the swatch picker next to the chat bar — message text colour
// (both the floating danmaku and the "<name>:" tag in history) is white
// by default, overridable per-player via this picker.
const CHAT_COLORS=['#ffffff','#f0d080','#ff6b6b','#6bff8f','#6bb6ff','#ff8fd6','#6bfff0','#ffb366'];
let myChatColor=CHAT_COLORS[0];
let chatOpen=false, unreadCount=0, colorPickerOpen=false;

// $() guards below: the colour swatch button/popup may not be present in
// every build of index.html. A thrown error here would abort the rest of
// the startup script — including connect() — leaving every button that
// depends on the websocket silently non-functional, so each function
// bails out early instead of assuming the elements exist.
function initColorPicker(){
  const picker=$('chat-color-picker'), btn=$('chat-color-btn');
  if(!picker||!btn) return;
  picker.innerHTML='';
  CHAT_COLORS.forEach(c=>{
    const sw=document.createElement('button');
    sw.className='chat-color-swatch'+(c===myChatColor?' selected':'');
    sw.style.background=c;
    sw.type='button';
    sw.setAttribute('aria-label','Set message colour to '+c);
    sw.onclick=()=>selectChatColor(c);
    picker.appendChild(sw);
  });
  btn.style.background=myChatColor;
}

function selectChatColor(c){
  myChatColor=c;
  const btn=$('chat-color-btn'); if(btn) btn.style.background=c;
  toggleColorPicker(false);
  initColorPicker();
}

function toggleColorPicker(force){
  colorPickerOpen=force!==undefined?force:!colorPickerOpen;
  const picker=$('chat-color-picker'), btn=$('chat-color-btn');
  if(!picker||!btn) return;
  picker.classList.toggle('open',colorPickerOpen);
  btn.classList.toggle('open',colorPickerOpen);
  btn.setAttribute('aria-expanded',String(colorPickerOpen));
}

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
  wss({type:'chat',text,color:myChatColor});
  inp.value='';
}

function showChatMsg(name,text,color){
  // Server validates color against its own copy of the palette and falls
  // back to white — see room.js chat().
  const msgColor=color||'#fff';

  // ── Floating danmaku message — random height, slides right-to-left ──
  const cf=$('chat-float');
  const div=document.createElement('div');
  div.className='chat-msg';
  div.style.color=msgColor;
  div.style.top=(10+Math.random()*72)+'%'; // stay clear of the topbar and action bar
  div.textContent=text; // no sender name — that's already visible in chat history
  cf.appendChild(div);
  setTimeout(()=>div.remove(),7100);

  // ── History entry ──
  const history=$('chat-history');
  const now=new Date();
  const time=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const entry=document.createElement('div');
  entry.className='chat-entry';
  entry.innerHTML=
    `<span class="chat-entry-who" style="color:${msgColor}">${escHtml(name)}</span>`+
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
  callBanner('riichi',m.name||'Player',label);
}
function toast(msg){
  const tc=$('tc'),t=document.createElement('div');
  t.className='toast';t.textContent=msg;
  tc.appendChild(t);setTimeout(()=>t.remove(),3000);
}

// Call banner (pon/kan/chi/riichi) — slides in from the bottom-left and
// settles across the felt; see .call-banner / @keyframes cb-slide.
function callBanner(type,name,label){
  const layer=$('cb-layer'); if(!layer) return;
  // .cb-layer is a flex row container, so a second banner appended while the
  // first is still fading out would sit beside it (split left/right) rather
  // than replace it. Drop any banner still in flight immediately so only the
  // newest call is ever shown.
  layer.querySelectorAll('.call-banner').forEach(el=>el.remove());
  const b=document.createElement('div');
  b.className='call-banner';b.dataset.type=type;
  const content=document.createElement('div');content.className='cb-content';
  const lb=document.createElement('span');lb.className='cb-label';lb.textContent=label;
  const nm=document.createElement('span');nm.className='cb-name';
  const who=document.createElement('b');who.textContent=name;
  nm.appendChild(who);nm.appendChild(document.createTextNode(' called'));
  content.appendChild(lb);content.appendChild(nm);
  b.appendChild(content);
  layer.appendChild(b);setTimeout(()=>b.remove(),2400);
}

// Round-start title card (wind + round + honba) — see .rs-plate / @keyframes
// rs-wind-in. Separate from callBanner() since this fires once per hand and
// is meant to be read together with the "dealing tiles" loading overlay
// rather than as a reactive notification.
function roundStartBanner(wind,round,honba){
  const layer=$('rs-layer'); if(!layer) return;
  layer.innerHTML='';
  const scrim=document.createElement('div');scrim.className='rs-scrim';
  const plate=document.createElement('div');plate.className='rs-plate';
  const w=document.createElement('div');w.className='rs-wind';w.textContent=wind;
  const sub=document.createElement('div');sub.className='rs-sub';
  const r=document.createElement('span');r.textContent=round;
  const dot=document.createElement('i');dot.textContent='·';
  const h=document.createElement('span');h.textContent=honba;
  sub.appendChild(r);sub.appendChild(dot);sub.appendChild(h);
  const start=document.createElement('div');start.className='rs-start';start.textContent='開始';
  plate.appendChild(w);plate.appendChild(sub);plate.appendChild(start);
  layer.appendChild(scrim);layer.appendChild(plate);
  setTimeout(()=>{scrim.remove();plate.remove();},3400);
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
  roundStartBanner(windChar[wind-1], rnd+'局', (m.honba||0)+'本場');
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
  if(han===4&&fu>=40) return {label:'満貫',en:'Mangan',cls:'lbl-mangan'}; // kiriage mangan: 4han/40fu already hits the 2000-base cap
  if(han===3&&fu>=70) return {label:'満貫',en:'Mangan',cls:'lbl-mangan'}; // ditto, 3han/70fu
  return null;
}


// Round-end panel (win/draw/abortive-draw/nagashi) — purely presentational,
// just formats whatever room.js already computed and sent in the round_end
// message (yakuList, han/fu, dora, scores, ...). No scoring logic lives
// here; if a number on this panel looks wrong, the bug is almost certainly
// in server/mahjong.js or server/room.js, not this rendering.
function onEnd(m){
  try{
  inGame=false;
  const loader=$('game-loading'); if(loader) loader.style.display='none';
  $('chat-bar').style.display='none';$('chat-panel').classList.remove('open');chatOpen=false;
  $('dora-panel').style.display='none';
  const reasonLabels={tsumo:'ツモ - TSUMO',ron:'ロン - RON',draw:'流局 - Exhaustive Draw',suukaikan:'四開槓 - Suukaikan',nagashi:'流し満貫 - Mangan at Draw',kyuushu:'九種九牌 - Kyuushu Kyuuhai'};
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
  for(const meld of(m.melds||[])) appendEndPanelMeld(tileRow,meld);
  wt.appendChild(tileRow);
  // Tenpai reveal (exhaustive draw only) — name + hand for each tenpai
  // player; noten hands stay private (server sends null for those seats).
  const tp=$('re-tenpai');tp.innerHTML='';
  if(m.reason==='draw'&&Array.isArray(m.tenpaiHands)){
    m.tenpaiHands.forEach((hand,seat)=>{
      if(!hand) return;
      const row=document.createElement('div');row.className='re-tenpai-row';
      const nameEl=document.createElement('div');nameEl.className='re-tenpai-name';
      nameEl.textContent=seat===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[seat]||`Seat ${seat}`);
      row.appendChild(nameEl);
      const tiles=document.createElement('div');tiles.className='re-tile-row';
      for(const t of hand) tiles.appendChild(mkElMd(t));
      for(const meld of(m.tenpaiMelds?.[seat]||[])) appendEndPanelMeld(tiles,meld);
      row.appendChild(tiles);
      tp.appendChild(row);
    });
  }
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
if($('chat-color-btn')) $('chat-color-btn').onclick=()=>toggleColorPicker();
initColorPicker();
connect();