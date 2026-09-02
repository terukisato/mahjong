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
  const numColor=red?'#c52626':'#1a1a1a';
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
  const ringCol=(isRed||hasRedInner||forceRedInner)?'#c82020':'#1a1a1a';
  const outerCol=hasRedOuter?'#c82020':'#1a1a1a';
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
    `<circle cx="${hx+hr*0.38}" cy="${hy-hr*0.28}" r="${hr*0.23}" fill="#1a1a1a"/>`,
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
// melds, riichi flags, ...) is in ABSOLUTE seat order (0..numSeats-1, stable
// for the whole game). To place a player at a screen position, rotate by
// your own seat: abs=(mySeat+i)%numSeats, id=P[i] — i.e. P[0]='b' is always
// mySeat itself (bottom), P[1]='r' is mySeat+1 (your shimocha / next
// player, drawn on your right per real mahjong table convention), P[2]='t'
// is across (toimen, 4-player only — sanma has no seat directly across, so
// P drops it), and the last entry is your kamicha (previous player, on
// your left). This exact `abs=(mySeat+i)%numSeats, id=P[i]` pattern repeats
// throughout this file (renderState, onRoundStart, etc.) — keep it
// consistent if you touch it, a mismatch here silently shows the wrong
// player's info in the wrong seat. numSeats/P are set once per game, from
// game_start's numPlayers field (see startGame) — 3 for sanma, 4 otherwise.
let numSeats=4;
let P=['b','r','t','l'];

// Core client state — mostly set by onMsg's handlers below. `lastState` is
// the previous game_state message, kept around so renderState can diff
// against it (e.g. "did a new pon just happen" for sound effects).
let ws=null, mySeat=-1, inGame=false, selId=null, lastState=null, isReady=false, discarding=false, pendingGameOver=null;
// Session-resume (see connect()/visibilitychange/onMsg 'resume_result').
// activeGameResume = {roomId, seat, token} — stashed at game_start, mirrored
// into sessionStorage so it survives a full reload (a suspended mobile tab
// keeps the in-memory copy; a killed-and-reopened one doesn't), cleared at
// game_over / leaving. Reconnecting is silent: no overlay, no bot ever takes
// the seat — the game just carries on for the bots and waits at this seat
// until the socket is back. lastHiddenAt tracks how long the tab was
// backgrounded so a brief app-switch doesn't force an unnecessary reconnect.
let myRoomId=null, activeGameResume=null, lastHiddenAt=0;
function loadResume(){
  if(activeGameResume) return activeGameResume;
  try{ const r=JSON.parse(sessionStorage.getItem('mj-resume')||'null');
    if(r&&r.roomId!=null&&r.seat!=null&&r.token) activeGameResume=r; }catch(e){}
  return activeGameResume;
}
function setResume(r){
  activeGameResume=r;
  try{ r?sessionStorage.setItem('mj-resume',JSON.stringify(r)):sessionStorage.removeItem('mj-resume'); }catch(e){}
}
// Play Again (same-room rematch) state — isPrivateRoomGame/isRoomHost come
// from 'joined' (see onMsg below: quick_match never sets isHost and marks
// itself with `instant`, so both stay false there, keeping the whole
// feature a no-op for quick_match same as Room.playAgain/hostStartPlayAgain
// on the server). playAgainSeats/lastGameOverNames are set fresh by every
// game_over/play_again_status, and only ever rendered while #s-end shows
// the game-over buttons (bplay-again/bplay-again-start).
let isPrivateRoomGame=false, isRoomHost=false, playAgainSeats=[], lastGameOverNames=null;
// Last 'round_end' message shown on the results screen — kept around
// purely so a resize (see scheduleTileRedraw) can redraw its tile artwork
// at the new size, the same reason lastState is kept for the live board.
// Deliberately never reset back to null when that screen is left — the
// resize handler only ever acts on it while #s-end is actually visible, so
// a stale reference just sits here unused rather than needing to be
// cleared from every path that can dismiss that screen.
let lastEndState=null;
// Which entry of lastEndState.winners is currently showing on the results
// panel (see renderWinnerNav/renderWinnerInfo) — only ever >0 when a
// double/triple ron's prev/next arrows have stepped past the first winner.
// Reset to 0 at the top of every onEnd(), same "stale reference is harmless, just
// unused" reasoning as lastEndState above for everything in between.
let currentEndWinnerIdx=0;
// Theme ids unlocked for the currently-entered name, refreshed whenever a
// 'stats' response arrives (see onMsg) — gates the locked/unlocked styling
// in renderVoiceThemes. 'Default' is always available even before any
// stats round-trip has happened.
let unlockedThemes=['Default'];

// True for exactly as long as the round-start card (.rs-layer.blocking) OR
// the game-start roll call (.gs-layer.blocking, see gameStartIntro) is
// visible — see roundStartBanner and onMsg's deferred-game_state handling
// just above it. Both cards share this one gate rather than each having
// their own, since the deferral behavior they need is identical.
// pendingBannerGameState holds the latest game_state that arrived during
// that window (only the latest matters — nothing in between was ever
// shown), applied the instant the card clears.
let roundStartBannerActive=false, pendingBannerGameState=null;

// game_start payload waiting for the game to actually finish loading (its
// first real game_state) before gameStartIntro() fires — see startGame and
// the game_state branch in onMsg. null whenever no roll call is pending.
let pendingGameStartIntro=null;

// Pending playNameplateSfx() timers, one per roll-call row (see
// gameStartIntro) — tracked so clearActiveBanners can cancel any not yet
// fired if the player leaves mid-animation, instead of a chime playing
// into whatever screen they've navigated to since.
let gsChimeTimers=[];

// Showing 's-end' deliberately leaves 's-game' un-hidden underneath, so the
// final board state shows through the darkened round-end/game-over overlay
// (see #s-end in style.css) instead of a blank screen. Every other target
// screen still hides all three others as normal.
function show(id){['s-start','s-lobby','s-game','s-end'].forEach(s=>{
  if(id==='s-end'&&s==='s-game') return;
  $(s).classList.toggle('hidden',s!==id);
});}
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
  // Silent "stay logged in" auto-unlock — fires once per (re)connect, using
  // whatever token onProfileUnlocked stashed the last time this profile was
  // unlocked with the toggle on (see toggleProfileRemember/unlockProfile).
  // The `silent:true` echoed back in the response is what tells
  // onProfileUnlocked not to treat a failure here as a wrong-code error.
  ws.onopen=()=>{
    try{
      const name=localStorage.getItem('mj-remember-name');
      const token=localStorage.getItem('mj-remember-token');
      if(name&&token) wss({type:'unlock_profile_token',name,token});
    }catch(e){}
    // Silently reconnect straight back into a game this client was dropped
    // from (see activeGameResume). `warm` = we still have the game in memory
    // (a tab suspend, not a reload), so the server just re-sends game_state
    // and it re-renders in place. The server either restores the seat or, if
    // the game's gone, replies resume_result{ok:false} (see onMsg).
    const r=loadResume();
    if(r) wss({type:'resume',roomId:r.roomId,seat:r.seat,token:r.token,warm:inGame&&!!lastState});
  };
  ws.onmessage=e=>{try{onMsg(JSON.parse(e.data));}catch(ex){console.error(ex);}};
  ws.onclose=()=>{setTimeout(connect,2000);};
  ws.onerror=()=>{try{ws.close();}catch{}};
}
function wss(d){if(ws&&ws.readyState===1)ws.send(JSON.stringify(d));}

// Mobile browsers suspend a backgrounded tab and often silently kill its
// WebSocket; `readyState` can still read OPEN for a while after. When the
// player comes back mid-game, verify the socket is actually alive and
// rebuild it if not (the rebuild then silently auto-resumes via connect()'s
// ws.onopen) rather than waiting for the next doomed send to fail. A long
// absence almost certainly means a dead socket, so skip straight to the
// rebuild; a short one gets an app-level ping and only rebuilds if no pong
// comes back — see probeConnection. (The old "leave anything under 8s
// alone" shortcut is gone: even a 2-3s app switch is enough for a mobile OS
// to suspend the tab and quietly drop the socket while readyState still
// reads OPEN, which is exactly the case that stranded the player.)
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){ lastHiddenAt=Date.now(); return; }
  if(!inGame||!loadResume()) return;
  const dead=!ws||ws.readyState===2||ws.readyState===3;
  if(dead||Date.now()-lastHiddenAt>8000) reconnectNow();
  else probeConnection();
});

// App-level liveness probe. The browser WebSocket API can't send protocol
// pings or observe pongs, and a mobile-suspended socket keeps reporting
// readyState OPEN long after the OS silently killed it (see the server's
// own heartbeat comment in index.js) — so an otherwise-dead socket is only
// noticed ~30-60s later, when the server's ping sweep terminates it and the
// client finally gets a close event. This sends {type:'ping'} and, if no
// {type:'pong'} (handled in onMsg) comes back fast, rebuilds the socket.
// Fired on return-to-foreground mid-game and right after every table action
// (see act()) — the two moments a wedged socket actually strands the player.
let pingProbeTimer=null;
function probeConnection(){
  if(!inGame||!loadResume()) return;
  if(!ws||ws.readyState===2||ws.readyState===3){ reconnectNow(); return; }
  if(ws.readyState===0) return; // still opening — its own onopen will resume
  clearTimeout(pingProbeTimer);
  pingProbeTimer=setTimeout(()=>{ pingProbeTimer=null; reconnectNow(); },2500);
  wss({type:'ping'});
}

// Detach the current socket and open a fresh one exactly once (connect()'s
// ws.onopen then re-runs profile unlock + game resume). Null the old
// handlers first so its own onclose can't also schedule a second connect().
function reconnectNow(){
  // Cancel any in-flight probe timer so its own fallback can't fire a
  // second reconnect on top of the fresh socket that's now opening.
  clearTimeout(pingProbeTimer); pingProbeTimer=null;
  // A discard was in flight when the socket went — have the post-resume
  // game_state re-send it if it never actually reached the server.
  if(pendingDiscardTileId!=null) discardRetryArmed=true;
  const old=ws;
  if(old){ old.onopen=old.onmessage=old.onclose=old.onerror=null; try{ old.close(); }catch(e){} }
  ws=null;
  connect();
}

// Piggybacks a liveness probe on every table action (turn plays and
// reactions alike). If the socket died while backgrounded the send just
// vanishes and the player is left tapping a button that does nothing until
// the server's 30s heartbeat notices — the probe catches that in ~2.5s and
// rebuilds instead. The action itself is NOT replayed: resume re-sends the
// authoritative game_state, so either the action already landed (state
// reflects it) or it didn't (buttons are back) and the player taps again.
// Discards opt out — they have their own richer optimistic/rollback
// watchdog (see sendDiscardAction).
function act(action){ wss({type:'action',action}); probeConnection(); }

// Server -> client message router. Lobby/lifecycle messages (joined,
// room_update, game_start, round_start/end, game_over, ready_status) are
// handled regardless of state; the `if(!inGame) return;` gate below that
// means the remaining message types (game_state, riichi, kan, chat) are
// only meaningful — and only processed — once actually seated at a table.
function onMsg(m){
  if(m.type==='hello') return;
  // Answer to probeConnection()'s app-level ping — the socket is alive, so
  // stand down the fallback reconnect it armed.
  if(m.type==='pong'){ clearTimeout(pingProbeTimer); pingProbeTimer=null; return; }
  // Reconnect handshake (see connect()'s ws.onopen). ok → a game_state
  // (warm) or game_start(resumed)+game_state (cold reload) follows and the
  // board picks up where it left off; not ok → the game's gone (ended /
  // server restarted / stale token), so drop the stale resume state and,
  // if we were sitting on a now-dead board, return to the lobby.
  if(m.type==='resume_result'){
    if(m.ok){
      // Clear any mid-animation state frozen from when the tab was
      // suspended so the incoming game_state renders straight away.
      if(m.warm){ roundStartBannerActive=false; pendingBannerGameState=null; discarding=false; clearActiveBanners(); }
    } else {
      setResume(null);
      if(inGame){ inGame=false; toast('This game has ended.'); resetLobby(); }
    }
    return;
  }
  // `instant` marks a quick_match reply — the server starts that game in
  // the same tick (see server/index.js), so 'game_start' is right behind
  // this message; skip the waiting-room screen entirely rather than flash
  // "Looking for players..." for a single frame before it's replaced.
  if(m.type==='joined'){
    mySeat=m.seat;myRoomId=m.roomId??myRoomId;currentRoomRules=m.rules||null;currentRoomMode=m.gameMode||null;currentRoomNumPlayers=m.numPlayers||null;isPrivateRoomGame=!m.instant;isRoomHost=!!m.isHost;
    if(!m.instant)showWaiting();
    // Fire off any invites picked in the Create Room flow (see
    // rulesSelectedInvites/openCreateRoomRules) now that the room this
    // connection just created actually exists — invite_player needs a real
    // roomId to invite into, which doesn't exist until this very message.
    // isHost-gated so a join_room's own 'joined' (isHost always false)
    // never accidentally replays a stale pick from the last room this
    // connection created.
    if(m.isHost&&rulesSelectedInvites.size){
      for(const name of rulesSelectedInvites) wss({type:'invite_player',name});
      rulesSelectedInvites=new Set();
    }
    return;
  }
  if(m.type==='room_update'){updateSlots(m.seats);return;}
  // Table seating is reshuffled server-side on every game_start (see
  // Room.start in room.js) — the lobby-join seat from 'joined' is only a
  // starting guess, this personalized message's `seat` is the real one.
  if(m.type==='game_start'){
    if(Number.isInteger(m.seat))mySeat=m.seat;
    if(m.roomId!=null)myRoomId=m.roomId;
    // Stash what a later reconnect needs to slot straight back into this
    // seat (see connect()/loadResume). Re-sent on a resume too (harmless —
    // same token), so it stays fresh across a Play Again rematch.
    if(m.resumeToken&&myRoomId!=null) setResume({roomId:myRoomId,seat:mySeat,token:m.resumeToken});
    // A resume can land mid-anything — wipe any frozen banner/intro state
    // left over from when the tab was suspended so the rebuilt board isn't
    // gated behind a stale round-start card that will never clear.
    if(m.resumed) clearActiveBanners();
    startGame(m);
    return;
  }
  if(m.type==='round_start'){onRoundStart(m);return;}
  if(m.type==='round_end'){onEnd(m);return;}
  if(m.type==='game_over'){
    pendingGameOver=m;
    // Game's finished — the seat can't be resumed any more (a Play Again
    // rematch issues a fresh token via its own game_start).
    setResume(null);
    const btn=$('bview-results'); if(btn) btn.style.display='';
    return;
  }
  if(m.type==='ready_status'){onReadyStatus(m);return;}
  if(m.type==='typing_status'){onTypingStatus(m);return;}
  if(m.type==='player_left'){onPlayerLeft(m);return;}
  if(m.type==='play_again_status'){onPlayAgainStatus(m);return;}
  if(m.type==='play_again_left_behind'){onPlayAgainLeftBehind();return;}
  if(m.type==='stats'){
    renderStats(m);
    // Also refreshes theme/title-lock state (see renderVoiceThemes/
    // renderTitles) — 'stats' is requested both by the My Stats modal and
    // by opening Settings, so whichever one triggered this response still
    // keeps unlockedThemes/unlockedTitles current.
    unlockedThemes=m.stats?.unlockedThemes||['Default'];
    renderVoiceThemes();
    unlockedTitles=m.stats?.unlockedTitles||['Beginner'];
    renderTitles();
    unlockedTracks=m.stats?.unlockedTracks||['tea'];
    renderGameMusicList();
    renderAchievements(m.stats?.achievementsInfo);
    // Combined wins (both variants — the nameplate is one identity, not
    // split by mode) drive the User Profile hub's nameplate tier — see
    // updateNameplateTier. m.stats.yonma/sanma.gamesWon are lifetime
    // totals (see server/stats.js's getStats — only the nested `windowed`
    // sub-object is capped to the last 100 rounds), same numbers
    // 'the_diamond'/'century_club' in achievements.js check.
    updateNameplateTier((m.stats?.yonma?.gamesWon||0)+(m.stats?.sanma?.gamesWon||0));
    return;
  }
  if(m.type==='game_history'){renderPlayHistory(m.games);return;}
  if(m.type==='game_history_detail'){onGameHistoryDetail(m);return;}
  if(m.type==='leaderboard'){renderLeaderboard(m);return;}
  if(m.type==='period_leaderboard'){renderLeaderboard(m);return;}
  if(m.type==='player_stats'){
    if(pendingPlayerCardKind==='popover') renderPlayerPopover(m);
    else renderPlayerCard(m);
    return;
  }
  if(m.type==='room_list'){renderRoomList(m);return;}
  if(m.type==='join_room_result'){if(!m.ok) toast(m.error||'Could not join that room.');return;}
  // Reply to the shared Invite Players window's fetch (see
  // openInviteModal) — renderInvitePlayers itself reads onlineProfilesTarget
  // to decide what a click does (send immediately vs. stage a pick).
  if(m.type==='online_profiles'){renderInvitePlayers(m.profiles);return;}
  if(m.type==='invite_result'){onInviteResult(m);return;}
  if(m.type==='room_invite'){showRoomInvite(m);return;}
  // ── Friends ──
  if(m.type==='friends'){renderFriends(m);return;}
  if(m.type==='notifications'){renderNotifications(m);updateNotifBadge(m.unread||0);return;}
  if(m.type==='notifications_read'){updateNotifBadge(0);return;}
  if(m.type==='friend_request_result'){
    // Came from the in-game nameplate popover's ＋ button — report the
    // outcome on the button itself, no toast (see addFriendFromPopover).
    if(popoverRequestPending){
      popoverRequestPending=false;
      const b=$('pp-addfriend');
      if(b){
        b.disabled=true;
        b.textContent=m.ok?(m.autoAccepted?'Friend added':'Friend request sent'):(m.error||'Request failed');
      }
      if(m.ok&&$('friends-modal').classList.contains('visible')) wss({type:'get_friends'});
      return;
    }
    if(m.ok){
      $('friend-add-error').textContent='';
      const inp=$('friend-id-input'); if(inp) inp.value='';
      toast(m.autoAccepted?'Friend added.':'Friend request sent.');
      if($('friends-modal').classList.contains('visible')){
        // Drop back to the list so the new friend / pending "Sent" row is
        // visible right away, rather than leaving them on the empty add form.
        setFriendsTab('list');
        wss({type:'get_friends'});
      }
    } else {
      const err=m.error||'Could not send that request.';
      if($('friends-modal').classList.contains('visible')) $('friend-add-error').textContent=err;
      else toast(err);
    }
    return;
  }
  // Something changed our friends/requests (an accept/decline/remove we or
  // the other party did) — refresh whatever friend UI is open, and always
  // the notification badge.
  if(m.type==='friend_action_done'){
    if($('friends-modal').classList.contains('visible')) wss({type:'get_friends'});
    wss({type:'get_notifications'});
    return;
  }
  // Live badge bump while we're sitting in the lobby (see pushFriendBadge in
  // server/index.js) — a friend request or acceptance just landed.
  if(m.type==='friend_notification'){
    // If the panel's already open, the new item counts as read on arrival.
    if($('notifications-modal').classList.contains('visible')){
      wss({type:'get_notifications'});
      wss({type:'mark_notifications_read'});
      updateNotifBadge(0);
    } else {
      updateNotifBadge(m.unread||0);
    }
    // A request/acceptance involving us just landed — if we're looking at
    // the Friends panel, refresh it so a new incoming request or a
    // just-confirmed friend shows without reopening.
    if($('friends-modal').classList.contains('visible')) wss({type:'get_friends'});
    return;
  }
  // End-of-game coin payout (unicast, see _finishGame in server/room.js).
  // Toast is the universal feedback; the game-over standings panel also
  // shows it as a summary line IF the player opens "View Results" (see
  // showCoinReward, called from onGameOver).
  if(m.type==='coins'){
    updateCoins(m.balance);
    if(m.delta>0){
      pendingCoinReward=m;
      toast(`+${m.delta} coins`+(m.capped?' · daily limit reached':''));
      // If the game-over results are already on screen (fast "View Results"
      // click beat this message), paint the line now too.
      if($('bend-menu')?.style.display!=='none'&&!$('s-end').classList.contains('hidden')) showCoinReward();
    }
    return;
  }
  // Generic server-side rejection (currently just quick_match/create_room
  // refusing a profile that's already seated in another room — see
  // isProfileSeatedElsewhere in server/index.js; join_room reuses
  // 'join_room_result' above instead since it already has an error toast).
  if(m.type==='error'){
    toast(m.error||'Something went wrong.');
    // findMatch() disables #bfind before sending 'quick_match' and normally
    // only resetLobby() (after a real game starts) re-enables it — a
    // rejected quick_match never reaches that point, so without this the
    // button would stay stuck disabled.
    if(m.context==='quick_match'){ const b=$('bfind'); if(b) b.disabled=false; }
    return;
  }
  if(m.type==='achievements_unlocked'){
    // Merge any newly-unlocked title/voice theme into the client's own
    // gating arrays immediately — without this, unlockedTitles/
    // unlockedThemes stayed stale until something else happened to
    // request fresh 'stats' (opening the gear-icon Settings panel or My
    // Stats), so a new unlock wouldn't show up in User Profile > Title or
    // > Voice Theme (which just render whatever's already in these arrays,
    // see toggleTitleModal/toggleVoiceThemeModal) until a full page
    // refresh forced a fresh fetch. Re-rendering both here is harmless
    // even when neither picker is currently open.
    for(const a of (m.achievements||[])){
      if(a.unlocksTitle && !unlockedTitles.includes(a.unlocksTitle)) unlockedTitles.push(a.unlocksTitle);
      if(a.unlocksTheme && !unlockedThemes.includes(a.unlocksTheme)) unlockedThemes.push(a.unlocksTheme);
    }
    renderTitles();
    renderVoiceThemes();
    showAchievementUnlock(m.achievements);
    return;
  }
  if(m.type==='profiles'){renderProfileList(m);return;}
  if(m.type==='profile_unlocked'){onProfileUnlocked(m);return;}
  if(m.type==='guest_selected'){onGuestSelected();return;}
  if(m.type==='dev_key_result'){onDevKeyResult(m);return;}
  if(m.type==='create_profile_result'){onCreateProfileResult(m);return;}
  if(m.type==='delete_profile_result'){onDeleteProfileResult(m);return;}
  if(m.type==='clear_all_history_result'){onClearAllHistoryResult(m);return;}
  if(m.type==='change_username_result'){onChangeUsernameResult(m);return;}
  if(m.type==='change_code_result'){onChangeCodeResult(m);return;}
  if(m.type==='advice'){renderAdvice(m);return;}
  if(!inGame) return;
  // While the round-start card ("東2局") is up, the board underneath is
  // already click-blocked (see .rs-layer.blocking / roundStartBanner), but
  // the game itself is NOT paused server-side — bots keep acting on their
  // own timers underneath it. Without this, a bot's kita/discard/etc during
  // that window would silently update the board (or pop a call banner)
  // while the player is still looking at last round's-end state, then the
  // card disappears onto an already-advanced board — looking like the
  // round "started" before they could see it. Game-state-affecting
  // messages are deferred here (queued, latest-wins) and only ever
  // rendered once the card actually clears — see roundStartBanner's timer.
  if(roundStartBannerActive && m.type==='game_state'){ pendingBannerGameState=m; return; }
  if(roundStartBannerActive && (m.type==='riichi'||m.type==='kan'||m.type==='pon'||m.type==='chi'||m.type==='kita')) return;
  if(m.type==='game_state'){
    const prev=lastState;lastState=m;discarding=false;renderState(m,prev);
    // The game has now actually finished loading (this is the first real
    // state of a fresh game) — show the roll call now, on top of the
    // just-rendered (fully dealt) board, rather than back at game_start
    // when the board was still a "dealing tiles" placeholder.
    if(pendingGameStartIntro){const gm=pendingGameStartIntro;pendingGameStartIntro=null;gameStartIntro(gm);}
    // Pending-discard reconciliation (see sendDiscardAction). Tile now gone
    // from the hand → the discard landed, stop tracking. Still in hand and
    // it's our turn again after a reconnect → the original send was lost,
    // re-send it exactly once. Anything else → drop it.
    if(pendingDiscardTileId!=null){
      const stillHeld=(m.myHand||[]).some(t=>t.id===pendingDiscardTileId)
        ||(m.drawTile&&m.drawTile.id===pendingDiscardTileId);
      if(!stillHeld){ pendingDiscardTileId=null; discardRetryArmed=false; }
      else if(discardRetryArmed&&m.turn===mySeat&&!m.pending&&!m.riichi?.[mySeat]){
        discardRetryArmed=false;
        const id=pendingDiscardTileId; pendingDiscardTileId=null;
        sendDiscardAction(id);
      } else { pendingDiscardTileId=null; discardRetryArmed=false; }
    }
  }
  else if(m.type==='riichi'){onRiichi(m);}
  else if(m.type==='kan'){callBanner('kan',m.name||'Player','カン');}
  else if(m.type==='pon'){callBanner('pon',m.name||'Player','ポン');}
  else if(m.type==='chi'){callBanner('chi',m.name||'Player','チー');}
  else if(m.type==='kita'){callBanner('kita',m.name||'Player','北');}
  else if(m.type==='chat'){showChatMsg(m.name,m.text,m.color,m.id);}
  else if(m.type==='emoji_react'){showEmojiPopup(m.seat,m.emoji);}
  else if(m.type==='msg_react'){onMsgReact(m);}
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
  // Refresh theme-lock state for the current name each time the panel
  // opens — onMsg's 'stats' handler updates unlockedThemes and re-renders
  // the theme list once the response lands.
  if(!open) wss({type:'get_stats',name:($('iname').value.trim()||'Player')});
}

function toggleAbout(){
  const modal=$('about-modal');
  const backdrop=$('about-backdrop');
  const open=modal.classList.contains('visible');
  modal.classList.toggle('visible',!open);
  backdrop.classList.toggle('visible',!open);
}

function toggleRulesModal(){
  const modal=$('rules-modal');
  const backdrop=$('rules-backdrop');
  const open=modal.classList.contains('visible');
  modal.classList.toggle('visible',!open);
  backdrop.classList.toggle('visible',!open);
  // Opening normally (gear icon/Quick Match) hides the "+ Create Room"
  // confirm button — only openCreateRoomRules (below) re-shows it, since
  // that's the one path where picking rules here actually creates a room
  // rather than just updating what's queued for next time. Invite Players
  // is gated the exact same way, for the exact same reason — there's no
  // room to invite anyone into outside that one path.
  if(!open){
    $('rules-modal-create-btn').style.display='none';
    $('rules-invite-section').style.display='none';
  }
}

// Hub for everything specific to the unlocked profile (player icon, voice
// theme, stats, username/key) — only reachable once a profile is unlocked
// (see user-icon-btn, shown by onProfileUnlocked). Just a list of links;
// each setting fetches/renders whatever it needs only once actually opened,
// in its own toggle function below, not here — same pattern as
// toggleDevPanel's hub.
function toggleUserProfile(){
  const modal=$('userprofile-modal');
  const backdrop=$('userprofile-backdrop');
  const open=modal.classList.contains('visible');
  modal.classList.toggle('visible',!open);
  backdrop.classList.toggle('visible',!open);
}

// "← Back" from any User Profile child panel — hides whichever one is
// currently open and returns to the hub. Mirrors backToDevPanel, including
// unconditionally clearing every child (not just the caller's own) so this
// stays correct even if a future setting gets added here.
function backToUserProfile(){
  ['friends','notifications','playericon','title','voicetheme','userstats','playhistory','achievements','changeusername','changecode'].forEach(id=>{
    $(id+'-modal').classList.remove('visible');
    $(id+'-backdrop').classList.remove('visible');
  });
  $('userprofile-modal').classList.add('visible');
  $('userprofile-backdrop').classList.add('visible');
}

// ── Coins ──────────────────────────────────────────────────────────────

// This connection's coin balance (see server/economy.js). 0 for Guest.
let myCoins=0;
// The last unrendered end-of-game coin payout ('coins' message), held until
// the game-over results panel is on screen — see showCoinReward.
let pendingCoinReward=null;

// A short leaning stack of matte-gold cash coins, drawn in 3/4 view — two
// coin edges plus a foreshortened top face with a small square hole (sized
// to read naturally at the tilt). Matte: gentle two-stop gradients, no
// chrome highlight. Sized to the surrounding text via .coin-svg in both the
// lobby badge and the game-over reward line. Gradient ids are namespaced.
const coinIconSvg='<svg class="coin-svg" viewBox="1.5 4 21 17.5" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  +'<defs>'
  +'<linearGradient id="mjCoinFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcc584"/><stop offset="1" stop-color="#9f8440"/></linearGradient>'
  +'<linearGradient id="mjCoinEdge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c4a95c"/><stop offset="0.5" stop-color="#9f8440"/><stop offset="1" stop-color="#6a5526"/></linearGradient>'
  +'</defs>'
  +'<g transform="rotate(-9 12 13)">'
  +'<ellipse cx="12" cy="17" rx="8.6" ry="3.4" fill="#9f8440"/>'
  +'<path d="M3.4 13.6 v3.4 a8.6 3.4 0 0 0 17.2 0 v-3.4 z" fill="url(#mjCoinEdge)" stroke="#78632f" stroke-width="0.8"/>'
  +'<path d="M3.4 10.2 v3.4 a8.6 3.4 0 0 0 17.2 0 v-3.4 z" fill="url(#mjCoinEdge)" stroke="#78632f" stroke-width="0.8"/>'
  +'<ellipse cx="12" cy="9.8" rx="8.6" ry="3.6" fill="url(#mjCoinFace)" stroke="#78632f" stroke-width="1"/>'
  +'<rect x="9.7" y="8.9" width="4.6" height="1.9" rx="0.5" fill="#241b09"/>'
  +'</g>'
  +'</svg>';

// Gradient-fade angled underline behind the coin count — bright gold on the
// left, tapering to nothing on the right, sitting under the numerals (not a
// box). Stretches to the text width via preserveAspectRatio="none".
const coinUnderlineSvg='<svg class="coin-underline" viewBox="0 0 260 24" preserveAspectRatio="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">'
  +'<defs><linearGradient id="mjCoinUl" x1="0" y1="0" x2="1" y2="0">'
  +'<stop offset="0" stop-color="#f0d080"/><stop offset="0.6" stop-color="#c9a84c"/><stop offset="1" stop-color="#c9a84c" stop-opacity="0"/>'
  +'</linearGradient></defs>'
  +'<polygon points="2,17 258,13 258,16.5 2,20.5" fill="url(#mjCoinUl)"/>'
  +'</svg>';

function updateCoins(n){
  myCoins=Math.max(0,n|0);
  const el=$('coin-amount'); if(el) el.textContent=myCoins.toLocaleString();
  const ic=$('coin-icon'); if(ic&&ic.dataset.svg!=='1'){ ic.innerHTML=coinIconSvg; ic.dataset.svg='1'; }
  const box=$('coin-count');
  if(box){
    if(box.dataset.ul!=='1'){ box.insertAdjacentHTML('afterbegin',coinUnderlineSvg); box.dataset.ul='1'; }
    box.style.display='';
  }
}

// Renders the "Coins earned +N" line on the game-over panel from
// pendingCoinReward, then clears it. A no-op when there's nothing pending
// (e.g. a between-rounds panel, or a guest game). Called from both the
// 'coins' handler and onGameOver since either can run second.
function showCoinReward(){
  const el=$('coin-reward'); if(!el) return;
  if(!pendingCoinReward){ el.textContent=''; return; }
  const m=pendingCoinReward; pendingCoinReward=null;
  const cap=m.capped?' <span class="coin-cap">· daily limit reached</span>':'';
  el.innerHTML=`Coins earned&nbsp;&nbsp;+${m.delta} ${coinIconSvg}${cap}`;
}

// Store — placeholder window opened by clicking the coin balance. A
// customization shop that spends coins is a later feature (economy.spend is
// already stubbed server-side).
function toggleStoreModal(){
  const modal=$('store-modal'),backdrop=$('store-backdrop');
  const open=modal.classList.contains('visible');
  modal.classList.toggle('visible',!open);
  backdrop.classList.toggle('visible',!open);
}
// #coin-count is a role="button" div (not a real <button>, to avoid the UA
// button styling) — wire keyboard activation to match the click.
$('coin-count')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleStoreModal(); }
});

// ── Friends & notifications ─────────────────────────────────────────────

// Unread-notification indicator: a red dot on the 人 user icon and, once the
// User Profile hub is open, on its "Notifications" row. Just a boolean —
// "there's something to read" — the actual count/list is in the panel.
function updateNotifBadge(n){
  const has=Math.max(0,n|0)>0;
  $('user-icon-btn')?.classList.toggle('has-notif',has);
  $('notif-hub-badge')?.classList.toggle('show',has);
}

// Notifications panel — a User Profile child (opened from the hub's
// "Notifications" link; ← returns to the hub, ✕ closes out). Opening marks
// everything read server-side and re-fetches the list, which clears the dot.
function toggleNotificationsModal(){
  const modal=$('notifications-modal');
  const backdrop=$('notifications-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('notifications-list').textContent='Loading…';
  modal.classList.add('visible');
  backdrop.classList.add('visible');
  // mark-read first so the list we then fetch already reflects it (no
  // stale per-row "unread" dots on items you're looking at).
  wss({type:'mark_notifications_read'});
  wss({type:'get_notifications'});
}

function renderNotifications(m){
  const box=$('notifications-list'); if(!box) return;
  const items=m.items||[];
  if(!items.length){ box.innerHTML='<p class="friends-empty">No notifications yet.</p>'; return; }
  box.innerHTML='';
  for(const it of items){
    const row=document.createElement('div');
    row.className='notif-row'+(it.read?'':' notif-row-unread');
    const who=escHtml(it.fromName||'Someone');
    if(it.type==='request'){
      row.innerHTML=`<div class="notif-text"><b>${who}</b> sent you a friend request.</div>
        <div class="notif-actions">
          <button class="notif-accept">Accept</button>
          <button class="notif-decline">Decline</button>
        </div>`;
      row.querySelector('.notif-accept').onclick=()=>{ wss({type:'accept_friend_request',fromId:it.fromId}); row.remove(); };
      row.querySelector('.notif-decline').onclick=()=>{ wss({type:'decline_friend_request',fromId:it.fromId}); row.remove(); };
    } else if(it.type==='accepted'){
      row.innerHTML=`<div class="notif-text"><b>${who}</b> accepted your friend request.</div>`;
    } else {
      row.innerHTML=`<div class="notif-text">${who}</div>`;
    }
    box.appendChild(row);
  }
}

function toggleFriendsModal(){
  const modal=$('friends-modal');
  const backdrop=$('friends-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('friends-my-id').textContent=myProfileId||'—';
  clearTimeout(_copyIdRevertTimer); $('friends-copy-id').textContent='Copy';
  $('friend-add-error').textContent='';
  $('friend-id-input').value='';
  $('friend-incoming').innerHTML='';
  $('friend-outgoing').innerHTML='';
  $('friends-list').innerHTML='<p class="friends-empty">Loading…</p>';
  setFriendsTab('list');
  modal.classList.add('visible');
  backdrop.classList.add('visible');
  wss({type:'get_friends'});
}

// Switches the Friends modal between the friends-list pane (default) and
// the add-by-ID pane behind the magnifier tab. The "Your ID" box above the
// tab strip stays put either way.
function setFriendsTab(which){
  const isAdd=which==='add';
  $('friends-tab-list').classList.toggle('active',!isAdd);
  $('friends-tab-add').classList.toggle('active',isAdd);
  $('friends-pane-list').style.display=isAdd?'none':'';
  $('friends-pane-add').style.display=isAdd?'':'none';
}

function renderFriends(m){
  friendIdSet=new Set((m.friends||[]).map(f=>f.id));
  $('friends-my-id').textContent=m.myId||myProfileId||'—';

  // Incoming requests — Accept / Decline.
  const inc=$('friend-incoming');
  if(inc){
    const rows=(m.incoming||[]).map(f=>`
      <div class="friend-row" data-id="${f.id}">
        <span class="friend-ic">${iconSvg(f.icon)}</span>
        <span class="friend-nm">${escHtml(f.name)}</span>
        <span class="friend-actions">
          <button onclick="acceptFriend('${f.id}')">Accept</button>
          <button onclick="declineFriend('${f.id}')">Decline</button>
        </span>
      </div>`).join('');
    inc.innerHTML=rows?`<div class="friends-section-title">Requests</div>${rows}`:'';
  }

  // Outgoing — just "Pending", with a Cancel (reuses decline).
  const out=$('friend-outgoing');
  if(out){
    const rows=(m.outgoing||[]).map(f=>`
      <div class="friend-row friend-row-pending" data-id="${f.id}">
        <span class="friend-ic">${iconSvg(f.icon)}</span>
        <span class="friend-nm">${escHtml(f.name)}</span>
        <span class="friend-actions">
          <span class="friend-pending">Pending</span>
          <button onclick="declineFriend('${f.id}')">Cancel</button>
        </span>
      </div>`).join('');
    out.innerHTML=rows?`<div class="friends-section-title">Sent</div>${rows}`:'';
  }

  // Friends list.
  const list=$('friends-list');
  const canInvite=isRoomHost && !inGame && $('wa').style.display==='block';
  const friends=m.friends||[];
  $('friends-list-title').style.display=friends.length?'':'none';
  if(!friends.length){ list.innerHTML='<p class="friends-empty">No friends yet — add one by ID from the search tab above.</p>'; return; }
  list.innerHTML=friends.map(f=>{
    const dot=f.online?'<span class="friend-dot" title="Online"></span>':(f.busy?'<span class="friend-dot friend-dot-busy" title="In a game"></span>':'');
    const invite=(canInvite&&f.online&&!f.busy)?`<button onclick="inviteFriendToRoom('${escAttr(f.name)}')">Invite</button>`:'';
    return `
      <div class="friend-row" data-id="${f.id}">
        <span class="friend-ic">${iconSvg(f.icon)}</span>
        <span class="friend-nm">${escHtml(f.name)}${dot}</span>
        <span class="friend-actions">
          ${invite}
          <button class="friend-remove" onclick="removeFriend('${f.id}','${escAttr(f.name)}')">Remove</button>
        </span>
      </div>`;
  }).join('');
}

// Small attribute-safe escaper for the inline onclick string args above
// (names can contain quotes/backslashes). escHtml handles element text;
// this is for a JS string literal inside an HTML attribute.
function escAttr(s){ return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function acceptFriend(id){ wss({type:'accept_friend_request',fromId:id}); }
function declineFriend(id){ wss({type:'decline_friend_request',fromId:id}); }
function removeFriend(id,name){
  uiConfirm(`Remove ${name||'this friend'} from your friends?`,()=>wss({type:'remove_friend',otherId:id}),'Remove');
}
function inviteFriendToRoom(name){ wss({type:'invite_player',name}); toast(`Invited ${name}.`); }

function submitFriendRequest(){
  const inp=$('friend-id-input'); if(!inp) return;
  const id=inp.value.trim();
  if(!/^\d{16}$/.test(id)){ $('friend-add-error').textContent='Enter a 16-digit ID.'; return; }
  if(id===myProfileId){ $('friend-add-error').textContent="That's your own ID."; return; }
  $('friend-add-error').textContent='';
  wss({type:'send_friend_request',toId:id});
}

// Async Clipboard API where available, with a hidden-textarea + execCommand
// fallback for the contexts it isn't (older browsers, no focus/permission).
function copyToClipboard(text){
  if(navigator.clipboard&&window.isSecureContext){
    return navigator.clipboard.writeText(text).catch(()=>legacyCopy(text));
  }
  return legacyCopy(text);
}
function legacyCopy(text){
  return new Promise((resolve,reject)=>{
    try{
      const ta=document.createElement('textarea');
      ta.value=text; ta.setAttribute('readonly','');
      ta.style.cssText='position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta); ta.select();
      const ok=document.execCommand('copy');
      document.body.removeChild(ta);
      ok?resolve():reject(new Error('execCommand failed'));
    }catch(e){ reject(e); }
  });
}

let _copyIdRevertTimer=null;
function copyMyFriendId(){
  if(!myProfileId) return;
  const btn=$('friends-copy-id');
  const flash=txt=>{
    if(!btn) return;
    btn.textContent=txt;
    clearTimeout(_copyIdRevertTimer);
    _copyIdRevertTimer=setTimeout(()=>{ btn.textContent='Copy'; },1600);
  };
  copyToClipboard(myProfileId).then(()=>flash('Copied'),()=>flash('Copy failed'));
}

function togglePlayerIconModal(){
  const modal=$('playericon-modal');
  const backdrop=$('playericon-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  renderPlayerIcons();
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

function toggleTitleModal(){
  const modal=$('title-modal');
  const backdrop=$('title-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  renderTitles();
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

function toggleVoiceThemeModal(){
  const modal=$('voicetheme-modal');
  const backdrop=$('voicetheme-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  renderVoiceThemes();
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// Fetches stats fresh each open (renderStats reveals it, via onMsg's
// 'stats' handler) so it never flashes stale content from a previous open,
// same reasoning the old inline My Stats section had.
function toggleUserStatsModal(){
  const modal=$('userstats-modal');
  const backdrop=$('userstats-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  currentStatsMatchKind='quick';
  $('btn-stats-quick').classList.add('active');
  $('btn-stats-room').classList.remove('active');
  $('stats-body').textContent='Loading…';
  wss({type:'get_stats'});
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// Play History — same open/fetch/render pattern as My Stats above, fetched
// fresh each open so it never shows a stale list from a previous open (a
// game finished since the last time this was opened, etc). 'game_history'
// (see onMsg) carries summary rows only, no round detail — a game's own
// rounds are fetched on demand the first time its row is expanded (see
// togglePlayHistoryGame/phDetailCache below), not all up front.
function togglePlayHistoryModal(){
  const modal=$('playhistory-modal');
  const backdrop=$('playhistory-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  phDetailCache={};
  $('playhistory-list').textContent='Loading…';
  wss({type:'get_game_history'});
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// gameId -> full game record (with `rounds`) once fetched — persists for
// this modal open only (cleared on every togglePlayHistoryModal open above)
// so re-collapsing/re-expanding the same row within one visit doesn't
// re-fetch. `phPendingDetail` tracks the one row currently awaiting its
// 'get_game_history_detail' reply, so onGameHistoryDetail (below) knows
// which DOM node to fill in once it arrives.
let phDetailCache={};
let phPendingDetail=null;

const ORDINALS=['1st','2nd','3rd','4th'];

// One row per past game — every seat's placement/name/final points, sorted
// by placement (winner first), not just this profile's own seat, so a game
// summary reads as a real standings table. The viewing profile's own row
// (g.seat, stamped by history.recordGame server-side) is marked
// .ph-standing-mine so it stands out from the opponents around it. Clicking
// a row expands/collapses its round-by-round detail (see
// togglePlayHistoryGame) rather than navigating to a separate screen, so
// scrolling back through several games' rounds stays in one place.
function renderPlayHistory(games){
  const body=$('playhistory-list');
  if(!games||!games.length){ body.innerHTML='<p>No games played yet.</p>'; return; }
  body.innerHTML='';
  for(const g of games){
    const seat=g.seat;
    const dateStr=new Date(g.date).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
    const ruleLabel=`${g.gameMode==='hanchan'?'Hanchan':'Tonpuu'} · ${g.variant==='sanma'?'Sanma':'Yonma'} · ${g.matchKind==='quick'?'Quick Match':'Room Match'}`;
    const standings=(g.playerNames||[]).map((name,i)=>({
      seat:i,name,place:g.placements?.[i],score:g.finalScores?.[i],
    })).sort((a,b)=>(a.place||99)-(b.place||99));
    const row=document.createElement('div'); row.className='ph-game-row';
    const head=document.createElement('div'); head.className='ph-game-head';
    // Field order per the Play History spec: game rule + date/time sharing
    // one line (saves a whole row of vertical space over stacking them),
    // then every player's placement/username/final points (own seat
    // highlighted) — the chevron (expand for the round breakdown) sits to
    // the right of all of it, spanning the whole card via flex.
    const standingsHtml=standings.map(s=>{
      const ordinal=s.place?(ORDINALS[s.place-1]||`${s.place}th`):'—';
      return `<span class="ph-standing-row${s.seat===seat?' ph-standing-mine':''}">
          <span class="ph-game-place place-${s.place||''}">${escHtml(ordinal)}</span>
          <span class="ph-game-name">${escHtml(s.name)}</span>
          <span class="ph-game-score">${(s.score??0).toLocaleString()}</span>
        </span>`;
    }).join('');
    head.innerHTML=`<span class="ph-game-info">
        <span class="ph-game-topline">
          <span class="ph-game-rule">${escHtml(ruleLabel)}</span>
          <span class="ph-game-date">${escHtml(dateStr)}</span>
        </span>
        <span class="ph-game-standings">${standingsHtml}</span>
      </span>
      <button type="button" class="ph-game-chevron" aria-label="Show round breakdown">▾</button>`;
    const detailWrap=document.createElement('div'); detailWrap.className='ph-game-detail';
    row.appendChild(head); row.appendChild(detailWrap);
    head.onclick=()=>togglePlayHistoryGame(g.id,row,detailWrap,seat);
    body.appendChild(row);
  }
}

// Expands/collapses one game's round-by-round detail. First expand for a
// given gameId fetches it (see phDetailCache); every expand after that (or
// after collapsing and re-expanding) reuses the cached copy instead of
// round-tripping again.
function togglePlayHistoryGame(gameId,row,detailWrap,mySeat){
  if(row.classList.contains('open')){ row.classList.remove('open'); return; }
  row.classList.add('open');
  if(phDetailCache[gameId]){ renderPlayHistoryDetail(detailWrap,phDetailCache[gameId],mySeat); return; }
  detailWrap.innerHTML='<p class="ph-loading">Loading…</p>';
  phPendingDetail={gameId,detailWrap,mySeat};
  wss({type:'get_game_history_detail',gameId});
}

// 'game_history_detail' reply handler (see onMsg) — fills in whichever row
// is currently awaiting it (phPendingDetail), and caches the result so
// collapsing/re-expanding that same row doesn't fetch it again this visit.
// A stale reply for a row the player has since collapsed-and-moved-past
// (gameId no longer matches phPendingDetail) is just ignored.
function onGameHistoryDetail(m){
  if(m.game) phDetailCache[m.gameId]=m.game;
  if(!phPendingDetail||phPendingDetail.gameId!==m.gameId) return;
  const {detailWrap,mySeat}=phPendingDetail;
  phPendingDetail=null;
  renderPlayHistoryDetail(detailWrap,m.game||{rounds:[]},mySeat);
}

function renderPlayHistoryDetail(container,game,mySeat){
  container.innerHTML='';
  const rounds=game.rounds||[];
  if(!rounds.length){ container.innerHTML='<p class="ph-loading">No round data.</p>'; return; }
  // Two passes: append every card first, THEN run each one's tile-row fit
  // pass (see buildHistoryRoundCard's own comment) — fitEndTileSize needs
  // a real clientWidth to measure against, which .ph-round-card doesn't
  // have until it's actually attached under this (already-visible)
  // container.
  const fills=[];
  for(const r of rounds){
    const {card,fill}=buildHistoryRoundCard(r,mySeat);
    container.appendChild(card);
    if(fill) fills.push(fill);
  }
  for(const fill of fills) fill();
}

// Round reason labels — same mapping onEnd (the live round-results screen)
// uses, kept as its own copy here rather than a shared constant so this
// file's two renderers (live vs. history) can't accidentally couple to each
// other's exact needs later.
const phReasonLabels={tsumo:'ツモ - TSUMO',ron:'ロン - RON',draw:'流局 - Exhaustive Draw',suukaikan:'四開槓 - Suukaikan',nagashi:'流し満貫 - Mangan at Draw',kyuushu:'九種九牌 - Kyuushu Kyuuhai',chonbo:'チョンボ - Chonbo'};

// One round's worth of the same information the live round-results screen
// (#s-end, see onEnd) shows — winner/hand/yaku/dora/score-deltas — built
// from the exact payload room.js broadcast at the time (see
// room.js's _recordRoundHistory), just rendered as a static card instead of
// the live panel's one-time sound/animation. mySeat (this profile's own
// seat in the game, not necessarily 0) is used only to label that seat
// "(You)" in the name lists below.
function buildHistoryRoundCard(round,mySeat){
  const card=document.createElement('div'); card.className='ph-round-card';
  // Tile rows (hand+melds, tenpai reveals) are sized to fit in one line
  // the same way the live round-end panel does (see fitEndTileSize) —
  // populating them can't happen until `card` is actually attached to the
  // visible DOM (fitEndTileSize needs a real clientWidth to measure
  // against), so each one is queued here and run by the caller
  // (renderPlayHistoryDetail) right after appending this card.
  //
  // Each queued row also gets a temporary min-height reservation (see
  // reserveTileRowHeight below) equal to the tallest a tile row could be —
  // #playhistory-modal scrolls (overflow-y:auto), so an EMPTY placeholder
  // row can measure as wider than it'll actually end up: the browser only
  // decides a scrollbar is needed once the round's real (filled-in)
  // height is on the page, which happens strictly after the width
  // measurement below runs. Without the reservation, a scrollbar that
  // pops in exactly because this row's tiles were added would silently
  // invalidate the width just used to size them, wrapping the row anyway.
  const fills=[];
  const tmdDefaultH=parseInt(document.documentElement.style.getPropertyValue('--tmd-h'))||36;
  const reserveTileRowHeight=el=>{ el.style.minHeight=tmdDefaultH+'px'; };
  const windChar=['東','南','西','北'];
  const wind=round.displayWind||round.roundWind||1;
  const rnd=round.displayRound||round.round||1;
  const head=document.createElement('div'); head.className='ph-round-head';
  head.innerHTML=`<span class="ph-round-kyoku">${windChar[wind-1]}${rnd}局 ${round.honba||0}本場</span><span class="ph-round-reason">${escHtml(phReasonLabels[round.reason]||'Round Over')}</span>`;
  card.appendChild(head);

  const names=round.playerNames||[];
  const nameFor=seat=>{
    const n=names[seat]||`Seat ${seat}`;
    return seat===mySeat?`${n} (You)`:n;
  };

  if(round.reason==='tsumo'||round.reason==='ron'){
    const limit=limitLabel(round.han||0,round.fu||0);
    const info=document.createElement('div'); info.className='ph-round-info';
    let html=`<span class="re-winner">${escHtml(nameFor(round.winner))}</span>`;
    if(limit) html+=`<span class="re-limit ${limit.cls}">${limit.en} · ${limit.label}</span>`;
    if(round.fu) html+=`<span class="re-hand"> · ${round.han} Han · ${round.fu} Fu</span>`;
    info.innerHTML=html;
    card.appendChild(info);
    if((round.yakuList||[]).length){
      const yl=document.createElement('div'); yl.className='ph-yaku-row';
      for(const y of round.yakuList){
        const c=document.createElement('div');c.className='yc';
        c.innerHTML=`${escHtml(y.name)}<span class="yh">${y.han}Han</span><span class="yj">${escHtml(y.jp||'')}</span>`;
        yl.appendChild(c);
      }
      card.appendChild(yl);
    }
    if((round.dora||[]).length||(round.uraDora||[]).length){
      const dr=document.createElement('div');dr.className='re-dora-row';
      if((round.dora||[]).length){ const lbl=document.createElement('span');lbl.className='re-dora-lbl';lbl.textContent='Dora'; dr.appendChild(lbl); for(const t of round.dora) dr.appendChild(mkElMd(t)); }
      if((round.uraDora||[]).length){ const lbl2=document.createElement('span');lbl2.className='re-dora-lbl re-ura-lbl';lbl2.textContent='Ura Dora'; dr.appendChild(lbl2); for(const t of round.uraDora) dr.appendChild(mkElMd(t)); }
      card.appendChild(dr);
    }
    const handTiles=(round.hand||[]).filter(Boolean);
    if(handTiles.length){
      const tileRow=document.createElement('div'); tileRow.className='re-tile-row';
      reserveTileRowHeight(tileRow);
      card.appendChild(tileRow);
      const melds=round.melds||[];
      fills.push(()=>{
        const meldTileCount=melds.reduce((n,meld)=>n+(meld.kanType==='ankan'?4:meld.tiles.length),0);
        // tileRow itself, not card — card's own padding would otherwise get
        // counted as extra tile-row width, overestimating how much
        // actually fits and wrapping anyway (tileRow, an unstyled block
        // div, already spans exactly card's content box).
        const {w,h}=fitEndTileSize(tileRow,handTiles.length+meldTileCount);
        tileRow.style.minHeight='';
        for(const t of handTiles) tileRow.appendChild(mkEl(t,'tmd',w,h));
        for(const meld of melds) appendEndPanelMeld(tileRow,meld,w,h);
      });
    }
  } else if(round.reason==='chonbo'){
    const info=document.createElement('div'); info.className='ph-round-info';
    info.innerHTML=`<span class="re-winner re-offender">${escHtml(nameFor(round.winner))}</span><span class="re-hand"> declared a false win</span>`;
    card.appendChild(info);
  } else if(round.reason==='draw'){
    if(Array.isArray(round.tenpaiHands)&&round.tenpaiHands.some(Boolean)){
      const tp=document.createElement('div'); tp.className='ph-tenpai';
      round.tenpaiHands.forEach((hand,seat)=>{
        if(!hand) return;
        const row=document.createElement('div');row.className='re-tenpai-row';
        const nameEl=document.createElement('div');nameEl.className='re-tenpai-name';nameEl.textContent=nameFor(seat);
        row.appendChild(nameEl);
        const tiles=document.createElement('div');tiles.className='re-tile-row';
        reserveTileRowHeight(tiles);
        row.appendChild(tiles);
        const tpMelds=round.tenpaiMelds?.[seat]||[];
        fills.push(()=>{
          const tpMeldCount=tpMelds.reduce((n,meld)=>n+(meld.kanType==='ankan'?4:meld.tiles.length),0);
          const {w,h}=fitEndTileSize(row,hand.length+tpMeldCount);
          tiles.style.minHeight='';
          for(const t of hand) tiles.appendChild(mkEl(t,'tmd',w,h));
          for(const meld of tpMelds) appendEndPanelMeld(tiles,meld,w,h);
        });
        tp.appendChild(row);
      });
      card.appendChild(tp);
    } else {
      const info=document.createElement('div'); info.className='ph-round-info'; info.textContent='All players noten.';
      card.appendChild(info);
    }
  } else if(round.reason==='nagashi'){
    const info=document.createElement('div'); info.className='ph-round-info';
    const winners=(round.nagashiSeats||[]).map((ok,seat)=>ok?nameFor(seat):null).filter(Boolean);
    info.textContent=`Nagashi Mangan: ${winners.join(', ')}`;
    card.appendChild(info);
  } else {
    const info=document.createElement('div'); info.className='ph-round-info';
    info.textContent=phReasonLabels[round.reason]||'Round Over';
    card.appendChild(info);
  }

  // Score table with delta column, same shape as onEnd's #rest.
  const tbl=document.createElement('table'); tbl.className='ph-score-table';
  const scores=round.scores||[];
  const sorted=scores.map((sc,seat)=>({sc,seat})).sort((a,b)=>b.sc-a.sc);
  sorted.forEach(({sc,seat},rank)=>{
    const delta=round.prevScores?sc-round.prevScores[seat]:null;
    const row=document.createElement('tr');
    if(seat===round.winner) row.className=round.reason==='chonbo'?'l':'w';
    const ordinal=['1st','2nd','3rd','4th'][rank]||`${rank+1}th`;
    const deltaHtml=delta!=null&&delta!==0
      ?`<span class="re-delta ${delta>0?'re-delta-pos':'re-delta-neg'}">${delta>0?'+':''}${delta.toLocaleString()}</span>`
      :`<span class="re-delta re-delta-nil">—</span>`;
    // Dealer marker — a plain gold dot rather than reusing the live table's
    // circular wind badge (.wb): this row already carries an ordinal medal
    // AND a win/loss color, so a text/badge dealer mark competed for the
    // same small amount of space and read as cluttered. A dot is the
    // minimum viable signal and doesn't fight either of those. Superscript
    // and trailing the name (not leading) so it reads as an annotation ON
    // the name, like a footnote marker, rather than a bullet stacked in
    // front of it competing with the ordinal medal right next to it.
    const dealerHtml=seat===round.dealer?'<sup class="ph-dealer-dot" title="Dealer"></sup>':'';
    row.innerHTML=`<td>${ordinal} ${escHtml(nameFor(seat))}${dealerHtml}</td><td>${sc.toLocaleString()}</td><td class="re-td-delta">${deltaHtml}</td>`;
    tbl.appendChild(row);
  });
  card.appendChild(tbl);

  return {card,fill:fills.length?()=>fills.forEach(fn=>fn()):null};
}

// Same open/fetch pattern as My Stats above — 'stats' carries
// achievementsInfo alongside the stat blocks (see onMsg), so both panels
// piggyback on the same get_stats round trip.
function toggleAchievementsModal(){
  const modal=$('achievements-modal');
  const backdrop=$('achievements-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('achievements-list').textContent='Loading…';
  wss({type:'get_stats'});
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// Reward text for one achievement — combines unlocksTitle/unlocksTheme
// (an achievement could in principle grant both, even though none
// currently do) into one line, or falls back to a plain "Achievement" tag
// if somehow neither is set.
function achievementRewardText(a){
  const parts=[];
  if(a.unlocksTitle) parts.push(`Title "${a.unlocksTitle}"`);
  if(a.unlocksTheme) parts.push(`Voice Theme "${a.unlocksTheme}"`);
  // unlocksTrack carries the track's internal id (see gameTracks) — look up
  // its display label rather than showing the raw id to the player.
  if(a.unlocksTrack) parts.push(`Music Track "${gameTracks.find(t=>t.id===a.unlocksTrack)?.label||a.unlocksTrack}"`);
  return parts.length?parts.join(' + '):'Achievement';
}

// Every achievement, earned or not — not-yet-earned ones are just dimmed
// (.achv-locked; no lock icon, unlike the Title/Voice Theme pickers) so
// the label/reward/progress bar stay fully readable, just visually
// secondary. Progress bar reuses the same .place-bar-track/.place-bar-fill
// language as the Placements chart in My Stats for visual consistency.
function renderAchievements(list){
  const body=$('achievements-list');
  if(!list||!list.length){ body.innerHTML='<p>No achievements yet.</p>'; return; }
  body.innerHTML=list.map(a=>{
    const pct=a.target?Math.round((a.current/a.target)*100):0;
    return `<div class="achv-item${a.earned?'':' achv-locked'}">
      <div class="achv-label">${escHtml(a.label)}</div>
      <div class="achv-reward">${escHtml(achievementRewardText(a))}</div>
      <div class="place-bar-row">
        <div class="place-bar-track"><div class="place-bar-fill place-bar-1" style="width:${pct}%"></div></div>
        <span class="place-bar-pct">${a.current}/${a.target}</span>
      </div>
    </div>`;
  }).join('');
}

// Auto-dismiss timer for the toast below — tracked so a second
// 'achievements_unlocked' arriving while one's still showing (unlikely in
// one game, but possible e.g. right at the start of a new one) resets the
// clock instead of closing early under the new content.
let achvToastTimer=null;

// Pops up whenever the server sends 'achievements_unlocked' (see onMsg) —
// right after a finished game, if this connection's own seat earned any
// new achievements that game (see _finishGame in server/room.js, which
// only ever sends a seat its OWN unlocks, never an opponent's). A corner
// toast (see .achv-toast in style.css), not a blocking modal — it used to
// be one, but its backdrop sat on top of the round-end screen's View
// Results/Main Menu/Ready buttons right when a player would want those
// most. Reuses .achv-item's styling from the Achievements panel, just
// without the dimmed/not-yet-earned state — everything here was just
// earned. Auto-dismisses after 8s; the ✕ (closeAchievementUnlock) still
// works for closing it early.
function showAchievementUnlock(list){
  if(!list||!list.length) return;
  $('achv-unlock-body').innerHTML=list.map(a=>`
    <div class="achv-item">
      <div class="achv-label">${escHtml(a.label)}</div>
      <div class="achv-reward">${escHtml(achievementRewardText(a))}</div>
    </div>
  `).join('');
  $('achv-toast').classList.add('show');
  if(achvToastTimer) clearTimeout(achvToastTimer);
  achvToastTimer=setTimeout(closeAchievementUnlock,8000);
}

function closeAchievementUnlock(){
  $('achv-toast').classList.remove('show');
  if(achvToastTimer){ clearTimeout(achvToastTimer); achvToastTimer=null; }
}

// Daily login bonus — slides in from the top-right on the same .achv-toast
// track as the achievement/invite toasts (see showAchievementUnlock), rather
// than the old centre-screen toast(). Fired from onProfileUnlocked when the
// 'profile_unlocked' message carries a dailyBonus amount. Auto-dismisses
// after 8s; ✕ (closeCoinBonus) closes it early.
let coinToastTimer=null;
function showCoinBonus(amount){
  if(!amount) return;
  $('coin-toast-body').innerHTML=`
    <div class="achv-item">
      <div class="achv-label">Welcome back!</div>
      <div class="achv-reward">+${amount} ${coinIconSvg}</div>
    </div>`;
  $('coin-toast').classList.add('show');
  if(coinToastTimer) clearTimeout(coinToastTimer);
  coinToastTimer=setTimeout(closeCoinBonus,8000);
}

function closeCoinBonus(){
  $('coin-toast').classList.remove('show');
  if(coinToastTimer){ clearTimeout(coinToastTimer); coinToastTimer=null; }
}

// Owner-only — see 'change_username' in server/index.js, which re-verifies
// the profile's own current code before renaming anything. Fields are
// cleared on every open, same "ask again" spirit as the profile picker's
// code prompt, so a stale code/name from a previous attempt never lingers.
function toggleChangeUsernameModal(){
  const modal=$('changeusername-modal');
  const backdrop=$('changeusername-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('changeusername-current').value='';
  $('changeusername-new').value=$('iname').value;
  $('changeusername-error').textContent='';
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

function submitChangeUsername(){
  const currentCode=$('changeusername-current').value;
  const newName=$('changeusername-new').value.trim();
  if(!newName){ $('changeusername-error').textContent='Username required.'; return; }
  wss({type:'change_username',currentCode,newName});
}

function onChangeUsernameResult(m){
  if(m.ok){
    $('iname').value=m.name;
    refreshProfileDisplay();
    $('changeusername-error').style.color='#8fffb0';
    $('changeusername-error').textContent='Username updated.';
  } else {
    $('changeusername-error').style.color='';
    $('changeusername-error').textContent=m.error||'Failed to update username';
  }
}

// Same owner-only gate as Change Username above (see 'change_code' in
// server/index.js) — only the current code changes here, not the name.
function toggleChangeCodeModal(){
  const modal=$('changecode-modal');
  const backdrop=$('changecode-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('changecode-current').value='';
  $('changecode-new').value='';
  $('changecode-error').textContent='';
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

function submitChangeCode(){
  const currentCode=$('changecode-current').value;
  const newCode=$('changecode-new').value;
  wss({type:'change_code',currentCode,newCode});
}

function onChangeCodeResult(m){
  if(m.ok){
    $('changecode-current').value='';
    $('changecode-new').value='';
    $('changecode-error').style.color='#8fffb0';
    $('changecode-error').textContent='Key updated.';
  } else {
    $('changecode-error').style.color='';
    $('changecode-error').textContent=m.error||'Failed to update key';
  }
}

// Every yaku name detectYaku() (server/mahjong.js) can ever attach to a
// win, plus 'Dora' (a synthetic entry room.js adds alongside the real yaku
// list whenever dora count > 0 — see _endRound/_recordHandWin). Kept here
// rather than fetched from the server since there's no shared module
// system between server (CommonJS) and this plain browser script — if
// mahjong.js ever gains/renames a yaku, this list needs updating too.
// Powers the "not yet achieved" rows in the Yaku Achieved section below,
// which needs the full universe of possible names to know what's missing
// from a player's own s.yaku (which only ever contains names they've
// actually hit).
const ALL_YAKU_NAMES=[
  'Riichi','Double Riichi','Ippatsu','Menzen Tsumo','Pinfu','Tanyao',
  'Iipeiko','Ryanpeiko','Haku','Hatsu','Chun','Seat Wind','Round Wind',
  'Sanshoku Doujun','Sanshoku Doukou','Ittsu','Chanta','Junchan','Toitoi',
  'San Ankou','San Kantsu','Honroutou','Chiitoitsu','Honitsu','Chinitsu',
  'Shousangen','Haitei','Houtei','Rinshan Kaihou','Chankan','Nagashi Mangan','Dora',
  'Tenhou','Chiihou','Kokushi Musou','Kokushi Juusanmen','Suu Ankou',
  'Suu Ankou Tanki','Daisangen','Shousuushii','Daisuushii','Tsuuiisou',
  'Chinroutou','Ryuuiisou','Chuuren Poutou','Junsei Chuuren','Suu Kantsu',
  'Kazoe Yakuman',
];

// Expand/collapse for the Yaku Achieved section (see renderStatsBlock) —
// starts collapsed (just the header) since the full achieved+not-yet-
// achieved list can run to 40+ rows; variant is 'yonma'/'sanma' so the two
// stat blocks' sections toggle independently.
function toggleYakuSection(variant){
  const list=$('yaku-list-'+variant); if(!list) return;
  const caret=$('yaku-caret-'+variant);
  const open=list.style.display!=='none';
  list.style.display=open?'none':'';
  if(caret) caret.textContent=open?'▸':'▾';
}

// Renders one variant's block (see the .yonma/.sanma split in
// server/stats.js — sanma and yonma are scored on different scales, so
// they're never combined into one set of numbers). Returns the HTML for
// just this block; renderStats below wraps one of these per variant, each
// under its own heading, rather than a variant picker/toggle — both are
// short enough to just show together. `variant` ('yonma'/'sanma') just
// namespaces the Yaku Achieved section's collapse-state ids so the two
// blocks' sections don't collide/toggle each other.
// One placement's bar row for the block below — width% is that rank's
// share of total games played, so four/three of these stacked read as a
// tiny distribution chart instead of a "1st 1 · 2nd 0 · ..." text line
// that's hard to compare at a glance. Brightness fades rank-over-rank
// (1st brightest, last dimmest) via the .place-bar-N classes in style.css,
// so "better placement" reads as "brighter bar" without needing a legend.
function renderPlacementBar(rank,count,total){
  const pct=total?Math.round((count/total)*100):0;
  const ord=['1st','2nd','3rd','4th'][rank-1];
  return `<div class="place-bar-row">
    <span class="place-bar-label">${ord}</span>
    <div class="place-bar-track"><div class="place-bar-fill place-bar-${rank}" style="width:${pct}%"></div></div>
    <span class="place-bar-pct">${count} (${pct}%)</span>
  </div>`;
}

function renderStatsBlock(s,variant){
  if(!s||s.gamesPlayed===0) return `<p>No games recorded yet in this mode. Play a full match to start building stats.</p>`;
  // Two sources on `s`: the top-level fields are lifetime totals (never
  // shrink, same numbers achievements track — Games Played, Hands Played,
  // Best Hand stay these). `s.windowed` is the exact same shape recomputed
  // from just this profile's last 100 rounds (see server/stats.js's
  // _deriveWindowStats) — every RATE or AVERAGE below (a lifetime rate
  // barely moves after enough games and stops reflecting how you're
  // actually playing lately) reads from that instead, numerator/
  // denominator and all, so each rate row's own numbers stay internally
  // consistent rather than mixing a windowed % with a lifetime count.
  const w=s.windowed||s;
  const avgScore=w.gamesPlayed>0?Math.round(w.totalFinalScore/w.gamesPlayed):0;
  const dealInRate=w.handsWon+w.dealIns>0?((w.dealIns/(w.handsWon+w.dealIns))*100).toFixed(1):'0.0';
  // Hora/Tsumo/Huro/Riichi rate are all "X per hand played" (handsPlayed is
  // the denominator throughout — see stats.js's getLeaderboard, which uses
  // the exact same formulas server-side for the Rankings versions of these).
  // Bankruptcy is "X per GAME" instead — you bust at most once per game,
  // not per hand.
  const horaRate=w.handsPlayed>0?((w.handsWon/w.handsPlayed)*100).toFixed(1):'0.0';
  const tsumoRate=w.handsPlayed>0?((w.tsumoWon/w.handsPlayed)*100).toFixed(1):'0.0';
  const huroRate=w.handsPlayed>0?((w.huro/w.handsPlayed)*100).toFixed(1):'0.0';
  const riichiRate=w.handsPlayed>0?((w.riichiDeclared/w.handsPlayed)*100).toFixed(1):'0.0';
  const bustRate=w.gamesPlayed>0?((w.busts/w.gamesPlayed)*100).toFixed(1):'0.0';
  // Achieved yaku, most-common first, followed by every yaku NOT yet
  // achieved (count 0, dimmed, alphabetical) — see ALL_YAKU_NAMES above.
  // Lifetime (s.yaku), not windowed — a yaku you've ever pulled off stays
  // "achieved" even if it ages out of the last 100 rounds.
  const achievedNames=new Set(Object.keys(s.yaku));
  const achieved=Object.entries(s.yaku).sort((a,b)=>b[1]-a[1]);
  const notAchieved=ALL_YAKU_NAMES.filter(n=>!achievedNames.has(n)).sort();
  // Sanma is 3 players — placements[3] (4th) is always 0/unused there (see
  // stats.js's own comment on the placements array), so only sanma's real
  // three ranks get a bar; yonma still shows all four. Windowed (recent
  // placement distribution reads as recent form, same reasoning as every
  // other rate above), not lifetime.
  const numRanks=variant==='sanma'?3:4;
  const placementBars=Array.from({length:numRanks},(_,i)=>renderPlacementBar(i+1,w.placements[i],w.gamesPlayed)).join('');
  let rows=`
    <div class="sp-row"><span class="sp-label">Games Played</span><span>${s.gamesPlayed}</span></div>
    <div class="place-bars"><div class="sp-label">Placements (last ${w.gamesPlayed} games)</div>${placementBars}</div>
    <div class="sp-row"><span class="sp-label">Avg Final Score (recent)</span><span>${avgScore.toLocaleString()}</span></div>
    <div class="sp-row"><span class="sp-label">Hands Played</span><span>${s.handsPlayed}</span></div>
    <div class="sp-row"><span class="sp-label">Hora Rate</span><span>${w.handsWon}/${w.handsPlayed} (${horaRate}%)</span></div>
    <div class="sp-row"><span class="sp-label">Tsumo Rate</span><span>${w.tsumoWon}/${w.handsPlayed} (${tsumoRate}%) — Ron ${w.ronWon}</span></div>
    <div class="sp-row"><span class="sp-label">Huro Rate</span><span>${w.huro}/${w.handsPlayed} (${huroRate}%)</span></div>
    <div class="sp-row"><span class="sp-label">Riichi Rate</span><span>${w.riichiDeclared}/${w.handsPlayed} (${riichiRate}%)</span></div>
    <div class="sp-row"><span class="sp-label">Deal-In Rate</span><span>${w.dealIns}/${w.handsWon+w.dealIns} (${dealInRate}%)</span></div>
    <div class="sp-row"><span class="sp-label">Bankruptcy Rate</span><span>${w.busts}/${w.gamesPlayed} (${bustRate}%)</span></div>
    <div class="sp-row"><span class="sp-label">Best Hand</span><span>${s.bestHan} Han · ${s.bestScore.toLocaleString()} pts</span></div>
  `;
  rows+=`<div class="about-section">
    <div class="about-section-title yaku-toggle" onclick="toggleYakuSection('${variant}')">Yaku Achieved <span class="yaku-caret" id="yaku-caret-${variant}">▸</span></div>
    <div id="yaku-list-${variant}" style="display:none;">`;
  rows+=achieved.map(([name,count])=>`<div class="sp-row"><span class="sp-label">${escHtml(name)}</span><span>${count}</span></div>`).join('');
  rows+=notAchieved.map(name=>`<div class="sp-row yaku-not-achieved"><span class="sp-label">${escHtml(name)}</span><span>0</span></div>`).join('');
  rows+=`</div></div>`;
  return rows;
}

// Quick Match (vs. bots, via Find Match) and Room Match (create/join a
// room) keep fully separate stat totals (see Room.matchKind in room.js,
// byMatchKind in stats.js) — this picks which one renderStats below reads.
// Reset to 'quick' on every My Stats open, same "don't remember stale
// sub-state" spirit as the Rankings variant/sort reset.
let currentStatsMatchKind='quick';
// Cached so switching the quick/room tab can just re-render instead of
// round-tripping get_stats again — both buckets are already present on
// every 'stats' response (see getStats in stats.js), just under different
// byMatchKind keys.
let lastStatsMsg=null;

function renderStats(m){
  lastStatsMsg=m;
  const body=$('stats-body');
  const s=m.stats;
  const yk=s?.yonma?.byMatchKind?.[currentStatsMatchKind];
  const sk=s?.sanma?.byMatchKind?.[currentStatsMatchKind];
  if(!s||((yk?.gamesPlayed||0)===0&&(sk?.gamesPlayed||0)===0)){
    const modeLabel=currentStatsMatchKind==='quick'?'Quick Match':'Room Match';
    body.innerHTML=`<p>No ${modeLabel} games recorded yet for <strong>${escHtml(m.name)}</strong>. Play a full match to start building stats.</p>`;
    return;
  }
  // Win streak is account-wide (see currentWinStreak on server/stats.js's
  // _emptyStats) — combined across Sanma/Yonma and unaffected by the
  // quick/room match-kind tabs below (yk/sk are ONE matchKind's bucket;
  // win streak isn't split that way at all), so it gets its own row here
  // rather than being duplicated inside renderStatsBlock's per-variant output.
  body.innerHTML=`
    <div class="sp-row"><span class="sp-label">Win Streak</span><span>${s.currentWinStreak||0} current · ${s.bestWinStreak||0} best</span></div>
    <div class="about-section-title">三人麻雀 SANMA</div>
    ${renderStatsBlock(sk,'sanma')}
    <div class="about-section" style="margin-top:18px;">
      <div class="about-section-title">四人麻雀 YONMA</div>
      ${renderStatsBlock(yk,'yonma')}
    </div>
  `;
}

// Switches which match-kind bucket the My Stats panel shows — mirrors
// setLeaderboardSort's tab-toggle pattern, just re-rendering from the
// already-fetched lastStatsMsg instead of a fresh round trip (see above).
function setStatsMatchKind(kind){
  if(kind===currentStatsMatchKind) return;
  currentStatsMatchKind=kind;
  $('btn-stats-quick').classList.toggle('active',kind==='quick');
  $('btn-stats-room').classList.toggle('active',kind==='room');
  if(lastStatsMsg) renderStats(lastStatsMsg);
}

// Same open/fetch/render pattern as toggleUserProfile/renderStats above,
// just against the room-wide leaderboard instead of one name's own stats.
// Reset to 'sanma' on every open, same "don't remember stale sub-state"
// spirit as the profile picker's code prompt — see toggleLeaderboardVariant.
let currentLeaderboardVariant='sanma';
// Which stat the board is ranked by (see the rank-sort-tabs row in
// index.html and setLeaderboardSort below) — separate from
// currentLeaderboardVariant above, which picks the per-variant dataset to
// rank WITHIN. Reset to the default on every open, same "don't remember
// stale sub-state" spirit as the variant reset already had.
let currentLeaderboardSort='totalFinalScore';
// 'all'|'week'|'month' — which request fetchLeaderboard sends (see below).
// Reset to 'all' on every open, same "don't remember stale sub-state"
// spirit as the variant/sort resets already had.
let currentLeaderboardPeriod='all';
// Same labels as each rank-sort-tab's `title` (index.html) — duplicated
// here rather than read off the DOM since #rank-sort-header needs to show
// the CURRENT one at all times, not just on hover, and touch devices never
// fire hover at all (see #rank-sort-header's own comment in index.html).
const RANK_SORT_LABELS={
  totalFinalScore:'Points', gamesWon:'Wins', avgPlacement:'Average Placement',
  bestScore:'Best Hand', bestHan:'Highest Han', handsWon:'Hands Won', yakumanCount:'Yakuman Count',
  dealInRate:'Deal-In Rate', bestWinStreak:'Win Streak',
};
function updateRankSortHeader(sortBy){
  const el=$('rank-sort-header'); if(el) el.textContent=RANK_SORT_LABELS[sortBy]||'';
}
// Single place that actually sends the leaderboard request — routes to
// get_leaderboard (all-time) or get_period_leaderboard (Weekly/Monthly,
// see server/stats.js's getPeriodLeaderboard) purely based on
// currentLeaderboardPeriod, so toggleLeaderboardVariant/setLeaderboardSort
// below don't each need their own if/else for it.
function fetchLeaderboard(){
  $('rankings-body').textContent='Loading…';
  if(currentLeaderboardPeriod==='all'){
    wss({type:'get_leaderboard',variant:currentLeaderboardVariant,sortBy:currentLeaderboardSort});
  } else {
    wss({type:'get_period_leaderboard',variant:currentLeaderboardVariant,sortBy:currentLeaderboardSort,period:currentLeaderboardPeriod});
  }
}
// Switches between All Time/This Week/This Month — mirrors
// toggleLeaderboardVariant/setLeaderboardSort below, just for the third
// axis. Sort selection and variant both carry over across a period switch,
// same "no reason to reset just because you changed one axis" reasoning
// toggleLeaderboardVariant's own comment already gives.
function setLeaderboardPeriod(period){
  if(period===currentLeaderboardPeriod) return;
  currentLeaderboardPeriod=period;
  $('btn-rank-period-all').classList.toggle('active',period==='all');
  $('btn-rank-period-week').classList.toggle('active',period==='week');
  $('btn-rank-period-month').classList.toggle('active',period==='month');
  fetchLeaderboard();
}
function toggleRankings(){
  const modal=$('rankings-modal');
  const backdrop=$('rankings-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  currentLeaderboardVariant='sanma';
  currentLeaderboardSort='totalFinalScore';
  currentLeaderboardPeriod='all';
  $('btn-rank-sanma').classList.add('active');
  $('btn-rank-yonma').classList.remove('active');
  $('btn-rank-period-all').classList.add('active');
  $('btn-rank-period-week').classList.remove('active');
  $('btn-rank-period-month').classList.remove('active');
  document.querySelectorAll('#rank-sort-tabs .rank-sort-tab').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.sort==='totalFinalScore');
  });
  updateRankSortHeader('totalFinalScore');
  fetchLeaderboard();
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// ── Yaku Reference ──────────────────────────────────────────────────────────
// Static — every yaku the scorer (server/mahjong.js detectYaku) recognizes,
// with its han value(s). Purely informational, not tied to the current
// hand, so this never needs a server round-trip. `tab` buckets each entry
// under its CLOSED-hand han value (the number most players think of it by)
// for the tab strip below — display `han` still spells out the full closed/
// open split where it differs. Yakuman all share the 'yakuman' tab instead
// of being split across the 13/26 double-yakuman line, since that's a
// meaningfully different category from ordinary han counting, not just a
// bigger number.
// `example` is a full sample WINNING HAND (14 "<v><suit>" tile keys) that
// satisfies the yaku, so a beginner sees the whole hand it actually takes
// rather than just an isolated group floating with no context. `highlight`
// lists which indices into `example` are the tiles that specifically MAKE
// it that yaku — those render emphasized (glowing outline), the rest
// render dimmed as "just filling out the hand" (see renderYakuRefCard).
// Yaku defined by a property of the WHOLE hand (Tanyao's "no terminals",
// Honitsu's "one suit", Toitoi's "all triplets", Chiitoitsu's 7-pairs
// shape, ...) highlight every index, since every tile is part of what
// qualifies. Yaku defined by one embedded group (a triplet, a same-suit
// straight, two duplicate sequences, ...) highlight only that subset, with
// the remaining tiles as a plausible but otherwise-irrelevant filler
// group+pair. Purely SITUATIONAL yaku (no tile shape at all — Riichi,
// Ippatsu, Menzen Tsumo, Rinshan/Chankan/Haitei/Houtei, Tenhou/Chiihou)
// have neither `example` nor `highlight`: showing an arbitrary hand for
// those would suggest a shape requirement that doesn't exist. Every entry
// has `desc`, a plain-English explanation shown under the tiles (or in
// place of them, for the situational ones).
// `menzen` mirrors exactly what server/mahjong.js's detectYaku actually
// gates on `isMenzen(melds)` for that yaku (not guesswork — cross-checked
// against every `menzen &&` / `menzen?` condition there):
//   'required' — only scores on a fully closed hand (any call, even one
//                pon, kills it entirely): Riichi family, Menzen Tsumo,
//                Pinfu, Iipeiko, Ryanpeiko, Chiitoitsu, both Kokushi
//                variants, both Suu Ankou variants, both Chuuren variants,
//                Tenhou/Chiihou (closed by definition — no call is even
//                possible before the win).
//   'bonus'    — scores either way, but LESS when open (the han value
//                already spells out both numbers): Sanshoku Doujun, Ittsu,
//                Chanta, Junchan, Honitsu, Chinitsu.
//   'any'      — identical han whether the hand is open or closed: every
//                other entry (Tanyao, Yakuhai, Toitoi, San Ankou/Kantsu,
//                Daisangen, Suu Kantsu, the timing yaku, ...).
const YAKU_REFERENCE=[
  {name:'Riichi',jp:'立直',han:'1',tab:1,menzen:'required',desc:'Declared when your closed hand reaches tenpai — any winning shape qualifies, there\'s no tile pattern to show.'},
  {name:'Ippatsu',jp:'一発',han:'1',tab:1,menzen:'required',desc:'Winning within one go-around of declaring riichi, before calling anything — timing, not a tile shape.'},
  {name:'Menzen Tsumo',jp:'門前清自摸和',han:'1',tab:1,menzen:'required',desc:'Any closed hand won by drawing the winning tile yourself, rather than off someone\'s discard.'},
  {name:'Pinfu',jp:'平和',han:'1',tab:1,menzen:'required',
    example:['2m','3m','4m','5p','6p','7p','3s','4s','5s','6s','7s','8s','3p','3p'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'All four groups are sequences, the pair isn\'t a yakuhai tile, and you win on a two-sided (ryanmen) wait.'},
  {name:'Iipeiko',jp:'一盃口',han:'1',tab:1,menzen:'required',
    example:['2m','3m','4m','2m','3m','4m','4p','5p','6p','7s','8s','9s','8s','8s'],highlight:[0,1,2,3,4,5],
    desc:'Two identical sequences (same suit, same numbers) inside one closed hand.'},
  {name:'Tanyao',jp:'断么九',han:'1',tab:1,menzen:'any',
    example:['2m','3m','4m','5p','6p','7p','3s','4s','5s','6s','7s','8s','2p','2p'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'Every tile in the hand is a simple (2-8) — no terminals (1/9) and no honor tiles at all.'},
  {name:'Yakuhai',jp:'役牌',han:'1 per triplet',tab:1,menzen:'any',
    example:['5z','5z','5z','2m','3m','4m','5p','6p','7p','3s','4s','5s','9s','9s'],highlight:[0,1,2],
    desc:'A triplet of a dragon tile, or of your seat/round wind, is worth 1 han on its own — stack multiple for more.'},
  {name:'Rinshan Kaihou',jp:'嶺上開花',han:'1',tab:1,menzen:'any',desc:'Winning on the replacement tile drawn immediately after calling a kan — timing, not a tile shape.'},
  {name:'Chankan',jp:'槍槓',han:'1',tab:1,menzen:'any',desc:'Winning by ron on a tile someone else just added to an existing pon (kakan) — timing, not a tile shape.'},
  {name:'Haitei',jp:'海底摸月',han:'1',tab:1,menzen:'any',desc:'Self-drawing the very last tile in the wall for the win — timing, not a tile shape.'},
  {name:'Houtei',jp:'河底撈魚',han:'1',tab:1,menzen:'any',desc:'Winning by ron on the very last discard of the round — timing, not a tile shape.'},
  {name:'Double Riichi',jp:'ダブルリーチ',han:'2',tab:2,menzen:'required',desc:'Riichi declared on your very first discard, before anyone has called anything — timing, not a tile shape.'},
  {name:'Shousangen',jp:'小三元',han:'2',tab:2,menzen:'any',
    example:['5z','5z','5z','6z','6z','6z','7z','7z','2m','3m','4m','5p','6p','7p'],highlight:[0,1,2,3,4,5,6,7],
    desc:'Two dragon triplets plus a pair of the third dragon — one triplet short of Daisangen.'},
  {name:'Sanshoku Doujun',jp:'三色同順',han:'2 closed / 1 open',tab:2,menzen:'bonus',
    example:['2m','3m','4m','2p','3p','4p','2s','3s','4s','7s','8s','9s','6m','6m'],highlight:[0,1,2,3,4,5,6,7,8],
    desc:'The same sequence (same three numbers) appears in all three suits — man, pin, and sou.'},
  {name:'Sanshoku Doukou',jp:'三色同刻',han:'2',tab:2,menzen:'any',
    example:['5m','5m','5m','5p','5p','5p','5s','5s','5s','2m','3m','4m','9p','9p'],highlight:[0,1,2,3,4,5,6,7,8],
    desc:'The same triplet (same number) appears in all three suits.'},
  {name:'Ittsu',jp:'一気通貫',han:'2 closed / 1 open',tab:2,menzen:'bonus',
    example:['1m','2m','3m','4m','5m','6m','7m','8m','9m','2s','3s','4s','5p','5p'],highlight:[0,1,2,3,4,5,6,7,8],
    desc:'1-2-3, 4-5-6, and 7-8-9 of the same suit, all in one hand.'},
  {name:'Chanta',jp:'混全帯么九',han:'2 closed / 1 open',tab:2,menzen:'bonus',
    example:['1m','2m','3m','7p','8p','9p','1s','2s','3s','7z','7z','7z','9p','9p'],highlight:[0,5,6,9,10,11,12,13],
    desc:'Every group (including the pair) contains at least one terminal or honor tile.'},
  {name:'Toitoi',jp:'対々和',han:'2',tab:2,menzen:'any',
    example:['2m','2m','2m','5p','5p','5p','8s','8s','8s','1z','1z','1z','9p','9p'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'All four groups are triplets (or kans) instead of sequences — no sequences anywhere.'},
  {name:'San Ankou',jp:'三暗刻',han:'2',tab:2,menzen:'any',
    example:['2m','2m','2m','5p','5p','5p','8s','8s','8s','4s','5s','6s','9p','9p'],highlight:[0,1,2,3,4,5,6,7,8],
    desc:'Three concealed triplets somewhere in the hand — the 4th group and the pair can be anything.'},
  {name:'San Kantsu',jp:'三槓子',han:'2',tab:2,menzen:'any',
    example:['2m','2m','2m','2m','5p','5p','5p','5p','8s','8s','8s','8s','9p','9p'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11],
    desc:'Three kans (declared quads) anywhere in the hand.'},
  {name:'Honroutou',jp:'混老頭',han:'2',tab:2,menzen:'any',
    example:['1m','1m','1m','9p','9p','9p','7z','7z','7z','1s','1s','1s','9s','9s'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'Every tile is a terminal (1/9) or an honor — a genuine mix of both, with no simples at all.'},
  {name:'Chiitoitsu',jp:'七対子',han:'2',tab:2,menzen:'required',
    example:['1m','1m','3p','3p','5s','5s','7m','7m','2z','2z','6z','6z','9s','9s'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'Seven distinct pairs — a completely different hand shape from the usual four groups plus a pair.'},
  {name:'Ryanpeiko',jp:'二盃口',han:'3',tab:3,menzen:'required',
    example:['2m','3m','4m','2m','3m','4m','5p','6p','7p','5p','6p','7p','9s','9s'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11],
    desc:'Two separate pairs of identical sequences — like Iipeiko twice over in one hand.'},
  {name:'Junchan',jp:'純全帯么九',han:'3 closed / 2 open',tab:3,menzen:'bonus',
    example:['1m','2m','3m','7p','8p','9p','1s','2s','3s','1p','1p','1p','9m','9m'],highlight:[0,5,6,9,10,11,12,13],
    desc:'Like Chanta, but every group must touch a terminal specifically — no honor tiles allowed anywhere.'},
  {name:'Honitsu',jp:'混一色',han:'3 closed / 2 open',tab:3,menzen:'bonus',
    example:['1p','2p','3p','4p','5p','6p','7p','8p','9p','1z','1z','1z','5p','5p'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'The entire hand is one suit, plus any honor tiles — no second or third suit mixed in.'},
  {name:'Chinitsu',jp:'清一色',han:'6 closed / 5 open',tab:6,menzen:'bonus',
    example:['1p','2p','3p','4p','5p','6p','7p','8p','9p','2p','3p','4p','5p','5p'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'The entire hand is a single suit — no honors, no other suits at all.'},
  {name:'Kokushi Musou',jp:'国士無双',han:'13',tab:'yakuman',menzen:'required',
    // The duplicated tile sits right next to its twin (not split across
    // the two ends of the row) so the pair reads as "these two together",
    // not as a 13-wide spread that could be mistaken for the Juusanmen
    // (13-sided wait) variant's tenpai shape.
    example:['1m','1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'All 13 terminal/honor types, plus one more copy of any of them as the pair.'},
  {name:'Kokushi Juusanmen',jp:'国士無双十三面待ち',han:'26 (double)',tab:'yakuman',menzen:'required',desc:'Kokushi Musou, but already holding all 13 types singly before the win — tenpai on any of the 13 (a 13-sided wait).'},
  {name:'Suu Ankou',jp:'四暗刻',han:'13',tab:'yakuman',menzen:'required',
    example:['1m','1m','1m','4p','4p','4p','7s','7s','7s','2z','2z','2z','9s','9s'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11],
    desc:'Four concealed triplets — the rarest structural yakuman.'},
  {name:'Suu Ankou Tanki',jp:'四暗刻単騎',han:'26 (double)',tab:'yakuman',menzen:'required',desc:'Suu Ankou, but the winning tile completes the pair (a single-tile "tanki" wait) rather than a triplet.'},
  {name:'Daisangen',jp:'大三元',han:'13',tab:'yakuman',menzen:'any',
    example:['5z','5z','5z','6z','6z','6z','7z','7z','7z','2m','3m','4m','9p','9p'],highlight:[0,1,2,3,4,5,6,7,8],
    desc:'All three dragon triplets in one hand.'},
  {name:'Shousuushii',jp:'小四喜',han:'13',tab:'yakuman',menzen:'any',
    example:['1z','1z','1z','2z','2z','2z','3z','3z','3z','4z','4z','5p','6p','7p'],highlight:[0,1,2,3,4,5,6,7,8,9,10],
    desc:'Three wind triplets plus a pair of the fourth wind.'},
  {name:'Daisuushii',jp:'大四喜',han:'26 (double)',tab:'yakuman',menzen:'any',
    example:['1z','1z','1z','2z','2z','2z','3z','3z','3z','4z','4z','4z','9m','9m'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11],
    desc:'All four wind triplets in one hand — the rarer, higher-value sibling of Shousuushii.'},
  {name:'Tsuuiisou',jp:'字一色',han:'13',tab:'yakuman',menzen:'any',
    example:['1z','1z','1z','2z','2z','2z','3z','3z','3z','4z','4z','4z','5z','5z'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'Every tile is an honor — no numbered tiles at all.'},
  {name:'Chinroutou',jp:'清老頭',han:'13',tab:'yakuman',menzen:'any',
    example:['1m','1m','1m','9m','9m','9m','9p','9p','9p','1s','1s','1s','9s','9s'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'Every tile is a terminal (1 or 9) — no honors, no simples.'},
  {name:'Ryuuiisou',jp:'緑一色',han:'13',tab:'yakuman',menzen:'any',
    example:['2s','3s','4s','2s','3s','4s','8s','8s','8s','6z','6z','6z','6s','6s'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'Every tile is green — only 2/3/4/6/8 sou and the Green Dragon qualify.'},
  {name:'Chuuren Poutou',jp:'九蓮宝燈',han:'13',tab:'yakuman',menzen:'required',
    example:['1m','1m','1m','2m','3m','4m','5m','6m','7m','8m','9m','9m','9m','5m'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
    desc:'1-1-1-2-3-4-5-6-7-8-9-9-9 of one suit, plus one more copy of any tile in that suit.'},
  {name:'Junsei Chuuren',jp:'純正九蓮宝燈',han:'26 (double)',tab:'yakuman',menzen:'required',desc:'Chuuren Poutou, but tenpai on the pure 13-tile shape (1112345678999) — any of the 9 tile ranks completes it (a 9-sided wait).'},
  {name:'Suu Kantsu',jp:'四槓子',han:'13',tab:'yakuman',menzen:'any',
    example:['1m','1m','1m','1m','5p','5p','5p','5p','8s','8s','8s','8s','2z','2z'],highlight:[0,1,2,3,4,5,6,7,8,9,10,11],
    desc:'Four kans (declared quads) in one hand — extremely rare.'},
  {name:'Tenhou',jp:'天和',han:'13',tab:'yakuman',menzen:'required',desc:'The dealer\'s starting hand is already complete before anyone has acted — timing, not a tile shape.'},
  {name:'Chiihou',jp:'地和',han:'13',tab:'yakuman',menzen:'required',desc:'A non-dealer wins on their very first draw, before calling or discarding anything — timing, not a tile shape.'},
];
const YAKU_REF_TABS=[
  {id:1,label:'1 Han'},{id:2,label:'2 Han'},{id:3,label:'3 Han'},{id:6,label:'6 Han'},{id:'yakuman',label:'Yakuman'},
];
let currentYakuRefTab=1;
const YAKU_MENZEN_BADGE={
  required:{text:'Closed Hand Only',cls:'yakuref-menzen-required'},
  bonus:{text:'Open OK (less han)',cls:'yakuref-menzen-bonus'},
  any:{text:'Open Hand OK',cls:'yakuref-menzen-any'},
};
function renderYakuRefCard(y){
  const tilesHtml=y.example
    // Non-highlighted tiles dim to fade into the background — that
    // contrast alone is enough to read "these are the ones that matter",
    // so the highlighted tiles themselves get no extra frame/outline.
    ? `<div class="yakuref-tiles">${y.example.map((k,i)=>
        miniTileHTML(k,24,34,y.highlight.includes(i)?null:'yakuref-tile-dim')
      ).join('')}</div>`
    : '';
  const badge=YAKU_MENZEN_BADGE[y.menzen];
  const badgeHtml=badge?`<span class="yakuref-menzen-badge ${badge.cls}">${escHtml(badge.text)}</span>`:'';
  const descHtml=y.desc?`<div class="yakuref-desc">${escHtml(y.desc)}</div>`:'';
  return `<div class="yakuref-card"><div class="yakuref-card-head">${escHtml(y.name)}<span class="yh">${escHtml(y.han)}</span><span class="yj">${escHtml(y.jp)}</span>${badgeHtml}</div>${tilesHtml}${descHtml}</div>`;
}
function renderYakuRefSection(list){
  return list.map(renderYakuRefCard).join('');
}
function renderYakuRefBody(){
  const tabsHtml=YAKU_REF_TABS.map(t=>
    `<button class="rank-period-tab${t.id===currentYakuRefTab?' active':''}" onclick='setYakuRefTab(${JSON.stringify(t.id)})'>${escHtml(t.label)}</button>`
  ).join('');
  const list=YAKU_REFERENCE.filter(y=>y.tab===currentYakuRefTab);
  $('yakuref-body').innerHTML=
    `<div class="rank-period-tabs">${tabsHtml}</div><div class="yakuref-list">${renderYakuRefSection(list)}</div>`;
  fitYakuRefTiles(list);
}
// Shrinks each card's tile row to whatever size actually fits its own
// rendered width in one line, instead of the fixed 24px letting a
// many-tile card (up to 14) wrap to a second row on a narrow screen — same
// "measure the real container, size to fit" approach fitEndTileSize uses
// for the round-end winning-hand display elsewhere in this file. Needs an
// actual DOM measurement pass (can't be precomputed), since a card's
// available width depends on the modal's rendered size, which varies with
// viewport/--ui-vmin scaling. `list` is the same array renderYakuRefBody
// just rendered, in the same order as the cards now in the DOM, so each
// card can be matched back to its `example`/`highlight` data by index
// without re-parsing anything from the page.
function fitYakuRefTiles(list){
  const cards=[...document.querySelectorAll('#yakuref-body .yakuref-card')];
  cards.forEach((card,i)=>{
    const y=list[i];
    const tilesEl=card.querySelector('.yakuref-tiles');
    if(!y||!tilesEl||!y.example||!y.example.length) return;
    const count=y.example.length;
    const gap=2; // matches .yakuref-tiles' own CSS gap
    const availWidth=tilesEl.clientWidth;
    if(!availWidth) return;
    let w=Math.floor((availWidth-(count-1)*gap)/count);
    w=Math.max(12,Math.min(w,34)); // 34 keeps a low-count card (e.g. Yakuhai's 3 tiles) from ballooning
    const h=Math.round(w*1.4);
    tilesEl.innerHTML=y.example.map((k,idx)=>
      miniTileHTML(k,w,h,y.highlight.includes(idx)?null:'yakuref-tile-dim')
    ).join('');
  });
}
function setYakuRefTab(id){
  currentYakuRefTab=id;
  renderYakuRefBody();
}
function toggleYakuRef(){
  const modal=$('yakuref-modal');
  const backdrop=$('yakuref-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  currentYakuRefTab=1;
  // Modal made visible BEFORE rendering, not after — fitYakuRefTiles (run
  // at the end of renderYakuRefBody) measures each card's real
  // clientWidth to size tiles, which reads 0 on a display:none element.
  // Rendering first (as this used to) left the very first open's tiles
  // stuck at their unadjusted default size — a later tab switch "fixed"
  // itself only because the modal was already visible by then.
  modal.classList.add('visible');
  backdrop.classList.add('visible');
  renderYakuRefBody();
}

// ── Hand Advice ("Help") ─────────────────────────────────────────────────────
// Beginner-assist: on click, ask the server to analyze THIS player's actual
// current hand/situation (see get_advice/'advice' in server/room.js) and
// render its response. Deliberately request-driven, never auto-refreshed —
// the point is a player-initiated hint, not a running autopilot overlay.
const TILE_SUIT_NAMES={m:'Man',p:'Pin',s:'Sou'};
const HONOR_NAMES={'1z':'East','2z':'South','3z':'West','4z':'North','5z':'White Dragon','6z':'Green Dragon','7z':'Red Dragon'};
function tileKeyLabel(k){
  if(HONOR_NAMES[k]) return HONOR_NAMES[k];
  const v=k.slice(0,-1),s=k.slice(-1);
  return `${v} ${TILE_SUIT_NAMES[s]||s}`;
}
// Anchors the panel's bottom-left corner just above the ❓ help button that
// opened it (same getBoundingClientRect + inline left/top approach as
// positionPlayerPopover, just anchored by the trigger button instead of a
// clicked nameplate) — clamped to stay fully on-screen, since the button
// sits close to the right edge and a naive left-aligned placement would
// push part of the panel off it. Re-run after renderAdvice() replaces the
// placeholder with real content too, since the panel's height (and so
// where its top edge needs to land to keep the bottom-left corner anchored
// in place) changes once actual advice text/tiles replace "Analyzing…".
function positionAdvicePanel(){
  const panel=$('advice-modal');
  const btn=$('badvice');
  if(!panel||!btn) return;
  const r=btn.getBoundingClientRect();
  const pw=panel.offsetWidth, ph=panel.offsetHeight;
  const margin=8, gap=10;
  let left=r.left;
  let top=r.top-gap-ph;
  left=Math.max(margin,Math.min(left,window.innerWidth-pw-margin));
  top=Math.max(margin,Math.min(top,window.innerHeight-ph-margin));
  panel.style.left=left+'px';
  panel.style.top=top+'px';
  panel.style.bottom='auto';
}
function requestAdvice(){
  if(!inGame) return;
  wss({type:'get_advice'});
  $('advice-body').innerHTML='<div class="about-body" style="text-align:center;">Analyzing your hand…</div>';
  $('advice-modal').classList.add('visible');
  $('advice-backdrop').classList.add('visible');
  positionAdvicePanel();
}
function toggleAdvice(){
  $('advice-modal').classList.remove('visible');
  $('advice-backdrop').classList.remove('visible');
}
// Small inline SVG for a single tile from its "<v><suit>" key — used inline
// inside text rows (discard/wait lists) where a DOM element would be
// awkward to splice into a template string. Reuses the same tsvg() renderer
// as the in-game hand/discard tiles, just at a smaller fixed size.
function miniTileHTML(k,w=20,h=28,extraClass){
  // Routed through mkEl (not a bare tsvg() string) specifically for its
  // '.tile.tmd' wrapper — that's what supplies the ivory tile-face
  // background/gold border every other tile in the game has. A raw tsvg()
  // string here previously left these mini tiles as bare glyphs floating
  // on the modal's dark background, with no tile shape behind them at all.
  const el=mkEl(keyToTile(k),'tmd',w,h);
  if(extraClass) el.classList.add(extraClass);
  return `<span class="advice-mini-tile">${el.outerHTML}</span>`;
}
function renderAdvice(m){
  const parts=[];
  const doraTxt=m.doraCount>0?` You're holding ${m.doraCount} dora.`:'';
  parts.push(`<div class="about-section-title">Shanten</div><div class="about-body">${
    (m.isTenpai?'You\'re in tenpai — one tile away from a winning hand!':`You're ${m.shanten} tile${m.shanten===1?'':'s'} away from tenpai.`)
  }${escHtml(doraTxt)}</div>`);

  // Beginner traps/opportunities — surfaced right under the shanten line,
  // above the shape-specific sections below, since these matter regardless
  // of whether the hand is even close to tenpai.
  if(m.furiten){
    parts.push(`<div class="advice-row advice-row-bad">⚠ You're in furiten — you can't win by ron right now (tsumo only) until it clears.</div>`);
  }
  if(m.wallLowTip){
    parts.push(`<div class="advice-row advice-row-warn">⏳ ${escHtml(m.wallLowTip)}</div>`);
  }
  if(m.kitaTip){
    parts.push(`<div class="advice-row advice-row-best">🀄 ${escHtml(m.kitaTip)}</div>`);
  }
  if(m.riichiTip){
    parts.push(`<div class="advice-row advice-row-best">${escHtml(m.riichiTip)}</div>`);
  }
  if(m.dangerTip){
    const oppList=m.dangerTip.opponents.join(', ');
    const safeTxt=m.dangerTip.safeKeys.length
      ? `Safe tiles in your hand right now: ${m.dangerTip.safeKeys.map(tileKeyLabel).join(', ')}.`
      : `None of your current tiles are confirmed safe against them yet.`;
    parts.push(`<div class="advice-row advice-row-warn">🛡 ${escHtml(oppList)} ${m.dangerTip.opponents.length===1?'is':'are'} in riichi — pushing risks dealing in. ${safeTxt}</div>`);
  }

  if(m.discards&&m.discards.length){
    const top=m.discards[0];
    const rows=m.discards.map((d,i)=>{
      const waitTxt=d.shanten===0?` — waits on ${d.waitTiles.map(tileKeyLabel).join(', ')||'nothing yet'} (${d.waitCount} tile type${d.waitCount===1?'':'s'})`:'';
      // Flags when THIS specific discard would give up a yaku another
      // candidate wouldn't (e.g. breaking a dragon pair you were holding
      // toward Yakuhai) — efficiency (shanten/waits) alone stays silent
      // about that trade-off otherwise.
      const lostTxt=d.lostYaku&&d.lostYaku.length
        ? `<div class="advice-lost-yaku">⚠ Gives up potential: ${d.lostYaku.map(escHtml).join(', ')}</div>` : '';
      return `<div class="advice-row${i===0?' advice-row-best':''}">${escHtml(tileKeyLabel(d.key))}${i===0?' (best)':''} → ${d.shanten===0?'tenpai':d.shanten+'-away'}${waitTxt}${lostTxt}</div>`;
    }).join('');
    parts.push(`<div class="about-section"><div class="about-section-title">Suggested Discard</div><div class="about-body">Discard <b>${escHtml(tileKeyLabel(top.key))}</b> — it keeps your hand closest to tenpai.</div><div class="advice-list">${rows}</div></div>`);
  }

  if(m.callAdvice&&m.callAdvice.length){
    const rows=m.callAdvice.map(c=>{
      // Three mutually exclusive outcomes for "what would calling lead
      // to": already-tenpai-with-a-yaku (show what you could win with),
      // already-tenpai-but-NO-yaku (the classic open-hand trap — reaching
      // tenpai means nothing if there's nothing to declare a win on), or
      // not tenpai yet (show the same composition hints the main
      // Potential Yaku section uses, just for the post-call hand).
      let extra='';
      if(c.noYakuWarning){
        extra=`<div class="advice-call-warning">⚠ Reaches tenpai, but with no yaku — you wouldn\'t be able to win on it as-is.</div>`;
      } else if(c.yaku&&c.yaku.length){
        const pills=c.yaku.map(y=>`<span class="yc" style="margin:2px;">${escHtml(y)}</span>`).join('');
        extra=`<div class="advice-call-yaku">Could win with: ${pills}</div>`;
      } else if(c.potential&&c.potential.length){
        const hints=c.potential.map(p=>`<div class="advice-call-potential-item">${escHtml(p.name)} <span class="yj">${escHtml(p.jp)}</span> — ${escHtml(p.hint)}</div>`).join('');
        extra=`<div class="advice-call-potential">${hints}</div>`;
      }
      return `<div class="advice-row${c.recommend?' advice-row-best':' advice-row-bad'}">${c.recommend?'✓':'✗'} ${escHtml(c.type.toUpperCase())} — ${escHtml(c.reason)}${extra}</div>`;
    }).join('');
    parts.push(`<div class="about-section"><div class="about-section-title">Should You Call?</div><div class="advice-list">${rows}</div></div>`);
  }

  if(m.waits&&m.waits.length){
    const rows=m.waits.map(w=>{
      const yakuPills=w.yaku.map(y=>`<span class="yc" style="margin:2px;">${escHtml(y)}</span>`).join('');
      return `<div class="advice-wait"><div class="advice-wait-tile">${escHtml(tileKeyLabel(w.tile))}</div><div class="advice-wait-score">${w.han} Han${w.fu?', '+w.fu+' Fu':''} · ${escHtml(w.label)} · ${w.points.toLocaleString()} pts</div><div class="advice-wait-yaku">${yakuPills}</div></div>`;
    }).join('');
    parts.push(`<div class="about-section"><div class="about-section-title">Waits &amp; Potential Score</div>${rows}</div>`);
  } else if(m.potential&&m.potential.length){
    const rows=m.potential.map(p=>`<div class="advice-row">${escHtml(p.name)} <span class="yj">${escHtml(p.jp)}</span> — ${escHtml(p.hint)}</div>`).join('');
    parts.push(`<div class="about-section"><div class="about-section-title">Potential Yaku</div><div class="advice-list">${rows}</div></div>`);
  }

  $('advice-body').innerHTML=parts.join('');
  positionAdvicePanel();
}

// Sanma/yonma leaderboards are scored on different scales (see
// server/stats.js) so this re-fetches rather than filtering client-side —
// there's no combined dataset to filter from, each variant is its own
// query server-side. Sort selection (currentLeaderboardSort) carries over
// across a variant switch — no reason picking e.g. "Yakuman" should reset
// just because you also swapped from yonma to sanma.
function toggleLeaderboardVariant(variant){
  if(variant===currentLeaderboardVariant) return;
  currentLeaderboardVariant=variant;
  $('btn-rank-yonma').classList.toggle('active',variant==='yonma');
  $('btn-rank-sanma').classList.toggle('active',variant==='sanma');
  fetchLeaderboard();
}

// Switches which stat the board is ranked by (see rank-sort-tabs in
// index.html) — mirrors toggleLeaderboardVariant above, just for the other
// axis (stat instead of player-count).
function setLeaderboardSort(sortBy){
  if(sortBy===currentLeaderboardSort) return;
  currentLeaderboardSort=sortBy;
  document.querySelectorAll('#rank-sort-tabs .rank-sort-tab').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.sort===sortBy);
  });
  updateRankSortHeader(sortBy);
  fetchLeaderboard();
}

function renderLeaderboard(m){
  // Guards against a stale response landing after the user already
  // switched tabs again (multiple requests in flight, an older one
  // resolving after a newer one) — server echoes back which variant, sort,
  // AND period this response is for (see the get_leaderboard/
  // get_period_leaderboard handlers in index.js), so any one of them
  // having since moved on discards it. get_leaderboard's own 'leaderboard'
  // response has no `period` field at all (it's always All Time), hence
  // the `||'all'` — matches currentLeaderboardPeriod's own default.
  if(m.variant&&m.variant!==currentLeaderboardVariant) return;
  if(m.sortBy&&m.sortBy!==currentLeaderboardSort) return;
  if((m.period||'all')!==currentLeaderboardPeriod) return;
  const body=$('rankings-body');
  const entries=m.entries||[];
  const periodLabel=currentLeaderboardPeriod==='week'?'this week':currentLeaderboardPeriod==='month'?'this month':null;
  if(!entries.length){
    // avgPlacement and dealInRate rows are filtered server-side below a
    // minimum games/hands count (see stats.js) — an empty list there
    // almost always means that threshold, not literally zero games
    // played, so says so specifically rather than the generic "no games
    // recorded" message. The same threshold applies within Weekly/Monthly
    // too (see getPeriodLeaderboard) — a harder bar to clear in just a
    // week, but not called out differently here; the message already
    // explains the real reason either way.
    if(currentLeaderboardSort==='avgPlacement'){
      body.innerHTML=`<p>Nobody's played enough games${periodLabel?' '+periodLabel:''} yet (5+ needed) for an average placement ranking.</p>`;
    }else if(currentLeaderboardSort==='dealInRate'){
      body.innerHTML=`<p>Nobody's played enough hands${periodLabel?' '+periodLabel:''} yet (5+ needed) for a deal-in rate ranking.</p>`;
    }else if(periodLabel){
      body.innerHTML=`<p>No games recorded ${periodLabel} yet. Play a full match to appear on the board.</p>`;
    }else{
      body.innerHTML=`<p>No games recorded yet. Play a full match to appear on the board.</p>`;
    }
    return;
  }
  const myName=$('iname').value.trim()||'Player';
  const rows=entries.map((e,i)=>{
    const mine=e.name===myName;
    return `<div class="sp-row${mine?' sp-row-mine':''}" data-player-name="${escHtml(e.name)}">
      <span class="sp-label sp-label-clickable" onclick="openPlayerCard(this)">#${i+1} ${escHtml(e.name)}</span>
      <span>${formatRankingPrimary(e,currentLeaderboardSort)}</span>
    </div>`;
  }).join('');
  body.innerHTML=rows;
}

// The one figure a leaderboard row (or a player card — see
// openPlayerCard/renderPlayerCard below) is actually ranked by, formatted
// to match whichever sort tab is active — shared so both places always
// read identically for the same sort. `e`/entry is a getLeaderboard() row
// shape ({gamesWon, avgPlacement, bestScore, bestHan, handsWon,
// yakumanCount, dealInRate, totalFinalScore, ...} — see server/stats.js).
function formatRankingPrimary(e,sortBy){
  switch(sortBy){
    case 'gamesWon': return `${e.gamesWon} wins`;
    case 'avgPlacement': return `${e.avgPlacement.toFixed(2)} avg place`;
    case 'bestScore': return `${e.bestScore.toLocaleString()} pts (best hand)`;
    case 'bestHan': return `${e.bestHan} han (best)`;
    case 'handsWon': return `${e.handsWon} hands won`;
    case 'yakumanCount': return `${e.yakumanCount} yakuman`;
    case 'dealInRate': return `${e.dealInRate.toFixed(1)}% deal-in`;
    case 'bestWinStreak': return `${e.bestWinStreak} game streak`;
    default: return `${e.totalFinalScore.toLocaleString()} pts`;
  }
}

// Clicking a name in Rankings opens a separate modal (#player-card-modal,
// stacked on top of Rankings — see its own comment in index.html) showing
// ONLY that one player's nameplate + a SUMMARY of their rank in every
// ranking category, both variants — not their whole detailed stats
// history, but also not just whichever one sort tab happened to be active,
// so it answers "how do they rank overall" without clicking through each
// tab (see renderPlayerCard). Tracks the currently-requested name so a
// slow response can't clobber a LATER click's result if the player clicks
// a second name (or closes the modal) before the first response arrives.
// pendingPlayerCardKind tells the 'player_stats' handler in onMsg which UI
// asked for it ('modal' for Rankings' full card, 'popover' for the in-game
// nameplate glance below) — both share the one get_player_stats round trip
// and message type, so this is the only way the response knows which
// renderer to hand off to.
let pendingPlayerCardName=null;
let pendingPlayerCardKind=null;
// This connection's own unlocked profile id (the 16-digit friend ID),
// received in the 'profile_unlocked' message. null for Guest. Shown in the
// Friends panel and used to suppress the in-game ＋ on your own nameplate.
let myProfileId=null;
// Ids the client currently believes are friends — repopulated from every
// 'friends' message. Only used to hide the popover ＋ for known friends; the
// server still validates every request regardless.
let friendIdSet=new Set();
function openPlayerCard(labelEl){
  const row=labelEl.closest('.sp-row');
  openPlayerCardByName(row.dataset.playerName);
}

function openPlayerCardByName(name){
  pendingPlayerCardName=name;
  pendingPlayerCardKind='modal';
  $('player-card-body').innerHTML=`<p class="player-card-loading">Loading…</p>`;
  $('player-card-modal').classList.add('visible');
  $('player-card-backdrop').classList.add('visible');
  wss({type:'get_player_stats',name});
}

function closePlayerCard(){
  if(pendingPlayerCardKind==='modal') pendingPlayerCardName=null;
  $('player-card-modal').classList.remove('visible');
  $('player-card-backdrop').classList.remove('visible');
}

// In-game nameplate click (see the onclick on #npb/#npt/#npl/#npr in
// index.html) — a small popover anchored next to the nameplate, deliberately
// NOT the Rankings player-card modal above: that one has a full-screen
// backdrop, which mid-hand would block the board the player is actively
// reading. posId is the seat's DOM suffix ('b'/'t'/'l'/'r'), used to look up
// the name/bot-status startGame stashed in inGameSeatInfo. Bots have no
// profile/stats to show (get_player_stats would just come back all zeroes
// for whatever id their display name happens to hash to), so their
// nameplate is a no-op rather than opening a popover that reads "0 games
// played" for something that was never a real player. Clicking the SAME
// nameplate again toggles the popover closed instead of re-requesting.
let inGameSeatInfo={};
// Last-clicked nameplate element — kept so renderPlayerPopover can
// re-measure/reposition once real content replaces the "Loading…"
// placeholder (its height changes, so the initial position can go stale).
let popoverAnchorEl=null;
// The clicked opponent's stable profile id (from room.js's _seatInfo
// friendId), for the popover's ＋ Add Friend button. null for bots/guests.
let popoverFriendId=null;
// True between tapping the popover's ＋ Add Friend (confirm) and its
// friend_request_result landing — so that result updates the button text
// in place instead of firing the generic toast/modal-error handling.
let popoverRequestPending=false;
function openPlayerCardInGame(posId,anchorEl){
  const info=inGameSeatInfo[posId];
  if(!info||info.isBot||!info.name) return;
  const pop=$('player-popover');
  if(pop.style.display!=='none'&&pendingPlayerCardName===info.name&&pendingPlayerCardKind==='popover'){
    closePlayerPopover();
    return;
  }
  pendingPlayerCardName=info.name;
  pendingPlayerCardKind='popover';
  popoverAnchorEl=anchorEl;
  popoverFriendId=info.friendId||null;
  positionPlayerPopover(anchorEl);
  $('pp-nameplate').innerHTML='';
  $('pp-stats').innerHTML=`<p class="player-card-loading">Loading…</p>`;
  resetPopoverAddFriend();
  pop.style.display='';
  wss({type:'get_player_stats',name:info.name});
}

function closePlayerPopover(){
  if(pendingPlayerCardKind==='popover') pendingPlayerCardName=null;
  pendingPlayerCardKind=null;
  popoverAnchorEl=null;
  popoverFriendId=null;
  resetPopoverAddFriend();
  $('player-popover').style.display='none';
}

// Back to the un-armed "＋ Add Friend" state — hidden, enabled, first tap.
function resetPopoverAddFriend(){
  popoverRequestPending=false;
  const af=$('pp-addfriend');
  if(af){ af.style.display='none'; af.disabled=false; af.dataset.armed='0'; af.textContent='＋ Add Friend'; }
}

// The popover's ＋ Add Friend button — a two-tap control, no separate
// dialog: first tap arms it ("Tap again to confirm"), second tap sends the
// request and the button itself becomes the status line ("Friend request
// sent", or whatever friend_request_result reports — see onMsg).
function addFriendFromPopover(){
  const btn=$('pp-addfriend');
  if(!btn||!popoverFriendId) return;
  if(btn.dataset.armed!=='1'){
    btn.dataset.armed='1';
    btn.textContent='Tap again to confirm';
    return;
  }
  btn.dataset.armed='0';
  btn.disabled=true;
  btn.textContent='Friend request sent';
  popoverRequestPending=true;
  wss({type:'send_friend_request',toId:popoverFriendId});
}

// Anchors the popover just below-and-centered on whichever nameplate was
// clicked, clamped to stay fully on-screen (an opponent nameplate near a
// screen edge would otherwise push the popover half off it). Uses
// position:fixed + getBoundingClientRect (viewport coordinates) rather than
// the anchor's offsetParent, since nameplates sit inside the felt's
// rotated/translated ancestors (see .np-wrap-t/l/r) — an offset-based
// position would inherit that rotation instead of just placing a small
// upright card near the click.
function positionPlayerPopover(anchorEl){
  const pop=$('player-popover');
  const r=anchorEl.getBoundingClientRect();
  pop.style.display=''; // must be visible to measure its own size below
  const pw=pop.offsetWidth||220, ph=pop.offsetHeight||120;
  let left=r.left+r.width/2-pw/2;
  let top=r.bottom+8;
  const margin=8;
  left=Math.max(margin,Math.min(left,window.innerWidth-pw-margin));
  if(top+ph>window.innerHeight-margin) top=r.top-ph-8; // flip above if it'd overflow the bottom
  top=Math.max(margin,top);
  pop.style.left=left+'px';
  pop.style.top=top+'px';
}

// Dismiss on any click outside the popover itself and outside every
// nameplate (nameplates handle their own open/toggle-close via
// openPlayerCardInGame — excluding them here stops this same click from
// immediately closing what that just opened) or on Escape.
document.addEventListener('click',e=>{
  if(pendingPlayerCardKind!=='popover') return;
  if(e.target.closest('#player-popover')||e.target.closest('.np')) return;
  closePlayerPopover();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&pendingPlayerCardKind==='popover') closePlayerPopover();
});

// Combined-across-both-variants glance (see the `combined` field in
// server/index.js's 'get_player_stats' handler) — deliberately just these
// three numbers plus the nameplate, no Sanma/Yonma split and no ranking
// categories, unlike renderPlayerCard's full modal. m.name is checked
// against pendingPlayerCardName the same way renderPlayerCard does, so a
// slow response can't clobber a later click (or paint into a popover the
// player already dismissed).
function renderPlayerPopover(m){
  if(m.name!==pendingPlayerCardName||pendingPlayerCardKind!=='popover') return;
  const tierCls=nameplateTierClass(m.wins||0);
  $('pp-nameplate').innerHTML=`
    <div class="up-nameplate player-card-nameplate${tierCls?' '+tierCls:''}">
      <span class="pnp-icon">${iconSvg(m.icon)}</span>
      <span class="pnp-info">
        <span class="pnp-name">${escHtml(m.name)}</span>
        <span class="pnp-title">${escHtml(m.title||'Beginner')}</span>
      </span>
    </div>`;
  const c=m.combined||{gamesPlayed:0,gamesWon:0,dealInRate:null,bestHan:0,currentWinStreak:0};
  const dealIn=c.dealInRate!=null?`${c.dealInRate.toFixed(1)}%`:'—';
  const bestHan=c.bestHan>0?`${c.bestHan} han`:'—';
  $('pp-stats').innerHTML=`
    <div class="sp-row"><span class="sp-label">Win Streak</span><span>${c.currentWinStreak||0}</span></div>
    <div class="sp-row"><span class="sp-label">Games Played</span><span>${c.gamesPlayed}</span></div>
    <div class="sp-row"><span class="sp-label">Games Won</span><span>${c.gamesWon}</span></div>
    <div class="sp-row"><span class="sp-label">Deal-In Rate</span><span>${dealIn}</span></div>
    <div class="sp-row"><span class="sp-label">Best Han</span><span>${bestHan}</span></div>
  `;
  // ＋ Add Friend — only for a real opponent id you're not already friends
  // with, and only when you're playing as a profile yourself. Shown fresh
  // (un-armed) each time the popover opens.
  const af=$('pp-addfriend');
  if(af){
    const show=popoverFriendId&&myProfileId&&popoverFriendId!==myProfileId&&!friendIdSet.has(popoverFriendId);
    if(show&&!popoverRequestPending){
      af.style.display='';af.disabled=false;af.dataset.armed='0';af.textContent='＋ Add Friend';
    } else if(!show){
      af.style.display='none';
    }
  }
  if(popoverAnchorEl) positionPlayerPopover(popoverAnchorEl);
}

// Renders one variant's worth of category rows (see server's `summarize`
// in the get_player_stats handler) — one row per ranking category this
// player currently qualifies for; categories they're not ranked in yet
// (below a minimum-sample gate — see stats.js) are skipped rather than
// shown as a blank/broken row. `list` is empty of qualifying entries when
// this player has no ranked games at all in this variant.
function renderRankSummary(list){
  const rows=list.filter(r=>r.entry).map(r=>
    `<div class="sp-row"><span class="sp-label">${escHtml(RANK_SORT_LABELS[r.sortBy]||'Points')}</span><span>#${r.rank} · ${formatRankingPrimary(r.entry,r.sortBy)}</span></div>`
  ).join('');
  return rows||`<p>Not ranked yet — not enough games/hands recorded in this mode.</p>`;
}

// Games Played/Wins/Best Hand headline row — unlike renderRankSummary above,
// these are plain lifetime totals (see the headline() helper in
// server/index.js's 'get_player_stats' handler), always shown even for a
// player with too few games to qualify for any ranking category. Best Hand
// shown as "N han (S pts)" when the player has actually won a hand in this
// variant (bestScore>0), otherwise "—" — a bare "0 han" reads as a real
// (terrible) hand rather than "hasn't won one yet".
function renderHeadlineSummary(h){
  const bestHand=h.bestScore>0?`${h.bestHan} han (${h.bestScore.toLocaleString()} pts)`:'—';
  return `
    <div class="sp-row"><span class="sp-label">Games Played</span><span>${h.gamesPlayed}</span></div>
    <div class="sp-row"><span class="sp-label">Wins</span><span>${h.gamesWon}</span></div>
    <div class="sp-row"><span class="sp-label">Best Hand</span><span>${bestHand}</span></div>
  `;
}

// Response handler for openPlayerCard's request — see onMsg's
// 'player_stats' branch. Deliberately a separate message type from 'stats'
// (the current user's OWN stats response), not reused: that handler also
// refreshes the viewer's own unlockedThemes/unlockedTitles/achievements/
// nameplate tier from whatever it's given, which would corrupt all of
// those with some OTHER player's unlocks if this reused it.
function renderPlayerCard(m){
  if(m.name!==pendingPlayerCardName) return; // stale — modal closed or a different name clicked since
  // Tier class (see nameplateTierClass) applied directly here rather than
  // via updateNameplateTier — that function targets the User Profile
  // hub's OWN nameplate specifically, not whichever player is being
  // viewed here. This used to go entirely unset (always reading as the
  // default Bronze tier regardless of the viewed player's real wins) —
  // see server/index.js's 'get_player_stats' handler for where m.wins
  // comes from.
  const tierCls=nameplateTierClass(m.wins||0);
  $('player-card-body').innerHTML=`
    <div class="about-title up-nameplate player-card-nameplate${tierCls?' '+tierCls:''}">
      <span class="pnp-icon">${iconSvg(m.icon)}</span>
      <span class="pnp-info">
        <span class="pnp-name">${escHtml(m.name)}</span>
        <span class="pnp-title">${escHtml(m.title||'Beginner')}</span>
      </span>
    </div>
    <div class="about-section-title">三人麻雀 SANMA</div>
    ${renderHeadlineSummary(m.sanmaHeadline)}
    ${renderRankSummary(m.sanma)}
    <div class="about-section" style="margin-top:18px;">
      <div class="about-section-title">四人麻雀 YONMA</div>
      ${renderHeadlineSummary(m.yonmaHeadline)}
      ${renderRankSummary(m.yonma)}
    </div>
  `;
}

// ════════════════════════════════════════════════════════════
// PROFILES — replaces free-typed names: play requires selecting an
// existing profile and unlocking it with its code (see server/index.js's
// unlockedName). Unlocking sets #iname's value/readonly text to the
// confirmed name — every other place in this file that reads
// $('iname').value keeps working unchanged, since it's now just always
// the confirmed profile name instead of freely typed text.
// ════════════════════════════════════════════════════════════
// Which card the player has clicked in the picker grid, if any — the
// actual login target once they submit a code (see unlockProfile). Reset
// to null every time the picker (re)opens, same "ask again" spirit as
// Developer Settings' own gate.
let selectedProfileName=null;

function toggleProfilePicker(){
  const modal=$('profile-modal');
  const backdrop=$('profile-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  selectedProfileName=null;
  $('profile-error').textContent='';
  $('profile-code').value='';
  $('profile-code-section').style.display='none';
  rememberProfile=false;
  $('profile-remember').checked=false;
  $('profile-card-grid').innerHTML='<p>Loading…</p>';
  wss({type:'list_profiles'});
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// Shared by the player-facing picker (icon+name cards, #profile-card-grid)
// and Developer Settings' delete dropdown (#dev-delete-select, still a
// plain name list) — both are driven by the same 'list_profiles'
// request/response, just from different callers (toggleProfilePicker/
// toggleDevPanel), so this fills in whichever of the two is present.
function renderProfileList(m){
  const profiles=m.profiles||[];
  const grid=$('profile-card-grid');
  if(grid){
    grid.innerHTML='';
    // Always present, first, regardless of how many real profiles exist —
    // the no-code, no-data option (see select_guest in index.js). Unlike
    // the real cards below, clicking it logs in immediately, no code
    // prompt (see selectGuest).
    const guestBtn=document.createElement('button');
    guestBtn.className='profile-card';
    guestBtn.innerHTML=`${guestIconSvg}<span class="profile-card-name">Guest</span>`;
    guestBtn.onclick=selectGuest;
    grid.appendChild(guestBtn);
    profiles.forEach(p=>{
      const btn=document.createElement('button');
      btn.className='profile-card';
      btn.dataset.name=p.name;
      btn.innerHTML=`${iconSvg(p.icon)}<span class="profile-card-name">${escHtml(p.name)}</span>`;
      btn.onclick=()=>selectProfileCard(p.name);
      grid.appendChild(btn);
    });
  }
  const del=$('dev-delete-select');
  if(del){
    del.innerHTML=profiles.length
      ? profiles.map(p=>`<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`).join('')
      : '<option value="">No profiles yet</option>';
  }
}

// Clicking a card doesn't log in by itself — it just picks which profile
// the code prompt below the grid now applies to (highlighted via .active,
// same pattern as the theme/icon pickers elsewhere in this file). Picking
// the profile that's already unlocked on this connection (#iname's value —
// see the block comment above) is a no-op server-side, so skip the code
// prompt entirely and just close the picker instead of asking to re-enter
// a code that's already verified.
function selectProfileCard(name){
  if(name===$('iname').value){ toggleProfilePicker(); return; }
  selectedProfileName=name;
  document.querySelectorAll('.profile-card').forEach(c=>{
    c.classList.toggle('active',c.dataset.name===name);
  });
  $('profile-code-label').textContent=`Code for ${name}`;
  $('profile-error').textContent='';
  $('profile-code').value='';
  $('profile-code-section').style.display='';
  $('profile-code').focus();
}

// "Stay logged in" checkbox inside the profile picker's code prompt —
// deliberately doesn't persist across picker opens (toggleProfilePicker
// resets it unchecked every time, same "ask again" spirit as the code
// field next to it). See unlockProfile/onProfileUnlocked for what actually
// happens when it's checked.
let rememberProfile=false;
function toggleProfileRemember(){
  rememberProfile=$('profile-remember').checked;
}

function unlockProfile(){
  const name=selectedProfileName;
  const code=$('profile-code').value;
  if(!name){ $('profile-error').textContent='No profile selected.'; return; }
  wss({type:'unlock_profile',name,code,remember:rememberProfile});
}

// Clears this device's "stay logged in" state, both the token stored here
// (so ws.onopen's silent auto-login in connect() stops firing) and its
// server-side record (see 'forget_profile' in index.js) — otherwise a
// stale local token would just keep failing the silent unlock forever
// instead of actually being gone.
function forgetRememberedProfile(){
  let storedName=null;
  try{ storedName=localStorage.getItem('mj-remember-name'); }catch(e){}
  if(storedName) wss({type:'forget_profile',name:storedName});
  try{ localStorage.removeItem('mj-remember-name'); localStorage.removeItem('mj-remember-token'); }catch(e){}
}

// Called from onMsg on 'profile_unlocked' — on success, confirms #iname
// (readonly, so it can't be hand-edited back to an unverified name) and
// unblocks Find Match; on failure, shows the error inline in the picker
// rather than closing it, so the player can just retry the code.
// `m.silent` marks a response to connect()'s automatic 'unlock_profile_token'
// attempt on open (see ws.onopen below) rather than a user-driven code
// submission — so a failure here (stale/revoked token) is handled quietly
// instead of surfacing "Incorrect code" for something the player never typed,
// and a success here must NOT call toggleProfilePicker (the picker was never
// opened for it).
function onProfileUnlocked(m){
  if(m.ok){
    $('iname').value=m.name;
    $('bfind').disabled=false;
    $('user-icon-btn').style.display='';
    // Friend ID + notification state + coin balance come alive with the profile.
    myProfileId=m.id||null;
    friendIdSet=new Set();
    updateNotifBadge(m.unread||0);
    updateCoins(m.coins||0);
    // Fired on either unlock path (real code OR silent token) — the silent
    // one is the normal "opened the game today" case, so don't gate on it.
    // A top-right slide-in toast (see showCoinBonus), same as the
    // achievement-unlock notification.
    if(m.dailyBonus) showCoinBonus(m.dailyBonus);
    // Sync to the profile's own stored icon/title (server-authoritative —
    // see profiles.getIcon/getTitle), not whatever this browser last
    // cached, in case this device previously had a different profile's
    // icon/title cached.
    currentPlayerIcon=m.icon||'default';
    try{ localStorage.setItem('mj-player-icon',currentPlayerIcon); }catch(e){}
    currentPlayerTitle=m.title||'Beginner';
    try{ localStorage.setItem('mj-player-title',currentPlayerTitle); }catch(e){}
    // Voice theme is server-authoritative for a logged-in profile too now
    // (see profiles.getVoiceTheme) — sync it the same way, so it survives a
    // localStorage wipe / a different browser and can't drift from what the
    // account actually has. renderVoiceThemes repaints the picker highlight
    // (best-effort — it re-heals once the 'stats' message lands with this
    // profile's unlockedThemes).
    if(m.voiceTheme){
      currentVoiceTheme=m.voiceTheme;
      try{ localStorage.setItem('mj-voice-theme',m.voiceTheme); }catch(e){}
      renderVoiceThemes();
    }
    refreshProfileDisplay();
    if(m.token){
      // "Stay logged in" was checked — store the token in place of the
      // code so future visits can auto-unlock via ws.onopen without asking.
      try{ localStorage.setItem('mj-remember-name',m.name); localStorage.setItem('mj-remember-token',m.token); }catch(e){}
    } else if(!m.silent){
      // A real code unlock without "stay logged in" checked — if this
      // device had a token from a previous session, drop it; leaving it
      // would auto-login again next visit despite the box being unchecked.
      forgetRememberedProfile();
    }
    if(!m.silent) toggleProfilePicker();
    // Refresh stats/theme-lock state for the now-confirmed profile.
    wss({type:'get_stats'});
  } else if(m.silent){
    // Stored token no longer works (revoked, code changed since) — clear
    // it so this doesn't retry forever, and just fall back to the picker.
    try{ localStorage.removeItem('mj-remember-name'); localStorage.removeItem('mj-remember-token'); }catch(e){}
  } else {
    $('profile-error').textContent=m.error||'Incorrect code';
  }
}

// Explicit "play as Guest" pick — no code prompt, logs in immediately
// (see the Guest card in renderProfileList). Clears any profile this
// connection had unlocked server-side too (see select_guest in
// index.js), so switching to Guest after already unlocking a real
// profile actually takes effect on the next join, not just cosmetically.
function selectGuest(){
  // Explicit switch to Guest is a logout — drop any "stay logged in" token
  // this device was holding so it doesn't silently re-unlock the profile
  // on the next visit.
  forgetRememberedProfile();
  wss({type:'select_guest'});
}

function onGuestSelected(){
  $('iname').value='Guest';
  $('bfind').disabled=false;
  // No profile to manage (no stats, no persisted icon/title) — same
  // reasoning user-icon-btn stays hidden by default before any profile's
  // unlocked. Deliberately does NOT touch currentPlayerIcon/
  // currentPlayerTitle (unlike the old applyPlayerIcon('default') this
  // used to call) — refreshProfileDisplay's isGuest check shows Guest's
  // fixed icon/blank title regardless of those, and leaving them alone
  // means a real profile's cached icon in localStorage doesn't get
  // clobbered with 'default' just because Guest was picked in between.
  $('user-icon-btn').style.display='none';
  // Guest has no friend graph and no wallet — drop cached state, the unread
  // dot, and the coin display.
  myProfileId=null;
  friendIdSet=new Set();
  updateNotifBadge(0);
  myCoins=0;
  $('coin-count').style.display='none';
  refreshProfileDisplay();
  // Unlike icon/title above, the nameplate's win-tier class (see
  // updateNameplateTier) persists on the DOM element itself, not through a
  // variable refreshProfileDisplay re-reads — so switching to Guest DOES
  // need to explicitly reset it back to Bronze, or a previous real
  // profile's Silver/Gold/Platinum tier would keep showing.
  updateNameplateTier(0);
  toggleProfilePicker();
}

// Hidden entry point for Developer Settings — no link anywhere in normal
// UI; reached only by tapping the About panel's version number 10 times
// within DEV_TAP_WINDOW_MS of each other. A slow, one-tap-every-few-
// minutes sequence doesn't count (almost certainly someone idly clicking,
// not deliberately unlocking this), so the count resets whenever a tap
// lands outside that window. This only keeps the panel out of everyday
// view — every actual capability inside (create profile, etc.) is still
// independently gated server-side by DEV_SECRET, so this taps-to-reveal
// gesture isn't itself a real access control.
const DEV_TAP_TARGET=10, DEV_TAP_WINDOW_MS=1500;
let devTapCount=0, devTapLastTime=0;
function handleVersionTap(){
  const now=Date.now();
  devTapCount=(now-devTapLastTime<=DEV_TAP_WINDOW_MS)?devTapCount+1:1;
  devTapLastTime=now;
  if(devTapCount>=DEV_TAP_TARGET){
    devTapCount=0;
    toggleAbout();
    toggleDevPanel();
  }
}

// Holds the key only after this specific panel-open has verified it —
// reset to null every time toggleDevPanel opens the panel (see below), so
// it's never carried over from a previous open, let alone across a page
// reload. submitCreateProfile/confirmDeleteProfile read this rather than
// the (now gate-only, hidden-post-unlock) #dev-secret field.
let verifiedDevSecret=null;

function toggleDevPanel(){
  const modal=$('devpanel-modal');
  const backdrop=$('devpanel-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  // Always reopen at the gate — the key is required every time the panel
  // is accessed, never remembered from a previous open this session.
  verifiedDevSecret=null;
  $('dev-secret').value='';
  $('devgate-error').textContent='';
  $('devpanel-gate').style.display='';
  $('devpanel-content').style.display='none';
  cancelClearAllHistory();
  $('devclearhistory-error').textContent='';
  $('devclearhistory-error').style.color='';
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// Create/Delete Profile each get their own window (opened from the
// Developer Settings hub, which closes itself first — see the hub's
// onclick in index.html) rather than expanding inline, so each gets full
// modal space instead of being squeezed into a dropdown.
function toggleCreateProfileModal(){
  const modal=$('create-profile-modal');
  const backdrop=$('create-profile-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('devpanel-error').textContent='';
  $('devpanel-error').style.color='';
  $('dev-newname').value='';
  $('dev-newcode').value='';
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

function toggleDeleteProfileModal(){
  const modal=$('delete-profile-modal');
  const backdrop=$('delete-profile-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('devdelete-error').textContent='';
  $('devdelete-error').style.color='';
  $('dev-delete-select').innerHTML='<option>Loading…</option>';
  cancelDeleteProfile();
  wss({type:'list_profiles'});
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// "← Back" from Create/Delete Profile — returns to the Developer Settings
// hub's list, not the key gate. Deliberately does NOT go through
// toggleDevPanel (that always resets to the gate on open); #devpanel-gate/
// #devpanel-content's display state is exactly as onDevKeyResult left it
// when the key was verified, so just re-showing the modal is enough.
function backToDevPanel(){
  $('create-profile-modal').classList.remove('visible');
  $('create-profile-backdrop').classList.remove('visible');
  $('delete-profile-modal').classList.remove('visible');
  $('delete-profile-backdrop').classList.remove('visible');
  $('devpanel-modal').classList.add('visible');
  $('devpanel-backdrop').classList.add('visible');
}

function submitDevKey(){
  wss({type:'verify_dev_key',devSecret:$('dev-secret').value});
}

// Called from onMsg on 'dev_key_result'. On success, swaps the gate for
// the hub's list of settings — each setting fetches whatever it needs
// (e.g. Delete Profile's dropdown) only once actually opened, in its own
// toggle function, not here.
function onDevKeyResult(m){
  if(m.ok){
    verifiedDevSecret=$('dev-secret').value;
    $('devpanel-gate').style.display='none';
    $('devpanel-content').style.display='';
  } else {
    $('devgate-error').textContent='Incorrect developer key';
    $('dev-secret').value='';
    $('dev-secret').focus();
  }
}

function submitCreateProfile(){
  const name=$('dev-newname').value.trim();
  const code=$('dev-newcode').value;
  wss({type:'create_profile',devSecret:verifiedDevSecret,name,code});
}

function onCreateProfileResult(m){
  if(m.ok){
    $('devpanel-error').style.color='#8fffb0';
    $('devpanel-error').textContent='Profile created — it can now be selected from the picker.';
    $('dev-newname').value='';
    $('dev-newcode').value='';
    wss({type:'list_profiles'}); // refresh both dropdowns with the new name
  } else {
    $('devpanel-error').style.color='';
    $('devpanel-error').textContent=m.error||'Failed to create profile';
  }
}

// Delete Profile — a genuine second tap (confirm row), not just a bigger
// button, same reasoning as the chonbo declare-confirm popup elsewhere in
// this file: this is destructive (wipes the profile AND its stats) and
// can't be undone, so an accidental single tap must not be enough.
function armDeleteProfile(){
  $('dev-delete-btn').style.display='none';
  $('dev-delete-confirm-row').style.display='block';
}

function cancelDeleteProfile(){
  $('dev-delete-btn').style.display='';
  $('dev-delete-confirm-row').style.display='none';
}

function confirmDeleteProfile(){
  const name=$('dev-delete-select').value;
  if(!name){ $('devdelete-error').textContent='No profile selected.'; return; }
  wss({type:'delete_profile',devSecret:verifiedDevSecret,name});
}

function onDeleteProfileResult(m){
  cancelDeleteProfile();
  if(m.ok){
    $('devdelete-error').style.color='#8fffb0';
    $('devdelete-error').textContent='Profile deleted.';
    wss({type:'list_profiles'}); // refresh both dropdowns
  } else {
    $('devdelete-error').style.color='';
    $('devdelete-error').textContent=m.error||'Failed to delete profile';
  }
}

// Clear All Play History — same arm/cancel/confirm two-step as Delete
// Profile above (destructive, no undo), just with no selection step first
// since this always targets every profile at once.
function armClearAllHistory(){
  $('dev-clear-history-btn').style.display='none';
  $('dev-clear-history-confirm-row').style.display='block';
}

function cancelClearAllHistory(){
  $('dev-clear-history-btn').style.display='';
  $('dev-clear-history-confirm-row').style.display='none';
}

function confirmClearAllHistory(){
  wss({type:'clear_all_history',devSecret:verifiedDevSecret});
}

function onClearAllHistoryResult(m){
  cancelClearAllHistory();
  if(m.ok){
    $('devclearhistory-error').style.color='#8fffb0';
    $('devclearhistory-error').textContent='Every profile\'s play history has been cleared.';
  } else {
    $('devclearhistory-error').style.color='';
    $('devclearhistory-error').textContent=m.error||'Failed to clear play history';
  }
}

// ════════════════════════════════════════════════════════════
// MUSIC
// ════════════════════════════════════════════════════════════
let musicEnabled=true;
let musicVolume=0.30;

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

// Game music playlist — user picks which of these are in rotation (at
// least one always stays selected, see toggleGameTrack) and whether they
// play in list order or shuffled. Reuses the single #game-music-1 element
// across tracks (swap src, don't create one <audio> per track) so the
// existing volume/mute plumbing in allTracks()/setVolume keeps working
// untouched. A single selected track sets the element's own `loop` so it
// gaplessly repeats itself exactly like before this feature existed;
// picking 2+ tracks turns `loop` off and chains tracks via the 'ended'
// listener registered below instead.
// 'tea' is free from the start; the rest are earned via the 'safe_player_*'
// achievements' `unlocksTrack` (see server/achievements.js) and gated in
// renderGameMusicList/toggleGameTrack below by unlockedTracks — same
// locked/hint treatment voiceThemes gets from unlockedThemes.
const gameTracks=[
  {id:'tea', label:'Table Tea', src:'/audio/Music/Mahjong_Table_Tea.mp3'},
  {id:'elegy', label:'Ceremony Elegy', src:'/audio/Music/Mahjong_Ceremony_Elegy.mp3', hint:'Go 5 hands in a row without dealing in to unlock'},
  {id:'city_lights', label:'City Lights', src:'/audio/Music/Mahjong_City_Lights.mp3', hint:'Go 10 hands in a row without dealing in to unlock'},
  {id:'groovy_tea', label:'Groovy Tea', src:'/audio/Music/Mahjong_Groovy_Tea.mp3', hint:'Go 20 hands in a row without dealing in to unlock'},
];
let unlockedTracks=['tea'];
let selectedGameTracks=['tea'];
let gameMusicShuffle=false;
let gameMusicQueue=[];
let gameMusicQueueIdx=0;

function saveGameTrackPrefs(){
  try{
    localStorage.setItem('mj-game-tracks',JSON.stringify(selectedGameTracks));
    localStorage.setItem('mj-game-shuffle',gameMusicShuffle?'1':'0');
  }catch(e){}
}

function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function buildGameMusicQueue(){
  // Re-filters against unlockedTracks every time (not just when a track is
  // toggled) — a saved selection can outlive its unlock, e.g. 'elegy' was
  // freely selectable before this locking system existed, so an existing
  // localStorage selection could still name a track this profile hasn't
  // actually earned. Falls back to the always-free 'tea' if that empties
  // the list out entirely.
  const unlocked=selectedGameTracks.filter(id=>unlockedTracks.includes(id));
  const chosen=unlocked.length?unlocked:[gameTracks[0].id];
  gameMusicQueue=gameMusicShuffle?shuffleArray(chosen):[...chosen];
  gameMusicQueueIdx=0;
}

function currentGameTrack(){
  return gameTracks.find(t=>t.id===gameMusicQueue[gameMusicQueueIdx])||gameTracks[0];
}

// Only reached when loop is off, i.e. 2+ tracks are selected — wraps back
// to the start of the queue (reshuffling if shuffle is on) once the last
// track in it finishes.
function advanceGameMusic(){
  gameMusicQueueIdx++;
  if(gameMusicQueueIdx>=gameMusicQueue.length) buildGameMusicQueue();
  const t1=$('game-music-1');
  if(!t1) return;
  t1.src=currentGameTrack().src;
  t1.currentTime=0;
  if(musicEnabled) t1.play().catch(()=>{});
}

function toggleGameMusicShuffle(){
  gameMusicShuffle=!gameMusicShuffle;
  const btn=$('bgame-music-shuffle');
  if(btn) btn.classList.toggle('off',!gameMusicShuffle);
  saveGameTrackPrefs();
}

function toggleGameTrack(id){
  if(!unlockedTracks.includes(id)) return; // locked — no achievement earned yet
  const idx=selectedGameTracks.indexOf(id);
  if(idx>=0){
    if(selectedGameTracks.length===1) return; // at least one track must stay selected
    selectedGameTracks.splice(idx,1);
  } else {
    selectedGameTracks.push(id);
  }
  renderGameMusicList();
  saveGameTrackPrefs();
}

function renderGameMusicList(){
  const list=$('game-music-list'); if(!list) return;
  list.innerHTML='';
  gameTracks.forEach(t=>{
    const locked=!unlockedTracks.includes(t.id);
    const btn=document.createElement('button');
    // Same locked/hint treatment as renderVoiceThemes — dimmed via .locked,
    // no lock icon, disabled + hint as the tooltip instead of a click handler.
    btn.className=locked?'theme-btn locked':(selectedGameTracks.includes(t.id)?'theme-btn selected':'theme-btn');
    btn.textContent=t.label;
    if(locked){ btn.disabled=true; btn.title=t.hint||'Locked'; }
    else btn.onclick=()=>toggleGameTrack(t.id);
    list.appendChild(btn);
  });
}

function toggleGameMusicModal(){
  const modal=$('gamemusic-modal');
  const backdrop=$('gamemusic-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  renderGameMusicList();
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

function playGameMusic(){
  if(!musicEnabled) return;
  const t1=$('game-music-1');
  if(!t1) return;
  buildGameMusicQueue();
  t1.pause();
  t1.loop=gameMusicQueue.length<=1;
  t1.src=currentGameTrack().src;
  t1.currentTime=0;
  t1.volume=musicVolume;
  t1.play().catch(()=>{});
}
$('game-music-1')?.addEventListener('ended',advanceGameMusic);

function stopGameMusic(){
  const t1=$('game-music-1');
  if(t1){ t1.pause(); t1.currentTime=0; }
}

// Voice theme system — themes other than Default are gated by unlockedThemes
// (see the 'stats' handler in onMsg), which mirrors server/achievements.js's
// ACHIEVEMENTS list. `hint` is shown for a theme the player hasn't unlocked
// yet; keep it in sync with that achievement's `label`.
const voiceThemes=[
  {id:'Default', label:'Default'},
  {id:'Natsu', label:'Natsu', hint:'Win your first game to unlock'},
];
let currentVoiceTheme='Default';

const fxFiles=['Pon','Chii','Kan','Riichi','Double_riichi','Ron','Tsumo','Kita'];
const fxExts={Pon:'mp3',Chii:'mp3',Kan:'mp3',Riichi:'mp3',Double_riichi:'mp3',Ron:'mp3',Tsumo:'mp3',Kita:'mp3'};

// persist=true (a real user pick) writes the choice to localStorage AND
// the profile server-side; persist=false (re-applying during renderVoiceThemes,
// which happens on every 'stats' refresh) only repaints the highlight, so a
// bare re-render can never overwrite the saved selection with a transient
// value (e.g. 'Default' before the real one has been restored).
function applyVoiceTheme(themeId,persist=true){
  if(themeId!=='Default'&&!unlockedThemes.includes(themeId)) return;
  currentVoiceTheme=themeId;
  // Scoped to #voice-theme-list (not a bare '.theme-btn') — the Title
  // picker's buttons (see renderTitles below) reuse the same .theme-btn
  // class for its visual style, and a bare query here would repaint those
  // too (they have no dataset.theme, so it'd always match the "inactive"
  // branch and stomp whatever applyPlayerTitle had just set).
  document.querySelectorAll('#voice-theme-list .theme-btn').forEach(b=>{
    b.style.background=b.dataset.theme===themeId?'rgba(201,168,76,.25)':'rgba(42,58,42,.3)';
    b.style.borderColor=b.dataset.theme===themeId?'var(--gold)':'rgba(201,168,76,.2)';
  });
  if(!persist) return;
  try{ localStorage.setItem('mj-voice-theme',themeId); }catch(e){}
  // Persist onto the profile itself (server-side, see profiles.setVoiceTheme,
  // re-checked there against this profile's own unlockedThemes) so the choice
  // follows the account across devices — a no-op server-side if no profile is
  // unlocked yet. Mirrors applyPlayerTitle's set_profile_title send.
  wss({type:'set_profile_voice_theme',theme:themeId});
}

function renderVoiceThemes(){
  const list=$('voice-theme-list'); if(!list) return;
  list.innerHTML='';
  voiceThemes.forEach(t=>{
    const locked=t.id!=='Default'&&!unlockedThemes.includes(t.id);
    const btn=document.createElement('button');
    // Dimmed via .locked (opacity, see style.css) rather than a 🔒 prefix
    // — same "gray it out, no lock icon" language the Achievements panel
    // uses, just applied here too now.
    btn.className=locked?'theme-btn locked':'theme-btn';
    btn.dataset.theme=t.id;
    btn.textContent=t.label;
    if(locked){ btn.disabled=true; btn.title=t.hint||'Locked'; }
    else btn.onclick=()=>applyVoiceTheme(t.id);
    list.appendChild(btn);
  });
  applyVoiceTheme(currentVoiceTheme,false);
}

// Title system — same shape as voice themes above (pick one from a list,
// gated by unlockedTitles the same way voice themes are gated by
// unlockedThemes — see the 'stats' handler in onMsg), earned via the
// achievements in server/achievements.js (`unlocksTitle`). `hint` mirrors
// that achievement's `label`, same convention voiceThemes' hints follow.
// server/profiles.js's TITLES is the final gate on what a title can
// actually be set to; this array is just what the picker offers.
const titles=[
  {id:'Beginner', label:'Beginner'},
  {id:'Regular', label:'Regular', hint:'Play 10 games to unlock'},
  {id:'Veteran', label:'Veteran', hint:'Play 100 games to unlock'},
  {id:'Century Club', label:'Century Club', hint:'Win 100 games to unlock'},
  {id:'Ace', label:'Ace', hint:'Win 50%+ of at least 20 games to unlock'},
  {id:'Yakuman Hunter', label:'Yakuman Hunter', hint:'Achieve a yakuman to unlock'},
  {id:'Riichi Machine', label:'Riichi Machine', hint:'Declare riichi 50 times to unlock'},
  {id:'Renaissance Player', label:'Renaissance Player', hint:'Achieve 10 different yaku to unlock'},
  {id:'Big Hand', label:'Big Hand', hint:'Win a hand worth 8+ han to unlock'},
  {id:'High Roller', label:'High Roller', hint:'Reach a final score of 50,000+ to unlock'},
  {id:'Safe Player', label:'Safe Player', hint:'Go 5 hands in a row without dealing in to unlock'},
  {id:'Disciplined Safe Player', label:'Disciplined Safe Player', hint:'Go 10 hands in a row without dealing in to unlock'},
  {id:'Elite Safe Player', label:'Elite Safe Player', hint:'Go 20 hands in a row without dealing in to unlock'},
  {id:'Legendary Safe Player', label:'Legendary Safe Player', hint:'Go 30 hands in a row without dealing in to unlock'},
  {id:'Sanma Specialist', label:'Sanma Specialist', hint:'Win your first sanma game to unlock'},
  {id:'Tsumo Specialist', label:'Tsumo Specialist', hint:'Win 30 hands by tsumo to unlock'},
  {id:'Ron Specialist', label:'Ron Specialist', hint:'Win 30 hands by ron to unlock'},
  {id:'Hand Collector', label:'Hand Collector', hint:'Win 100 hands to unlock'},
  {id:'Podium Regular', label:'Podium Regular', hint:'Finish 1st, 2nd, or 3rd 20 times to unlock'},
  {id:'Lightning Reflexes', label:'Lightning Reflexes', hint:'Achieve Ippatsu to unlock'},
  {id:'Quick Draw', label:'Quick Draw', hint:'Achieve Double Riichi to unlock'},
  {id:'All Triplets', label:'All Triplets', hint:'Achieve Toitoi to unlock'},
  {id:'Pure Runner', label:'Pure Runner', hint:'Achieve Ittsu to unlock'},
  {id:'Dora Rich', label:'Dora Rich', hint:'Win 30 hands with dora to unlock'},
  {id:'The Diamond', label:'The Diamond', hint:'Win 200 games to unlock'},
  {id:'Hoarder', label:'Hoarder', hint:'Reach a final score of 100,000+ in yonma to unlock'},
  {id:'Overlord', label:'Overlord', hint:'Reach a final score of 105,000+ in yonma to unlock'},
  {id:'Plunderer', label:'Plunderer', hint:'Reach a final score of 100,000+ in sanma to unlock'},
  {id:'Conqueror', label:'Conqueror', hint:'Reach a final score of 105,000+ in sanma to unlock'},
  {id:'Double Knockout', label:'Double Knockout', hint:'Win a tsumo that bankrupts both opponents (sanma) to unlock'},
  {id:'The South Pole', label:'The South Pole', hint:"Bank all 4 of a round's kita tiles yourself (sanma) to unlock"},
  {id:'Legend', label:'Legend', hint:'Play 500 games to unlock'},
  {id:'Living Legend', label:'Living Legend', hint:'Win 500 games to unlock'},
  {id:'Riichi Addict', label:'Riichi Addict', hint:'Declare riichi 200 times to unlock'},
  {id:'Hand Hoarder', label:'Hand Hoarder', hint:'Win 300 hands to unlock'},
  {id:'Tsumo Master', label:'Tsumo Master', hint:'Win 100 hands by tsumo to unlock'},
  {id:'Ron Master', label:'Ron Master', hint:'Win 100 hands by ron to unlock'},
  {id:'Dora Addict', label:'Dora Addict', hint:'Win 100 hands with dora to unlock'},
  {id:'Yakuman Collector', label:'Yakuman Collector', hint:'Achieve 3 yakuman-tier hands (any combination) to unlock'},
  {id:'Yakuman Legend', label:'Yakuman Legend', hint:'Achieve 10 yakuman-tier hands (any combination) to unlock'},
  {id:'Twin Fortune', label:'Twin Fortune', hint:'Achieve 2 different yakuman in the same hand to unlock'},
  {id:'Double Crown', label:'Double Crown', hint:'Achieve a double yakuman (any kind) to unlock'},
  {id:'Twin Ascendant', label:'Twin Ascendant', hint:'Achieve 2 different kinds of double yakuman to unlock'},
  {id:'Grand Ascendant', label:'Grand Ascendant', hint:'Achieve all 4 kinds of double yakuman to unlock'},
  {id:'The Last Emperor', label:'The Last Emperor', hint:'Win 70%+ of at least 100 games to unlock'},
  {id:'Mighty Mouse', label:'Mighty Mouse', hint:'Achieve 30 different yaku to unlock'},
  {id:'The Eagle', label:'The Eagle', hint:'Win 29 games in a row to unlock'},
  {id:'Master of Forms', label:'Master of Forms', hint:'Achieve 20 different yaku to unlock'},
  {id:'Robbing Kan', label:'Robbing Kan', hint:'Win with Chankan to unlock'},
  {id:'Dead Wall Diver', label:'Dead Wall Diver', hint:'Win with Rinshan Kaihou to unlock'},
  {id:'Last Tile Standing', label:'Last Tile Standing', hint:'Win with Haitei to unlock'},
  {id:"River's End", label:"River's End", hint:'Win with Houtei to unlock'},
  {id:'Instant Riichi', label:'Instant Riichi', hint:'Win with Double Riichi to unlock'},
  {id:'Triple Threat', label:'Triple Threat', hint:'Win with San Ankou to unlock'},
  {id:'Triple Triplet', label:'Triple Triplet', hint:'Win with Sanshoku Doukou to unlock'},
  {id:'Rainbow Run', label:'Rainbow Run', hint:'Win with Sanshoku Doujun to unlock'},
  {id:'Terminal Case', label:'Terminal Case', hint:'Win with Honroutou to unlock'},
  {id:'Straight Shooter', label:'Straight Shooter', hint:'Win with Ittsu to unlock'},
  {id:'Edge Player', label:'Edge Player', hint:'Win with Chanta to unlock'},
  {id:'Dragon Tamer', label:'Dragon Tamer', hint:'Win with Shousangen to unlock'},
  {id:'Kan Collector', label:'Kan Collector', hint:'Win with San Kantsu to unlock'},
  {id:'Mono Color', label:'Mono Color', hint:'Win with Honitsu to unlock'},
  {id:'Pure Edge', label:'Pure Edge', hint:'Win with Junchan to unlock'},
  {id:'Double Twin', label:'Double Twin', hint:'Win with Ryanpeiko to unlock'},
  {id:'Clean Sweep', label:'Clean Sweep', hint:'Win with Nagashi Mangan to unlock'},
  {id:'One Suit Wonder', label:'One Suit Wonder', hint:'Win with Chinitsu to unlock'},
  {id:"Heaven's Chosen", label:"Heaven's Chosen", hint:'Achieve Tenhou to unlock'},
  {id:"Earth's Chosen", label:"Earth's Chosen", hint:'Achieve Chiihou to unlock'},
  {id:'Orphan Collector', label:'Orphan Collector', hint:'Achieve Kokushi Musou to unlock'},
  {id:'Thirteen-Sided Master', label:'Thirteen-Sided Master', hint:'Achieve Kokushi Juusanmen to unlock'},
  {id:'Iron Wall', label:'Iron Wall', hint:'Achieve Suu Ankou to unlock'},
  {id:"Needle's Eye", label:"Needle's Eye", hint:'Achieve Suu Ankou Tanki to unlock'},
  {id:'Dragon Lord', label:'Dragon Lord', hint:'Achieve Daisangen to unlock'},
  {id:'Wind Whisperer', label:'Wind Whisperer', hint:'Achieve Shousuushii to unlock'},
  {id:'Wind Sovereign', label:'Wind Sovereign', hint:'Achieve Daisuushii to unlock'},
  {id:'Honor Bound', label:'Honor Bound', hint:'Achieve Tsuuiisou to unlock'},
  {id:'Terminal Master', label:'Terminal Master', hint:'Achieve Chinroutou to unlock'},
  {id:'Emerald Hand', label:'Emerald Hand', hint:'Achieve Ryuuiisou to unlock'},
  {id:'Nine Gates', label:'Nine Gates', hint:'Achieve Chuuren Poutou to unlock'},
  {id:'True Nine Gates', label:'True Nine Gates', hint:'Achieve Junsei Chuuren to unlock'},
  {id:'Kan Emperor', label:'Kan Emperor', hint:'Achieve Suu Kantsu to unlock'},
  {id:'Counted Divinity', label:'Counted Divinity', hint:'Achieve Kazoe Yakuman to unlock'},
];
let currentPlayerTitle='Beginner';
let unlockedTitles=['Beginner'];

function applyPlayerTitle(titleId){
  if(titleId!=='Beginner'&&!unlockedTitles.includes(titleId)) return;
  currentPlayerTitle=titleId;
  // Scoped to #title-list — same cross-contamination reasoning as
  // applyVoiceTheme's #voice-theme-list scoping above.
  document.querySelectorAll('#title-list .theme-btn').forEach(b=>{
    b.style.background=b.dataset.title===titleId?'rgba(201,168,76,.25)':'rgba(42,58,42,.3)';
    b.style.borderColor=b.dataset.title===titleId?'var(--gold)':'rgba(201,168,76,.2)';
  });
  try{ localStorage.setItem('mj-player-title',titleId); }catch(e){}
  // Persists onto the profile itself (server-side, see profiles.setTitle,
  // re-checked there against this profile's own unlockedTitles) — a no-op
  // server-side if no profile's unlocked yet (e.g. this fires at page load
  // too, restoring the cached selection), same reasoning as
  // applyPlayerIcon's set_profile_icon send.
  wss({type:'set_profile_title',title:titleId});
  refreshProfileDisplay();
}

// Only ever lists titles this profile actually owns — not-yet-earned ones
// aren't shown at all (unlike Voice Theme's locked-with-🔒 treatment, or
// the Achievements panel's dimmed-but-visible rows). Where to go see what
// ELSE is earnable is the Achievements panel now, so this list can just
// stay a clean "pick one of what you have."
function renderTitles(){
  const list=$('title-list'); if(!list) return;
  list.innerHTML='';
  titles.filter(t=>t.id==='Beginner'||unlockedTitles.includes(t.id)).forEach(t=>{
    const btn=document.createElement('button');
    btn.className='theme-btn';
    btn.dataset.title=t.id;
    btn.textContent=t.label;
    btn.onclick=()=>applyPlayerTitle(t.id);
    list.appendChild(btn);
  });
  applyPlayerTitle(currentPlayerTitle);
}

// Player icon system — same shape as voice themes (pick one, persisted to
// localStorage, sent on join), but each option is a small hand-coded SVG
// mark instead of an audio folder: the app has no image-upload capability,
// so these are drawn directly rather than being uploaded/illustrated art.
// None are unlock-gated (unlike voice themes) — free personalization.
const playerIcons=[
  {id:'default', label:'Janshin', svg:'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="36" height="36" rx="6" fill="#0a160c" stroke="var(--gold)" stroke-width="0.5"/><text x="20" y="20" dominant-baseline="central" font-size="18" text-anchor="middle" fill="var(--gold)" font-family="\'Noto Serif JP\',serif">心</text></svg>'},
  {id:'man', label:'Character', svg:'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="36" height="36" rx="6" fill="#0a160c" stroke="var(--gold)" stroke-width="0.5"/><text x="20" y="20" dominant-baseline="central" font-size="18" text-anchor="middle" fill="#e04040" font-family="\'Noto Serif JP\',serif">萬</text></svg>'},
  {id:'pin', label:'Circle', svg:'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="36" height="36" rx="6" fill="#0a160c" stroke="var(--gold)" stroke-width="0.5"/><circle cx="20" cy="20" r="3.5" fill="#3aa0d0"/><circle cx="13" cy="13" r="3" fill="#3aa0d0"/><circle cx="27" cy="13" r="3" fill="#3aa0d0"/><circle cx="13" cy="27" r="3" fill="#3aa0d0"/><circle cx="27" cy="27" r="3" fill="#3aa0d0"/></svg>'},
  {id:'sou', label:'Bamboo', svg:'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="36" height="36" rx="6" fill="#0a160c" stroke="var(--gold)" stroke-width="0.5"/><rect x="17" y="8" width="6" height="24" rx="2" fill="#4caf60"/><line x1="17" y1="14" x2="23" y2="14" stroke="#0a160c" stroke-width="1.5"/><line x1="17" y1="20" x2="23" y2="20" stroke="#0a160c" stroke-width="1.5"/><line x1="17" y1="26" x2="23" y2="26" stroke="#0a160c" stroke-width="1.5"/></svg>'},
  {id:'chun', label:'Red Dragon', svg:'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="36" height="36" rx="6" fill="#0a160c" stroke="var(--gold)" stroke-width="0.5"/><text x="20" y="20" dominant-baseline="central" font-size="18" text-anchor="middle" fill="#e04040" font-family="\'Noto Serif JP\',serif">中</text></svg>'},
  {id:'hatsu', label:'Green Dragon', svg:'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="36" height="36" rx="6" fill="#0a160c" stroke="var(--gold)" stroke-width="0.5"/><text x="20" y="20" dominant-baseline="central" font-size="18" text-anchor="middle" fill="#4caf60" font-family="\'Noto Serif JP\',serif">發</text></svg>'},
];
let currentPlayerIcon='default';

// Guest's own fixed icon — deliberately NOT in playerIcons above: Guest has
// no profile to persist a choice onto, so it isn't offered in the Player
// Icon picker at all (see the isGuest branch in refreshProfileDisplay,
// which uses this directly instead of going through iconSvg/
// currentPlayerIcon). Same visual language as the other icons (gold-framed
// square, centered glyph) just with a plain "G" instead of a mahjong mark.
// x=17.2 (not 20) + dominant-baseline="central": text-anchor="middle" only
// centers by advance width, and Cinzel Decorative's "G" has asymmetric
// side-bearings — at x=20 the glyph's actual ink sits ~2.8 units right of
// center (measured via getBBox). The CJK glyphs above don't need this
// nudge, their ink is already centered within their advance width; "G" is
// the one letter icon where advance-width centering and visual centering
// diverge. dominant-baseline="central" (replacing the old eyeballed y="27")
// fixes vertical centering for both the CJK glyphs and "G" in one go,
// regardless of each font's baseline metrics.
const guestIconSvg='<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="36" height="36" rx="6" fill="#0a160c" stroke="var(--gold)" stroke-width="0.5"/><text x="17.2" y="20" dominant-baseline="central" font-size="18" text-anchor="middle" fill="var(--gold)" font-family="\'Cinzel Decorative\',serif">G</text></svg>';

// Looks up any icon's SVG by id (falls back to Default for an unknown/
// missing id) — used for the player's own icon grid, the picker's profile
// cards, and the user-icon-btn mirror, so all three ever only need this.
function iconSvg(iconId){
  return (playerIcons.find(i=>i.id===iconId)||playerIcons[0]).svg;
}

function applyPlayerIcon(iconId){
  currentPlayerIcon=iconId;
  document.querySelectorAll('.icon-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.icon===iconId);
  });
  try{ localStorage.setItem('mj-player-icon',iconId); }catch(e){}
  // Persists onto the profile itself (server-side, see profiles.setIcon)
  // so the picker's cards show it correctly even before anyone unlocks
  // this profile again — a no-op server-side if no profile's unlocked yet
  // (e.g. this fires at page load too, restoring the cached selection).
  wss({type:'set_profile_icon',icon:iconId});
  refreshProfileDisplay();
}

// Mirrors the chosen icon/name/title onto the lobby's user-icon-btn (next
// to the settings icon), the profile nameplate (icon+name+title, #iname's
// actual value), and the User Profile hub's own header (#up-icon/#up-name/
// #up-title, same pairing — see .up-nameplate in index.html) — every place
// that always needs to agree with currentPlayerIcon/currentPlayerTitle/
// #iname.value, so anywhere any of those changes just calls this instead
// of touching each display separately. user-icon-btn stays hidden until a
// profile's unlocked (see onProfileUnlocked) regardless of icon content;
// the nameplates are always visible (Guest by default), so they're updated
// unconditionally.
//
// Guest is special-cased here rather than through currentPlayerIcon/
// currentPlayerTitle: Guest always shows its own fixed icon (guestIconSvg)
// and no title at all, regardless of whatever a previously-unlocked real
// profile on this connection had picked — those two variables are left
// untouched when switching to Guest (see onGuestSelected) specifically so
// this check is the only thing that needs to get it right, rather than
// relying on every guest-switch path remembering to reset them.
function refreshProfileDisplay(){
  const isGuest=$('iname').value==='Guest';
  const iconHtml=isGuest?guestIconSvg:iconSvg(currentPlayerIcon);
  const titleText=isGuest?'':currentPlayerTitle;
  const btn=$('user-icon-btn'); if(btn) btn.innerHTML=iconHtml;
  const pnpIcon=$('pnp-icon'); if(pnpIcon) pnpIcon.innerHTML=iconHtml;
  const pnpName=$('pnp-name'); if(pnpName) pnpName.textContent=$('iname').value||'Guest';
  const pnpTitle=$('pnp-title'); if(pnpTitle) pnpTitle.textContent=titleText;
  const upIcon=$('up-icon'); if(upIcon) upIcon.innerHTML=iconHtml;
  const upName=$('up-name'); if(upName) upName.textContent=$('iname').value||'Guest';
  const upTitle=$('up-title'); if(upTitle) upTitle.textContent=titleText;
}

// Nameplate tier thresholds (see .tier-* in style.css) — Bronze (default,
// no class) under 10 combined wins, Silver at 10, Gold at 50, Platinum at
// 100, Diamond at 200. Shared by updateNameplateTier (the User Profile
// hub's own nameplate) and renderPlayerCard (another player's nameplate in
// the Rankings player-card modal) so the two never drift out of sync.
function nameplateTierClass(wins){
  if(wins>=200) return 'tier-diamond';
  if(wins>=100) return 'tier-platinum';
  if(wins>=50) return 'tier-gold';
  if(wins>=10) return 'tier-silver';
  return null;
}

// User Profile hub nameplate's tier. Driven by the 'stats' handler in
// onMsg (combined yonma+sanma gamesWon) whenever a real profile's stats
// load. Unlike icon/title, this class lives on the DOM element itself
// rather than a JS variable refreshProfileDisplay re-reads every time, so
// switching to Guest (see onGuestSelected) has to call this explicitly
// with 0 — otherwise a previous real profile's tier would keep showing.
// Scoped to #userprofile-modal specifically (not just '.up-nameplate')
// since the Rankings player-card modal's nameplate (see renderPlayerCard)
// reuses that exact class and sits EARLIER in index.html's DOM order —
// once a player card has ever been opened, an unscoped querySelector
// would silently start finding that leftover element instead of this
// profile's own one.
function updateNameplateTier(wins){
  const el=document.querySelector('#userprofile-modal .up-nameplate'); if(!el) return;
  el.classList.remove('tier-silver','tier-gold','tier-platinum','tier-diamond');
  const cls=nameplateTierClass(wins);
  if(cls) el.classList.add(cls);
}

function renderPlayerIcons(){
  const list=$('player-icon-list'); if(!list) return;
  list.innerHTML='';
  playerIcons.forEach(ic=>{
    const btn=document.createElement('button');
    btn.className='icon-btn';
    btn.dataset.icon=ic.id;
    btn.title=ic.label;
    btn.innerHTML=ic.svg;
    btn.onclick=()=>applyPlayerIcon(ic.id);
    list.appendChild(btn);
  });
  applyPlayerIcon(currentPlayerIcon);
}

let fxEnabled=true;
let fxVolume=1.4; // default 35% display = 1.4 gain (x4 mapping)
let discardSfxEnabled=true;
let discardSfxVolume=0.7; // default 35% display = 0.7 gain (x2 mapping)
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
  return ['sfx-pon','sfx-chii','sfx-kan','sfx-riichi','sfx-double-riichi','sfx-ron','sfx-tsumo','sfx-kita'].map(id=>$(id)).filter(Boolean);
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
  const path=`/audio/Voice/${theme}/${capName}.${ext}`;
  // Reassigning .src (even to the same URL) re-triggers the browser's media
  // load algorithm and resets readyState, delaying playback start — skip it
  // when this element is already pointed at the right file.
  if(!el.src.endsWith(path)) el.src=path;
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

// Winner's victory line on the game-over/bankruptcy panel (see onGameOver)
// — Natsu-exclusive: Default has no equivalent lines at all (see
// public/audio/Voice/Natsu/*.mp3 vs Default's smaller call-only set), so
// this only ever plays when the WINNING seat has Natsu selected. The actual
// line is picked ONCE server-side (see _finishGame in room.js) and sent as
// m.winSfxLine, not rolled independently here — every client rolling its
// own Math.random() meant different players heard different lines for the
// exact same win. natsuWinLines here is now just a whitelist, guarding
// against ever pointing <audio> at an arbitrary/malformed src. Shares
// fxGainNode/fxEnabled with playSfx (same "Voice" mute/volume control)
// since this is a voice line too, just not a call.
const natsuWinLines=['Yavai','Otoko','Suberu','Hantei'];
function playWinSfx(lineName){
  if(!natsuWinLines.includes(lineName)) return;
  if(!fxEnabled) return;
  const el=$('sfx-win'); if(!el) return;
  el.src=`/audio/Voice/Natsu/${lineName}.mp3`;
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

// Yakuman/double-yakuman reveal — a synthesized "epic moment" sting (Web
// Audio, no bundled file, same reasoning as playNameplateSfx's sword
// sound). Parameterised by a preset (see YAKUMAN_SOUNDS) so each specific
// yakuman can have its own timbre; called with no arg it plays 'classic'
// (a low gong hit landing first, then a bright ascending sparkle arpeggio),
// exactly the old shared sting. Shares the discard click's own FX gain
// stage, same as playNameplateSfx — this is a sound effect, not a voice.
//
// A preset is {gong:[from,to,dur,gain,type], arp:[[freqs],type,step,gain]}
// plus optional flags: drone (detuned sub-oscillator bed), noise:'sweep'|
// 'crack' (filtered white-noise gust/crackle), metallic (square overtone
// on each arp note), shimmer (high sine tail), swell (softer arp attack).
const YAKUMAN_SOUNDS={
  classic  :{gong:[180,70,1.2,.60,'sine'    ],arp:[[523.25,659.25,783.99,1046.5],'triangle',.09,.28]},
  imperial :{gong:[240,90,1.0,.55,'sine'    ],arp:[[523.25,622.25,783.99,932.33,1244.51],'triangle',.08,.26],shimmer:true},
  ominous  :{gong:[110,41,1.8,.70,'sawtooth'],arp:[[196,185,138.59,130.81],'sine',.13,.30],drone:true},
  thunder  :{gong:[ 90,45,1.6,.80,'sine'    ],arp:[[392,523.25,659.25],'square',.06,.20],noise:'crack'},
  airy     :{gong:[420,260,.8,.40,'sine'    ],arp:[[659.25,783.99,987.77,1174.66,1567.98],'sine',.07,.22],noise:'sweep',shimmer:true},
  frostbell:{gong:[600,400,.7,.45,'triangle'],arp:[[1046.5,1318.5,1567.98,2093],'sine',.10,.24],shimmer:true},
  earthdrum:{gong:[ 70,38,1.9,.85,'sine'    ],arp:[[98,110,73.42,65.41],'sine',.16,.32]},
  zen      :{gong:[262,196,1.3,.40,'triangle'],arp:[[587.33,659.25,783.99,880,1174.66],'triangle',.12,.26]},
  celestial:{gong:[330,220,1.0,.40,'sine'   ],arp:[[523.25,587.33,659.25,783.99,880,1046.5,1174.66,1318.5],'sine',.05,.20],shimmer:true},
  forge    :{gong:[160,120,.5,.50,'square'  ],arp:[[880,880,880,880],'square',.14,.30],metallic:true},
  divine   :{gong:[392,392,1.4,.50,'sine'   ],arp:[[392,523.25,659.25,783.99,1046.5],'sine',.09,.26],shimmer:true,swell:true},
};
function playYakumanSfx(preset){
  if(!discardSfxEnabled) return;
  const s=(typeof preset==='string'?YAKUMAN_SOUNDS[preset]:preset)||YAKUMAN_SOUNDS.classic;
  try{
    const ctx=getFxAudioCtx().ctx;
    const out=getDiscardGainNode();
    if(ctx.state==='suspended') ctx.resume();
    const now=ctx.currentTime;

    const [gf,gt,gd,gg,gtype]=s.gong;
    const gong=ctx.createOscillator();
    gong.type=gtype||'sine';
    gong.frequency.setValueAtTime(gf,now);
    gong.frequency.exponentialRampToValueAtTime(Math.max(20,gt),now+gd);
    const gongEnv=ctx.createGain();
    gongEnv.gain.setValueAtTime(0,now);
    gongEnv.gain.linearRampToValueAtTime(gg,now+0.02);
    gongEnv.gain.exponentialRampToValueAtTime(0.0001,now+gd+0.4);
    gong.connect(gongEnv);gongEnv.connect(out);
    gong.start(now);gong.stop(now+gd+0.5);

    if(s.drone){
      const d=ctx.createOscillator();d.type='sawtooth';
      d.frequency.setValueAtTime(gf/2,now);
      const de=ctx.createGain();
      de.gain.setValueAtTime(0,now);
      de.gain.linearRampToValueAtTime(0.12,now+0.1);
      de.gain.exponentialRampToValueAtTime(0.0001,now+2.0);
      d.connect(de);de.connect(out);d.start(now);d.stop(now+2.1);
    }

    if(s.noise){
      const dur=s.noise==='crack'?0.5:1.1;
      const buf=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*dur),ctx.sampleRate);
      const dat=buf.getChannelData(0);
      for(let i=0;i<dat.length;i++) dat[i]=(Math.random()*2-1)*(1-i/dat.length);
      const src=ctx.createBufferSource();src.buffer=buf;
      const bp=ctx.createBiquadFilter();bp.type='bandpass';
      if(s.noise==='sweep'){
        bp.frequency.setValueAtTime(400,now);
        bp.frequency.exponentialRampToValueAtTime(6000,now+dur);bp.Q.value=0.7;
      }else{
        bp.frequency.setValueAtTime(3000,now);
        bp.frequency.exponentialRampToValueAtTime(200,now+dur);bp.Q.value=1.2;
      }
      const ne=ctx.createGain();
      ne.gain.setValueAtTime(s.noise==='crack'?0.5:0.25,now);
      ne.gain.exponentialRampToValueAtTime(0.0001,now+dur);
      src.connect(bp);bp.connect(ne);ne.connect(out);
      src.start(now);src.stop(now+dur);
    }

    const [notes,atype,step,again]=s.arp;
    const base=now+(s.swell?0.25:0.15);
    notes.forEach((freq,i)=>{
      const t=base+i*step;
      const osc=ctx.createOscillator();
      osc.type=atype||'triangle';
      osc.frequency.setValueAtTime(freq,t);
      const env=ctx.createGain();
      env.gain.setValueAtTime(0,t);
      env.gain.linearRampToValueAtTime(again,t+(s.swell?0.08:0.01));
      env.gain.exponentialRampToValueAtTime(0.0001,t+(s.metallic?0.6:0.4));
      osc.connect(env);env.connect(out);
      osc.start(t);osc.stop(t+0.65);
      if(s.metallic){
        const hi=ctx.createOscillator();hi.type='square';
        hi.frequency.setValueAtTime(freq*2.01,t);
        const he=ctx.createGain();
        he.gain.setValueAtTime(again*0.3,t);
        he.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
        hi.connect(he);he.connect(out);hi.start(t);hi.stop(t+0.55);
      }
    });

    if(s.shimmer){
      const top=notes[notes.length-1]*2;
      const t0=base+notes.length*step;
      [top,top*1.5,top*2].forEach((f,i)=>{
        const t=t0+i*0.04;
        const o=ctx.createOscillator();o.type='sine';
        o.frequency.setValueAtTime(f,t);
        const e=ctx.createGain();
        e.gain.setValueAtTime(0,t);
        e.gain.linearRampToValueAtTime(0.06,t+0.05);
        e.gain.exponentialRampToValueAtTime(0.0001,t+1.2);
        o.connect(e);e.connect(out);o.start(t);o.stop(t+1.3);
      });
    }
  }catch(e){}
}

// Per-yakuman visual+audio identity, keyed by the exact yaku `name` from
// detectYaku (server/mahjong.js). Each theme sets the flash's palette
// (--ym-* custom props on #yakuman-layer), the falling/rising/radiating
// particle motif (shape + motion + tint list, see spawnYakumanMotif), the
// headline kanji/romaji, and a YAKUMAN_SOUNDS preset. Anything not listed
// here (e.g. Kazoe Yakuman, or a future yakuman) falls back to `_default`,
// which reproduces the original gold flash + 'classic' sting exactly.
//   glow/glow2/accent are "r,g,b" triples (consumed inside rgba(...)).
//   double:true marks a theme as the one to prefer when the win is a
//     double yakuman and several yaku names are in play.
//   soundDouble overrides `sound` when isDouble (optional).
const YAKUMAN_THEMES={
  _default:{jp:'役満',romaji:'YAKUMAN',ink:'var(--gl,#ffe9a8)',
    glow:'255,215,100',glow2:'255,180,40',accent:'255,140,0',
    scrimA:'rgba(70,45,0,.6)',scrimB:'rgba(0,0,0,.93)',
    shape:'star',motion:'ym-radiate',tints:['#ffd75a','#ffe9a8','#ffb54a'],sound:'classic'},

  'Kokushi Musou':{jp:'国士無双',romaji:'THIRTEEN ORPHANS',ink:'#eef1ff',
    glow:'180,195,255',glow2:'120,140,255',accent:'90,110,230',
    scrimA:'rgba(18,22,60,.72)',scrimB:'rgba(2,3,16,.95)',
    shape:'shard',motion:'ym-radiate',tints:['#eef1ff','#b9c4ff','#8aa0ff'],sound:'imperial'},
  'Kokushi Juusanmen':{jp:'国士無双十三面待ち',romaji:'THIRTEEN-SIDED WAIT',ink:'#ffffff',
    glow:'200,215,255',glow2:'150,175,255',accent:'120,255,240',
    scrimA:'rgba(20,20,66,.8)',scrimB:'rgba(2,2,18,.96)',
    shape:'crystal',motion:'ym-radiate',tints:['#ffffff','#bfe6ff','#c9b9ff','#a0ffe8'],
    double:true,sound:'imperial',soundDouble:'imperial'},

  'Suu Ankou':{jp:'四暗刻',romaji:'FOUR CONCEALED TRIPLETS',ink:'#ffdccb',
    glow:'255,110,80',glow2:'220,40,40',accent:'150,10,20',
    scrimA:'rgba(40,4,6,.8)',scrimB:'rgba(8,0,0,.97)',
    shape:'ember',motion:'ym-rise',tints:['#ff7a4a','#ff4a3a','#d01f2a'],sound:'ominous'},
  'Suu Ankou Tanki':{jp:'四暗刻単騎',romaji:'LONE TANKI WAIT',ink:'#ffd9e6',
    glow:'255,90,150',glow2:'190,40,120',accent:'120,20,160',
    scrimA:'rgba(40,4,30,.82)',scrimB:'rgba(8,0,8,.97)',
    shape:'ember',motion:'ym-rise',tints:['#ff5a96','#c22890','#7a20b0'],
    double:true,sound:'ominous',soundDouble:'ominous'},

  'Daisangen':{jp:'大三元',romaji:'BIG THREE DRAGONS',ink:'#ffffff',
    glow:'255,255,255',glow2:'120,240,140',accent:'230,50,50',
    scrimA:'rgba(30,30,34,.78)',scrimB:'rgba(0,0,0,.96)',
    shape:'bolt',motion:'ym-radiate',tints:['#ffffff','#5ce65c','#ff5a5a'],sound:'thunder'},
  'Shousuushii':{jp:'小四喜',romaji:'LITTLE FOUR WINDS',ink:'#e2fbff',
    glow:'120,230,255',glow2:'70,180,220',accent:'40,120,180',
    scrimA:'rgba(6,30,38,.78)',scrimB:'rgba(0,6,10,.96)',
    shape:'streak',motion:'ym-gale',tints:['#dffbff','#66e6ff','#3aa0d0'],sound:'airy'},
  'Daisuushii':{jp:'大四喜',romaji:'BIG FOUR WINDS',ink:'#e6fff4',
    glow:'110,255,210',glow2:'80,200,255',accent:'40,150,200',
    scrimA:'rgba(4,32,30,.82)',scrimB:'rgba(0,8,8,.97)',
    shape:'streak',motion:'ym-gale',tints:['#e6fff4','#6effd2','#50c8ff','#3aa0d0'],
    double:true,sound:'airy',soundDouble:'airy'},

  'Tsuuiisou':{jp:'字一色',romaji:'ALL HONORS',ink:'#f6f7ff',
    glow:'205,215,240',glow2:'160,175,215',accent:'110,130,180',
    scrimA:'rgba(20,22,32,.8)',scrimB:'rgba(2,2,6,.96)',
    shape:'crystal',motion:'ym-fall',tints:['#ffffff','#cfd6f0','#9fb0d8'],sound:'frostbell'},
  'Chinroutou':{jp:'清老頭',romaji:'ALL TERMINALS',ink:'#ffe6c0',
    glow:'230,170,90',glow2:'180,120,60',accent:'120,70,30',
    scrimA:'rgba(34,20,8,.82)',scrimB:'rgba(8,4,0,.96)',
    shape:'ember',motion:'ym-rise',tints:['#e6aa5a','#c8863c','#8a5a28'],sound:'earthdrum'},
  'Ryuuiisou':{jp:'緑一色',romaji:'ALL GREEN',ink:'#e9ffe2',
    glow:'120,240,140',glow2:'60,200,90',accent:'20,140,60',
    scrimA:'rgba(6,30,12,.8)',scrimB:'rgba(0,8,2,.96)',
    shape:'leaf',motion:'ym-fall',tints:['#c8ffb8','#5ce65c','#2aa84a'],sound:'zen'},

  'Chuuren Poutou':{jp:'九蓮宝燈',romaji:'NINE GATES',ink:'#fff0d0',
    glow:'255,200,110',glow2:'255,150,60',accent:'200,90,180',
    scrimA:'rgba(30,14,40,.8)',scrimB:'rgba(6,2,12,.96)',
    shape:'orb',motion:'ym-rise',tints:['#fff0d0','#ffc86e','#ff9a4a','#e08adf'],sound:'celestial'},
  'Junsei Chuuren':{jp:'純正九蓮宝燈',romaji:'PURE NINE GATES',ink:'#fffaf0',
    glow:'255,235,180',glow2:'255,200,110',accent:'255,170,220',
    scrimA:'rgba(34,20,44,.82)',scrimB:'rgba(8,4,14,.97)',
    shape:'orb',motion:'ym-rise',tints:['#fffaf0','#ffe9a8','#ffc86e','#ffb0e0'],
    double:true,sound:'celestial',soundDouble:'celestial'},

  'Suu Kantsu':{jp:'四槓子',romaji:'FOUR KANS',ink:'#fff4c0',
    glow:'255,215,90',glow2:'220,170,40',accent:'150,110,20',
    scrimA:'rgba(30,22,4,.82)',scrimB:'rgba(6,4,0,.96)',
    shape:'coin',motion:'ym-fall',tints:['#fff8d0','#ffd75a','#e0a828'],sound:'forge'},

  'Tenhou':{jp:'天和',romaji:'HEAVENLY HAND',ink:'#fffdf0',
    glow:'255,245,210',glow2:'255,220,150',accent:'150,200,255',
    scrimA:'rgba(40,44,66,.7)',scrimB:'rgba(6,8,16,.95)',
    shape:'orb',motion:'ym-fall',tints:['#ffffff','#fff2c8','#cfe4ff'],sound:'divine'},
  'Chiihou':{jp:'地和',romaji:'EARTHLY HAND',ink:'#f2ffdf',
    glow:'205,240,140',glow2:'150,200,90',accent:'230,200,120',
    scrimA:'rgba(18,34,10,.76)',scrimB:'rgba(2,8,0,.96)',
    shape:'leaf',motion:'ym-rise',tints:['#e6ffb8','#cdf08a','#ffe0a8'],sound:'divine'},
};

// Full manual override hook — takes total control of the flash for a yaku
// name (called as fn(isDouble), builds its own #yakuman-layer content).
// Empty by default: every yakuman goes through the themed path below.
const YAKUMAN_ANIMATIONS={};

// Scatter one motif's worth of particles across #yakuman-layer for the
// hold duration. cfg is a YAKUMAN_THEMES entry (shape / motion / tints /
// count). CSS (.ym-particle + @keyframes ym-fall/rise/radiate/gale) does
// the animating; this only seeds randomised start positions, sizes,
// durations and per-particle vectors via inline custom props.
function spawnYakumanMotif(layer,cfg){
  const wrap=document.createElement('div');wrap.className='yakuman-motif';
  const shape=cfg.shape||'star';
  const motion=cfg.motion||{star:'ym-radiate',shard:'ym-radiate',bolt:'ym-radiate',
    crystal:'ym-fall',leaf:'ym-fall',coin:'ym-fall',ember:'ym-rise',orb:'ym-rise',
    streak:'ym-gale'}[shape]||'ym-fall';
  const tints=cfg.tints&&cfg.tints.length?cfg.tints:['#ffd75a'];
  const count=cfg.count||26;
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const sign=()=>Math.random()<.5?-1:1;
  for(let i=0;i<count;i++){
    const p=document.createElement('span');
    p.className='ym-particle ym-s-'+shape;
    const st=p.style;
    st.setProperty('--motion',motion);
    st.setProperty('--tint',tints[i%tints.length]);
    st.setProperty('--dur',rnd(3.2,5.2).toFixed(2)+'s');
    st.setProperty('--delay',rnd(0,1.6).toFixed(2)+'s');
    st.setProperty('--rot',(sign()*rnd(180,720)).toFixed(0)+'deg');
    if(motion==='ym-radiate'){
      const ang=rnd(0,Math.PI*2),dist=rnd(26,62);
      st.left='50%';st.top='50%';
      st.setProperty('--sz',rnd(1.6,4.6).toFixed(2)+'vmin');
      st.setProperty('--dx',(Math.cos(ang)*dist).toFixed(1)+'vmax');
      st.setProperty('--dy',(Math.sin(ang)*dist).toFixed(1)+'vmax');
    }else if(motion==='ym-gale'){
      st.left='-14%';st.top=rnd(4,92).toFixed(1)+'%';
      st.setProperty('--sz',rnd(10,24).toFixed(1)+'vmin');
      st.setProperty('--dy',rnd(-6,6).toFixed(1)+'vh');
      st.setProperty('--tilt',rnd(-15,-3).toFixed(1)+'deg');
    }else{
      st.left=rnd(1,99).toFixed(1)+'%';
      st.top=(motion==='ym-rise'?rnd(78,112):rnd(-16,10)).toFixed(1)+'%';
      st.setProperty('--sz',rnd(1.4,4.2).toFixed(2)+'vmin');
      st.setProperty('--dx',(sign()*rnd(2,14)).toFixed(1)+'vw');
    }
    wrap.appendChild(p);
  }
  layer.appendChild(wrap);
  return wrap;
}

// Yakuman/double-yakuman flash (see onEnd) — a bigger, more dramatic
// moment than the normal call-banner win announcement, playing BEFORE it
// rather than replacing it. yakuNames is every yaku name across every
// qualifying winner (a double/triple ron could have more than one); the
// most specific one that has a YAKUMAN_THEMES entry drives the palette,
// motif and sound (preferring a `double`-flagged theme when isDouble).
function playYakumanFx(isDouble,yakuNames){
  const names=yakuNames||[];
  const override=names.map(n=>YAKUMAN_ANIMATIONS[n]).find(Boolean);
  if(override) return override(isDouble);
  const layer=$('yakuman-layer'); if(!layer) return;
  const themed=names.filter(n=>YAKUMAN_THEMES[n]);
  const key=themed.find(n=>YAKUMAN_THEMES[n].double)||themed[0];
  const theme=(key&&YAKUMAN_THEMES[key])||YAKUMAN_THEMES._default;
  const named=theme!==YAKUMAN_THEMES._default;
  layer.innerHTML='';
  const st=layer.style;
  st.setProperty('--ym-ink',theme.ink);
  st.setProperty('--ym-glow',theme.glow);
  st.setProperty('--ym-glow2',theme.glow2||theme.glow);
  st.setProperty('--ym-accent',theme.accent||theme.glow2||theme.glow);
  st.setProperty('--ym-scrim-a',theme.scrimA);
  st.setProperty('--ym-scrim-b',theme.scrimB||'rgba(0,0,0,.93)');

  const scrim=document.createElement('div');scrim.className='yakuman-scrim';
  layer.appendChild(scrim);
  spawnYakumanMotif(layer,{...theme,count:(theme.count||26)+(isDouble?12:0)});

  const burst=document.createElement('div');burst.className='yakuman-burst';
  if(named){
    const eb=document.createElement('div');
    eb.className='yakuman-eyebrow'+(isDouble?' double':'');
    eb.textContent=isDouble?'ダブル役満':'役満';
    burst.appendChild(eb);
  }
  const text=document.createElement('div');
  const label=named?theme.jp:(isDouble?'ダブル役満':'役満');
  text.className='yakuman-text'+((isDouble&&!named)?' double':'')
    +(label.length>=7?' xlong':label.length>=4?' long':'');
  text.textContent=label;
  const sub=document.createElement('div');sub.className='yakuman-sub';
  sub.textContent=named?theme.romaji:(isDouble?'DOUBLE YAKUMAN':'YAKUMAN');
  burst.appendChild(text);burst.appendChild(sub);
  layer.appendChild(burst);
  layer.classList.add('blocking');

  playYakumanSfx(isDouble&&theme.soundDouble?theme.soundDouble:theme.sound);
  setTimeout(()=>{
    layer.innerHTML='';layer.classList.remove('blocking');
  },YAKUMAN_FX_HOLD);
}
// Held on screen before the normal win banner(s) get their turn — see
// onEnd, which also folds this into WIN_BANNER_DELAY so the results panel
// waits for the flash too, not just the banner(s) after it.
const YAKUMAN_FX_HOLD=4400;

function setFxVolume(val){
  fxVolume=(val/100)*4; // 0-100 slider maps to 0-4.0 gain
  if(fxGainNode) fxGainNode.gain.value=fxVolume;
  const lbl=$('fx-vol-label'); if(lbl) lbl.textContent=val+'%';
  try{ localStorage.setItem('mj-fx-vol',val); }catch(e){}
}

function toggleFx(){
  fxEnabled=!fxEnabled;
  const btn=$('bfx'); if(btn) btn.classList.toggle('off',!fxEnabled);
  try{ localStorage.setItem('mj-fx',fxEnabled?'1':'0'); }catch(e){}
}

function toggleDiscardSfx(){
  discardSfxEnabled=!discardSfxEnabled;
  const btn=$('bdiscard-sfx'); if(btn) btn.classList.toggle('off',!discardSfxEnabled);
  try{ localStorage.setItem('mj-discard-sfx',discardSfxEnabled?'1':'0'); }catch(e){}
}

function setDiscardVolume(val){
  discardSfxVolume=(val/100)*2;
  if(discardGainNode) discardGainNode.gain.value=discardSfxVolume;
  const lbl=$('discard-vol-label'); if(lbl) lbl.textContent=val+'%';
  try{ localStorage.setItem('mj-discard-vol',val); }catch(e){}
}

// Lazily creates the shared "FX" gain stage (Settings > FX — discardSfxEnabled/
// discardSfxVolume) — factored out of playDiscardSfx so playNameplateSfx
// below can feed its synthesized tone through the exact same volume/mute
// control instead of the "Voice" one (fxGainNode/playSfx) that Pon/Riichi/
// etc. use, since a reveal chime isn't a character voice line.
function getDiscardGainNode(){
  if(!discardGainNode){
    const ctx=getFxAudioCtx().ctx;
    discardGainNode=ctx.createGain();
    discardGainNode.gain.value=discardSfxVolume;
    discardGainNode.connect(ctx.destination);
  }
  return discardGainNode;
}

function playDiscardSfx(){
  if(!discardSfxEnabled) return;
  const el=$('sfx-discard');
  if(!el) return;
  try{
    const gainNode=getDiscardGainNode();
    if(!_fxConnectedEls.has(el)){
      const src=getFxAudioCtx().ctx.createMediaElementSource(el);
      src.connect(gainNode);
      _fxConnectedEls.add(el);
    }
    if(getFxAudioCtx().ctx.state==='suspended') getFxAudioCtx().ctx.resume();
  }catch(e){}
  el.currentTime=0;
  el.volume=1.0;
  el.play().catch(()=>{});
}

// Reveal chime for the game-start roll call (see gameStartIntro) — a
// synthesized sword "shing" (Web Audio noise + oscillators, no bundled
// audio file needed, since nothing already in public/audio fit: the
// discard click is a tile clack, the Voice lines are Pon/Riichi/etc. call-
// outs). Two layered parts: a short bright noise burst standing in for the
// blade's air-cut/friction, then a handful of inharmonic high sines
// (like a struck blade's overtones) ringing out together underneath it.
// Shares the discard click's own FX gain stage/mute toggle rather than the
// Voice one, since this isn't a character voice line either.
function playNameplateSfx(){
  if(!discardSfxEnabled) return;
  try{
    const ctx=getFxAudioCtx().ctx;
    const gainNode=getDiscardGainNode();
    if(ctx.state==='suspended') ctx.resume();
    const now=ctx.currentTime;

    // "Shhk" — a short highpassed noise burst, gone before the ring below
    // really gets going.
    const noiseDur=0.08;
    const noiseBuf=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*noiseDur),ctx.sampleRate);
    const data=noiseBuf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*(1-i/data.length); // linear fade-out, not a hard cutoff
    const noise=ctx.createBufferSource();
    noise.buffer=noiseBuf;
    const noiseFilter=ctx.createBiquadFilter();
    noiseFilter.type='highpass';
    noiseFilter.frequency.value=2500;
    const noiseEnv=ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.4,now);
    noiseEnv.gain.exponentialRampToValueAtTime(0.0001,now+noiseDur);
    noise.connect(noiseFilter);noiseFilter.connect(noiseEnv);noiseEnv.connect(gainNode);
    noise.start(now);noise.stop(now+noiseDur);

    // Metallic ring — inharmonic (non-integer-multiple) high sines read as
    // "struck metal" rather than a musical chord; each drifts slightly flat
    // and decays together, like a blade's overtones settling.
    [3200,4700,6100].forEach((freq,idx)=>{
      const osc=ctx.createOscillator();
      osc.type='sine';
      osc.frequency.setValueAtTime(freq,now);
      osc.frequency.exponentialRampToValueAtTime(freq*0.85,now+0.5);
      const env=ctx.createGain();
      env.gain.setValueAtTime(0,now);
      env.gain.linearRampToValueAtTime(0.22/(idx+1),now+0.006+idx*0.004); // higher overtones quieter, staggered so the onset doesn't sound too synced
      env.gain.exponentialRampToValueAtTime(0.0001,now+0.5);
      osc.connect(env);env.connect(gainNode);
      osc.start(now);osc.stop(now+0.55);
    });
  }catch(e){}
}

function toggleMusic(){
  musicEnabled=!musicEnabled;
  const btn=$('bmute');
  if(musicEnabled){
    if(btn) btn.classList.remove('off');
    if(inGame) playGameMusic(); else playLobbyMusic();
  } else {
    stopLobbyMusic(); stopGameMusic();
    if(btn) btn.classList.add('off');
  }
  try{ localStorage.setItem('mj-music',musicEnabled?'1':'0'); }catch(e){}
}

// LOBBY
let gameMode='tonpuu'; // 'tonpuu' or 'hanchan'
let variant='yonma'; // 'yonma' (4-player, default) or 'sanma' (3-player)

function setMode(mode){
  gameMode=mode;
  $('btn-tonpuu').classList.toggle('active', mode==='tonpuu');
  $('btn-hanchan').classList.toggle('active', mode==='hanchan');
  try{ localStorage.setItem('mj-game-mode',mode); }catch(e){}
  updateMatchSummary();
}

function setVariant(v){
  variant=v;
  $('btn-yonma').classList.toggle('active', v==='yonma');
  $('btn-sanma').classList.toggle('active', v==='sanma');
  const n=v==='sanma'?3:4;
  $('tonpuu-sub').textContent=`TONPUU · ${n} rounds`;
  $('hanchan-sub').textContent=`HANCHAN · ${n*2} rounds`;
  updateSlotCount();
  try{ localStorage.setItem('mj-variant',v); }catch(e){}
  updateMatchSummary();
}

// Live readout of the current Match Settings picks — mode/player-count in
// the header, other active rules right below it (see .lobby-rules-summary
// in index.html) — since Game Mode/Players/Rules all moved into the
// settings modal, without this there'd be no way to tell what you're about
// to queue for. Skipped once a room exists: renderWaitingRules (below)
// owns both elements from that point on, showing the room's actual, frozen
// settings instead of whatever's currently picked for the NEXT one.
function updateMatchSummary(){
  if(currentRoomMode!=null) return;
  const header=$('lobby-header');
  if(header){
    const modeLabel=gameMode==='hanchan'?'半荘戦 HANCHAN':'東風戦 TONPUU';
    const variantLabel=variant==='sanma'?'三人麻雀 SANMA':'四人麻雀 YONMA';
    header.textContent=`${modeLabel} · ${variantLabel}`;
  }
  const el=$('lobby-rules-summary'); if(!el) return;
  const RULE_LABELS={akaDora:'Aka Dora',kuitanAri:'Kuitan',doubleRon:'Double Ron',nagashiMangan:'Nagashi Mangan',chonbo:'Chonbo'};
  const onRules=Object.keys(RULE_LABELS).filter(k=>rules[k]).map(k=>RULE_LABELS[k]);
  el.textContent=onRules.length?onRules.join(', '):'No optional rules enabled';
}

// Waiting-room slot count follows the selected variant even before a
// room_update confirms it server-side — updateSlots() (below) re-renders
// with real seat data once the server responds, this just keeps the
// lobby's placeholder slot count from looking wrong in the meantime.
function updateSlotCount(){
  const wrap=$('slots'); if(!wrap) return;
  const n=variant==='sanma'?3:4;
  wrap.querySelectorAll('.slot').forEach((el,i)=>{el.style.display=i<n?'':'none';});
}

// Rule variants — picked once in the lobby, sent with 'join' like gameMode.
// chonbo defaults OFF (opt-in) unlike the others — it removes a safety
// net (Tsumo/Ron become declarable before the server's confirmed they're
// valid), not something a casual match should suddenly get by default.
let rules={akaDora:true,kuitanAri:true,doubleRon:true,nagashiMangan:true,chonbo:false};

// The room actually being played in — set from the server's 'joined' reply
// (server/index.js), NOT the `rules`/`gameMode`/`variant` globals above.
// Those stay editable in Match Settings for picking your NEXT room; these
// are frozen the moment a room exists and are what the waiting room
// displays (see renderWaitingRules) — the two must never be conflated, or
// tweaking Match Settings mid-wait would look like it changed a room whose
// server-side rules (Room.rules in server/room.js) are actually immutable.
let currentRoomRules=null,currentRoomMode=null,currentRoomNumPlayers=null;

// Read-only readout of the room actually joined — takes over the same
// header/subtitle updateMatchSummary uses (mode/player-count, then the
// other active rules), since match settings can't be changed after a room
// exists (see currentRoomRules above).
function renderWaitingRules(){
  const header=$('lobby-header');
  if(header&&currentRoomMode!=null&&currentRoomNumPlayers!=null){
    const modeLabel=currentRoomMode==='hanchan'?'半荘戦 HANCHAN':'東風戦 TONPUU';
    const variantLabel=currentRoomNumPlayers===3?'三人麻雀 SANMA':'四人麻雀 YONMA';
    header.textContent=`${modeLabel} · ${variantLabel}`;
  }
  const el=$('lobby-rules-summary'); if(!el||!currentRoomRules) return;
  const RULE_LABELS={akaDora:'Aka Dora',kuitanAri:'Kuitan',doubleRon:'Double Ron',nagashiMangan:'Nagashi Mangan',chonbo:'Chonbo'};
  const onRules=Object.keys(RULE_LABELS).filter(k=>currentRoomRules[k]).map(k=>RULE_LABELS[k]);
  el.textContent=onRules.length?onRules.join(', '):'No optional rules enabled';
}
function toggleRule(name){
  rules[name]=!rules[name];
  applyRuleButton(name);
  try{ localStorage.setItem('mj-rules',JSON.stringify(rules)); }catch(e){}
  updateMatchSummary();
}

// Syncs one rule's ON/OFF button to the current `rules` state — split out
// from toggleRule so boot-time restore can apply saved values without
// re-flipping them.
function applyRuleButton(name){
  const btn=$('btn-rule-'+name); if(!btn) return;
  btn.classList.toggle('off',!rules[name]);
}

// Quick Match — straight into a game against bots (see 'quick_match' in
// server/index.js, which creates, fills, and starts the room in one shot,
// no waiting room, not listed anywhere). No profile needed — defaults to
// Guest play (see index.html's #iname default value and the server's
// assignIdentity, which assigns a Guest identity itself whenever this
// connection hasn't unlocked one). The name/icon sent here are only ever a
// starting hint for that default case; once a profile IS unlocked the
// server uses its own record for both regardless of what's sent (see
// unlockedName/getIcon in index.js).
function findMatch(){
  // Guards against a double-fire (impatient double-click/tap, or a slow
  // connection making the button feel unresponsive so the player clicks
  // again before the first request lands) — since quick_match starts the
  // game immediately server-side, a second request while the first is
  // still in flight makes the server evict this connection from the FIRST
  // room it just created (see leaveCurrentRoom in server/index.js) and
  // spin up a second one instead. The first room doesn't just vanish
  // though — every seat is now a bot, so it plays itself out as an
  // orphaned bot-vs-bot game, and the client briefly renders its
  // game_start before the real (second) one arrives and overwrites it,
  // which reads as a confusing extra "player" flashing into a seat. Once
  // disabled, resetLobby() (returning to the lobby after a game) is what
  // re-enables it — see below.
  if($('bfind').disabled) return;
  $('bfind').disabled=true;
  playLobbyMusic();
  wss({type:'quick_match',name:($('iname').value.trim()||'Player'),gameMode,variant,rules,voiceTheme:currentVoiceTheme,icon:currentPlayerIcon});
}

// ════════════════════════════════════════════════════════════
// ROOM LIST — the alternative to Find Match's blind quick-match, for
// playing with a specific person: createRoom() spins up a room using
// whatever's currently picked in Match Settings (same gameMode/variant/
// rules variables findMatch reads); it then shows up for everyone via
// 'list_rooms', and joinRoom() joins that exact room, inheriting its rules
// automatically — nobody has to communicate a code or match toggles by
// hand. See 'create_room'/'join_room'/'list_rooms' in server/index.js.
// ════════════════════════════════════════════════════════════
function toggleRoomList(){
  const modal=$('roomlist-modal');
  const backdrop=$('roomlist-backdrop');
  const open=modal.classList.contains('visible');
  if(open){ modal.classList.remove('visible'); backdrop.classList.remove('visible'); return; }
  $('roomlist-body').textContent='Loading…';
  wss({type:'list_rooms'});
  modal.classList.add('visible');
  backdrop.classList.add('visible');
}

// Routes Room List's "+ Create Room" through Match Settings instead of
// firing create_room immediately with whatever was last picked — closes
// Room List, opens the rules modal with its confirm button (and the Invite
// Players link right below it — see openInviteModal/rulesSelectedInvites)
// showing, and leaves the actual request to confirmCreateRoom once the
// player's happy with their picks.
function openCreateRoomRules(){
  toggleRoomList();
  toggleRulesModal();
  $('rules-modal-create-btn').style.display='block';
  $('rules-invite-section').style.display='block';
  rulesSelectedInvites=new Set();
  renderInvitedChips();
}

function confirmCreateRoom(){
  toggleRulesModal();
  createRoom();
}

// Selected during openCreateRoomRules (see renderRulesInviteList) — staged
// here rather than sent immediately (unlike the waiting room's own Invite
// Players picker) because there's no room to invite anyone into yet. Read
// once by the 'joined' handler in onMsg right after this connection's own
// create_room actually creates one, then cleared — see its own comment.
let rulesSelectedInvites=new Set();

function createRoom(){
  playLobbyMusic();
  wss({type:'create_room',gameMode,variant,rules,voiceTheme:currentVoiceTheme,icon:currentPlayerIcon});
}

function joinRoom(id){
  playLobbyMusic();
  wss({type:'join_room',roomId:id,voiceTheme:currentVoiceTheme,icon:currentPlayerIcon});
  // Only close the Room List modal if that's actually where this call came
  // from — acceptRoomInvite() also calls joinRoom() directly (accepting a
  // Room Invite toast never opens Room List at all), and toggleRoomList()
  // would otherwise OPEN it instead of closing it in that case, since it
  // just flips whichever state the modal's currently in.
  const modal=$('roomlist-modal');
  if(modal&&modal.classList.contains('visible')) toggleRoomList();
}

// One card per open room — host is just the first non-bot seat (whoever
// created it or was first to join), same "who's actually real" filter
// updateSlots uses elsewhere. Rule toggles are summarized as a short
// "ON" list rather than every single row, since most games use the
// defaults and a wall of ON/OFF pairs per card would be noise.
function renderRoomList(m){
  const body=$('roomlist-body'); if(!body) return;
  const rooms=m.rooms||[];
  if(!rooms.length){ body.innerHTML='<p>No open rooms — create one above!</p>'; return; }
  const RULE_LABELS={akaDora:'Aka Dora',kuitanAri:'Kuitan',doubleRon:'Double Ron',nagashiMangan:'Nagashi Mangan',chonbo:'Chonbo'};
  body.innerHTML='';
  rooms.forEach(r=>{
    const modeLabel=r.gameMode==='hanchan'?'半荘戦 HANCHAN':'東風戦 TONPUU';
    const variantLabel=r.numPlayers===3?'三人麻雀 SANMA':'四人麻雀 YONMA';
    const humanCount=r.seats.filter(s=>s&&!s.isBot).length;
    const host=r.seats.find(s=>s&&!s.isBot);
    const onRules=Object.keys(RULE_LABELS).filter(k=>r.rules[k]).map(k=>RULE_LABELS[k]);
    const full=humanCount>=r.seats.length;
    const div=document.createElement('div');
    div.className='room-card';
    div.innerHTML=`<div>
        <div class="room-card-title">${modeLabel} · ${variantLabel}</div>
        <div class="room-card-sub">Host: ${host?escHtml(host.name):'—'} · ${humanCount}/${r.seats.length} players${onRules.length?' · '+onRules.join(', '):''}</div>
      </div>
      <button class="room-card-join"${full?' disabled':''} onclick="joinRoom(${r.id})">${full?'Full':'Join'}</button>`;
    body.appendChild(div);
  });
}

function showWaiting(){
  $('wa').style.display='block';
  $('lobby-actions').style.display='none';
  $('lobby-inputs').style.display='none';
  $('match-settings-link').style.display='none';
  $('rankings-icon-btn').style.display='none';
  renderWaitingRules();
  $('cdiv').textContent='Press Ready when you are set to start';
  // Room Invite — host-only (isRoomHost is set right before showWaiting()
  // is called, see 'joined' in onMsg); quick_match rooms have no host at
  // all (hostId stays null server-side), and join_room's caller is never
  // the host, so neither ever sees this button.
  $('binvite').style.display=isRoomHost?'':'none';
}

// ── Room Invite ──────────────────────────────────────────────────────────
// Which caller opened the Invite Players window (see index.html's single
// shared #invite-modal) — 'waiting' (the waiting room's own link, picks
// send immediately) or 'create' (Create Room's link, picks are staged —
// see openCreateRoomRules/rulesSelectedInvites). Read by renderInvitePlayers
// (to decide what a click does) and closeInviteModal (to decide what
// closing the window returns to). Set at the top of openInviteModal.
let onlineProfilesTarget='waiting';

// Opens the Invite Players window (see the modal in index.html) — shared by
// both the waiting room's link and Create Room's link, `target` says which.
// Fetches a fresh list every open, same "never show stale content from a
// previous visit" reasoning as every other on-demand modal in this file.
// From Create Room, this hides the rules modal's own box (not its backdrop
// — see closeInviteModal) rather than just stacking on top of it, mirroring
// the User Profile hub's "child panel replaces the hub" pattern elsewhere
// in this file, and shows the ← Back control instead of just ✕.
function openInviteModal(target){
  onlineProfilesTarget=target;
  $('invite-list').innerHTML='Loading…';
  wss({type:'get_online_profiles'});
  if(target==='create') $('rules-modal').classList.remove('visible');
  $('invite-modal-back').style.display=target==='create'?'':'none';
  $('invite-modal').classList.add('visible');
  $('invite-backdrop').classList.add('visible');
}

// Closing the window: from the waiting room this just closes it; from
// Create Room it also brings the rules modal's box back (its backdrop was
// never hidden — see openInviteModal) showing whatever got picked as chips
// (see renderInvitedChips) above the "+ Create Room" button.
function closeInviteModal(){
  $('invite-modal').classList.remove('visible');
  $('invite-backdrop').classList.remove('visible');
  if(onlineProfilesTarget==='create'){
    $('rules-modal').classList.add('visible');
    renderInvitedChips();
  }
}

// One .profile-card per known profile (minus this connection's own — see
// server/index.js's 'get_online_profiles'), online ones first and marked
// with a glowing dot (.profile-card-dot); offline ones are dimmed and
// unpickable (.profile-card-offline) rather than hidden, so a host can see
// "not online right now" instead of a name just silently missing. Same
// markup as the Select Profile picker's cards (renderProfileList), but a
// click's effect depends on onlineProfilesTarget: 'waiting' sends an invite
// immediately (see sendInvite); 'create' just stages the pick
// (rulesSelectedInvites) — either way the modal stays open so a host can
// pick several without reopening it.
function renderInvitePlayers(profiles){
  const grid=$('invite-list'); if(!grid) return;
  if(!profiles||!profiles.length){ grid.innerHTML='<p>No other players yet.</p>'; return; }
  grid.innerHTML='';
  for(const p of profiles){
    const btn=document.createElement('button');
    btn.type='button';
    const picked=onlineProfilesTarget==='create'&&rulesSelectedInvites.has(p.name);
    btn.className='profile-card'+(p.online?'':' profile-card-offline')+(picked?' active':'');
    btn.dataset.name=p.name;
    btn.innerHTML=`${iconSvg(p.icon)}${p.online?'<span class="profile-card-dot" title="Online"></span>':''}<span class="profile-card-name">${escHtml(p.name)}</span>`;
    if(p.online){
      btn.onclick=onlineProfilesTarget==='create'
        ?()=>{
          if(rulesSelectedInvites.has(p.name)){ rulesSelectedInvites.delete(p.name); btn.classList.remove('active'); }
          else { rulesSelectedInvites.add(p.name); btn.classList.add('active'); }
        }
        :()=>sendInvite(p.name,btn);
    }
    grid.appendChild(btn);
  }
}

function sendInvite(name,btn){
  if(btn.disabled) return;
  btn.disabled=true;
  wss({type:'invite_player',name});
}

// 'invite_result' reply (see onMsg) — marks the card Invited on success, or
// re-enables it (so the host can retry) plus a toast explaining why on
// failure. Looked up by data-name rather than closing over the exact `btn`
// from sendInvite, so this still works correctly even if renderInvitePlayers
// re-rendered the grid in between (e.g. the modal was closed and reopened).
function onInviteResult(m){
  const btn=document.querySelector(`#invite-list .profile-card[data-name="${cssEscape(m.name)}"]`);
  if(m.ok){
    if(btn){ btn.classList.add('active'); const nm=btn.querySelector('.profile-card-name'); if(nm) nm.textContent=`${m.name} ✓`; }
  } else {
    if(btn) btn.disabled=false;
    toast(m.error||'Could not send invite.');
  }
}

// The chip list shown above Create Room's "+ Create Room" button (see
// #rules-invited-list in index.html) — one removable chip per name in
// rulesSelectedInvites, rebuilt from scratch on every call rather than
// diffed (this list is short and only ever changes from direct user
// action, never a server push). Removing a chip here is the only way back
// out of a pick besides reopening the Invite Players window and clicking
// the card again — both stay in sync since they share the same
// rulesSelectedInvites Set.
function renderInvitedChips(){
  const wrap=$('rules-invited-list'); if(!wrap) return;
  wrap.innerHTML='';
  for(const name of rulesSelectedInvites){
    const chip=document.createElement('span'); chip.className='invite-chip';
    chip.appendChild(document.createTextNode(name));
    const x=document.createElement('button');
    x.type='button'; x.className='invite-chip-x'; x.textContent='✕'; x.setAttribute('aria-label',`Remove ${name}`);
    x.onclick=()=>{ rulesSelectedInvites.delete(name); renderInvitedChips(); };
    chip.appendChild(x);
    wrap.appendChild(chip);
  }
}

// CSS.escape isn't available in every embedded/older WebView this app might
// run in — a minimal inline fallback (escape everything CSS.escape would)
// rather than pulling in a dependency for one attribute-selector lookup.
function cssEscape(s){
  return window.CSS&&CSS.escape?CSS.escape(s):String(s).replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
}

// Invitee side — the currently-shown invite, if any (see onMsg's
// 'room_invite'), so acceptRoomInvite() below knows which room to join.
// Deliberately does NOT auto-dismiss (unlike the achievement toast this
// visually mirrors) — an invite is something to act on, not just glance at.
let pendingRoomInvite=null;

function showRoomInvite(m){
  pendingRoomInvite=m;
  const modeLabel=m.gameMode==='hanchan'?'Hanchan':'Tonpuu';
  const variantLabel=m.numPlayers===3?'Sanma':'Yonma';
  $('invite-toast-body').innerHTML=`<div class="achv-item">
      <div class="achv-label">${escHtml(m.fromName)} invited you to a game</div>
      <div class="achv-reward">${escHtml(modeLabel)} · ${escHtml(variantLabel)}</div>
    </div>`;
  $('invite-toast').classList.add('show');
}

function closeRoomInvite(){
  pendingRoomInvite=null;
  $('invite-toast').classList.remove('show');
}

function acceptRoomInvite(){
  if(!pendingRoomInvite) return;
  const roomId=pendingRoomInvite.roomId;
  closeRoomInvite();
  joinRoom(roomId);
}

// Cached across calls so toggling a bot's difficulty popup can re-render
// the slots locally (without waiting on a server round-trip) — see
// renderDiffPopup()/the click-outside listener below.
let lastSeats=null, openDiffPopupSeat=null;

// Tracks each seat's ready flag across calls (index = seat), purely so the
// one-shot .rdy-flash pulse (see style.css) only plays on the render where
// a seat actually FLIPS to ready — updateSlots re-runs on every
// room_update (which fires for lots of unrelated reasons: another seat's
// difficulty change, a bot getting swapped in, etc.), and without this
// check the flash would replay on every one of those instead of just the
// moment someone hits Ready.
let prevReady=[];

function updateSlots(seats){
  lastSeats=seats;
  $('wmsg').textContent=`${seats.filter(Boolean).length}/${seats.length} players`;
  document.querySelectorAll('.slot').forEach((sl,i)=>{
    // seats.length is the room's real numPlayers (3 for sanma, 4 otherwise)
    // — hide any static slot div past that (there are always 4 in the DOM).
    if(i>=seats.length){ sl.style.display='none'; return; }
    sl.style.display='';
    const p=seats[i]; sl.innerHTML='';sl.className='slot';sl.onclick=null;
    if(p){
      sl.classList.add('filled');
      if(p.isBot) sl.classList.add('bot');
      if(p.ready){
        if(!prevReady[i]) sl.classList.add('rdy-flash');
        sl.classList.add('rdy');
      }
      prevReady[i]=!!p.ready;
      // Real players show their actual profile icon (same iconSvg lookup
      // as everywhere else); bots stay iconless here (no profile to draw
      // one from) — the difficulty label below is what identifies them.
      const iconHtml=p.isBot?'':`<span class="s-icon">${iconSvg(p.icon)}</span>`;
      sl.innerHTML=`${iconHtml}<span class="sn">${p.name.slice(0,8)}</span>`;
      if(p.isBot){
        const diff=p.difficulty||'normal';
        sl.classList.add('clickable-bot');
        const lbl=document.createElement('span');
        lbl.className='sd';
        lbl.textContent=diff[0].toUpperCase()+diff.slice(1);
        sl.appendChild(lbl);
        sl.onclick=(e)=>{e.stopPropagation();openDiffPopupSeat=openDiffPopupSeat===i?null:i;updateSlots(lastSeats);};
        if(openDiffPopupSeat===i) renderDiffPopup(sl,i,diff);
      }
    } else {
      prevReady[i]=false;
      sl.innerHTML='<span class="si">🀄</span>';
    }
  });
}

// Small inline Easy/Normal/Hard picker anchored under a clicked bot slot.
// Reuses .mode-btn's existing styling (same visual language as Game Mode)
// rather than inventing a new button style — see .diff-popup-btn (style.css).
function renderDiffPopup(sl,seat,current){
  const pop=document.createElement('div');pop.className='diff-popup';
  pop.onclick=e=>e.stopPropagation();
  for(const level of['easy','normal','hard']){
    const btn=document.createElement('button');
    btn.className='mode-btn diff-popup-btn'+(level===current?' active':'');
    btn.textContent=level[0].toUpperCase()+level.slice(1);
    btn.onclick=e=>{e.stopPropagation();wss({type:'set_bot_difficulty',seat,difficulty:level});openDiffPopupSeat=null;updateSlots(lastSeats);};
    pop.appendChild(btn);
  }
  sl.appendChild(pop);
}
document.addEventListener('click',e=>{
  if(openDiffPopupSeat!==null&&!e.target.closest('.slot')){openDiffPopupSeat=null;if(lastSeats)updateSlots(lastSeats);}
});

function pressReady(){
  if(isReady) return;
  isReady=true;
  $('bready').classList.add('pressed');
  $('bready').disabled=true;
  wss({type:'ready'});
}

// Leaving mid-round can catch a call banner (riichi/pon/kan/chi) or the
// round-start card still mid-animation — both live in page-level fixed
// overlays (.cb-layer/.rs-layer, see index.html), NOT scoped inside
// #s-game, so show()'s screen-swapping back to the lobby doesn't hide them
// on its own; they'd otherwise just sit there until their own setTimeout
// happens to fire. The round-start card is the more serious case: while
// showing, .rs-layer gains .blocking (pointer-events:auto) to stop early
// taps on the board underneath it — left in place after leaving, it
// silently eats every click on the LOBBY screen too until that timer fires.
function clearActiveBanners(){
  const cb=$('cb-layer'); if(cb) cb.querySelectorAll('.call-banner').forEach(el=>el.remove());
  const rs=$('rs-layer'); if(rs){ rs.innerHTML=''; rs.classList.remove('blocking'); }
  const gs=$('gs-layer'); if(gs){ gs.innerHTML=''; gs.classList.remove('blocking'); }
  roundStartBannerActive=false;
  pendingBannerGameState=null;
  pendingGameStartIntro=null;
  gsChimeTimers.forEach(clearTimeout); gsChimeTimers.length=0;
}

function resetLobby(){
  clearActiveBanners();
  setResume(null);
  mySeat=-1;inGame=false;selId=null;lastState=null;isReady=false;discarding=false;
  pendingDiscardTileId=null;discardRetryArmed=false;suppressDiscardSfxOnce=false;clearTimeout(discardWatchdog);
  currentRoomRules=null;currentRoomMode=null;currentRoomNumPlayers=null;
  isPrivateRoomGame=false;isRoomHost=false;playAgainSeats=[];lastGameOverNames=null;
  $('wa').style.display='none';
  $('binvite').style.display='none';
  $('lobby-actions').style.display='flex';
  $('bfind').disabled=false;
  $('lobby-inputs').style.display='block';
  $('match-settings-link').style.display='';
  $('rankings-icon-btn').style.display='';
  updateMatchSummary();
  $('cdiv').textContent='';
  $('bready').classList.remove('pressed');
  $('bready').disabled=false;
  document.querySelectorAll('.slot').forEach(sl=>{sl.innerHTML='<span class="si">🀄</span>';sl.className='slot';sl.style.display='';});
  updateSlotCount();
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

// The game-over panel's "Leave Room" button (#bend-menu, only ever shown by
// onGameOver). The game is already finished, so there's no progress to
// lose — leave straight to the lobby with no "progress will be lost"
// confirm, regardless of what inGame happens to be.
function leaveRoomFromGameOver(){
  _leaveGame();
}
function showLeaveConfirm(){
  $('leave-modal').classList.add('visible');
  $('leave-backdrop').classList.add('visible');
}

// Generic themed yes/no confirm (see #confirm-modal in index.html) — a
// drop-in for window.confirm, which this app's sandboxed preview disables
// and which looks out of place against the rest of the UI anyway. `onYes`
// runs only if the player confirms.
let _uiConfirmYes=null;
function uiConfirm(message,onYes,okLabel){
  _uiConfirmYes=onYes||null;
  $('confirm-message').textContent=message||'Are you sure?';
  $('confirm-ok-btn').textContent=okLabel||'OK';
  $('confirm-ok-btn').onclick=()=>{ const fn=_uiConfirmYes; closeUiConfirm(); if(fn) fn(); };
  $('confirm-modal').classList.add('visible');
  $('confirm-backdrop').classList.add('visible');
}
function closeUiConfirm(){
  _uiConfirmYes=null;
  $('confirm-modal').classList.remove('visible');
  $('confirm-backdrop').classList.remove('visible');
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
  // Just the 'leave' message — NOT a socket close/reconnect (this used to
  // close+reopen the WebSocket here). unlockedName lives only in memory
  // for one WebSocket's lifetime (see server/index.js), so closing the
  // connection silently logged the player out server-side: the client's
  // #iname kept showing their real name, but the next 'join' had no
  // unlockedName to use and fell back to a fresh Guest identity — the
  // waiting room and eventual game would show Guest despite the client UI
  // still saying otherwise. 'leave' alone already does everything needed
  // server-side (removeHuman swaps a bot into the seat, myRoom is cleared
  // — see index.js), so there's nothing the reconnect was actually buying.
  wss({type:'leave'});
  resetLobby();
  stopGameMusic();
  playLobbyMusic();
}

// Traps the phone/browser back button so it can't silently exit a game in
// progress — a stray back gesture (very easy to hit by accident on mobile,
// where it's a thin edge swipe rather than a deliberate button) used to pop
// this SPA's only history entry and close/exit the app outright, with no
// chance to reconsider. Pairs with the existing leave-confirmation flow
// above instead of adding a second one: works by keeping one extra "guard"
// history entry pushed ahead of the page's real load — a back press pops
// it (firing popstate) and, while a game is in progress, this immediately
// re-pushes a fresh guard in its place, so the SPA never actually
// navigates anywhere and the back press instead surfaces the same
// confirmation the top-bar Leave button uses. Once the player isn't in a
// game, popstate is left alone (no guard re-pushed), so back behaves
// normally again — e.g. actually exiting to the home screen/closing the
// tab, which is the outcome a back press should have outside a game.
history.pushState({janshinGuard:true},'');
window.addEventListener('popstate',()=>{
  if(!inGame) return;
  history.pushState({janshinGuard:true},'');
  showLeaveConfirm();
});


// Shrinks .pname/.ptitle's font-size (in 1px steps) until the text fits
// within its CSS max-width without triggering the ellipsis clip (see those
// classes in style.css) — used instead of just letting a long name/title
// get clipped, so the actual achievement title (e.g. "Disciplined Safe
// Player", the longest one — see server/achievements.js) always reads in
// full, without the nameplate box itself growing to fit it (that's what
// the max-width cap is there to prevent — see its own comment on .pname).
// Floored at 60% of the CSS-intended size so an even longer future title
// still degrades to ellipsis rather than shrinking to unreadable — el's own
// overflow:hidden;text-overflow:ellipsis stays in place as that fallback.
function fitNameplateText(el){
  if(!el||!el.textContent) return;
  el.style.fontSize='';
  const base=parseFloat(getComputedStyle(el).fontSize);
  // Absolute floor, not a fraction of `base` — .ptitle's own CSS floor is
  // already just 9px (see style.css), so 60% of THAT collapsed to ~5px,
  // unreadable. 7px is the real "still legible at a glance" floor this app
  // uses elsewhere (see .btag's own font floor) regardless of
  // which element's base size started the shrink.
  const floor=Math.min(base,7);
  let size=base,guard=0;
  // Checks height as well as width — .pname stays single-line (nowrap), so
  // only ever overflows sideways, but .ptitle now wraps to 2 lines
  // (-webkit-line-clamp:2, see style.css), so a title too long even
  // wrapped overflows DOWN instead, which the old width-only check never
  // caught (it would report "fits" while line-clamp silently ellipsized a
  // still-oversized title). scrollHeight reflects the full unclamped
  // content height even though clientHeight is capped at 2 visual lines,
  // so this still shrinks it toward the floor first before falling back to
  // line-clamp's own ellipsis.
  const overflowing=()=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1;
  while(overflowing()&&size>floor&&guard<20){
    size-=1; el.style.fontSize=size+'px'; guard++;
  }
}

// Picks .ptitle's size per-title (see .one-line/.two-line in style.css):
// tries the bigger single-line size first, and only falls back to the
// smaller 2-line wrap (plus fitNameplateText's own shrink loop) if the
// title doesn't fit at that size on one line. Most titles in
// server/achievements.js are short enough to stay on .one-line — reserving
// the small size for every title, even one-word ones, would make them all
// pay for the few genuinely long titles.
function fitTitleText(el){
  if(!el) return;
  el.classList.remove('one-line','two-line');
  el.style.fontSize='';
  if(!el.textContent) return;
  el.classList.add('one-line');
  if(el.scrollWidth<=el.clientWidth+1) return;
  el.classList.remove('one-line');
  el.classList.add('two-line');
  fitNameplateText(el);
}

// Re-fits every currently-rendered nameplate's name+title (see
// fitNameplateText/fitTitleText above). Needed because startGame calls
// them exactly once, right when it sets each name/title — but 'Cinzel
// Decorative' (.ptitle's font, see style.css) is a webfont loaded via a
// Google Fonts <link>, and while it's still loading, WebKit/Chromium render
// the text with a near-zero-width fallback metric during the font-block
// period rather than the eventual real glyphs. A fit computed against THOSE
// bogus dimensions can under-shrink (or not shrink at all), and nothing
// re-checks it once the real font swaps in and the text re-flows wider —
// which is exactly the "long titles still get clipped" symptom despite
// fitNameplateText supposedly already handling it. document.fonts.ready
// (below) fires once every requested font has actually finished loading,
// so re-running the fit then closes that gap.
function refitAllNameplates(){
  for(const id of ['b','t','l','r']){
    fitNameplateText($('pn'+id));
    fitTitleText($('pt'+id));
  }
}
if(document.fonts&&document.fonts.ready) document.fonts.ready.then(refitAllNameplates);

// Each discard zone (.dzb/.dzt/.dzl/.dzr) grows straight toward its own
// seat's nameplate as more tiles get discarded (6 per row) — on a narrow
// screen a deep pile (4+ rows, i.e. 24+ discards from one seat — happens
// when a hand runs long with several kans) reaches far enough to visually
// sit UNDER the nameplate (.np's z-index:20 beats the discard zone's own
// auto stacking), hiding those tiles rather than just crowding them. Rather
// than touch the shared 26%-of-felt anchor every discard zone/the round-info
// panel are positioned off of (risking the whole felt's balance for a rare
// edge case), this only ever engages once an actual overlap is detected,
// scaling the WHOLE pile down toward its own anchor corner (transform-
// origin:left top — already set in CSS for dzt/dzl/dzr, a no-op for dzb
// which has no rotation) so it shrinks in place rather than sliding.
// ROT mirrors each dz's own base CSS transform (style.css) — inline
// transform overrides the CSS one entirely, so this has to restate it (a
// scale() appended on top) rather than layer on top of it.
const DZ_ROTATION={b:'',t:'rotate(180deg)',l:'rotate(90deg)',r:'rotate(-90deg)'};
function fitDiscardZone(dz,id){
  const base=DZ_ROTATION[id]||'';
  dz.style.transform=base; // reset before measuring — a PRIOR render may have scaled this down, which would corrupt this render's measurement if left in place
  const npWrap=document.querySelector('.np-wrap-'+id);
  if(!npWrap) return;
  const overlaps=()=>{
    const a=dz.getBoundingClientRect(),b=npWrap.getBoundingClientRect();
    return !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);
  };
  if(!overlaps()) return;
  let scale=1,guard=0;
  while(scale>0.5&&guard<20&&overlaps()){
    scale-=0.05;
    dz.style.transform=`${base} scale(${scale})`.trim();
    guard++;
  }
}

// Roll-call card introducing every seated player. Fired once the game has
// actually finished loading (the first real game_state has arrived and been
// rendered — see the game_state branch in onMsg, which calls this right
// after renderState) rather than at game_start itself, so the card never
// covers a "still dealing" board — the table underneath is already fully
// dealt, just hidden behind this card's opaque scrim until it clears.
// Reuses roundStartBanner's own gate (roundStartBannerActive/
// pendingBannerGameState, checked in onMsg) rather than a parallel one —
// both need the identical "hold further game_state until this card clears"
// behavior, just for a different card.
// Rows clone .up-nameplate/.pnp-* — the same icon+name+title plate as the
// User Profile hub header and the Rankings player-card modal (see
// #userprofile-modal in index.html and renderPlayerCard above) — rather
// than the in-game .np nameplate, so this introduces each player by their
// actual profile identity, not their at-the-table plate. Self's tier class
// (bronze/silver/gold/.../diamond — see nameplateTierClass) is copied
// straight off the User Profile hub's own element since that's already
// kept current all session (updateNameplateTier); opponents/bots have no
// tier available synchronously here (that needs a get_player_stats
// round-trip — see openPlayerCardInGame), so they render at the plain
// default (bronze) look.
function gameStartIntro(m){
  const layer=$('gs-layer'); if(!layer) return;
  layer.innerHTML='';
  // Cancel any chime still queued from an interrupted previous call (see
  // clearActiveBanners, which clears this same array on an early leave) —
  // defensive, since gameStartIntro only ever fires once per game in
  // practice, but a queued playNameplateSfx() firing into a NEW roll call
  // would otherwise land on the wrong row's timing.
  gsChimeTimers.forEach(clearTimeout); gsChimeTimers.length=0;
  const scrim=document.createElement('div');scrim.className='gs-scrim';
  const plate=document.createElement('div');plate.className='gs-plate';
  const title=document.createElement('div');title.className='gs-title';title.textContent='対局開始';
  const rows=document.createElement('div');rows.className='gs-rows';
  const windLabels=['東','南','西','北'];
  const dealer=m.dealer??0;
  const seats=m.seats||[];
  const seatCount=m.numPlayers||4;
  const isSelfGuest=$('iname').value==='Guest';
  const selfTierEl=document.querySelector('#userprofile-modal .up-nameplate');
  const selfTierCls=selfTierEl&&['tier-silver','tier-gold','tier-platinum','tier-diamond'].find(c=>selfTierEl.classList.contains(c));
  for(let i=0;i<seatCount;i++){
    const abs=(mySeat+i)%seatCount, p=seats[abs], isMe=i===0;
    const row=document.createElement('div');
    row.className='gs-row';
    const delayMs=300+i*180;
    row.style.animationDelay=(delayMs/1000)+'s';
    gsChimeTimers.push(setTimeout(playNameplateSfx,delayMs)); // lines the chime up with this row's own fade-in
    const wind=document.createElement('div');wind.className='gs-wind';
    wind.textContent=windLabels[(abs-dealer+seatCount)%seatCount];
    const np=document.createElement('div');
    // Self reads its tier off the User Profile hub's own live element (same
    // as before); opponents/bots now get theirs from m.seats[abs].wins —
    // added server-side (see _seatInfo in room.js) specifically so this no
    // longer has to fall back to the plain bronze default for everyone but
    // the local player.
    const tierCls=isMe?selfTierCls:nameplateTierClass(p?.wins||0);
    np.className='up-nameplate'+(tierCls?' '+tierCls:'');
    const icon=document.createElement('span');icon.className='pnp-icon';
    icon.innerHTML=isMe?(isSelfGuest?guestIconSvg:iconSvg(currentPlayerIcon)):iconSvg(p?.icon||'default');
    const info=document.createElement('span');info.className='pnp-info';
    const pname=document.createElement('span');pname.className='pnp-name';
    pname.textContent=isMe?($('iname').value.trim()||'Player'):(p?.name||'—');
    const ptitle=document.createElement('span');ptitle.className='pnp-title';
    ptitle.textContent=isMe?(isSelfGuest?'':currentPlayerTitle):(p?.isBot?'CPU':(p?.title||''));
    info.appendChild(pname);info.appendChild(ptitle);
    np.appendChild(icon);np.appendChild(info);
    row.appendChild(wind);row.appendChild(np);
    rows.appendChild(row);
  }
  plate.appendChild(title);plate.appendChild(rows);
  layer.appendChild(scrim);layer.appendChild(plate);
  layer.classList.add('blocking');
  roundStartBannerActive=true;
  setTimeout(()=>{
    scrim.remove();plate.remove();layer.classList.remove('blocking');
    roundStartBannerActive=false;
    // Game music starts right as the card clears, not back in startGame —
    // see that function's own comment. Guarded on inGame since this timer
    // isn't cancelled by an early leave (see clearActiveBanners, which only
    // cancels the per-row chime timers) — without the guard, leaving during
    // the roll call would still have this fire 5s later and cut in over
    // whatever's playing on the lobby screen by then.
    if(inGame) playGameMusic();
    if(pendingBannerGameState){
      const st=pendingBannerGameState; pendingBannerGameState=null;
      const prev=lastState; lastState=st; discarding=false; renderState(st,prev);
    }
  },5000);
}

// GAME START
function startGame(m){
  stopLobbyMusic();
  // Game music itself is deferred to gameStartIntro()'s own completion —
  // starting it here would have it playing underneath the "配牌中" loading
  // screen and the whole roll call, instead of kicking in once the card
  // actually clears.
  inGame=true;selId=null;lastState=null;
  clearTimeout(betweenRoundsTimer); // stale re-arm from the prior game's last round_end
  pendingCoinReward=null; $('coin-reward').textContent=''; // any unrendered payout belongs to the finished game
  // A stuck `discarding=true` from the PREVIOUS game (see sendDiscardAction
  // — the watchdog there recovers within 4s on its own, but this closes the
  // gap for the one path that skips it entirely: hostStartPlayAgain/
  // playAgain restarting the SAME room straight into a fresh game_start,
  // with no resetLobby() round-trip to have already cleared it — see the
  // "no lobby round-trip" comment further down) would otherwise carry
  // straight into the new game and block discarding from turn one.
  discarding=false; pendingDiscardTileId=null; discardRetryArmed=false; suppressDiscardSfxOnce=false; clearTimeout(discardWatchdog);
  declareWarningShown=false; // chonbo's declare-confirm message shows once per game, not once per browser session
  // Restore Ready button visibility for new game
  const btn=$('bround-ready'); if(btn){ btn.style.display=''; btn.disabled=false; btn.textContent='✓ Ready'; btn.style.opacity='1'; }
  const menuBtn=$('bend-menu'); if(menuBtn) menuBtn.style.display='none';
  const vrBtn=$('bview-results'); if(vrBtn) vrBtn.style.display='none';
  pendingGameOver=null;
  const status=$('ready-status'); if(status) status.textContent='';
  // Play Again panel — reachable here via hostStartPlayAgain restarting
  // the SAME room straight into a fresh game_start (no lobby round-trip),
  // so it needs resetting same as the buttons above.
  const paBtn=$('bplay-again'); if(paBtn){ paBtn.style.display='none'; paBtn.disabled=false; paBtn.textContent='↻ Play Again'; }
  const startBtn=$('bplay-again-start'); if(startBtn){ startBtn.style.display='none'; startBtn.disabled=true; }
  const paStatus=$('play-again-status'); if(paStatus) paStatus.textContent='';
  playAgainSeats=[]; lastGameOverNames=null;
  // numSeats/P are fixed for the whole game — set once here from
  // game_start's numPlayers (3=sanma, 4=yonma default).
  numSeats=m.numPlayers||4;
  P=numSeats===3?['b','r','l']:['b','r','t','l'];
  document.querySelector('.table')?.classList.toggle('sanma',numSeats===3);
  // Consumed by onMsg's game_state handler the moment the game has actually
  // finished loading (first real state rendered) — see gameStartIntro's own
  // comment on why the roll call waits for that instead of firing here.
  // A cold resume (full reload back into a game in progress) skips the
  // dealing animation / roll-call intro entirely — the board is rebuilt
  // directly from the game_state that follows. (A warm resume never gets
  // here — the server sends only game_state for those.)
  if(!m.resumed) pendingGameStartIntro=m;
  const seats=m.seats;
  inGameSeatInfo={};
  for(let i=0;i<numSeats;i++){
    const abs=(mySeat+i)%numSeats,id=P[i],p=seats[abs];
    const selfName=$('iname').value.trim()||'Player';
    const pn=$('pn'+id); pn.textContent=i===0?selfName:(p?.name||'—');
    fitNameplateText(pn);
    // Defensive reset, not load-bearing — room.js's typing()/
    // TYPING_TIMEOUT_MS always pairs a typing:true with a later
    // typing:false once it clears, but this guards against a leftover
    // .typing-dots surviving a reconnect/edge case where that pairing
    // broke, onto a nameplate DOM node that's reused game to game rather
    // than recreated.
    $('np'+id)?.querySelector('.typing-dots')?.remove();
    // Stashed for openPlayerCardInGame (nameplate click) — self is never a
    // bot, and always has a name (falls back to 'Player' same as the
    // nameplate text itself above); an opponent seat can be null (empty
    // seat) mid-game in theory, hence the p?.name guard leaving it
    // undefined rather than the literal '—' placeholder shown on-screen.
    inGameSeatInfo[id]=i===0?{name:selfName,isBot:false}:{name:p?.name,isBot:!!p?.isBot,friendId:p?.friendId||null};
    // Title under the name — self shows currentPlayerTitle (kept live by
    // applyPlayerTitle, so this never goes stale even if changed moments
    // before starting) UNLESS playing as Guest, who has no profile to hold
    // a title at all — same isGuest check refreshProfileDisplay uses for
    // the lobby nameplate, otherwise a stale title left over in
    // localStorage from a previous real profile would show under "Guest"
    // in-game even though the server never sent one for this seat (see
    // assignIdentity in server/index.js, which sets title:null for guests).
    // Opponents show whatever the server sent for their seat (see title in
    // room.js's _seatInfo — blank for guests/bots, which have no profile
    // to hold one).
    const isSelfGuest=$('iname').value==='Guest';
    const pt=$('pt'+id); if(pt){ pt.textContent=i===0?(isSelfGuest?'':currentPlayerTitle):(p?.title||''); fitTitleText(pt); }
    if(i>0){const bt=$('bt'+id);if(bt)bt.textContent=p?.isBot?'CPU':'';}
    $('rs'+id).style.display='none';
  }
  // The fitNameplateText/fitTitleText calls above just measured against
  // whatever font is ACTIVE right now — on the very first game after a
  // fresh page load, 'Cinzel Decorative'/'Noto Sans JP' (see the <link> in
  // index.html) can still be mid-download, so that measurement runs against
  // the browser's temporary fallback-font metrics rather than the real
  // glyphs. If a title's one-line-vs-two-line fit decision was made against
  // those bogus (usually narrower) metrics, it can wrongly pick .one-line,
  // which then visibly overflows once the real, wider font swaps in a
  // moment later — read as "shows clipped, then fixes itself" rather than
  // being wrong forever, since nothing re-checks it once the swap happens.
  // refitAllNameplates (below document.fonts.ready's OTHER, page-load-time
  // subscription) closes that gap once, globally, the very first time fonts
  // finish — which only helps if this is that first game. Re-subscribing
  // here too means every game start gets its own correction once fonts are
  // actually ready, not just the first one; a no-op extra re-fit (already
  // fonts.ready by now, as is true for every game after the first) costs
  // nothing.
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(refitAllNameplates);
  // Clear board (same as onRoundStart) — clears all 4 positions unconditionally
  // even in sanma (the 'top' ones are simply hidden via CSS, but stay clean
  // in case the tab later starts a 4-player game).
  ['hdb','hdt','hdl','hdr','mlb','mlt','mll','mlr'].forEach(id=>{const el=$(id);if(el)el.innerHTML='';});
  ['dzb','dzt','dzl','dzr'].forEach(id=>{const el=$(id);if(el)el.innerHTML='';});
  // Clear leftover kita (pei-nuki) tiles from a previous sanma game — renderState()
  // only repopulates these when m.sanma is true, so a stale sanma game's banked
  // North tiles would otherwise stay on screen through a subsequent yonma game.
  ['kb','kt','kl','kr'].forEach(id=>{const el=$(id);if(el)el.innerHTML='';});
  // Action bar (Tsumo/Riichi/discard/pon/chi/kan buttons) and any open
  // chi/riichi/ankan/declare picker are otherwise left showing whatever the
  // PREVIOUS game's last turn put up — drawActions() (called from
  // renderState) is the only thing that normally clears/rebuilds them, and
  // that doesn't run until this new game's first game_state arrives, well
  // after this loading screen/roll call are already on screen. Same
  // stale-picker cleanup drawActions() itself does, since those are
  // appended to document.body rather than inside #actbar.
  const bar=$('actbar'); if(bar){bar.innerHTML='';bar.classList.remove('visible');}
  ['chi-picker','riichi-picker','ankan-picker','declare-picker'].forEach(id=>{const el=$(id);if(el)el.remove();});
  // Set seat winds based on dealer
  const windLabels=['東','南','西','北'];
  const dealer=m.dealer??0;
  for(let i=0;i<numSeats;i++){
    const abs=(mySeat+i)%numSeats, id=P[i];
    const wb=$('wb'+id);
    if(wb) wb.textContent=windLabels[(abs-dealer+numSeats)%numSeats];
  }
  // Paint starting scores immediately from game_start's own scores (all
  // equal — 25000 yonma / 35000 sanma, see room.js's start()) rather than
  // leaving the centre panel blank until the first game_state arrives —
  // that's delayed a couple seconds server-side (see the setTimeout in
  // room.js's start()) for the round-start banner/dealing animation, so
  // without this the points display visibly lagged the rest of the loading
  // screen by those same couple seconds.
  const ctrIds={b:'ctr-s-b',r:'ctr-s-r',t:'ctr-s-t',l:'ctr-s-l'};
  if(m.scores){
    for(let i=0;i<numSeats;i++){
      const abs=(mySeat+i)%numSeats,id=P[i];
      const ctrEl=$(ctrIds[id]);
      if(ctrEl&&m.scores[abs]!==undefined) ctrEl.textContent=m.scores[abs];
    }
  }
  // Show game mode in topbar
  const modeLabel=m.gameMode==='hanchan'?'半荘戦':'東風戦';
  $('tb-mode').textContent=modeLabel;
  $('chat-bar').style.display='flex'; chatOpen=false; unreadCount=0; $('chat-history').innerHTML='';
  // Clear dora panel — same as onRoundStart. Without this, starting a new
  // game (Main Menu -> Find Match again in the same tab) shows the PREVIOUS
  // game's dora tiles during this loading screen, since this is the only
  // path into a round that never went through onRoundStart's own clear.
  // Riichi-stick/honba counts need the same treatment — they're only ever
  // written from real game_state data (renderState), never reset here or
  // in onRoundStart, so a leftover "2 Honba" from the previous game would
  // otherwise sit there until this new game's first game_state arrives.
  const doraPanel=$('dora-panel');
  if(doraPanel) doraPanel.querySelectorAll('.dora-slot').forEach(s=>{s.innerHTML='';s.className='dora-slot';});
  const riichiCountEl0=$('stick-riichi-count'); if(riichiCountEl0) riichiCountEl0.textContent='0';
  const honbaCountEl0=$('stick-honba-count'); if(honbaCountEl0) honbaCountEl0.textContent='0';
  $('dora-panel').style.display='flex';
  // Same stale-leftover problem as the dora/riichi/honba reset above, for
  // the center wind/round readout (#cw-wind/#cw-kyoku) — only ever written
  // by renderState (game_state) and onRoundStart (round_start), neither of
  // which fires until after this loading screen, so without this a
  // multi-round previous game's last "東2局" would sit there, visible
  // through/around the loading overlay, until the new game's first
  // game_state quietly swaps it out.
  $('cw-wind').textContent='—';
  $('cw-kyoku').textContent='';
  show('s-game');
  // Show loading overlay until first game_state arrives — except on a cold
  // resume, where that state is already on its way; also clears any stale
  // deal overlay that was frozen on screen when the tab was suspended.
  $('game-loading').style.display=m.resumed?'none':'flex';
}

// Absolute seat -> screen position id ('b'/'r'/'t'/'l'). The inverse of the
// `abs=(mySeat+i)%numSeats` pattern used everywhere else — use this one when
// you have an absolute seat number and need to know where on screen it lives.
function pid(abs){return P[(abs-mySeat+numSeats)%numSeats];}

// Shows/hides the chat "is typing…" indicator on a seat's nameplate —
// 3 real dot spans (.typing-dots, see style.css's own comment on why a
// single CSS `content` string can't bounce each dot independently),
// created/removed on demand rather than living permanently in index.html's
// markup for all 4 seats, same "no extra DOM per seat unless actually
// needed" reasoning .status-dot's own comment gives for why only bottom's
// markup has one. Server sends an absolute seat index (same convention as
// every other in-game broadcast — see pid() above).
function onTypingStatus(m){
  const np=$('np'+pid(m.seat));
  if(!np) return;
  const existing=np.querySelector('.typing-dots');
  if(m.typing){
    if(existing) return; // already showing — nothing to do
    const dots=document.createElement('span');
    dots.className='typing-dots';
    dots.innerHTML='<span></span><span></span><span></span>';
    np.appendChild(dots);
  }else if(existing){
    existing.remove();
  }
}

// A real human actually left the room (see removeHuman in room.js — fires
// once, right when their seat gets swapped over to a bot) — surfaced as a
// plain toast rather than a persistent nameplate badge, since unlike
// typing this isn't a live state to keep displaying: the moment matters,
// not an ongoing status (the seat just permanently reads as CPU from here
// on, via the existing .btag bot tag — see startGame).
function onPlayerLeft(m){
  toast(`${m.name} left the room`);
}


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
  const riichiCountEl=$('stick-riichi-count'); if(riichiCountEl) riichiCountEl.textContent=rs;
  const honbaCountEl=$('stick-honba-count'); if(honbaCountEl) honbaCountEl.textContent=h;

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

  // Scores in centre panel (compass layout: b=bottom=me, t=top, l=left, r=right)
  // P = ['b','r','t','l'] (or ['b','r','l'] in sanma), indexed by (abs - mySeat + numSeats) % numSeats
  const ctrIds={b:'ctr-s-b',r:'ctr-s-r',t:'ctr-s-t',l:'ctr-s-l'};
  const windLabels=['東','南','西','北'];
  for(let i=0;i<numSeats;i++){
    const abs=(mySeat+i)%numSeats,id=P[i];
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
    // Auto-select draw tile when in riichi — also sets selId (not just the
    // CSS class) so the DISCARD button is immediately available without an
    // extra tap, which matters once chonbo disables the auto-discard timer
    // below and a manual discard becomes the only way to pass.
    if(m.riichi?.[mySeat]){ el.classList.add('sel'); selId=drawTile.id; }
    hc.appendChild(el);
    // Auto-discard after riichi — unless tsumo/ankan/kyuushu/kita is
    // available. canKita is included since it's still legal mid-riichi
    // (see _kita's comment in room.js) — without this check, drawing a
    // North tile while in riichi would get auto-discarded before the
    // player ever saw the KITA button, silently forfeiting a free han.
    // Also skipped whenever canAttemptTsumo is set (chonbo only): with
    // chonbo on, the server never confirms whether this draw is actually a
    // win (canTsumo alone can't be used to gate this — see the tsumo/ron
    // hint removal elsewhere), so if this timer kept auto-discarding every
    // *non*-winning draw while only holding off on the winning one, the
    // presence/absence of the auto-discard itself would silently tell the
    // player which draw won — exactly the hint chonbo is meant to remove.
    // Skipping it unconditionally under chonbo means the player must
    // always manually choose Declare vs. Discard, so timing reveals nothing.
    if(m.riichi?.[mySeat] && !m.canTsumo && !m.canAttemptTsumo && !(m.canAnkan?.length) && !m.canKyuushu && !(m.canKita?.length)){
      setTimeout(()=>{
        // Same one-shot `discarding` latch clickTile/the DISCARD button use
        // (see clickTile's comment) — without it, a manual tap landing in
        // this same 600ms window wasn't blocked at all (this timer never
        // set the flag), so it could fire its own extra 'discard' for
        // whatever tile happened to be selected at that moment.
        if(lastState===m && !discarding){ sendDiscardAction(drawTile.id); }
      }, 600);
    }
  }

  // Keep the magnifier (if open) showing the same hand/selection as the
  // compact row above — a new game_state (a draw, an opponent's discard,
  // riichi's auto-select) would otherwise leave it showing a stale hand
  // until the player closes and reopens it.
  if($('magnify-overlay')?.classList.contains('visible')) renderMagnifyHand();

  // Opponent hands — back tiles
  // top: rot180. left/right: now column-layout rotated in CSS, tiles horizontal
  // (sanma has no 'top'/toimen opponent — P.slice(1) is just ['r','l'] there)
  P.slice(1).map((id,idx)=>[idx+1,id]).forEach(([i,id])=>{
    const abs=(mySeat+i)%numSeats;
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
  // suppressDiscardSfxOnce: optimisticDiscard already played the click for
  // the player's own just-sent discard — don't play it a second time when
  // that discard's authoritative game_state lands.
  if(newDiscardCount>prevDiscardCount){
    if(suppressDiscardSfxOnce) suppressDiscardSfxOnce=false;
    else playDiscardSfx();
  } else if(suppressDiscardSfxOnce){
    suppressDiscardSfxOnce=false; // discard was a no-op/rejected — release the guard
  }

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

  // Kita (sanma only) — one seat's banked-tile count went up
  if(m.sanma&&m.kita){
    const prevKitaTotal=(prev?.kita||[]).reduce((n,arr)=>n+(arr?.length||0),0);
    const newKitaTotal=m.kita.reduce((n,arr)=>n+(arr?.length||0),0);
    if(newKitaTotal>prevKitaTotal){
      const seat=m.kita.findIndex((arr,i)=>(arr?.length||0)>(prev?.kita?.[i]?.length||0));
      playSfx('sfx-kita',seat>=0?seat:null);
    }
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
  for(let i=0;i<numSeats;i++){
    const abs=(mySeat+i)%numSeats,id=P[i];
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
    fitDiscardZone(dz,id);
  }

  // My melds (bottom) — anchor bottom-right, first meld rightmost, grows leftward
  const ml=$('mlb');ml.innerHTML='';
  for(const meld of(m.myMelds||[])){
    const g=document.createElement('div');g.className='mg';
    renderMeld(g, meld, mySeat);
    ml.prepend(g);
  }
  // Opponent melds
  P.slice(1).map((id,idx)=>[idx+1,id]).forEach(([i,id])=>{
    const abs=(mySeat+i)%numSeats;
    const ml2=$('ml'+id);
    if(!ml2) return;
    ml2.innerHTML='';
    const melds=m.melds?.[abs]||[];
    for(const meld of melds){
      const g=document.createElement('div');g.className='mg';
      // No extra flip needed here — renderMeld's dir is computed against
      // the meld owner's own kamicha/shimocha regardless of which screen
      // position they're rendered at, and each opponent container's CSS
      // rotation (.ml-t 180°, .ml-l 90°, .ml-r -90°) already carries that
      // row to the correct on-screen position on its own (see renderMeld).
      renderMeld(g, meld, abs);
      if(id==='t') ml2.prepend(g); // top: anchor top-left, first meld leftmost, grows right
      else if(id==='l') ml2.prepend(g); // left: anchor bottom-left, first meld at bottom, grows up
      else ml2.prepend(g);          // right: anchor top-right, first meld at top, grows down
    }
  });

  // Kita (sanma only) — banked North tiles, shown face-up in their own
  // strip (.kita-strip, id 'k'+seat) in line with that seat's nameplate
  // rather than mixed into the meld row, since kita tiles aren't melds —
  // they don't affect hand shape/fu and mixing them in made the meld row
  // harder to read at a glance.
  if(m.sanma&&m.kita){
    for(let i=0;i<numSeats;i++){
      const abs=(mySeat+i)%numSeats,id=P[i];
      const kEl=$('k'+id); if(!kEl) continue;
      kEl.innerHTML='';
      for(const t of(m.kita[abs]||[])){
        const g=document.createElement('div');g.className='mg';
        g.appendChild(mkElMd(t));
        kEl.appendChild(g);
      }
    }
  }

  // With rules.chonbo on, these hints would defeat the point of the rule —
  // furiten in particular would tell the player in advance that a ron
  // attempt is unsafe, removing the actual risk the rule exists to
  // introduce. Suppressed outright rather than left accurate, since
  // chonbo is meant to make the player track their own hand the way a
  // real physical game would require.
  // Furiten in this ruleset only ever happens WHILE tenpai (see
  // .status-dot's own comment in style.css) — checked first so it takes
  // priority over the plain tenpai state rather than the two competing.
  // Riichi still suppresses the plain-tenpai case (redundant once you're
  // locked into a declared wait) but NOT furiten — that's still critical
  // to know mid-riichi, same as the old furiten-badge never suppressed it.
  const dot=$('statusdot-b');
  if(!m.chonbo&&m.furiten) dot.className='status-dot furiten';
  else if(!m.chonbo&&m.waits?.length>0&&!m.riichi?.[mySeat]) dot.className='status-dot tenpai';
  else dot.className='status-dot';
  drawActions(m);
}

// Pending recovery timer for the LAST discard sent — see sendDiscardAction.
let discardWatchdog=null;
// The tile id of a discard that's been sent but not yet confirmed by a
// game_state. Kept so it can be re-sent once after a reconnect if the
// original send fell into a dead socket (see the game_state handler in
// onMsg). discardRetryArmed gates that re-send to exactly once per drop.
let pendingDiscardTileId=null, discardRetryArmed=false;
// Set by optimisticDiscard so renderState's own "discard count went up →
// play the click" doesn't double up with the one optimisticDiscard already
// played for this same tile.
let suppressDiscardSfxOnce=false;

// Immediately reflect the player's own discard on the board — pull the tile
// out of the hand, drop it into their river, clear the action bar, play the
// click — WITHOUT waiting for the server's game_state to echo back. On a
// slow/degraded mobile connection that round trip could be seconds; the
// authoritative game_state still arrives and renderState rebuilds
// everything from scratch, so this is purely a "feels instant" layer that
// gets reconciled (or rolled back, if the discard is lost — see the
// watchdog) the moment real data lands.
function optimisticDiscard(tileId){
  if(!lastState) return;
  const hc=$('hdb'); if(!hc) return;
  const el=[...hc.querySelectorAll('.tlg')].find(e=>parseInt(e.dataset.tid)===tileId);
  const tileObj=(lastState.myHand||[]).find(t=>t.id===tileId)
    ||(lastState.drawTile&&lastState.drawTile.id===tileId?lastState.drawTile:null);
  if(!el||!tileObj) return;
  el.remove();
  hc.querySelector('.draw-sep')?.remove();
  // Stop the rest of the hand looking playable until the real state lands.
  hc.querySelectorAll('.tlg').forEach(e=>{ e.classList.remove('play','sel'); e.onclick=null; });
  selId=null;
  // Drop it into my own river, mirroring renderState's 6-per-row layout.
  const dz=$('dzb');
  if(dz){
    const count=(lastState.discards&&lastState.discards[mySeat]||[]).length;
    let row=dz.lastElementChild;
    if(!row||count%6===0){ row=document.createElement('div'); row.className='dz-row'; dz.appendChild(row); }
    row.appendChild(mkElMd(tileObj));
  }
  const bar=$('actbar'); if(bar){ bar.innerHTML=''; bar.classList.remove('visible'); }
  ['chi-picker','riichi-picker','ankan-picker','declare-picker'].forEach(id=>$(id)?.remove());
  $('npb')?.classList.remove('active');
  const si=$('tst'); if(si) si.className='tb-st';
  if(discardSfxEnabled){ playDiscardSfx(); suppressDiscardSfxOnce=true; }
}

// Sends a discard action, renders it optimistically, and arms a recovery
// timer. Normally the resulting game_state resets `discarding` (see its
// reset sites in onMsg/gameStartIntro/roundStartBanner) — but room.js's
// _discard() silently no-ops with NO reply at all if this tileId's already
// gone from the hand, or _handleAction ignores the whole action if it's no
// longer actually this seat's turn (see myTurnOpen there) — either can
// happen to a stale click, and on mobile the send can also vanish into a
// half-dead socket that still reports OPEN. Without this timer that left
// `discarding` stuck true forever, permanently locking the player out of
// discarding. 4s is comfortably longer than a normal round trip (incl. the
// reaction-window case — _sendState() fires immediately either way), so it
// never trips during ordinary play.
function sendDiscardAction(tileId){
  const live=!!(ws&&ws.readyState===1);
  wss({type:'action',action:{type:'discard',tileId}});
  optimisticDiscard(tileId);
  discarding=true;
  pendingDiscardTileId=tileId;
  clearTimeout(discardWatchdog);
  discardWatchdog=setTimeout(()=>{
    if(!discarding) return;
    discarding=false;
    // No confirmation — roll the optimistic discard back from the last
    // authoritative state, and if the socket looks wedged rebuild it
    // (resume re-syncs; the pending discard is re-sent once we're back).
    if(lastState) renderState(lastState,lastState);
    if(!ws||ws.readyState!==1){ discardRetryArmed=pendingDiscardTileId!=null; reconnectNow(); }
    else { pendingDiscardTileId=null; discardRetryArmed=false; } // stale click, socket fine — just drop it
  },4000);
  // Socket already down when we tried to send — don't sit on it for 4s.
  if(!live){ discardRetryArmed=true; reconnectNow(); }
}

// Tap-to-select, tap-again-to-discard: first click on a tile just selects
// it (highlights + shows available action buttons for that selection);
// clicking the SAME tile again is what actually sends the discard. `discarding`
// is a one-shot latch to swallow extra clicks between sending the action and
// the next game_state confirming it, so a slow network can't double-discard.
function clickTile(id){
  if(discarding) return;
  if(selId===id){
    sendDiscardAction(id);
    selId=null;
  } else {
    selId=id;
    $('hdb').querySelectorAll('.tlg').forEach(el=>{
      el.classList.toggle('sel',parseInt(el.dataset.tid)===id);
    });
    drawActions(lastState);
  }
}

// ── Magnifier ────────────────────────────────────────────────────────────────
// A full-screen, dimmed-backdrop view of the player's own hand at a much
// larger tile size — for reading fine detail (a red 5's dot, a 6 vs 8 pin
// pattern) that the compact in-table hand row is too small for on a
// crowded board. Same tap-to-select/tap-again-to-discard interaction as
// the compact row (both ultimately call clickTile — this isn't a separate
// discard path, just a bigger view onto the same one), so selecting here
// stays in sync with the compact row and vice versa.
// 1 = every tile in a single row spanning the table's full width (壱),
// 2 = split evenly into two rows instead (弐) — see setMagnifyRows below.
// Persists across opens within the session (not saved/synced anywhere),
// same as any other pure display preference.
let magnifyRows=1;
function setMagnifyRows(n){
  magnifyRows=n;
  $('magnify-mode-1').classList.toggle('active',n===1);
  $('magnify-mode-2').classList.toggle('active',n===2);
  renderMagnifyHand();
}
// Pan-out/zoom-in open, matching zoom-back-in close — the enlarged hand
// visually grows out of (and shrinks back into) wherever the compact hand
// row (#hdb) currently sits, rather than just appearing/disappearing.
// Implemented as a single transform+opacity transition on #magnify-content
// (computed fresh each time from the two elements' actual
// getBoundingClientRect()s, not a canned animation), since the compact
// row's on-screen position varies by seat layout/window size and the
// enlarged content's own size varies by tile count and row mode.
const MAGNIFY_ANIM_MS=280;
// Transform that would shrink #magnify-content down onto #hdb's current
// footprint — shared by both open (animate FROM this) and close (animate
// TO this) so the two directions are exact mirrors of each other.
function _magnifyShrinkTransform(content){
  const src=$('hdb');
  if(!src) return 'scale(0.4)';
  const srcRect=src.getBoundingClientRect();
  const dstRect=content.getBoundingClientRect();
  if(!srcRect.width||!dstRect.width) return 'scale(0.4)';
  const scale=Math.min(1,srcRect.width/dstRect.width,srcRect.height/dstRect.height);
  const dx=(srcRect.left+srcRect.width/2)-(dstRect.left+dstRect.width/2);
  const dy=(srcRect.top+srcRect.height/2)-(dstRect.top+dstRect.height/2);
  return `translate(${dx}px,${dy}px) scale(${scale})`;
}
function openMagnify(){
  if(!inGame||!lastState) return;
  const overlay=$('magnify-overlay'),content=$('magnify-content');
  renderMagnifyHand();
  overlay.style.display='flex';
  overlay.classList.add('visible');
  overlay.style.transition='none';overlay.style.opacity='0';
  content.style.transition='none';
  // Clear any shrink transform left over from a previous close BEFORE
  // measuring — _magnifyShrinkTransform reads content's current
  // getBoundingClientRect(), which would otherwise still reflect that old
  // transform's shrunk physical size rather than the content's true
  // natural size, corrupting every scale/offset computed from it.
  content.style.transform='none';
  content.style.opacity='1';
  void content.offsetHeight;
  content.style.transform=_magnifyShrinkTransform(content);
  content.style.opacity='0';
  void content.offsetHeight; // force the above starting state to apply before animating away from it
  overlay.style.transition=`opacity ${MAGNIFY_ANIM_MS}ms ease`;
  content.style.transition=`transform ${MAGNIFY_ANIM_MS}ms cubic-bezier(.2,.8,.2,1),opacity ${MAGNIFY_ANIM_MS}ms ease`;
  requestAnimationFrame(()=>{
    overlay.style.opacity='1';
    content.style.transform='translate(0,0) scale(1)';
    content.style.opacity='1';
  });
}
function closeMagnify(){
  const overlay=$('magnify-overlay'),content=$('magnify-content');
  if(!overlay.classList.contains('visible')) return;
  overlay.classList.remove('visible');
  overlay.style.transition=`opacity ${MAGNIFY_ANIM_MS}ms ease`;
  content.style.transition=`transform ${MAGNIFY_ANIM_MS}ms cubic-bezier(.4,0,.6,1),opacity ${MAGNIFY_ANIM_MS}ms ease`;
  overlay.style.opacity='0';
  content.style.transform=_magnifyShrinkTransform(content);
  content.style.opacity='0';
  setTimeout(()=>{ if(!overlay.classList.contains('visible')) overlay.style.display='none'; },MAGNIFY_ANIM_MS);
}
function renderMagnifyHand(){
  const m=lastState;
  const content=$('magnify-content');
  const hc=$('magnify-hand');
  if(!m||!hc) return;
  hc.innerHTML='';
  const mainHand=m.myHand||[];
  const drawTile=m.drawTile||null;
  const allTiles=[...mainHand,...(drawTile?[drawTile]:[])];
  if(!allTiles.length) return;
  // Only clickable-to-discard under the exact same conditions the compact
  // hand row uses (your turn, not mid-riichi where the draw auto-selects/
  // auto-discards instead) — otherwise this is a read-only zoomed view.
  const clickable=m.turn===mySeat && !m.riichi?.[mySeat];

  // "The whole width of the table" means the visible green felt (.felt) —
  // NOT .table, which is a full-viewport wrapper (left:0;right:0) that
  // .felt sits centered inside and is usually much NARROWER than on a
  // wide/landscape window (.felt is a square sized off the smaller of
  // vw/vh — see --felt-size). Sizing off .table was silently sizing off
  // the raw window instead, letting tiles span edge-to-edge past the
  // table's actual visible boundary (and, wide enough, past the window
  // itself). maxWidth is set on #magnify-content itself (a hard px cap,
  // not a vw guess) so the row genuinely cannot exceed the felt's own
  // footprint regardless of rounding below.
  const tableEl=document.querySelector('.felt');
  const tableWidth=tableEl?tableEl.clientWidth:window.innerWidth;
  if(content) content.style.maxWidth=tableWidth+'px';
  // Magnify exists mainly to make tiles more readable on a SMALL screen —
  // every px spent on margin/gap there is a px NOT going toward tile size,
  // and matters far more on a narrow phone felt than on a spacious desktop
  // one. sidePad/hGap tighten on a narrow felt (phone-width territory)
  // instead of using the same fixed breathing room everywhere.
  const isNarrow=tableWidth<480;
  const sidePad=isNarrow?6:16; // breathing room so tiles don't touch the felt's own edges
  // hGap (within a row, between tiles) — single source of truth, applied
  // as the ACTUAL gap below too so the budget math and the rendered gap
  // can never drift apart (a mismatch there is what pushed tiles past the
  // felt's edge before).
  const hGap=isNarrow?1:3;
  // vGap (between the two rows in 弐 mode) is deliberately much bigger —
  // a selected tile lifts via .tlg.sel's translateY(-1vmin), and with two
  // rows packed close together that lift can visually overlap the row
  // above it. Scaled off the viewport's own vmin (matching the CSS lift
  // exactly) plus a fixed margin, so the clearance stays enough on any
  // screen size rather than a flat px guess that's too small on a large
  // display where 1vmin itself is bigger.
  const vGap=Math.min(window.innerWidth,window.innerHeight)*0.01+10;
  const availWidth=Math.max(0,tableWidth-sidePad*2);

  const rows=magnifyRows===1
    ? [allTiles]
    : [allTiles.slice(0,Math.ceil(allTiles.length/2)),allTiles.slice(Math.ceil(allTiles.length/2))];
  // Both rows share one tile size (computed off the WIDER row) rather than
  // each row sizing independently — otherwise a 7/6 split in 弐 mode would
  // render two visibly different tile sizes, reading as a mistake rather
  // than a deliberate two-row layout.
  const widestRow=Math.max(...rows.map(r=>r.length));
  let tw=widestRow>0?Math.floor((availWidth-(widestRow-1)*hGap)/widestRow):48;
  // Capped above (raised from 150 — a tighter hGap already frees up more
  // room per tile, so the ceiling needed raising too or it'd just cap out
  // at the same size as before on tables with few tiles) so a handful of
  // tiles on a huge table don't balloon absurdly large, but deliberately
  // NOT floored below — a floor here was exactly what pushed tiles past
  // the table's edges on a narrow screen with many tiles (the fit-inside-
  // the-table budget above already gives the correct size; overriding it
  // upward with a minimum broke that guarantee). A crowded narrow screen
  // just gets small tiles instead.
  tw=Math.max(1,Math.min(tw,190));
  const th=Math.round(tw*1.4);

  hc.style.gap=vGap+'px';
  rows.forEach(rowTiles=>{
    if(!rowTiles.length) return;
    const rowEl=document.createElement('div');rowEl.className='magnify-row';rowEl.style.gap=hGap+'px';
    rowTiles.forEach(t=>{
      const el=mkEl(t,'tlg',tw,th);
      if(drawTile&&t.id===drawTile.id) el.classList.add('drw');
      if(clickable) el.classList.add('play');
      if(t.id===selId) el.classList.add('sel');
      el.dataset.tid=t.id;
      if(clickable) el.onclick=e=>{e.stopPropagation();magnifyTileClick(t.id);};
      rowEl.appendChild(el);
    });
    hc.appendChild(rowEl);
  });
}
function magnifyTileClick(id){
  const wasSelected=selId===id;
  clickTile(id);
  // A discard was just sent (clickTile's own guard already applied) —
  // close rather than leave the magnifier sitting over a hand that's
  // about to change underneath it once the server confirms.
  if(wasSelected) closeMagnify();
  else renderMagnifyHand();
}


// MELD RENDERING
// Draws chi/pon/kan groups with correct orientation per player. Real riichi
// tables sideways-rotate the called tile within the group to show which
// neighbor it was called from, in terms of the meld OWNER's own seat (as if
// sitting in their chair looking at their own hand) — dir 1=shimocha
// (their right) -> called tile at the END of the row, 2=toimen (across) ->
// MIDDLE, 3=kamicha (their left) -> START of the row. `viewerSeat` is the
// OWNER of the meld (not the person looking at the screen) — ankan has no
// `fromSeat` (self-declared) so it defaults to dir=1, though ankan's
// rendering below doesn't actually use dir since all 4 tiles are drawn
// face-down/symmetric anyway.
//
// This dir/row-order is computed once, independent of which screen
// position (bottom/right/top/left) the owner is actually rendered at — the
// CSS rotation each opponent's meld container carries (.ml-t 180°, .ml-l
// 90°, .ml-r -90°) is a pure rotation with no mirroring, so it already
// carries the owner's own left-to-right row to the correct on-screen
// position by itself. An earlier version of this code additionally
// swapped dir 1<->3 for every rotated container ("flipped"), on the theory
// that all three needed it — verified directly (rendering real melds at
// each position and measuring on-screen distance to the calling seat) that
// this swap is wrong for all three, not just some: it's what caused a
// sanma left-seat pon called from the bottom player to render with the
// sideways tile on the wrong end. Removed.
function renderMeld(container, meld, viewerSeat){
  const tiles = meld.tiles;
  const calledId = meld.calledTileId;
  const fromSeat = meld.fromSeat;
  // Determined explicitly against numSeats rather than via a flat
  // (fromSeat-viewerSeat+4)%4, which only worked by coincidence for a
  // 4-seat table. In sanma (numSeats=3) a kamicha call lands on the SAME
  // raw offset (2) that a 4-seat table uses for toimen — a position that
  // doesn't exist in sanma — so without this, a call from the left renders
  // with the "called from across" (middle) styling instead of "from the
  // left" (start). Sanma only ever has kamicha/shimocha (dir 1 or 3); dir
  // 2/toimen is only reachable at all when numSeats===4.
  let dir = 1;
  if(fromSeat !== undefined){
    const kamicha=(viewerSeat-1+numSeats)%numSeats, shimocha=(viewerSeat+1)%numSeats;
    if(fromSeat===shimocha) dir=1;
    else if(fromSeat===kamicha) dir=3;
    else dir=2;
  }
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
  const staleAnkan=$('ankan-picker'); if(staleAnkan) staleAnkan.remove();
  const staleDeclare=$('declare-picker'); if(staleDeclare) staleDeclare.remove();
  const staleRiichi=$('riichi-picker'); if(staleRiichi) staleRiichi.remove();
  if(!m) return;
  bar.className='act-overlay';
  const mine=m.turn===mySeat, react=m.pending?.isForMe;

  if(mine){
    // LEFT: TSUMO — the safe one-tap button only exists without chonbo;
    // with chonbo on, the server never confirms a win at all (see
    // canAttemptTsumo in room.js), so every tsumo goes through the manual
    // declare+confirm path below instead, valid or not.
    if(m.canTsumo&&!m.chonbo)
      ab(bar,'TSUMO','btsu',()=>act({type:'tsumo'}));
    // LEFT: chonbo-only "attempt" declare — deliberately NOT a normal
    // one-tap button (see showDeclareConfirm), since unlike canTsumo this
    // isn't actually confirmed valid; a stray tap here can end the hand
    // and cost real points, so it needs a second, explicit confirmation.
    else if(m.canAttemptTsumo)
      ab(bar,'⚠ Declare…','bchonbo',()=>showDeclareConfirm('tsumo'));

    // LEFT: ANKAN — a single candidate skips straight to a one-tap plain
    // button (the player's own hand already shows which tile it is, same
    // as TSUMO/RIICHI's one-tap buttons never showing a tile either); more
    // than one candidate (rare, but possible) opens the same tile-picker
    // overlay CHI/RIICHI use below instead of piling up several
    // identically-labeled buttons — that picker is where a tile face is
    // actually needed, to tell the candidates apart.
    const canAnkan=m.canAnkan||[];
    if(canAnkan.length===1){
      ab(bar,'ANKAN','bkan',()=>act({type:'ankan',tileKey:canAnkan[0]}));
    } else if(canAnkan.length>1){
      ab(bar,'ANKAN','bkan',()=>showAnkanPicker(canAnkan));
    }

    // LEFT: KAKAN — must show whenever canKakan is non-empty, same as
    // ANKAN above never depending on selId. The old version only rendered
    // when selId happened to already be a kakan candidate, or when nothing
    // else was selected at all — any OTHER tile being selected (e.g. just
    // idly tapped while looking at the hand) fell into neither branch and
    // silently hid the button even though kakan was legal, making it look
    // like kakan "randomly" stopped working depending on unrelated
    // selection state.
    const canKakan=m.canKakan||[];
    if(canKakan.length===1){
      ab(bar,'KAN','bkan',()=>act({type:'kakan',tileId:canKakan[0]}));
    } else if(canKakan.length>1){
      const tid=(selId!=null&&canKakan.includes(selId))?selId:canKakan[0];
      ab(bar,'KAN','bkan',()=>act({type:'kakan',tileId:tid}));
    }

    // LEFT: KITA (sanma only) — banks a North tile for a +1 han bonus later;
    // any candidate tile is functionally identical (they're all 4z), so a
    // single button covers however many copies happen to be in hand.
    const canKita=m.canKita||[];
    if(canKita.length>0)
      ab(bar,'KITA','bkita',()=>act({type:'kita',tileId:canKita[0]}));

    // LEFT: RIICHI — like CHI's sequence picker, pick which tile to
    // discard when more than one keeps the hand tenpai; a single option
    // skips the picker for a normal one-tap button. Doesn't require a
    // tile to already be selected — the button itself is the entry point
    // into choosing one, the same as CHI never requires pre-selecting the
    // hand tiles that make up a sequence.
    const canRiichi=m.canRiichi||[];
    if(canRiichi.length===1){
      ab(bar,'RIICHI','brii',()=>{act({type:'riichi',tileId:canRiichi[0]});selId=null;});
    } else if(canRiichi.length>1){
      ab(bar,'RIICHI','brii',()=>showRiichiPicker(canRiichi,m.myHand||[],m.drawTile||null));
    }

    // RIGHT: DISCARD
    if(selId!=null)
      ab(bar,'DISCARD','bdis',()=>{if(discarding)return;sendDiscardAction(selId);selId=null;});

    // RIGHT: KYUUSHU
    if(m.canKyuushu)
      ab(bar,'Kyuushu Kyuuhai','bkyu',()=>act({type:'kyuushu'}));

    if(bar.children.length>0) bar.classList.add('visible');

  } else if(react){
    const opts=m.pending.options||[];
    // LEFT: RON, PON, KAN, CHI
    // valid:false is a chonbo-only "attempt" option (rules.chonbo) — the
    // server hasn't confirmed this ron is actually legal, so it gets the
    // same recessed/confirm-required treatment as the tsumo attempt above
    // instead of the normal one-tap RON button.
    if(opts.some(o=>o.type==='ron'&&o.valid!==false))
      ab(bar,'RON','bron',()=>act({type:'ron'}));
    else if(opts.some(o=>o.type==='ron'&&o.valid===false))
      ab(bar,'⚠ Declare…','bchonbo',()=>showDeclareConfirm('ron'));
    if(opts.some(o=>o.type==='pon'))
      ab(bar,'PON','bpon',()=>act({type:'pon'}));
    if(opts.some(o=>o.type==='kan'))
      ab(bar,'KAN','bkan',()=>act({type:'kan'}));
    if(opts.some(o=>o.type==='chi')){
      const c=opts.find(o=>o.type==='chi');
      const discTile=m.pending.discard;
      const myHand=m.myHand||[];
      if(c.sequences.length===1){
        ab(bar,'CHI','bchi',()=>act({type:'chi',tileIds:c.sequences[0]}));
      } else {
        ab(bar,'CHI','bchi',()=>showChiPicker(c.sequences,discTile,myHand));
      }
    }
    // RIGHT: SKIP
    ab(bar,'SKIP','bpas',()=>act({type:'pass'}));
    if(bar.children.length>0) bar.classList.add('visible');
  }
  if(!bar.classList.contains('visible')) bar.classList.remove('visible');
  fitActionBarWidth(bar);
}

// Sizes the action bar to exactly what its own buttons need, capped at
// whatever room is actually left beside the nameplate — see .act-overlay's
// own comment in style.css for why this has to be inline JS rather than a
// CSS max-width (shrink-to-fit ancestor ambiguity), and why it's capped at
// the SMALLER of the two rather than always the full budget (avoiding an
// invisible pointer-events:auto dead zone over the felt for a short,
// non-wrapping button set). Runs on every drawActions call — i.e. every
// turn/reaction — so it's always measuring the CURRENT nameplate width,
// with no separate resize hook needed.
function fitActionBarWidth(bar){
  if(!bar.children.length){ bar.style.width=''; return; }
  const gapPx=parseFloat(getComputedStyle(bar).columnGap)||0;
  let natural=0;
  [...bar.children].forEach((b,i)=>{ natural+=b.getBoundingClientRect().width; if(i>0) natural+=gapPx; });
  const npWrap=document.querySelector('.np-wrap-b');
  const npInner=npWrap?.querySelector('.np-inner');
  let budget=natural;
  const margin=8; // small buffer so a wrapped row's own edge isn't flush against whichever boundary binds
  if(npWrap&&npInner){
    const wrapLeft=npWrap.getBoundingClientRect().left;
    const npWidth=npInner.getBoundingClientRect().width;
    const wrapGap=parseFloat(getComputedStyle(npWrap).gap)||0;
    budget=window.innerWidth-wrapLeft-npWidth-wrapGap-margin;
    // The viewport edge isn't the only thing this can run into — on a
    // tall/narrow phone the felt (and everything on it) can end up nearly
    // as wide as the viewport itself, meaning the right seat's own
    // nameplate (.np-wrap-r) sits well before window.innerWidth, not at
    // it. Measured: a long self-name/title (which shifts where this bar
    // STARTS, see the width-budget math above) combined with a full
    // 5-button reaction came within ~11px of overlapping it — close enough
    // that ordinary label/font variance could tip it over, the same
    // "technically fits, but only barely" issue the drawn-tile fix above
    // ran into. Cap the budget at whichever boundary is actually closer.
    const npWrapR=document.querySelector('.np-wrap-r');
    if(npWrapR){
      const barLeft=bar.getBoundingClientRect().left;
      const rBudget=npWrapR.getBoundingClientRect().left-barLeft-margin;
      budget=Math.min(budget,rBudget);
    }
  }
  // Floor at roughly one button's width — a budget smaller than a single
  // button would force-wrap every button onto its own row, which is worse
  // than just letting one row run slightly tight.
  bar.style.width=Math.min(natural,Math.max(budget,70))+'px';
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
      act({type:'chi',tileIds:seq});
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

// Shows a small overlay letting the player pick which tile to discard when
// declaring riichi, whenever more than one discard keeps the hand tenpai —
// same overlay pattern as showChiPicker, just one tile per option instead
// of a 3-tile sequence. tileIds can include the just-drawn tile (server's
// canRiichi checks the full post-draw hand), which isn't in myHand — that's
// why drawTile is looked up as a fallback.
function showRiichiPicker(tileIds,myHand,drawTile){
  let picker=$('riichi-picker');
  if(picker) picker.remove();
  picker=document.createElement('div');
  picker.id='riichi-picker';
  picker.className='chi-picker';
  tileIds.forEach(id=>{
    const t=myHand.find(x=>x.id===id)||(drawTile&&drawTile.id===id?drawTile:null);
    if(!t) return;
    const optBtn=document.createElement('button');
    optBtn.className='chi-picker-opt';
    optBtn.onclick=()=>{
      act({type:'riichi',tileId:id});
      selId=null;
      picker.remove();
    };
    optBtn.appendChild(mkElMd(t));
    picker.appendChild(optBtn);
  });
  const cancelBtn=document.createElement('button');
  cancelBtn.className='ba bpas chi-picker-cancel';
  cancelBtn.textContent='✕';
  cancelBtn.onclick=()=>picker.remove();
  picker.appendChild(cancelBtn);
  document.body.appendChild(picker);
}

// Shows a small overlay letting the player pick which tile rank to ankan
// when more than one is available at once (rare, but possible) — same
// overlay pattern as showChiPicker/showRiichiPicker, one option per
// candidate rank, each shown as the tile's actual face via keyToTile.
function showAnkanPicker(tileKeys){
  let picker=$('ankan-picker');
  if(picker) picker.remove();
  picker=document.createElement('div');
  picker.id='ankan-picker';
  picker.className='chi-picker';
  tileKeys.forEach(tileKey=>{
    const optBtn=document.createElement('button');
    optBtn.className='chi-picker-opt';
    optBtn.onclick=()=>{
      act({type:'ankan',tileKey});
      picker.remove();
    };
    optBtn.appendChild(mkElMd(keyToTile(tileKey)));
    picker.appendChild(optBtn);
  });
  const cancelBtn=document.createElement('button');
  cancelBtn.className='ba bpas chi-picker-cancel';
  cancelBtn.textContent='✕';
  cancelBtn.onclick=()=>picker.remove();
  picker.appendChild(cancelBtn);
  document.body.appendChild(picker);
}

// Chonbo (rules.chonbo) confirmation popup — a genuine second tap, not
// just a bigger button, since the "⚠ Declare…" control it's behind covers
// hands the server hasn't actually confirmed are winning. Deliberately
// mirrors showChiPicker's overlay pattern rather than the normal one-tap
// action bar buttons, specifically so an accidental tap on the recessed
// declare control can't by itself end the hand / cost points. The
// explanatory message only shows the first time this fires in a given
// game (see declareWarningShown, reset in startGame) — the confirm/cancel
// buttons themselves stay every time, so the "requires a second, deliberate
// tap" protection never goes away, just the repeated explanation of why.
let declareWarningShown=false;
function showDeclareConfirm(type){
  let picker=$('declare-picker');
  // Re-tapping the "⚠ Declare…" button while its own popup is already
  // open closes it (a toggle) rather than tearing it down and rebuilding
  // an identical one — see also the document click-outside handler below,
  // which covers dismissing it any other way.
  if(picker){ picker.remove(); return; }
  picker=document.createElement('div');
  picker.id='declare-picker';
  picker.className='chi-picker declare-picker';
  if(!declareWarningShown){
    const msg=document.createElement('div');
    msg.className='declare-picker-msg';
    msg.textContent=`Declare ${type==='tsumo'?'Tsumo':'Ron'}? If this hand isn't actually valid, you'll pay a chonbo penalty.`;
    picker.appendChild(msg);
    declareWarningShown=true;
  }
  const confirmBtn=document.createElement('button');
  confirmBtn.className='ba bchonbo declare-picker-confirm';
  confirmBtn.textContent=`Yes, Declare ${type==='tsumo'?'Tsumo':'Ron'}`;
  confirmBtn.onclick=()=>{
    act({type});
    picker.remove();
  };
  picker.appendChild(confirmBtn);
  const cancelBtn=document.createElement('button');
  cancelBtn.className='ba bpas chi-picker-cancel';
  cancelBtn.textContent='✕';
  cancelBtn.onclick=()=>picker.remove();
  picker.appendChild(cancelBtn);
  document.body.appendChild(picker);
}
// Click-outside-to-dismiss for the declare-confirm popup — excludes the
// "⚠ Declare…" button itself (.bchonbo) so the SAME click that opens it
// (this listener also sees that click, since it bubbles to document)
// doesn't immediately close it again; re-tapping that button is instead
// handled as an explicit toggle inside showDeclareConfirm above.
document.addEventListener('click',e=>{
  const picker=$('declare-picker');
  if(picker&&!e.target.closest('#declare-picker')&&!e.target.closest('.bchonbo')) picker.remove();
});
// Same click-outside-to-dismiss for the long-press message-reaction
// picker — it has no toggle button of its own to re-click (unlike the
// colour/emoji swatch pickers), so this is its only way to close without
// picking one.
document.addEventListener('click',e=>{
  const picker=$('msg-react-picker');
  if(!picker||e.target.closest('#msg-react-picker')) return;
  if(Date.now()-Number(picker.dataset.openedAt||0)<300) return; // see openReactionPicker's comment
  picker.remove();
});

function ab(c,l,cls,fn){const b=document.createElement('button');b.className='ba '+cls;b.textContent=l;b.onclick=fn;c.appendChild(b);}
function hint(c,t){const h=document.createElement('span');h.className='hint';h.textContent=t;c.appendChild(h);}

// "<v><suit>" tile key (e.g. "3m") -> a plain tile object usable by tsvg/mkEl.
function keyToTile(k){ return {v:parseInt(k), s:k.slice(-1)}; }

function mkEl(tile,cls,w,h){
  const el=document.createElement('div');el.className='tile '+cls;
  // If w/h not provided, read from CSS vars
  const root=document.documentElement;
  const explicit=!!(w&&h);
  if(!w) w=parseInt(root.style.getPropertyValue('--tmd-w'))||26;
  if(!h) h=parseInt(root.style.getPropertyValue('--tmd-h'))||36;
  // The wrapper's box size normally comes from its class (.tlg/.tmd/.tdora,
  // each hardcoded to a global --t*-w/h CSS var) — independent of the SVG's
  // own width/height attributes below. Callers passing an explicit w/h
  // that deliberately differs from that global var (see fitEndTileSize)
  // need the box itself to shrink too, or the smaller SVG just gets
  // centered/clipped inside the old, unchanged box.
  if(explicit){el.style.width=w+'px';el.style.height=h+'px';}
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
function appendEndPanelMeld(container,meld,w,h){
  const calledId=meld.calledTileId;
  const tile=t=>w?mkEl(t,'tmd',w,h):mkElMd(t);
  if(meld.kanType==='ankan'){
    const back=()=>{const d=document.createElement('div');d.className='kan-back re-kan-back';return d;};
    container.appendChild(back());
    container.appendChild(tile(meld.tiles[1]));
    container.appendChild(tile(meld.tiles[2]));
    container.appendChild(back());
  } else {
    for(const t of meld.tiles){
      const el=tile(t);
      if(t.id===calledId) el.classList.add('called');
      container.appendChild(el);
    }
  }
}

// Shrinks the winning-hand/tenpai-reveal tile size (which normally reuses
// --tmd-w/h, the discard-pile size tuned for 6 tiles per row) so a full
// 14-tile hand plus any melds still fits on one line inside the round-end
// panel. --tmd-w/h scales with the felt/window size with no ceiling, while
// the panel itself (#s-end's --ui-vmin) is deliberately capped for
// readability — on a large/4K display the two scales diverge enough that
// the uncapped tile size no longer fits the capped panel width, wrapping
// the hand onto a second line. Falls back to --tmd-w/h whenever it already
// fits (small screens, short hands), so normal sizing is unaffected.
function fitEndTileSize(container,count){
  const root=document.documentElement;
  const defaultW=parseInt(root.style.getPropertyValue('--tmd-w'))||26;
  const defaultH=parseInt(root.style.getPropertyValue('--tmd-h'))||36;
  if(!count||!container) return {w:defaultW,h:defaultH};
  const avail=container.clientWidth;
  if(!avail) return {w:defaultW,h:defaultH};
  const gapTotal=(count-1)*3; // matches .re-tile-row's own gap:3px
  const fitW=Math.floor((avail-gapTotal)/count);
  const w=Math.max(14,Math.min(defaultW,fitW));
  const h=Math.round(w*(defaultH/defaultW));
  return {w,h};
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
  // Mutual exclusion with the emoji picker right next to it — both are
  // small popups anchored to the same corner, so leaving both open at once
  // would just overlap.
  if(colorPickerOpen) toggleEmojiPicker(false);
}

// SEAT-EMOJI REACTIONS (pops up over your own play area, see
// showEmojiPopup below) — distinct from MSG_REACTIONS further down, which
// react to a specific chat message instead. Must match SEAT_EMOJI in
// room.js. Faces grouped first, then non-face reactions (👍/🔥/🏆/❤️/🙏) —
// keep new entries sorted into that same split rather than just appended.
const SEAT_EMOJI=['😂','😢','😠','😱','😊','🤯','😏','👍','🔥','🏆','❤️','🙏'];
let emojiPickerOpen=false;

function initEmojiPicker(){
  const picker=$('chat-emoji-picker'), btn=$('chat-emoji-btn');
  if(!picker||!btn) return;
  picker.innerHTML='';
  SEAT_EMOJI.forEach(e=>{
    const sw=document.createElement('button');
    sw.className='emoji-swatch';
    sw.type='button';
    sw.textContent=e;
    sw.setAttribute('aria-label','React with '+e);
    sw.onclick=()=>sendEmojiReact(e);
    picker.appendChild(sw);
  });
}

function sendEmojiReact(emoji){
  wss({type:'emoji_react',emoji});
  toggleEmojiPicker(false);
}

function toggleEmojiPicker(force){
  emojiPickerOpen=force!==undefined?force:!emojiPickerOpen;
  const picker=$('chat-emoji-picker'), btn=$('chat-emoji-btn');
  if(!picker||!btn) return;
  picker.classList.toggle('open',emojiPickerOpen);
  btn.classList.toggle('open',emojiPickerOpen);
  btn.setAttribute('aria-expanded',String(emojiPickerOpen));
  if(emojiPickerOpen) toggleColorPicker(false);
}

// Matches each position's own .pa-b/t/l/r rotation (see style.css) — the
// popped emoji (AND, critically, the direction it floats away in — see
// the nested-element structure in showEmojiPopup below) rotates along
// with it, so both the glyph and its motion read as belonging to that
// seat's own orientation instead of always being upright/floating
// screen-up regardless of whose reaction it is. 'l' and 'r' are NOT
// mirror images of each other despite both seats sitting at 90° to the
// bottom seat — .pa-l/.pa-r's own rotate(90deg) in style.css is identical
// for both, but that's the CONTAINER box only; the tile row layout inside
// each is separately mirrored via flex-direction, not by a second
// opposite-signed rotation. The emoji glyph has no such second mirroring
// step, so it needs the sign flipped explicitly here for 'r' — verified
// empirically in both sanma and yonma (mixing this up is exactly what
// made the right seat's emoji render upside-down before).
const EMOJI_POP_ROTATION={b:0,t:180,l:90,r:-90};

// Which edge of `pa-<posId>` (== that seat's own tile row, see index.html
// — the nameplate is a separate sibling, not inside it) is the "away from
// the table edge, toward the felt centre" side, and which screen axis is
// perpendicular to that (the one the felt's own centre — not the tile
// row's off-centre position — should be used for). Mirrors
// EMOJI_POP_ROTATION's reasoning: this is what makes "just above the
// tiles" and "centred on the felt" both come out correct per seat instead
// of only for the bottom/me.
const EMOJI_POP_EDGE={
  b:{axis:'top',edge:'top',sign:-1,cross:'left'},
  t:{axis:'top',edge:'bottom',sign:1,cross:'left'},
  l:{axis:'left',edge:'right',sign:1,cross:'top'},
  r:{axis:'left',edge:'left',sign:-1,cross:'top'},
};
// Small gap off the tile row's own edge for the SPAWN point — the 4s
// float (see @keyframes emojiPop) then continues further in the same
// direction from there. In vmin, not px, for the same "scales with actual
// screen size" reasoning as the float distance itself (see the comment
// on showEmojiPopup below).
const EMOJI_POP_SPAWN_GAP=3;

// Renders the emoji over `seat`'s (absolute seat index) own play area on
// EVERY client, including the sender's — server just relays, see
// emojiReact in room.js. pid() (defined further down) maps an absolute
// seat to this client's own screen position ('b'/'t'/'l'/'r'), same
// rotation-aware helper onRiichi/etc already use.
//
// Three nested elements, each owning exactly one job:
//   .emoji-pop        — positioned via inline left/top (JS): just off the
//                        tile row's own edge along the seat's local "up"
//                        axis (so it starts CLEAR of the tiles instead of
//                        centred on top of them), and centred on the felt
//                        itself (not the tile row, which sits off-centre
//                        within it) along the other axis.
//   .emoji-pop-rotate — STATIC translate(-50%,-50%)+rotate(seat's angle).
//                        Centres the glyph on that spawn point and
//                        establishes "up" in THIS seat's own rotated
//                        frame — everything below inherits it.
//   .emoji-pop-motion — the actual 4s keyframe animation (pop in, float
//                        AWAY, fade out). Its translateY happens inside
//                        the already-rotated frame above, so "float up"
//                        automatically comes out as the correct on-screen
//                        direction for whichever seat this is (screen-up
//                        for the bottom/me, screen-down for the seat
//                        across, sideways for the left/right seats) —
//                        rather than every popup floating screen-up
//                        regardless of whose reaction it is, which was
//                        the previous bug. Distances are in vmin, not px
//                        or %-of-self, so both the spawn gap and the float
//                        clear the tile row by a consistent margin of the
//                        table regardless of viewport resolution — a
//                        fixed px offset (the previous approach) was fine
//                        on a phone-sized viewport but nowhere near enough
//                        of a gap on a 4K screen, where the whole table
//                        renders far larger in actual pixels for the same
//                        vmin layout.
function showEmojiPopup(seat,emoji){
  const posId=pid(seat);
  const anchor=$('pa-'+posId);
  const felt=document.querySelector('.felt');
  const layer=$('emoji-layer');
  if(!anchor||!felt||!layer) return;
  // Replaces any still-animating popup for the same seat rather than
  // stacking — a rapid re-react should restart the pop, not pile up.
  layer.querySelectorAll(`.emoji-pop[data-seat="${seat}"]`).forEach(el=>el.remove());
  const rect=anchor.getBoundingClientRect();
  const feltRect=felt.getBoundingClientRect();
  const vmin=Math.min(window.innerWidth,window.innerHeight)/100;
  const gapPx=EMOJI_POP_SPAWN_GAP*vmin;
  const e=EMOJI_POP_EDGE[posId]||EMOJI_POP_EDGE.b;
  const el=document.createElement('div');
  el.className='emoji-pop';
  el.dataset.seat=seat;
  if(e.axis==='top'){
    el.style.top=(rect[e.edge]+e.sign*gapPx)+'px';
    el.style.left=(feltRect.left+feltRect.width/2)+'px';
  }else{
    el.style.left=(rect[e.edge]+e.sign*gapPx)+'px';
    el.style.top=(feltRect.top+feltRect.height/2)+'px';
  }
  const rotate=document.createElement('div');
  rotate.className='emoji-pop-rotate';
  rotate.style.transform=`translate(-50%,-50%) rotate(${EMOJI_POP_ROTATION[posId]||0}deg)`;
  const motion=document.createElement('div');
  motion.className='emoji-pop-motion';
  motion.textContent=emoji;
  rotate.appendChild(motion);
  el.appendChild(rotate);
  layer.appendChild(el);
  setTimeout(()=>el.remove(),4000);
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

function showChatMsg(name,text,color,id){
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
  // `id` is the server's per-room monotonic chatSeq (see chat() in
  // room.js) — the stable handle msg_react broadcasts reference, so a
  // reaction lands on the right message on every client. Reactions are
  // purely relayed same as chat itself (no server-side history), so a
  // message with no id (older client, or some future non-chat caller of
  // this function) simply can't carry a reaction — attachLongPress below
  // bails out for those instead of guessing an id.
  if(id!=null) entry.dataset.msgId=id;
  // Reaction pills sit in the same flex row as the text bubble (rather
  // than their own line below it) so they visually read as attached to
  // the end of THIS message, not a separate block for the whole entry.
  entry.innerHTML=
    `<span class="chat-entry-who" style="color:${msgColor}">${escHtml(name)}</span>`+
    `<span class="chat-entry-msg-row">`+
      `<span class="chat-entry-text">${escHtml(text)}</span>`+
      `<span class="chat-entry-reactions" id="reactions-${id}"></span>`+
    `</span>`+
    `<span class="chat-entry-time">${time}</span>`;
  history.appendChild(entry);
  history.scrollTop=history.scrollHeight;
  if(id!=null) attachLongPress(entry,id);

  // ── Unread badge ──
  if(!chatOpen){
    unreadCount++;
    const badge=$('chat-badge');
    badge.textContent=unreadCount;
    badge.classList.add('show');
  }
}

// MESSAGE REACTIONS — long-press a history entry to react (or edit/clear
// your own existing reaction by long-pressing again). Distinct from
// SEAT_EMOJI above; must match MSG_REACTIONS in room.js.
const MSG_REACTIONS=['👍','❤️','😂','😮','😢'];
// {[msgId]: {[seat]: emoji}} — built entirely from msg_react broadcasts as
// they arrive (including echoes of this client's own reactions), never
// fetched/replayed — consistent with chat itself having no server-side
// history (see room.js's reactToMessage comment). Lost on reload, same as
// the chat history it annotates.
const msgReactions={};

const LONG_PRESS_MS=500;
function attachLongPress(el,msgId){
  let timer=null;
  const start=()=>{
    cancel();
    timer=setTimeout(()=>{
      timer=null;
      el.classList.remove('pressing');
      openReactionPicker(el,msgId);
    },LONG_PRESS_MS);
    el.classList.add('pressing');
  };
  const cancel=()=>{
    if(timer){clearTimeout(timer);timer=null;}
    el.classList.remove('pressing');
  };
  el.addEventListener('mousedown',start);
  el.addEventListener('mouseup',cancel);
  el.addEventListener('mouseleave',cancel);
  el.addEventListener('touchstart',start,{passive:true});
  el.addEventListener('touchend',cancel);
  el.addEventListener('touchmove',cancel);
}

// Opens the 5-emoji picker near `entry` (a long-pressed .chat-entry).
// Re-long-pressing a message you've already reacted to opens the SAME
// picker with your current pick highlighted — clicking it again clears
// your reaction, clicking a different one swaps it. That's the whole
// "editable by long-pressing again" behavior; there's no separate edit
// mode, just re-opening the same picker.
function openReactionPicker(entry,msgId){
  $('msg-react-picker')?.remove();
  const mine=mySeat>=0?msgReactions[msgId]?.[mySeat]?.emoji:undefined;
  const picker=document.createElement('div');
  picker.className='msg-react-picker';
  picker.id='msg-react-picker';
  MSG_REACTIONS.forEach(e=>{
    const b=document.createElement('button');
    b.type='button';
    b.textContent=e;
    b.className=e===mine?'selected':'';
    b.setAttribute('aria-label','React with '+e);
    b.onclick=ev=>{
      ev.stopPropagation();
      wss({type:'msg_react',msgId,emoji:e===mine?null:e});
      picker.remove();
    };
    picker.appendChild(b);
  });
  // Timestamp guard for the outside-click dismiss handler below — the
  // mouseup/touchend that ends the long-press which OPENED this picker
  // fires its own synthetic 'click' on document right afterward, at the
  // pressed message's location (outside the picker, since the picker
  // wasn't there when the press started). Without this guard that trailing
  // click would immediately close the picker it just opened.
  picker.dataset.openedAt=Date.now();
  document.body.appendChild(picker);
  const rect=entry.getBoundingClientRect();
  const pw=picker.offsetWidth;
  let left=rect.left+rect.width/2-pw/2;
  left=Math.max(6,Math.min(left,window.innerWidth-pw-6));
  picker.style.left=left+'px';
  // Prefer just above the message; if that would run off the top of the
  // viewport (e.g. the very first entry in a scrolled-to-top history),
  // drop it below instead.
  const above=rect.top-picker.offsetHeight-8;
  picker.style.top=(above>4?above:rect.bottom+8)+'px';
}

// Applies an incoming msg_react broadcast (from ANY player, including
// echoes of this client's own — server relays to everyone, see
// reactToMessage in room.js) and re-renders that message's pill row.
// Stores {emoji, name} per seat (not just the emoji) so a pill long-press
// can list WHO reacted, not just how many.
function onMsgReact(m){
  const bucket=msgReactions[m.msgId]=msgReactions[m.msgId]||{};
  if(m.emoji) bucket[m.seat]={emoji:m.emoji,name:m.name}; else delete bucket[m.seat];
  renderMessageReactions(m.msgId);
}

// Groups the raw {seat: {emoji,name}} bucket into one pill per DISTINCT
// emoji — two people reacting with the same emoji still show just one
// pill (per request), not a count. Long-pressing a pill lists who's
// behind it (see attachPillLongPress/showReactionNames) instead of a
// number doing that job. .mine marks a pill that includes my own seat's
// reaction (openReactionPicker reads mySeat's entry directly, not this
// rendering, for its own "which one is currently selected" state).
function renderMessageReactions(msgId){
  const row=$('reactions-'+msgId);
  if(!row) return;
  const bucket=msgReactions[msgId]||{};
  const byEmoji={};
  for(const [seat,r] of Object.entries(bucket)){
    byEmoji[r.emoji]=byEmoji[r.emoji]||{names:[],mine:false};
    byEmoji[r.emoji].names.push(r.name);
    if(Number(seat)===mySeat) byEmoji[r.emoji].mine=true;
  }
  row.innerHTML='';
  for(const [emoji,{names,mine}] of Object.entries(byEmoji)){
    const pill=document.createElement('span');
    pill.className='reaction-pill'+(mine?' mine':'');
    pill.textContent=emoji;
    row.appendChild(pill);
    attachPillLongPress(pill,names);
  }
}

// Long-press on a reaction pill (distinct from long-pressing the message
// itself, which opens the react-with picker) shows who's behind it.
// stopPropagation on start/cancel keeps this from ALSO bubbling up into
// the message-level long-press handler on the parent .chat-entry — without
// it, pressing a pill would fire both handlers at once.
function attachPillLongPress(pill,names){
  let timer=null;
  const start=e=>{
    e.stopPropagation();
    timer=setTimeout(()=>{timer=null;showReactionNames(pill,names);},LONG_PRESS_MS);
  };
  const cancel=e=>{
    if(e) e.stopPropagation();
    if(timer){clearTimeout(timer);timer=null;}
  };
  pill.addEventListener('mousedown',start);
  pill.addEventListener('mouseup',cancel);
  pill.addEventListener('mouseleave',cancel);
  pill.addEventListener('touchstart',start,{passive:true});
  pill.addEventListener('touchend',cancel);
  pill.addEventListener('touchmove',cancel);
}

// Small popup listing everyone who reacted with this particular emoji —
// e.g. "Alice, Bob" when more than one person picked the same reaction.
function showReactionNames(pill,names){
  $('reaction-names-popup')?.remove();
  const popup=document.createElement('div');
  popup.className='reaction-names-popup';
  popup.id='reaction-names-popup';
  popup.textContent=names.join(', ');
  // Same trailing-click guard as openReactionPicker — see its comment.
  popup.dataset.openedAt=Date.now();
  document.body.appendChild(popup);
  const rect=pill.getBoundingClientRect();
  const pw=popup.offsetWidth;
  let left=rect.left+rect.width/2-pw/2;
  left=Math.max(6,Math.min(left,window.innerWidth-pw-6));
  popup.style.left=left+'px';
  const above=rect.top-popup.offsetHeight-8;
  popup.style.top=(above>4?above:rect.bottom+8)+'px';
}
document.addEventListener('click',e=>{
  const popup=$('reaction-names-popup');
  if(!popup||e.target.closest('#reaction-names-popup')) return;
  if(Date.now()-Number(popup.dataset.openedAt||0)<300) return;
  popup.remove();
});

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

// Builds one call-banner DOM node — shared by callBanner's single-banner
// path and ronBanners' multi-winner one below, so both produce identically
// styled/worded banners without duplicating the label/name markup.
function buildCallBannerEl(type,name,label){
  const b=document.createElement('div');
  b.className='call-banner';b.dataset.type=type;
  const content=document.createElement('div');content.className='cb-content';
  const lb=document.createElement('span');lb.className='cb-label';lb.textContent=label;
  // ダブルリーチ (6 chars) is twice as long as every other call-banner label
  // (リーチ/ポン/カン/チー/北, all <=3) — at the shared font-size it wraps
  // onto a second line inside the fixed-width banner. Shrink just the long
  // ones instead of the label font-size in general.
  if(label.length>4) lb.classList.add('cb-label-long');
  const nm=document.createElement('span');nm.className='cb-name';
  const who=document.createElement('b');who.textContent=name;
  nm.appendChild(who);
  // "called" fits pon/kan/chi/riichi/kita — a win isn't a call, so tsumo/ron
  // (see onEnd) get their own wording instead.
  const isWin=type==='tsumo'||type==='ron';
  nm.appendChild(document.createTextNode(isWin?' wins':' called'));
  content.appendChild(lb);content.appendChild(nm);
  b.appendChild(content);
  return b;
}

// Call banner (pon/kan/chi/riichi/tsumo/single-winner ron) — slides in from
// the bottom-left and settles across the felt; see .call-banner / @keyframes
// cb-slide.
function callBanner(type,name,label){
  const layer=$('cb-layer'); if(!layer) return;
  // .cb-layer is a flex row container, so a second banner appended while the
  // first is still fading out would sit beside it (split left/right) rather
  // than replace it. Drop any banner still in flight immediately so only the
  // newest call is ever shown.
  layer.querySelectorAll('.call-banner,.cb-stack').forEach(el=>el.remove());
  const b=buildCallBannerEl(type,name,label);
  layer.appendChild(b);setTimeout(()=>b.remove(),1800);
}

// Double/triple ron (see m.extraWinners in onEnd, and _multiRon in
// room.js) — every simultaneous winner gets their own full banner, in the
// SAME spot a single-winner ron uses, one at a time rather than stacked or
// overlapping. Layering two at once (an earlier version tried this, side
// by side and also directly on top of each other) reads badly either way:
// .call-banner's background isn't fully opaque, so whichever one is
// underneath still shows through the one on top, and two names/labels
// occupying the same space is hard to read regardless of opacity — it's a
// legibility problem, not a positioning one, so no amount of z-index or
// transparency tuning fixes it. Instead the previous winner's banner is
// always fully removed (not just visually covered) before the next one
// appears, so exactly one is ever on screen. Duration per winner matches
// a normal single-winner callBanner exactly (RON_BANNER_HOLD, same 1800ms)
// — see onEnd's WIN_BANNER_DELAY, which waits for the WHOLE sequence
// rather than just one banner's worth of time. Falls back to a single
// plain callBanner when there's only one name, so an ordinary (non-multi)
// ron looks identical to before this existed.
const RON_BANNER_HOLD=1800;
function ronBanners(names){
  const layer=$('cb-layer'); if(!layer) return;
  if(names.length<=1){ callBanner('ron',names[0]||'Player','ロン'); return; }
  layer.querySelectorAll('.call-banner,.cb-stack').forEach(el=>el.remove());
  const showAt=idx=>{
    if(idx>=names.length) return;
    // Removing the CURRENT banner (if any) here, in the same tick as
    // appending the next one, is what actually guarantees the "never both
    // on screen at once" property — relying on each banner's own
    // independent removal timer (as callBanner does solo) risks two timers
    // firing in an order that briefly leaves both present.
    layer.querySelectorAll('.call-banner').forEach(el=>el.remove());
    const b=buildCallBannerEl('ron',names[idx],'ロン');
    layer.appendChild(b);
    setTimeout(()=>{ b.remove(); showAt(idx+1); },RON_BANNER_HOLD);
  };
  showAt(0);
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
  // Block interaction with the board underneath for exactly as long as
  // this card is visible — otherwise the round becomes playable (game_state
  // usually arrives well under a second after round_start) while "東2局"
  // is still animating on top, letting an early tap/discard go through
  // before the player's actually had a chance to see the new hand.
  layer.classList.add('blocking');
  roundStartBannerActive=true;
  setTimeout(()=>{
    scrim.remove();plate.remove();layer.classList.remove('blocking');
    roundStartBannerActive=false;
    // Reveal whatever actually happened underneath (bots don't wait for
    // this card) the instant it clears, rather than mid-animation.
    if(pendingBannerGameState){
      const m=pendingBannerGameState; pendingBannerGameState=null;
      const prev=lastState; lastState=m; discarding=false; renderState(m,prev);
    }
  },3400);
}


// ════════════════════════════════════════════════════════════
// ROUND READY
// ════════════════════════════════════════════════════════════
function sendRoundReady(){
  act({type:'round_ready'});
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
// Handle for the delayed "re-arm inGame" timer a BETWEEN-rounds round_end
// schedules (see onEnd). Cleared whenever the next round actually starts or
// the game ends, so a short final round can't let this fire AFTER game over
// and wrongly put the "Leave Game? progress will be lost" confirm on the
// game-over panel (goLobby only shows that while inGame is true).
let betweenRoundsTimer=null;

function onRoundStart(m){
  clearTimeout(betweenRoundsTimer);
  inGame=true;
  discarding=false; pendingDiscardTileId=null; discardRetryArmed=false; suppressDiscardSfxOnce=false; clearTimeout(discardWatchdog);
  show('s-game');
  // Reset Ready button for next round
  const btn=$('bround-ready');
  if(btn){ btn.disabled=false; btn.textContent='✓ Ready'; btn.style.opacity='1'; }
  const status=$('ready-status'); if(status) status.textContent='';
  $('chat-bar').style.display='flex';
  $('dora-panel').style.display='flex';
  // Deliberately NOT showing #game-loading here (unlike startGame()) — the
  // round-start card below (roundStartBanner) already covers this same
  // "hand is being dealt" gap with its own opaque scrim, at a HIGHER
  // z-index (.rs-layer:210 vs #game-loading:200). Turning the loader on
  // here just hides it completely behind that scrim for the card's entire
  // ~3.4s run, then flashes it briefly the instant the card clears if
  // game_state hasn't arrived yet — i.e. the loading spinner would visibly
  // appear AFTER the round-start card instead of before/during it.

  // ── Update seat winds based on new dealer ────────────────────────────────
  const windLabels2=['東','南','西','北'];
  const dealer=m.dealer??0;
  for(let i=0;i<numSeats;i++){
    const abs=(mySeat+i)%numSeats, id=P[i];
    const wb=$('wb'+id);
    if(wb) wb.textContent=windLabels2[(abs-dealer+numSeats)%numSeats];
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
  // Clear leftover kita (pei-nuki) tiles from a previous sanma game (see startGame)
  ['kb','kt','kl','kr'].forEach(id=>{ const el=$(id); if(el) el.innerHTML=''; });
  // Clear riichi sticks
  ['b','r','t','l'].forEach(p=>{ const el=$('rs'+p); if(el) el.style.display='none'; });
  // Clear dora panel
  const doraPanel=$('dora-panel');
  if(doraPanel) doraPanel.querySelectorAll('.dora-slot').forEach(s=>{s.innerHTML='';s.className='dora-slot';});
  // Clear action bar
  const bar=$('actbar'); if(bar){bar.innerHTML='';bar.classList.remove('visible');}
  // Clear selection
  selId=null;
  // Same reasoning as startGame's own identical reset — a `discarding=true`
  // stuck from the round that just ended (see sendDiscardAction's watchdog,
  // which recovers within 4s regardless, but there's no reason to wait on
  // it here when a new round is starting anyway) would otherwise block
  // discarding for the entire next round too.
  discarding=false; pendingDiscardTileId=null; discardRetryArmed=false; suppressDiscardSfxOnce=false; clearTimeout(discardWatchdog);
  // Furiten/tenpai status dot (see renderState's own comment on it) — only
  // renderState ever sets this, based on the state it's currently
  // rendering, so without an explicit reset here it just keeps showing
  // whatever it last was at the END of the PREVIOUS round (e.g. still
  // "furiten") all the way through this round's start banner, until the
  // new round's first game_state finally re-evaluates it.
  const dot0=$('statusdot-b'); if(dot0) dot0.className='status-dot';
  // Paint this round's actual post-payout scores immediately, same
  // reasoning as startGame's own identical block — round_start's `scores`
  // already reflects the just-settled tsumo/ron/draw payout, but without
  // this the centre panel would keep showing the PREVIOUS round's numbers
  // (whatever the last game_state left there) all through the round-start
  // banner below, only catching up once the new round's first game_state
  // arrives well after the banner's already been read.
  const ctrIds0={b:'ctr-s-b',r:'ctr-s-r',t:'ctr-s-t',l:'ctr-s-l'};
  if(m.scores){
    for(let i=0;i<numSeats;i++){
      const abs=(mySeat+i)%numSeats,id=P[i];
      const ctrEl=$(ctrIds0[id]);
      if(ctrEl&&m.scores[abs]!==undefined) ctrEl.textContent=m.scores[abs];
    }
  }

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
  // A short final round can leave a between-rounds re-arm timer still
  // pending from the previous round_end — kill it so it can't flip inGame
  // back to true under the game-over panel (see betweenRoundsTimer).
  clearTimeout(betweenRoundsTimer);
  const loader=$('game-loading'); if(loader) loader.style.display='none';
  // Hide Ready, show Main Menu — game fully over
  const btn=$('bround-ready'); if(btn) btn.style.display='none';
  const vrBtn=$('bview-results'); if(vrBtn) vrBtn.style.display='none';
  const menuBtn=$('bend-menu'); if(menuBtn) menuBtn.style.display='';
  const status=$('ready-status'); if(status) status.textContent='';
  // Play Again vote/start UI — private rooms (create_room/join_room) only,
  // see isPrivateRoomGame's own comment. Quick_match keeps the plain
  // solo-requeue button (onPlayAgainClick below falls back to that).
  playAgainSeats=[];
  lastGameOverNames=m.playerNames||null;
  const paBtn=$('bplay-again');
  const startBtn=$('bplay-again-start');
  // The host is never actually undecided — they're the one who'll choose
  // WHEN to start, so there's no point making them click a separate
  // "Play Again" first. Skip straight to sending that vote for them and
  // show only the gold Start button (initially disabled until the vote
  // round-trip lands — see onPlayAgainStatus), instead of showing both
  // buttons at once (green Play Again + gold Start + red Leave Room felt
  // cluttered for what's really one decision for the host).
  const isHostRematch=isPrivateRoomGame&&isRoomHost;
  if(paBtn){ paBtn.style.display=isHostRematch?'none':''; paBtn.disabled=false; paBtn.textContent='↻ Play Again'; }
  if(startBtn){ startBtn.style.display=isHostRematch?'':'none'; startBtn.disabled=true; }
  const paStatus=$('play-again-status'); if(paStatus) paStatus.textContent='';
  if(isHostRematch) wss({type:'play_again'});
  stopGameMusic();
  playLobbyMusic();
  $('chat-bar').style.display='none';$('chat-panel').classList.remove('open');chatOpen=false;
  $('dora-panel').style.display='none';
  const sorted=[...((m.scores||[]).map((s,i)=>({s,i})))].sort((a,b)=>b.s-a.s);
  $('ret').textContent=m.reason==='tobi'?'飛び - Bankruptcy':'終局 - Game Over';
  $('rehn').textContent='';$('reyl').innerHTML='';$('rewt').innerHTML='';
  // Both left over from whatever the FINAL round's own onEnd() call put up
  // (a tenpai reveal if that round was an exhaustive draw, or a double/
  // triple-ron prev/next nav) — neither is redrawn by anything below, so
  // without clearing them here they'd stay stuck on top of/around the
  // final standings table instead of this panel starting clean.
  $('re-tenpai').innerHTML='';
  renderWinnerNav(null);
  // Final standings — each row pairs a medal-coloured ordinal with the
  // player's actual .up-nameplate/.pnp-* profile plate (same component the
  // game-start roll call uses — see gameStartIntro) instead of a bare name
  // string, so "who placed where" reads the same way "who's in this game"
  // already does. Self's tier class is read straight off the User Profile
  // hub's own element, same reasoning as gameStartIntro; opponents/bots use
  // their own m.seats[i].wins (see _seatInfo in room.js) through the same
  // nameplateTierClass lookup, rather than always falling back to bronze.
  const ordinalLabels=['1st','2nd','3rd','4th'];
  const rankColours=['#f0d080','#c0c0c0','#cd7f32','var(--cream)'];
  const isSelfGuestFinal=$('iname').value==='Guest';
  const selfTierElFinal=document.querySelector('#userprofile-modal .up-nameplate');
  const selfTierClsFinal=selfTierElFinal&&['tier-silver','tier-gold','tier-platinum','tier-diamond'].find(c=>selfTierElFinal.classList.contains(c));
  const tbl=$('rest'); tbl.innerHTML='';
  sorted.forEach(({s,i},rank)=>{
    const isMe=i===mySeat;
    const p=m.seats?.[i];
    const name=isMe?($('iname').value.trim()||'You'):(p?.name||m.playerNames?.[i]||`Seat ${i}`);
    const row=document.createElement('tr');
    row.className=rank===0?'w':'';
    const cell=document.createElement('td');cell.className='re-final-cell';
    const ord=document.createElement('span');ord.className='re-final-ordinal';
    ord.style.color=rankColours[rank]||'var(--cream)';
    ord.textContent=ordinalLabels[rank]||`${rank+1}th`;
    const np=document.createElement('div');
    const tierClsFinal=isMe?selfTierClsFinal:nameplateTierClass(p?.wins||0);
    np.className='up-nameplate'+(tierClsFinal?' '+tierClsFinal:'');
    const icon=document.createElement('span');icon.className='pnp-icon';
    icon.innerHTML=isMe?(isSelfGuestFinal?guestIconSvg:iconSvg(currentPlayerIcon)):iconSvg(p?.icon||'default');
    const info=document.createElement('span');info.className='pnp-info';
    const pname=document.createElement('span');pname.className='pnp-name';pname.textContent=name;
    const ptitle=document.createElement('span');ptitle.className='pnp-title';
    ptitle.textContent=isMe?(isSelfGuestFinal?'':currentPlayerTitle):(p?.isBot?'CPU':(p?.title||''));
    info.appendChild(pname);info.appendChild(ptitle);
    np.appendChild(icon);np.appendChild(info);
    cell.appendChild(ord);cell.appendChild(np);
    const scoreCell=document.createElement('td');scoreCell.textContent=s.toLocaleString();
    row.appendChild(cell);row.appendChild(scoreCell);
    tbl.appendChild(row);
  });
  // Coin payout for this game (see the 'coins' message handler / server
  // _finishGame). Called here AND from that handler since either can be the
  // one that runs with data ready — whichever is second paints the line.
  showCoinReward();
  // m.winSfxLine is picked server-side once per game (see _finishGame in
  // room.js) so every client plays the SAME line for this win, rather than
  // each rolling its own random pick.
  playWinSfx(m.winSfxLine);
  show('s-end');
}

// 'Play Again' button on the game-over panel — quick_match keeps its old
// solo-requeue behaviour (playAgain() below, unchanged); a create_room/
// join_room game instead casts this seat's vote to the room (see
// Room.playAgain in server/room.js) and waits on onPlayAgainStatus to hear
// back who else is in. Only the host (isRoomHost) additionally gets a
// '#bplay-again-start' button, enabled once THEY'VE voted too (mirrors the
// server-side guard in hostStartPlayAgain).
function onPlayAgainClick(){
  if(!isPrivateRoomGame){ playAgain(); return; }
  wss({type:'play_again'});
  const btn=$('bplay-again');
  if(btn){ btn.disabled=true; btn.textContent='✓ Waiting for others…'; }
}

function onPlayAgainStatus(m){
  playAgainSeats=m.seats||[];
  const status=$('play-again-status');
  if(status){
    const names=playAgainSeats.map(seat=>seat===mySeat?($('iname').value.trim()||'You'):(lastGameOverNames?.[seat]||`Seat ${seat}`));
    status.textContent=names.length?`Want to play again: ${names.join(', ')}`:'';
  }
  if(playAgainSeats.includes(mySeat)){
    const btn=$('bplay-again');
    if(btn){ btn.disabled=true; btn.textContent='✓ Waiting for others…'; }
  }
  if(isRoomHost){
    const startBtn=$('bplay-again-start');
    if(startBtn) startBtn.disabled=!playAgainSeats.includes(mySeat);
  }
}

// Sent to any seat that didn't vote play_again once the host started the
// rematch anyway (see hostStartPlayAgain) — this connection's seat was
// already handed to a bot server-side, so there's nothing left to rejoin;
// just explain what happened and drop back to the lobby.
function onPlayAgainLeftBehind(){
  toast('The host started a new game without you.');
  resetLobby();
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


// Hand tiles + dora (#rewt) and the tenpai reveal (#re-tenpai) on the
// round-end panel — every tile here is an mkElMd() SVG, same "size baked
// in at draw time" deal as the live board's tiles (see mkEl's own
// comment), so this needs to be re-runnable on its own: onEnd (below)
// calls it as part of a normal round_end, and scheduleTileRedraw calls it
// again on resize (using the last round_end message, see lastEndState)
// WITHOUT going through the rest of onEnd, which has one-time side effects
// (win/tsumo sound, the score count-up animation) that must not replay
// just because the window resized. winnerIdx selects which entry of
// m.winners (double/triple ron — see renderWinnerNav) supplies the hand/
// melds/ura-dora-eligibility; defaults to whichever tab is currently
// showing so a plain renderEndTiles(m) call (resize, the initial reveal)
// redraws the RIGHT winner rather than always reverting to the first.
function renderEndTiles(m,winnerIdx=currentEndWinnerIdx){
  const wt=$('rewt'); if(!wt) return;
  wt.innerHTML='';
  const w=m.winners?.[winnerIdx];
  // Ura dora tiles are the same physical indicators for every winner (they
  // come off the shared dead wall, not per-hand), but only actually apply
  // to THIS winner's score if they personally were in riichi — m.uraDora
  // being non-empty just means at least one of the (possibly several)
  // simultaneous winners qualified (see anyRiichiWinner in room.js), not
  // necessarily this one.
  const showUra=(m.uraDora||[]).length>0&&(w?w.riichi:true);
  if((m.dora||[]).length||showUra){
    const dr=document.createElement('div');dr.className='re-dora-row';
    if((m.dora||[]).length){
      const lbl=document.createElement('span');lbl.className='re-dora-lbl';lbl.textContent='Dora';
      dr.appendChild(lbl);
      for(const t of m.dora) dr.appendChild(mkElMd(t));
    }
    if(showUra){
      const lbl2=document.createElement('span');lbl2.className='re-dora-lbl re-ura-lbl';lbl2.textContent='Ura Dora';
      dr.appendChild(lbl2);
      for(const t of m.uraDora) dr.appendChild(mkElMd(t));
    }
    wt.appendChild(dr);
  }
  const tileRow=document.createElement('div');tileRow.className='re-tile-row';
  const handTiles=(w?w.hand:m.hand||[]).filter(Boolean);
  const melds=w?w.melds:m.melds;
  const meldTileCount=(melds||[]).reduce((n,meld)=>n+(meld.kanType==='ankan'?4:meld.tiles.length),0);
  const {w:hw,h:hh}=fitEndTileSize(wt,handTiles.length+meldTileCount);
  for(const t of handTiles) tileRow.appendChild(mkEl(t,'tmd',hw,hh));
  // Render melds right of closed hand, separated by a gap
  for(const meld of(melds||[])) appendEndPanelMeld(tileRow,meld,hw,hh);
  wt.appendChild(tileRow);
  // Tenpai reveal (exhaustive draw only) — name + hand for each tenpai
  // player; noten hands stay private (server sends null for those seats).
  const tp=$('re-tenpai'); if(!tp) return;
  tp.innerHTML='';
  if(m.reason==='draw'&&Array.isArray(m.tenpaiHands)){
    m.tenpaiHands.forEach((hand,seat)=>{
      if(!hand) return;
      const row=document.createElement('div');row.className='re-tenpai-row';
      const nameEl=document.createElement('div');nameEl.className='re-tenpai-name';
      nameEl.textContent=seat===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[seat]||`Seat ${seat}`);
      row.appendChild(nameEl);
      const tiles=document.createElement('div');tiles.className='re-tile-row';
      const tpMeldCount=(m.tenpaiMelds?.[seat]||[]).reduce((n,meld)=>n+(meld.kanType==='ankan'?4:meld.tiles.length),0);
      const {w:tw,h:th}=fitEndTileSize(tp,hand.length+tpMeldCount);
      for(const t of hand) tiles.appendChild(mkEl(t,'tmd',tw,th));
      for(const meld of(m.tenpaiMelds?.[seat]||[])) appendEndPanelMeld(tiles,meld,tw,th);
      row.appendChild(tiles);
      tp.appendChild(row);
    });
  }
}

// Populates #rehn (winner name + limit/han-fu) and #reyl (yaku pills) for
// ONE entry of m.winners — the per-winner half of the results panel that
// isn't the hand tile artwork (renderEndTiles handles that, keyed off the
// same winnerIdx via currentEndWinnerIdx). Called once for the primary
// winner right when onEnd first processes a tsumo/ron, and again by
// stepWinnerNav for whichever winner the prev/next arrows just selected.
function renderWinnerInfo(m,winnerIdx){
  const w=m.winners?.[winnerIdx]; if(!w) return;
  currentEndWinnerIdx=winnerIdx;
  const name=w.winSeat===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[w.winSeat]||`Seat ${w.winSeat}`);
  // FIX 1: strip han count from handLabel line — it's shown in the yaku pills below.
  // Only show fu here; total han is redundant.
  const limit=limitLabel(w.han||0,w.fu||0);
  const limitHtml=limit?`<span class="re-limit ${limit.cls}">${limit.en} · ${limit.label}</span>`:'';
  const handInfo=w.fu?`<span class="re-hand"> · ${w.han} Han · ${w.fu} Fu</span>`:'';
  $('rehn').innerHTML=`<span class="re-winner">${escHtml(name)}</span>${limitHtml}${handInfo}`;
  // FIX 2: yaku pills only — dora tiles sit in renderEndTiles, directly above the winning hand tiles
  const yl=$('reyl');yl.innerHTML='';
  for(const y of(w.yakuList||[])){
    const c=document.createElement('div');c.className='yc';
    c.innerHTML=`${escHtml(y.name)}<span class="yh">${y.han}Han</span><span class="yj">${escHtml(y.jp||'')}</span>`;
    yl.appendChild(c);
  }
}

// Double/triple ron prev/next nav (see #re-winner-nav in index.html) —
// shows/hides the whole arrows+indicator strip; hidden for a single winner
// or no winners at all, so an ordinary tsumo/single ron/draw/chonbo looks
// exactly as it did before this existed. Pass null (see onEnd's draw/
// chonbo/other branches) to just hide a stale nav left over from a
// PREVIOUS round's double ron.
function renderWinnerNav(m){
  const nav=$('re-winner-nav'); if(!nav) return;
  if(!m||!m.winners||m.winners.length<=1){ nav.classList.remove('visible'); return; }
  nav.classList.add('visible');
  updateWinnerIndicator(m);
}

// "1 / 2" position readout between the arrows — separate from
// renderWinnerNav (which only runs once per round_end) since stepWinnerNav
// needs to refresh just this text on every click without re-deciding
// whether the whole nav should be visible at all.
function updateWinnerIndicator(m){
  const ind=$('re-winner-indicator'); if(!ind||!m?.winners) return;
  ind.textContent=`${currentEndWinnerIdx+1} / ${m.winners.length}`;
}

// Wired to #re-winner-prev/#re-winner-next's onclick in index.html. Reads
// lastEndState directly (rather than a closure, the way the old per-tab
// buttons captured `m`) since these two arrow buttons are static markup,
// not created fresh per round_end. Wraps around at both ends (Math with
// +length before %, so a negative dir never goes negative overall).
function stepWinnerNav(dir){
  const m=lastEndState;
  if(!m||!m.winners||m.winners.length<=1) return;
  const idx=(currentEndWinnerIdx+dir+m.winners.length)%m.winners.length;
  renderWinnerInfo(m,idx);
  renderEndTiles(m,idx);
  updateWinnerIndicator(m);
  // Restart the slide-in (see .re-win-content's own comment in style.css)
  // — it's declared unconditionally on the element, so just having
  // re-rendered its contents above doesn't replay it on its own; toggling
  // to 'none' and forcing a reflow before clearing it back is the standard
  // way to re-trigger an already-applied CSS animation.
  const wrap=$('re-win-content');
  if(wrap){ wrap.style.animation='none'; void wrap.offsetWidth; wrap.style.animation=''; }
}

// Round-end panel (win/draw/abortive-draw/nagashi) — purely presentational,
// just formats whatever room.js already computed and sent in the round_end
// message (yakuList, han/fu, dora, scores, ...). No scoring logic lives
// here; if a number on this panel looks wrong, the bug is almost certainly
// in server/mahjong.js or server/room.js, not this rendering.
function onEnd(m){
  try{
  inGame=false;
  lastEndState=m;
  $('coin-reward').textContent=''; // round-result panel never shows a payout
  // Both set below (tsumo/ron branch), read again much further down by
  // WIN_BANNER_DELAY — declared up here rather than nested inside that
  // branch's own block scope, and rather than recomputing ronWinnerCount
  // a second time down there.
  let hasYakumanFx=false, winBannerHold=0;
  const loader=$('game-loading'); if(loader) loader.style.display='none';
  $('chat-bar').style.display='none';$('chat-panel').classList.remove('open');chatOpen=false;
  $('dora-panel').style.display='none';
  const reasonLabels={tsumo:'ツモ - TSUMO',ron:'ロン - RON',draw:'流局 - Exhaustive Draw',suukaikan:'四開槓 - Suukaikan',nagashi:'流し満貫 - Mangan at Draw',kyuushu:'九種九牌 - Kyuushu Kyuuhai',chonbo:'チョンボ - Chonbo'};
  $('ret').textContent=reasonLabels[m.reason]||'Round Over';
  if(m.reason==='tsumo'||m.reason==='ron'){
    if(m.reason==='ron') playSfx('sfx-ron', m.winner);
    if(m.reason==='tsumo') playSfx('sfx-tsumo', m.winner);
    const seatName=seat=>seat===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[seat]||`Seat ${seat}`);
    const winnerName=seatName(m.winner);
    // Reuses the same call-banner (.cb-layer) pon/kan/chi/riichi already
    // slide in across the felt, with two new accent-colour variants (see
    // .call-banner[data-type="tsumo"/"ron"] in style.css) — the win itself
    // gets the same dramatic full-width declaration those calls get, rather
    // than jumping straight to the results panel. Reveal is deferred below
    // (WIN_BANNER_DELAY) so the panel doesn't appear underneath/on top of
    // this while it's still sliding/settling.
    // Double/triple ron: m.extraWinners (see _multiRon in room.js) carries
    // every OTHER simultaneous winner beyond the primary m.winner — each
    // one gets their own banner via ronBanners rather than only the primary
    // winner ever being shown, same reasoning callBanner's own single-
    // winner path doesn't apply here. Tsumo can never have more than one
    // winner, so it always stays on the plain single-banner path.
    const ronWinnerCount=m.reason==='ron'?1+(m.extraWinners||[]).length:1;
    winBannerHold=RON_BANNER_HOLD*ronWinnerCount; // matches ronBanners' own sequential-per-winner timing
    if(m.reason==='tsumo') callBanner('tsumo',winnerName,'ツモ');
    else ronBanners([winnerName,...(m.extraWinners||[]).map(r=>seatName(r.winSeat))]);
    // Yakuman/double-yakuman flash (see playYakumanFx) — checked across
    // EVERY winner in m.winners, not just the primary, since a double/
    // triple ron could have more than one qualify. Plays once, AFTER the
    // win banner(s) have had their own full run (tsumo/ron announced first,
    // then the bigger "something huge just happened" moment on top of it)
    // rather than once per qualifying winner. hasYakumanFx/bannerHold feed
    // WIN_BANNER_DELAY below so the results panel waits for both, not just
    // the banner(s).
    const yakumanWinners=(m.winners||[]).filter(w=>{
      const l=limitLabel(w.han||0,w.fu||0);
      return l&&(l.cls==='lbl-yakuman'||l.cls==='lbl-double-yakuman');
    });
    hasYakumanFx=yakumanWinners.length>0;
    if(hasYakumanFx){
      const isDouble=yakumanWinners.some(w=>limitLabel(w.han,w.fu).cls==='lbl-double-yakuman');
      setTimeout(()=>playYakumanFx(isDouble,yakumanWinners.flatMap(w=>(w.yakuList||[]).map(y=>y.name))),winBannerHold);
    }
    // Winner info (name/limit/han-fu/yaku pills/hand tiles) comes from
    // m.winners (see _endRound in room.js — always populated for tsumo/ron,
    // even a single winner) via renderWinnerNav/renderWinnerInfo below,
    // rather than the old m.han/m.fu/m.yakuList/m.hand top-level fields
    // directly — those only ever described the PRIMARY winner, silently
    // dropping any simultaneous ron winner's own hand entirely.
    currentEndWinnerIdx=0;
    renderWinnerNav(m);
    renderWinnerInfo(m,0);
  } else if(m.reason==='draw'){
    $('rehn').textContent='';
    $('reyl').innerHTML='';
    renderWinnerNav(null);
  } else if(m.reason==='chonbo'){
    // room.js's _chonboPenalty passes the offender as `winner` (reusing
    // the same field _endRound already broadcasts for tsumo/ron) — there's
    // no actual winning hand here, just a penalty payment, which the
    // score-delta table below already shows generically for any reason.
    const offenderName=m.winner===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[m.winner]||`Seat ${m.winner}`);
    $('rehn').innerHTML=`<span class="re-winner re-offender">${escHtml(offenderName)}</span><span class="re-hand"> declared a false win</span>`;
    $('reyl').innerHTML='';
    renderWinnerNav(null);
  } else {
    $('rehn').textContent='';
    $('reyl').innerHTML='';
    renderWinnerNav(null);
  }
  // Hand/dora/tenpai tile artwork, score table, and the panel reveal itself
  // are grouped into this one closure so a tsumo/ron win can delay all of
  // it uniformly behind the call-banner declaration above (WIN_BANNER_DELAY
  // below) instead of the panel popping up underneath/on top of a banner
  // that's still sliding in. Every other end reason (draw/chonbo/etc, no
  // banner shown) just calls this immediately.
  const reveal=()=>{
  // Hand/dora/tenpai tile artwork — split into its own function (below)
  // since a resize needs to redraw just this part (see scheduleTileRedraw)
  // without replaying onEnd's one-time side effects (win/tsumo sound, the
  // score count-up animation further down). show() moves up here (rather
  // than staying at the bottom) because renderEndTiles measures #rewt/
  // #re-tenpai's actual layout width to size the winning-hand tiles (see
  // fitEndTileSize) — both are display:none until the screen is shown, so
  // measuring before this would always read 0 and silently fall back to
  // the uncapped --tmd-w/h size the fit logic exists to override.
  show('s-end');
  renderEndTiles(m);
  // Score table with delta column
  const tbl=$('rest');tbl.innerHTML='';
  const sorted=[...(m.scores||[]).map((sc,seat)=>({sc,seat}))].sort((a,b)=>b.sc-a.sc);
  sorted.forEach(({sc,seat},rank)=>{
    const name=seat===mySeat?($('iname').value.trim()||'You'):(m.playerNames?.[seat]||`Seat ${seat}`);
    // reason==='chonbo' reuses the `winner` field for the OFFENDER (see
    // _chonboPenalty in room.js) — they just paid a penalty, not won, so
    // that row gets the loss (red) styling instead of the winner gold.
    const row=document.createElement('tr');
    if(seat===m.winner) row.className=m.reason==='chonbo'?'l':'w';
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
      const duration=1400;
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
  // Drop any still-pending re-arm from a previous round_end — a new
  // round_end supersedes it either way (this one either ends the game or
  // schedules its own below).
  clearTimeout(betweenRoundsTimer);
  if(m.gameOver){
    const btn=$('bround-ready'); if(btn) btn.style.display='none';
    const vrBtn=$('bview-results'); if(vrBtn) vrBtn.style.display=pendingGameOver?'':'none';
    // Game's actually over — leave inGame false so "Leave Room" here just
    // leaves (there's no progress left to lose, so no confirm — see
    // goLobby/showLeaveConfirm). Only a BETWEEN-rounds results panel
    // re-arms inGame below, since the game there really is still going.
  } else {
    betweenRoundsTimer=setTimeout(()=>{ inGame=true; },5500);
  }
  };
  // WIN_BANNER_DELAY — long enough for the call-banner(s) above to slide
  // in, hold, and clear (winBannerHold — a double/triple ron plays its
  // banners one after another, see ronBanners, so this already covers the
  // WHOLE sequence, not just one banner's worth of time), THEN the
  // yakuman/double-yakuman flash after them (hasYakumanFx) if there is
  // one, before the results panel takes over. Only tsumo/ron actually
  // showed a banner above, so every other reason reveals immediately as
  // before.
  const WIN_BANNER_DELAY=winBannerHold+(hasYakumanFx?YAKUMAN_FX_HOLD:0);
  if(m.reason==='tsumo'||m.reason==='ron'){
    // reveal() firing here is OUTSIDE this function's own try (the timeout
    // callback runs long after this synchronous block has already
    // returned), so the outer catch below can't reach it — needs its own,
    // same show('s-end') fallback.
    setTimeout(()=>{ try{ reveal(); }catch(e){ show('s-end'); } },WIN_BANNER_DELAY);
  } else reveal();
  }catch(e){ show('s-end'); }
}

function showGameOverResults(){
  if(!pendingGameOver) return;
  const m=pendingGameOver; pendingGameOver=null;
  onGameOver(m);
}

// Re-queues a new Quick Match with the same gameMode/variant/rules the
// just-finished game used — those are module-level globals set by the
// Match Settings modal (see setMode/setVariant/toggleRule) and never
// touched by onGameOver/goLobby, so they're still exactly what the player
// last picked. resetLobby() first for the same "clean slate" reasons
// every other new-match entry point already goes through (fresh mySeat/
// lastState/discarding/etc., and re-enables #bfind, which findMatch()
// itself no-ops on if left disabled from the game that just ended).
// quick_match's own server-side handler already leaves whatever room this
// connection was just seated in, so no explicit {type:'leave'} is needed
// here — same reasoning findMatch() itself relies on from the lobby.
function playAgain(){
  resetLobby();
  findMatch();
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
  // Max 14 tiles must fit in ~70% of felt width (was 74% — measured on a
  // tall/narrow phone where this term, not the 6%-of-base term below, was
  // the binding constraint: a full 14-tile hand's own draw tile came within
  // ~12px of the right seat's nameplate (.np-wrap-r), close enough that
  // ordinary device/font rendering variance could tip it into actually
  // overlapping. Only affects sizing on screens where THIS term already
  // wins over the 6%-of-base cap below — i.e. exactly the narrow/tall
  // screens where the collision risk exists; wider screens (where the 6%
  // term binds instead) render identically to before.
  const maxByFit=Math.floor((base*0.70)/14);
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
// Every tile face (mkEl/tsvg — the number/suit glyph, not just its box) is
// an inline SVG whose width/height/viewBox/text coordinates are baked in
// as plain numbers at the moment it's drawn, from whatever --tlg/tmd/tsm
// were at the time — unlike a CSS-sized box, it does NOT redraw itself
// just because those custom properties change underneath it. So updating
// the vars above alone (e.g. after a phone rotation mid-game) resizes any
// CSS-only elements immediately but leaves every tile already on screen
// rendered at its old pixel size until something else happens to trigger a
// fresh renderState() — normally the next game_state message, which might
// not arrive for a while if it's not this player's turn. Forcing that
// redraw here closes the gap. Debounced (resize can fire many times in a
// row during an animated rotation/drag-resize, and this rebuilds the whole
// board each time) and passes lastState as BOTH arguments — renderState's
// `prev` param only drives "what just changed" sound-effect/banner diffing
// (see its own comment), so prev===m makes every one of those checks come
// back "nothing changed" instead of spuriously replaying them.
let tileRedrawDebounce=null;
function scheduleTileRedraw(){
  updateTileSizes();
  clearTimeout(tileRedrawDebounce);
  tileRedrawDebounce=setTimeout(()=>{
    if(inGame&&lastState) renderState(lastState,lastState);
    // Round-end screen has its own tiles (dora/hand/tenpai) with the same
    // baked-in-size problem — redraw those too if it's what's showing,
    // via renderEndTiles alone (NOT onEnd(m) again — see its comment for
    // why replaying the whole thing would be wrong here).
    if(lastEndState&&!$('s-end').classList.contains('hidden')) renderEndTiles(lastEndState);
    // Nameplate name/title have the exact same baked-in-size problem as the
    // tiles above, but renderState never touches them (name/title don't
    // change mid-game, so it has no reason to) — fitNameplateText/
    // fitTitleText (see refitAllNameplates' own comment) only ever ran once,
    // at startGame, against whatever viewport was active then. Resizing
    // afterward (phone rotation, or a devtools mobile-emulation toggle)
    // changes --table-size under it without re-running that decision, so a
    // title that picked .one-line's bigger size for the old viewport stays
    // stuck in .one-line at the new, smaller one — CSS still shrinks its
    // font via the clamp() formula, but the one-line-vs-two-line CHOICE
    // itself goes stale, and once the shrunk one-line text no longer fits,
    // nothing but the plain nowrap+ellipsis fallback is left to catch it.
    // Re-running the same fit used at game start closes that gap.
    if(inGame) refitAllNameplates();
  },150);
}
window.addEventListener('resize',scheduleTileRedraw);
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
    const b=$('bmute'); if(b) b.classList.add('off');
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
    const b=$('bfx'); if(b) b.classList.add('off');
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
    const b=$('bdiscard-sfx'); if(b) b.classList.add('off');
  }
  const savedGameTracks=localStorage.getItem('mj-game-tracks');
  if(savedGameTracks){
    // Own try — a corrupt/legacy value here must not abort the rest of this
    // block (it used to skip the identity-pref restore below, which for
    // voice theme then got overwritten with 'Default' by the first
    // renderVoiceThemes() — icon/title survived only because the server
    // re-sends them on profile unlock).
    try{
      const parsed=JSON.parse(savedGameTracks);
      if(Array.isArray(parsed)&&parsed.length&&parsed.every(id=>gameTracks.some(t=>t.id===id))){
        selectedGameTracks=parsed;
      }
    }catch(e){}
  }
  if(localStorage.getItem('mj-game-shuffle')==='1'){
    gameMusicShuffle=true;
    const b=$('bgame-music-shuffle'); if(b) b.classList.remove('off');
  }
}catch(e){}
// Identity prefs (voice theme / icon / title) — separate try so nothing in
// the audio-pref restore above can stop these from loading.
try{
  const savedTheme=localStorage.getItem('mj-voice-theme');
  if(savedTheme) currentVoiceTheme=savedTheme;
  const savedIcon=localStorage.getItem('mj-player-icon');
  if(savedIcon) currentPlayerIcon=savedIcon;
  const savedTitle=localStorage.getItem('mj-player-title');
  if(savedTitle) currentPlayerTitle=savedTitle;
}catch(e){}
renderVoiceThemes();
renderPlayerIcons();
renderTitles();

// Restore last-picked match settings (game mode, player count, rule
// toggles) — same "remember what you last used" treatment as the audio/
// voice-theme prefs above. setMode/setVariant already update their own
// buttons + localStorage + the header summary, so just feed them
// whatever was saved (or leave the built-in defaults if nothing was).
try{
  const savedGameMode=localStorage.getItem('mj-game-mode');
  if(savedGameMode==='hanchan'||savedGameMode==='tonpuu') setMode(savedGameMode);
  const savedVariant=localStorage.getItem('mj-variant');
  if(savedVariant==='sanma'||savedVariant==='yonma') setVariant(savedVariant);
  const savedRules=localStorage.getItem('mj-rules');
  if(savedRules){
    const parsed=JSON.parse(savedRules);
    for(const k of Object.keys(rules)){
      if(typeof parsed[k]==='boolean') rules[k]=parsed[k];
      applyRuleButton(k);
    }
  }
}catch(e){}
updateMatchSummary();
// Start music on first user interaction — via Press Start button
function enterLobby(){
  const btn=$('bstart');
  btn.classList.add('pressed');
  setTimeout(()=>btn.classList.remove('pressed'),135);
  const logoK=document.querySelector('.logo-k');
  if(logoK){ logoK.classList.add('burst'); setTimeout(()=>logoK.classList.remove('burst'),450); }
  $('s-start').classList.add('screen-out');
  setTimeout(()=>{
    playLobbyMusic();
    show('s-lobby');
    $('s-start').classList.remove('screen-out');
    $('s-lobby').classList.add('screen-in');
    setTimeout(()=>$('s-lobby').classList.remove('screen-in'),360);
  },252);
}
// Back to the start screen from the lobby — sends 'leave' unconditionally
// (a no-op server-side if we hadn't actually joined a room yet, e.g. before
// ever pressing Find Match) and reuses resetLobby()'s cleanup, then
// redirects the screen it lands on from s-lobby to s-start.
function backToMenu(){
  wss({type:'leave'});
  resetLobby();
  stopLobbyMusic();
  show('s-start');
}
$('bstart').onclick=enterLobby;
$('about-version').onclick=handleVersionTap;
$('bfind').onclick=findMatch;
$('bready').onclick=pressReady;
$('bcancel').onclick=()=>{wss({type:'leave'});resetLobby();};
$('bleave').onclick=goLobby;
$('bsettings').onclick=toggleSettings;
$('iname').onkeydown=e=>{if(e.key==='Enter')findMatch();};
$('dev-secret').onkeydown=e=>{if(e.key==='Enter')submitDevKey();};
$('profile-code').onkeydown=e=>{if(e.key==='Enter')unlockProfile();};
$('chat-send').onclick=sendChat;
$('chat-input').onkeydown=e=>{if(e.key==='Enter')sendChat();};
// Pings room.js's typing()/TYPING_TIMEOUT_MS on every keystroke — no
// client-side throttling needed, the server already collapses a burst of
// these into a single typing:true broadcast (see typing()'s own comment)
// and self-clears after a few quiet seconds, so there's nothing extra to
// debounce here. inGame-gated since the indicator only has anywhere to
// render (a nameplate) once a game's actually showing; an empty field
// (e.g. after clearing it without sending) doesn't need to keep the
// indicator alive either.
$('chat-input').oninput=()=>{
  if(inGame&&$('chat-input').value.trim()) wss({type:'typing'});
};
$('chat-hist-btn').onclick=toggleChat;
$('chat-close').onclick=toggleChat;
if($('chat-color-btn')) $('chat-color-btn').onclick=()=>toggleColorPicker();
if($('chat-emoji-btn')) $('chat-emoji-btn').onclick=()=>toggleEmojiPicker();
initColorPicker();
initEmojiPicker();
connect();