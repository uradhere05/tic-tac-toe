/* poker-3d.js — FILO Poker Full 3D Table Scene
 * Replaces flat card zones with an immersive oval poker table.
 * Full-screen Three.js canvas behind the HTML overlay.
 * HTML UI (buttons, chips, status) floats on top with glassmorphism.
 * All game logic in poker.js untouched.
 */
'use strict';
(function () {

const THREE = window.THREE;
if (!THREE) { console.warn('[poker-3d] Three.js not loaded'); return; }

// ─── Card texture (same procedural system) ────────────────────────────────
const RANKS      = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS      = ['♠','♥','♦','♣'];
const SUIT_COLOR = ['#111','#c00','#c00','#111'];
const RANK_CODES = ['2','3','4','5','6','7','8','9','0','J','Q','K','A'];
const SUIT_MAP   = { S:0, H:1, D:2, C:3 };

function parseCardSrc(src) {
  if (!src) return null;
  const m = src.match(/\/img\/([^.?#]+)\.png/);
  if (!m) return null;
  if (m[1] === 'back') return { faceDown: true };
  const rc = m[1].slice(0, -1), sc = m[1].slice(-1);
  const r = RANK_CODES.indexOf(rc), s = SUIT_MAP[sc];
  if (r < 0 || s === undefined) return null;
  return { r, s, faceDown: false };
}

function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);  ctx.arcTo(x+w,y,   x+w,y+r,   r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w,y+h, x+w-r,y+h, r);
  ctx.lineTo(x+r, y+h);  ctx.arcTo(x,  y+h, x,  y+h-r, r);
  ctx.lineTo(x,   y+r);  ctx.arcTo(x,  y,   x+r,y,      r);
  ctx.closePath();
}

function makeBackTex() {
  const C = document.createElement('canvas'); C.width=256; C.height=384;
  const ctx = C.getContext('2d');
  rrPath(ctx,0,0,256,384,14); ctx.fillStyle='#0e2057'; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1.3;
  for (let i=-400;i<650;i+=16){
    ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+384,384);ctx.stroke();
    ctx.beginPath();ctx.moveTo(i+384,0);ctx.lineTo(i,384);ctx.stroke();
  }
  ctx.restore();
  rrPath(ctx,9,9,238,366,10); ctx.strokeStyle='rgba(255,210,0,0.55)';ctx.lineWidth=2.5;ctx.stroke();
  rrPath(ctx,18,18,220,348,7); ctx.strokeStyle='rgba(255,210,0,0.22)';ctx.lineWidth=1;ctx.stroke();
  const t=new THREE.CanvasTexture(C); t.colorSpace=THREE.SRGBColorSpace; return t;
}

function makeFaceTex(card) {
  const C=document.createElement('canvas'); C.width=256; C.height=384;
  const ctx=C.getContext('2d');
  rrPath(ctx,0,0,256,384,14); ctx.fillStyle='#f9f9f9';ctx.fill();
  ctx.strokeStyle='#ccc';ctx.lineWidth=1.5;ctx.stroke();
  const rank=RANKS[card.r],suit=SUITS[card.s],clr=SUIT_COLOR[card.s];
  ctx.fillStyle=clr;
  ctx.font='bold 50px Arial';ctx.textAlign='left';ctx.textBaseline='top';
  ctx.fillText(rank,13,10); ctx.font='33px Arial';ctx.fillText(suit,15,59);
  ctx.save();ctx.translate(256,384);ctx.rotate(Math.PI);
  ctx.fillStyle=clr;ctx.font='bold 50px Arial';ctx.textAlign='left';ctx.textBaseline='top';
  ctx.fillText(rank,13,10);ctx.font='33px Arial';ctx.fillText(suit,15,59);
  ctx.restore();
  ctx.font='128px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=clr;ctx.fillText(suit,128,198);
  const t=new THREE.CanvasTexture(C); t.colorSpace=THREE.SRGBColorSpace; return t;
}

function makeEdgeTex() {
  const C=document.createElement('canvas');C.width=C.height=4;
  C.getContext('2d').fillStyle='#e6e6e6';C.getContext('2d').fillRect(0,0,4,4);
  return new THREE.CanvasTexture(C);
}

const _tc=new Map();
const getTex=(k,fn)=>{if(!_tc.has(k))_tc.set(k,fn());return _tc.get(k);};
const backTex=()=>getTex('back',makeBackTex);
const edgeTex=()=>getTex('edge',makeEdgeTex);
const faceTex=c=>getTex(`f${c.r}-${c.s}`,()=>makeFaceTex(c));

// ─── Table constants ──────────────────────────────────────────────────────
const TRX=3.8, TRZ=2.1;   // table ellipse radii
const TY=0;                 // table surface Y
const CW=0.72, CH=1.00, CD=0.014; // card dimensions (lying flat)
const COMM_Z=-0.10;         // community cards — center table, clearly visible
const HOLE_Z= 1.20;         // hole cards — bottom of table, above UI
const COMM_SPACING=CW*1.22;
const HOLE_SPACING=CW*1.50;

// ─── Label sprite builder ─────────────────────────────────────────────────
function makeLabelSprite(text, sub, color='#2ecc71') {
  const W=320, H=80;
  const C=document.createElement('canvas'); C.width=W; C.height=H;
  const ctx=C.getContext('2d');
  ctx.clearRect(0,0,W,H);
  // pill background
  ctx.fillStyle='rgba(0,0,0,0.72)';
  rrPath(ctx,0,0,W,H,14); ctx.fill();
  ctx.strokeStyle=color+'88'; ctx.lineWidth=2;
  rrPath(ctx,1,1,W-2,H-2,13); ctx.stroke();
  // name
  ctx.fillStyle='#ffffff'; ctx.font='bold 28px Arial';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text, W/2, sub?28:H/2);
  if (sub) {
    ctx.fillStyle=color; ctx.font='20px Arial';
    ctx.fillText(sub, W/2, 56);
  }
  const tex=new THREE.CanvasTexture(C); tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false});
  const sprite=new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

// ─── Card3D — PlaneGeometry lying flat on table ───────────────────────────
// PlaneGeometry default normal = +Z. With rotation.x = -π/2 the normal
// becomes +Y (pointing up), so the texture is visible from the overhead camera.
class Card3D {
  constructor(scene, onDirty) {
    const geo = new THREE.PlaneGeometry(CW, CH);
    this.mat = new THREE.MeshStandardMaterial({
      map: backTex(), roughness: 0.35, metalness: 0.0,
      side: THREE.DoubleSide, // visible from both above and below
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2; // lie flat, face pointing UP
    this.mesh.visible = false;
    this.isEmpty = true;
    this._dirty = onDirty;
    this._card = null;
    scene.add(this.mesh);
  }

  setCard(card) {
    if (!card) { this.mesh.visible = false; this.isEmpty = true; this._card = null; return; }
    this.isEmpty = false;
    this.mesh.visible = true;
    this._card = card;
    this.mat.map = card.faceDown ? backTex() : faceTex(card);
    this.mat.needsUpdate = true;
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.rotation.z = 0;
    this.mesh.scale.set(1, 1, 1);
  }

  dealIn(tx, ty, tz, faceUp) {
    const g = window.gsap; if (!g) return;
    const m = this.mesh;
    // Start with back texture, above the table
    this.mat.map = backTex(); this.mat.needsUpdate = true;
    m.scale.set(1, 1, 1);
    m.position.set(tx + (Math.random() - 0.5) * 0.5, TY + 2.2, tz - 2.2);
    m.rotation.set(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.3);
    const tl = g.timeline({ onUpdate: this._dirty });
    // Slide to table surface
    tl.to(m.position, { x: tx, y: TY + 0.006, z: tz, duration: 0.40, ease: 'power3.out' }, 0);
    tl.to(m.rotation, { z: 0, duration: 0.40, ease: 'power3.out' }, 0);
    if (faceUp && this._card) {
      // Card-flip illusion: squash to edge-on, swap texture, expand back
      const card = this._card;
      const mat  = this.mat;
      const dirty = this._dirty;
      tl.to(m.scale, { x: 0, duration: 0.12, ease: 'power2.in' }, 0.36);
      tl.call(() => { mat.map = faceTex(card); mat.needsUpdate = true; dirty(); }, [], 0.48);
      tl.to(m.scale, { x: 1, duration: 0.16, ease: 'power2.out' }, 0.48);
    }
  }

  hoverLift(on) {
    const g = window.gsap; if (!g) return;
    g.to(this.mesh.position, {
      y: on ? TY + 0.10 : TY + 0.006,
      duration: 0.18, ease: 'power2.out', onUpdate: this._dirty,
    });
  }
}

// ─── Main Table Scene ─────────────────────────────────────────────────────
class PokerTableScene {
  constructor() {
    this.dirty=true;
    this._active=false;
    this._seats=[];
    this._prevComm=[];
    this._prevHole=[];
    this._build();
  }

  _build() {
    // Full-screen canvas — sits behind HTML (z-index:0)
    this.canvas=document.createElement('canvas');
    this.canvas.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;transition:opacity 0.5s;opacity:0;';
    document.body.insertBefore(this.canvas, document.body.firstChild);

    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=0.85;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x050d06);
    this.scene.fog=new THREE.FogExp2(0x050d06, 0.06);

    this.camera=new THREE.PerspectiveCamera(55,1,0.1,60);
    this.camera.position.set(0,5.0,5.8);
    this.camera.lookAt(0,0,0.2);

    this._buildTable();
    this._buildLights();
    this._buildCards();
    this._buildSeatGroup();

    this._resizeH=()=>{this._resize();this.dirty=true;};
    window.addEventListener('resize',this._resizeH);
    this._resize();
    this._loop();
  }

  _buildTable() {
    // Felt surface
    const shape=new THREE.Shape();
    for (let i=0;i<=80;i++){
      const a=(i/80)*Math.PI*2;
      const x=Math.cos(a)*TRX, z=Math.sin(a)*TRZ;
      i===0?shape.moveTo(x,z):shape.lineTo(x,z);
    }
    const feltGeo=new THREE.ShapeGeometry(shape,80);
    feltGeo.rotateX(-Math.PI/2);
    const feltMat=new THREE.MeshStandardMaterial({color:0x1a5c2a,roughness:0.96,metalness:0});
    const felt=new THREE.Mesh(feltGeo,feltMat);
    felt.position.y=TY; felt.receiveShadow=true;
    this.scene.add(felt);

    // Inner accent line
    const innerShape=new THREE.Shape();
    for (let i=0;i<=80;i++){
      const a=(i/80)*Math.PI*2;
      innerShape[i===0?'moveTo':'lineTo'](Math.cos(a)*(TRX-0.25),Math.sin(a)*(TRZ-0.15));
    }
    const innerGeo=new THREE.ShapeGeometry(innerShape,80);
    innerGeo.rotateX(-Math.PI/2);
    const innerMat=new THREE.MeshStandardMaterial({color:0x155020,roughness:0.98,metalness:0});
    const inner=new THREE.Mesh(innerGeo,innerMat);
    inner.position.y=TY+0.001; inner.receiveShadow=true;
    this.scene.add(inner);

    // Wood rim
    const rimPath=[];
    for (let i=0;i<=80;i++){
      const a=(i/80)*Math.PI*2;
      rimPath.push(new THREE.Vector3(Math.cos(a)*(TRX+0.22),TY-0.12,Math.sin(a)*(TRZ+0.22)));
    }
    const rimCurve=new THREE.CatmullRomCurve3(rimPath,true);
    const rimGeo=new THREE.TubeGeometry(rimCurve,80,0.22,8,true);
    const rimMat=new THREE.MeshStandardMaterial({color:0x1a0b04,roughness:0.65,metalness:0.12});
    const rim=new THREE.Mesh(rimGeo,rimMat);
    rim.castShadow=true; rim.receiveShadow=true;
    this.scene.add(rim);

    // Table leg base
    const legGeo=new THREE.CylinderGeometry(0.6,0.9,0.5,12);
    const legMat=new THREE.MeshStandardMaterial({color:0x120804,roughness:0.6,metalness:0.1});
    const leg=new THREE.Mesh(legGeo,legMat);
    leg.position.set(0,TY-0.5,0); leg.castShadow=true;
    this.scene.add(leg);

    // Floor
    const floorGeo=new THREE.PlaneGeometry(40,40); floorGeo.rotateX(-Math.PI/2);
    const floorMat=new THREE.MeshStandardMaterial({color:0x060c07,roughness:1});
    const floor=new THREE.Mesh(floorGeo,floorMat);
    floor.position.y=-0.38; floor.receiveShadow=true;
    this.scene.add(floor);
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x334455,0.45));

    // Main overhead warm spot
    const spot=new THREE.SpotLight(0xfff0cc,2.8,14,Math.PI/5.5,0.25,1.2);
    spot.position.set(0,8,0); spot.castShadow=true;
    spot.shadow.mapSize.width=spot.shadow.mapSize.height=1024;
    this.scene.add(spot,spot.target);

    // Cool side fills
    const fl=new THREE.PointLight(0x2244aa,0.7,10); fl.position.set(-5,3,0); this.scene.add(fl);
    const fr=new THREE.PointLight(0x44aa55,0.5,10); fr.position.set(5,3,0); this.scene.add(fr);
    const fb=new THREE.PointLight(0x112233,0.9,12); fb.position.set(0,2,-6); this.scene.add(fb);

    // Under-rim glow
    const glow=new THREE.PointLight(0x22ff66,0.3,4); glow.position.set(0,TY-0.1,0); this.scene.add(glow);
  }

  _buildCards() {
    const onDirty=()=>{this.dirty=true;};
    this.communityCards=[];
    this.holeCards=[];

    for (let i=0;i<5;i++){
      const c=new Card3D(this.scene,onDirty);
      c.mesh.position.set(COMM_SPACING*(i-2),TY+0.006,COMM_Z);
      // rotation.x = -π/2 is already set by Card3D constructor (flat, face UP)
      this.communityCards.push(c);
    }
    for (let i=0;i<2;i++){
      const c=new Card3D(this.scene,onDirty);
      const xOff=HOLE_SPACING*(i-0.5);
      c.mesh.position.set(xOff,TY+0.006,HOLE_Z);
      c.mesh.rotation.z=(i===0?-0.05:0.05); // slight fan
      this.holeCards.push(c);
    }
  }

  _buildSeatGroup() {
    this.seatGroup=new THREE.Group();
    this.scene.add(this.seatGroup);
  }

  // Update seat labels around the table for other players
  updateSeats(players) {
    // Clear old labels
    while (this.seatGroup.children.length) this.seatGroup.remove(this.seatGroup.children[0]);
    this._seats=[];
    if (!players.length) return;

    // Distribute seats around top arc of table (Z negative half)
    const n=players.length;
    for (let i=0;i<n;i++){
      const p=players[i];
      // Spread from -150° to -30° around the ellipse (top half)
      const t=n===1?0.5:(i/(n-1));
      const angle=(-5*Math.PI/6)+(t*(4*Math.PI/6)); // -150° to -30° in radians from +X
      const sx=Math.cos(angle)*(TRX*0.78);
      const sz=Math.sin(angle)*(TRZ*0.78);
      const color=p.acting?'#2ecc71':p.folded?'#555555':p.allin?'#ff4444':'#aaaaaa';
      const sub=p.stack?('$'+(p.stack/100).toFixed(2)):null;
      const label=makeLabelSprite(p.name,sub,color);
      label.position.set(sx,TY+0.6,sz);
      this.seatGroup.add(label);
      this._seats.push({name:p.name,sprite:label});
    }
    this.dirty=true;
  }

  // Update community cards from array of {r,s,faceDown}|null
  updateCommunity(cards) {
    const keys=cards.map(c=>!c?'none':c.faceDown?'back':`${c.r}-${c.s}`);
    if (keys.join()===this._prevComm.join()) return;
    this._prevComm=keys;
    const visible=cards.filter(Boolean).length;
    // Re-space cards based on visible count
    const sp=visible<=3?COMM_SPACING*1.05:COMM_SPACING;
    for (let i=0;i<5;i++){
      const c=this.communityCards[i];
      const tx=sp*(i-2);
      if (!this.communityCards[i]._animating) c.mesh.position.x=tx;
      const wasEmpty=c.isEmpty;
      c.setCard(cards[i]||null);
      if (cards[i]&&wasEmpty){
        c._animating=true; c.dealIn(tx,TY+0.008,COMM_Z,!cards[i].faceDown);
        setTimeout(()=>{c._animating=false;},700);
      }
    }
    this.dirty=true;
  }

  // Update hole cards
  updateHole(cards) {
    const keys=cards.map(c=>!c?'none':c.faceDown?'back':`${c.r}-${c.s}`);
    if (keys.join()===this._prevHole.join()) return;
    this._prevHole=keys;
    for (let i=0;i<2;i++){
      const c=this.holeCards[i];
      const tx=HOLE_SPACING*(i-0.5);
      const wasEmpty=c.isEmpty;
      c.setCard(cards[i]||null);
      if (cards[i]&&wasEmpty){
        c._animating=true; c.dealIn(tx,TY+0.008,HOLE_Z,!cards[i].faceDown);
        setTimeout(()=>{c._animating=false;},700);
      }
    }
    this.dirty=true;
  }

  // Show or hide the table scene
  setVisible(on) {
    this._active=on;
    this.canvas.style.opacity=on?'1':'0';
    this.dirty=true;
  }

  _resize() {
    const w=window.innerWidth, h=window.innerHeight;
    this.renderer.setSize(w,h,false);
    this.camera.aspect=w/h;
    this.camera.updateProjectionMatrix();
    this.dirty=true;
  }

  _loop() {
    if (this.dirty&&this._active){
      this.renderer.render(this.scene,this.camera);
      this.dirty=false;
    }
    requestAnimationFrame(()=>this._loop());
  }

  markDirty(){this.dirty=true;}
  dispose(){
    this._active=false;
    window.removeEventListener('resize',this._resizeH);
    this.renderer.dispose();
  }
}

// ─── DOM Bridge ───────────────────────────────────────────────────────────
function parseCards(el,max){
  const imgs=el?el.querySelectorAll('img.card-img,img.card-img-sm'):[];
  const out=[];
  for(let i=0;i<max;i++) out.push(imgs[i]?parseCardSrc(imgs[i].getAttribute('src')||imgs[i].src):null);
  return out;
}

function parsePlayers(othersEl){
  if(!othersEl) return [];
  return Array.from(othersEl.querySelectorAll('.pl-row')).map(row=>{
    const name=(row.querySelector('.pl-name')||row.querySelector('span'))?.textContent?.replace(/[⏳🔴🔘]/g,'').trim()||'';
    const stackEl=row.querySelector('.pl-stack');
    const stack=stackEl?Math.round(parseFloat(stackEl.textContent.replace('$',''))*100):0;
    return{
      name,stack,
      acting:row.classList.contains('pl-acting'),
      folded:row.classList.contains('pl-folded'),
      allin:row.textContent.includes('🔴'),
    };
  }).filter(p=>p.name);
}

// ─── CSS Injection ────────────────────────────────────────────────────────
function injectCSS(){
  const s=document.createElement('style');
  s.textContent=`
/* ── Player screen: 3D table fills top half, UI in bottom half ── */
#s-player.p3d-screen {
  background: transparent !important;
  justify-content: flex-start !important;
  padding-top: min(52vh, 420px) !important;
  padding-bottom: max(16px, env(safe-area-inset-bottom)) !important;
  overflow-y: visible !important;
  gap: 6px;
}
/* Title bar stays at top, fixed */
#s-player.p3d-screen .p-title,
#s-player.p3d-screen .p-sub,
#s-player.p3d-screen #p-name-badge,
#s-player.p3d-screen #p-blinds {
  position: fixed !important;
  top: max(10px, env(safe-area-inset-top)) !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  z-index: 20 !important;
  pointer-events: none;
  text-align: center;
}
#s-player.p3d-screen .p-title  { top: max(10px, env(safe-area-inset-top)) !important; font-size:1.1rem !important; margin-bottom:0 !important; }
#s-player.p3d-screen .p-sub    { top: max(34px, calc(env(safe-area-inset-top) + 24px)) !important; font-size:.55rem !important; }
#s-player.p3d-screen #p-name-badge { top: max(52px, calc(env(safe-area-inset-top) + 42px)) !important; font-size:.75rem !important; }
#s-player.p3d-screen #p-blinds { top: max(68px, calc(env(safe-area-inset-top) + 58px)) !important; font-size:.6rem !important; }
/* Hide community and hole wrappers — cards are on 3D table */
#s-player.p3d-screen #p-community-wrap,
#s-player.p3d-screen .hole-area,
#s-player.p3d-screen .ann-card { display: none !important; }
/* Glassmorphism bottom panels */
#s-player.p3d-screen .status-row {
  background: rgba(0,0,0,0.62) !important;
  backdrop-filter: blur(14px) !important;
  -webkit-backdrop-filter: blur(14px) !important;
  border-radius: 14px !important;
  border: 1px solid rgba(255,255,255,0.09) !important;
  padding: 10px 8px !important;
  width: 100% !important;
  max-width: 420px !important;
}
#s-player.p3d-screen .action-panel {
  background: rgba(0,0,0,0.65) !important;
  backdrop-filter: blur(14px) !important;
  -webkit-backdrop-filter: blur(14px) !important;
  border-radius: 14px !important;
  border: 1px solid rgba(255,255,255,0.07) !important;
  padding: 10px !important;
  width: 100% !important;
  max-width: 420px !important;
}
#s-player.p3d-screen #p-others {
  background: rgba(0,0,0,0.50) !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
  border-radius: 12px !important;
  border: 1px solid rgba(255,255,255,0.06) !important;
  padding: 6px 10px !important;
  width: 100% !important;
  max-width: 420px !important;
}
/* Hand strength label — show below hole cards in 3D as floating text */
#s-player.p3d-screen .hand-strength {
  position: fixed !important;
  bottom: calc(220px + env(safe-area-inset-bottom)) !important;
  left: 50% !important; transform: translateX(-50%) !important;
  z-index: 15 !important;
  font-size: .72rem !important;
  text-shadow: 0 1px 4px rgba(0,0,0,0.9) !important;
  pointer-events: none;
}
/* Keep overlay for tap-to-view */
#card-overlay {
  background: radial-gradient(ellipse 60% 40% at 50% 50%,
    rgba(8,30,50,0.97) 0%,rgba(2,8,15,0.99) 100%) !important;
}
/* body background: dark casino floor */
body {
  background: #050d06 !important;
}
/* Dealer screen: keep existing enhanced style */
.community-area {
  background: radial-gradient(ellipse at 50% 40%,
    rgba(18,90,40,0.95) 0%,rgba(8,48,20,0.98) 65%,rgba(4,26,10,1) 100%) !important;
  border: 2px solid rgba(255,210,0,0.28) !important;
  box-shadow: inset 0 3px 24px rgba(0,0,0,0.55),0 0 28px rgba(46,204,113,0.07) !important;
}
.hole-area {
  background: radial-gradient(ellipse at 50% 40%,
    rgba(12,60,26,0.95) 0%,rgba(5,28,12,0.98) 100%) !important;
  border: 1.5px solid rgba(46,204,113,0.28) !important;
}
#d-community,#p-community {
  min-height:110px!important;height:110px!important;overflow:visible!important;justify-content:center;
}
#p-hole {min-height:126px!important;height:126px!important;overflow:visible!important;justify-content:center;}
#overlay-cards {width:min(380px,88vw)!important;height:210px!important;overflow:visible!important;}
@media(max-width:430px){
  #d-community,#p-community{min-height:90px!important;height:90px!important;}
  #p-hole{min-height:104px!important;height:104px!important;}
  #overlay-cards{height:170px!important;}
}
`;
  document.head.appendChild(s);
}

// ─── innerHTML shim for p-hole ────────────────────────────────────────────
function shimHoleInnerHTML(){
  const el=document.getElementById('p-hole'); if(!el)return;
  const nd=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  Object.defineProperty(el,'innerHTML',{
    get(){
      const nc=Array.from(this.childNodes).filter(n=>!(n.nodeType===1&&n.tagName==='CANVAS'&&n.classList.contains('p3d-canvas')));
      return nc.length===0?'':nd.get.call(this);
    },
    set(v){nd.set.call(this,v);},
    configurable:true,
  });
}

// ─── Dealer screen: keep CardZone system for the console view ─────────────
// (Player view uses the full-table scene; dealer console keeps zones)
class CardZone {
  constructor(el,maxCards,opts){
    this.el=el;this.maxCards=maxCards;this.opts=opts||{};
    this.cards=[];this.dirty=true;this._prev=[];this._active=true;
    this._resizeH=null;this._build();
  }
  _build(){
    const canvas=document.createElement('canvas');
    canvas.className='p3d-canvas';
    canvas.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;border-radius:inherit;';
    this.canvas=canvas;
    this.el.style.position='relative';this.el.style.overflow='visible';
    this.el.appendChild(canvas);
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene=new THREE.Scene();
    this.camera=new THREE.OrthographicCamera(-4,4,2.5,-2.5,0.01,20);
    this.camera.position.z=8;
    this._vy=this.opts.vy||0.72;
    this.scene.add(new THREE.AmbientLight(0xffffff,0.88));
    const sun=new THREE.DirectionalLight(0xfff6e0,0.60);sun.position.set(1,4,6);this.scene.add(sun);
    const fil=new THREE.DirectionalLight(0xe8f0ff,0.18);fil.position.set(-3,-1,3);this.scene.add(fil);
    const onAnim=()=>{this.dirty=true;};
    // Use flat-box cards for dealer zone (standing upright)
    for(let i=0;i<this.maxCards;i++){
      const geo=new THREE.BoxGeometry(0.70,1.00,0.016);
      const edge=new THREE.MeshStandardMaterial({map:edgeTex(),roughness:0.9});
      const fm=new THREE.MeshStandardMaterial({map:backTex(),roughness:0.28,metalness:0.04});
      const bm=new THREE.MeshStandardMaterial({map:backTex(),roughness:0.28,metalness:0.04});
      const mesh=new THREE.Mesh(geo,[edge,edge,edge,edge,fm,bm]);
      mesh.visible=false;
      this.scene.add(mesh);
      this.cards.push({mesh,fm,bm,isEmpty:true,_animating:false});
    }
    this._resize();
    this._resizeH=()=>{this._resize();this.dirty=true;};
    window.addEventListener('resize',this._resizeH);
    this._loop();
  }
  _resize(){
    const w=this.el.offsetWidth||300,h=this.el.offsetHeight||110;
    if(!w||!h)return;
    this.renderer.setSize(w,h,false);
    const aspect=w/h;
    const sp5=0.70*(this.maxCards<=2?1.24:this.maxCards<=3?1.18:1.06);
    const neededW=sp5*(this.maxCards-1)+0.70;
    const vyFit=neededW/(2*aspect*0.84);
    const vy=Math.max(this._vy,vyFit);
    this.camera.left=-vy*aspect;this.camera.right=vy*aspect;
    this.camera.top=vy;this.camera.bottom=-vy;
    this.camera.updateProjectionMatrix();
    this._layout(this._visible||this.maxCards);
    this.dirty=true;
  }
  _layout(count){
    if(!count||count<1)count=this.maxCards;
    const sp=0.70*(count<=2?1.24:count<=3?1.18:count<=5?1.12:1.06);
    const totalW=sp*(count-1);
    for(let i=0;i<this.maxCards;i++){
      if(!this.cards[i]._animating) this.cards[i].mesh.position.x=-totalW/2+i*sp;
    }
  }
  update(cards){
    const keys=cards.map(c=>!c?'none':c.faceDown?'back':`${c.r}-${c.s}`);
    if(keys.join()===this._prev.join())return;
    this._prev=keys;
    this._visible=cards.filter(Boolean).length;
    this._layout(this._visible||this.maxCards);
    for(let i=0;i<this.maxCards;i++){
      const card=cards[i],c3d=this.cards[i];
      const wasEmpty=c3d.isEmpty;
      if(!card){c3d.mesh.visible=false;c3d.isEmpty=true;continue;}
      c3d.isEmpty=false;c3d.mesh.visible=true;
      if(!card.faceDown){c3d.fm.map=faceTex(card);c3d.fm.needsUpdate=true;c3d.mesh.rotation.y=0;}
      else{c3d.fm.map=backTex();c3d.fm.needsUpdate=true;c3d.mesh.rotation.y=0;}
      c3d.bm.map=backTex();c3d.bm.needsUpdate=true;
      if(card&&wasEmpty&&window.gsap){
        c3d._animating=true;
        const tx=c3d.mesh.position.x;
        c3d.mesh.position.set(tx+(Math.random()-0.5)*0.3,2.4,0.4);
        c3d.mesh.rotation.set(-0.22,card.faceDown?0:Math.PI,(Math.random()-0.5)*0.14);
        const tl=window.gsap.timeline({onUpdate:()=>{this.dirty=true;}});
        tl.to(c3d.mesh.position,{x:tx,y:0,z:0,duration:0.40,ease:'power3.out'},0);
        tl.to(c3d.mesh.rotation,{x:0,z:0,duration:0.40,ease:'power3.out'},0);
        if(!card.faceDown) tl.to(c3d.mesh.rotation,{y:0,duration:0.45,ease:'power2.inOut'},0.28);
        setTimeout(()=>{c3d._animating=false;},700);
      }
    }
    this.dirty=true;
  }
  _loop(){
    if(!this._active)return;
    if(this.dirty){this.renderer.render(this.scene,this.camera);this.dirty=false;}
    requestAnimationFrame(()=>this._loop());
  }
  markDirty(){this.dirty=true;}
  dispose(){this._active=false;if(this._resizeH)window.removeEventListener('resize',this._resizeH);this.renderer.dispose();}
}

// ─── Init ─────────────────────────────────────────────────────────────────
let tableScene, dealerZone, overlayZone;
const observers=[];
let _pollId=null;

function hideOriginals(el){
  el.querySelectorAll('img.card-img,img.card-img-sm,.card-empty').forEach(n=>{
    n.style.opacity='0';n.style.pointerEvents='none';
  });
}

function setupDealerZone(){
  const el=document.getElementById('d-community'); if(!el||dealerZone)return;
  dealerZone=new CardZone(el,5,{vy:0.72});
  el.classList.add('p3d-active');
  const guard=new MutationObserver(()=>{
    if(!el.contains(dealerZone.canvas)){el.appendChild(dealerZone.canvas);dealerZone._resize();dealerZone.markDirty();}
  });
  guard.observe(el,{childList:true});
  const sync=new MutationObserver(()=>{
    if(!el.contains(dealerZone.canvas))return;
    hideOriginals(el);
    dealerZone.update(parseCards(el,5));
  });
  sync.observe(el,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  observers.push(guard,sync);
  hideOriginals(el); dealerZone.update(parseCards(el,5));
}

function setupOverlayZone(){
  const el=document.getElementById('overlay-cards'); if(!el||overlayZone)return;
  overlayZone=new CardZone(el,2,{vy:0.66});
  el.classList.add('p3d-active');
  const guard=new MutationObserver(()=>{
    if(!el.contains(overlayZone.canvas)){el.appendChild(overlayZone.canvas);overlayZone._resize();overlayZone.markDirty();}
  });
  guard.observe(el,{childList:true});
  const sync=new MutationObserver(()=>{
    if(!el.contains(overlayZone.canvas))return;
    hideOriginals(el); overlayZone.update(parseCards(el,2));
  });
  sync.observe(el,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  observers.push(guard,sync);
  // Resize overlay zone when overlay opens
  const overlay=document.getElementById('card-overlay');
  if(overlay){
    const obs=new MutationObserver(()=>{
      if(overlay.classList.contains('active')) requestAnimationFrame(()=>{overlayZone._resize();overlayZone.markDirty();});
    });
    obs.observe(overlay,{attributes:true,attributeFilter:['class']});
    observers.push(obs);
  }
  hideOriginals(el); overlayZone.update(parseCards(el,2));
}

function syncTableScene(){
  if(!tableScene)return;
  const commEl=document.getElementById('p-community');
  const holeEl=document.getElementById('p-hole');
  const othersEl=document.getElementById('p-others');
  tableScene.updateCommunity(parseCards(commEl,5));
  tableScene.updateHole(parseCards(holeEl,2));
  tableScene.updateSeats(parsePlayers(othersEl));
}

function watchScreens(){
  let lastScreen='';
  const screenObs=new MutationObserver(()=>{
    const active=document.querySelector('.screen.active');
    const id=active?.id||'';
    if(id===lastScreen)return;
    lastScreen=id;
    const isPlayer=id==='s-player';
    tableScene.setVisible(isPlayer);
    if(isPlayer){
      active.classList.add('p3d-screen');
      syncTableScene();
      setupDealerZone();
    } else {
      document.getElementById('s-player')?.classList.remove('p3d-screen');
    }
    if(id==='s-dealer'){
      setupDealerZone();
    }
  });
  screenObs.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
  observers.push(screenObs);
}

function watchPlayerDOM(){
  const commEl=document.getElementById('p-community');
  const holeEl=document.getElementById('p-hole');
  const othersEl=document.getElementById('p-others');
  [commEl,holeEl,othersEl].forEach(el=>{
    if(!el)return;
    const obs=new MutationObserver(()=>syncTableScene());
    obs.observe(el,{childList:true,subtree:true,attributes:true,attributeFilter:['src','class']});
    observers.push(obs);
  });
}

function startPoll(){
  _pollId=setInterval(()=>{
    syncTableScene();
    if(dealerZone){
      const el=document.getElementById('d-community');
      if(el&&el.offsetWidth>0){dealerZone._resize();hideOriginals(el);dealerZone.update(parseCards(el,5));}
    }
    if(overlayZone){
      const el=document.getElementById('overlay-cards');
      if(el&&el.offsetWidth>0){overlayZone._resize();overlayZone.update(parseCards(el,2));}
    }
    tableScene.markDirty();
  },600);
  window.addEventListener('pagehide',()=>{
    clearInterval(_pollId);
    observers.forEach(o=>o.disconnect());
    tableScene?.dispose();dealerZone?.dispose();overlayZone?.dispose();
  });
}

function init(){
  injectCSS();
  tableScene=new PokerTableScene();
  window._p3dScene=tableScene; // debug access
  shimHoleInnerHTML();
  setupOverlayZone();
  watchScreens();
  watchPlayerDOM();
  startPoll();
  // Activate immediately if already on player screen
  const active=document.querySelector('.screen.active');
  if(active?.id==='s-player'){
    active.classList.add('p3d-screen');
    tableScene.setVisible(true);
    syncTableScene();
    setupDealerZone();
  }
}

document.readyState==='loading'
  ?document.addEventListener('DOMContentLoaded',init)
  :init();

})();
