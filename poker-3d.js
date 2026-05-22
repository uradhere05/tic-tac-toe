/* poker-3d.js — FILO Poker 3D Visual Layer
 * Replaces 2D card images with Three.js 3D cards.
 * Uses MutationObserver to sync with existing DOM rendering.
 * Does NOT modify poker.js or any game logic.
 */
'use strict';
(function () {

const THREE = window.THREE;
if (!THREE) { console.warn('[poker-3d] Three.js not loaded'); return; }

// ─── Card data ────────────────────────────────────────────────────────────
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

// ─── Procedural textures ──────────────────────────────────────────────────
function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);  ctx.arcTo(x+w, y,   x+w, y+r,   r);
  ctx.lineTo(x + w, y+h-r);  ctx.arcTo(x+w, y+h, x+w-r,y+h,  r);
  ctx.lineTo(x + r, y + h);  ctx.arcTo(x,   y+h, x,   y+h-r, r);
  ctx.lineTo(x, y + r);      ctx.arcTo(x,   y,   x+r, y,      r);
  ctx.closePath();
}

function makeBackTex() {
  const C = document.createElement('canvas');
  C.width = 256; C.height = 384;
  const ctx = C.getContext('2d');
  rrPath(ctx, 0, 0, 256, 384, 14);
  ctx.fillStyle = '#0e2057'; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.3;
  for (let i = -400; i < 650; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 384, 384); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i + 384, 0); ctx.lineTo(i, 384); ctx.stroke();
  }
  ctx.restore();
  rrPath(ctx, 9, 9, 238, 366, 10);
  ctx.strokeStyle = 'rgba(255,210,0,0.55)'; ctx.lineWidth = 2.5; ctx.stroke();
  rrPath(ctx, 18, 18, 220, 348, 7);
  ctx.strokeStyle = 'rgba(255,210,0,0.22)'; ctx.lineWidth = 1; ctx.stroke();
  const tex = new THREE.CanvasTexture(C);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFaceTex(card) {
  const C = document.createElement('canvas');
  C.width = 256; C.height = 384;
  const ctx = C.getContext('2d');
  rrPath(ctx, 0, 0, 256, 384, 14);
  ctx.fillStyle = '#f9f9f9'; ctx.fill();
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5; ctx.stroke();
  const rank = RANKS[card.r], suit = SUITS[card.s], clr = SUIT_COLOR[card.s];
  ctx.fillStyle = clr;
  ctx.font = 'bold 50px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(rank, 13, 10);
  ctx.font = '33px Arial';
  ctx.fillText(suit, 15, 59);
  ctx.save();
  ctx.translate(256, 384); ctx.rotate(Math.PI);
  ctx.fillStyle = clr;
  ctx.font = 'bold 50px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(rank, 13, 10);
  ctx.font = '33px Arial';
  ctx.fillText(suit, 15, 59);
  ctx.restore();
  ctx.font = '128px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = clr;
  ctx.fillText(suit, 128, 198);
  const tex = new THREE.CanvasTexture(C);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeEdgeTex() {
  const C = document.createElement('canvas');
  C.width = C.height = 4;
  const ctx = C.getContext('2d');
  ctx.fillStyle = '#e6e6e6'; ctx.fillRect(0, 0, 4, 4);
  return new THREE.CanvasTexture(C);
}

const _tc = new Map();
const getTex = (key, fn) => { if (!_tc.has(key)) _tc.set(key, fn()); return _tc.get(key); };
const backTex = () => getTex('back', makeBackTex);
const edgeTex = () => getTex('edge', makeEdgeTex);
const faceTex = c => getTex(`f${c.r}-${c.s}`, () => makeFaceTex(c));

// ─── Card dimensions ──────────────────────────────────────────────────────
const CW = 0.70, CH = 1.00, CD = 0.016;

// ─── PokerCard3D ──────────────────────────────────────────────────────────
class PokerCard3D {
  constructor(scene, onAnimate) {
    const geo  = new THREE.BoxGeometry(CW, CH, CD);
    const edge = new THREE.MeshStandardMaterial({ map: edgeTex(), roughness: 0.9 });
    this.fm = new THREE.MeshStandardMaterial({ map: backTex(), roughness: 0.28, metalness: 0.04 });
    this.bm = new THREE.MeshStandardMaterial({ map: backTex(), roughness: 0.28, metalness: 0.04 });
    // BoxGeometry face order: +X,-X,+Y,-Y,+Z(front),-Z(back)
    this.mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, this.fm, this.bm]);
    this.mesh.visible = false;
    this.isEmpty = true;
    this._onAnimate = onAnimate; // callback to mark zone dirty during animation
    scene.add(this.mesh);
  }

  setCard(card) {
    if (!card) { this.mesh.visible = false; this.isEmpty = true; return; }
    this.isEmpty = false;
    this.mesh.visible = true;

    if (!card.faceDown) {
      this.fm.map = faceTex(card); this.fm.needsUpdate = true;
      this.mesh.rotation.y = 0;
    } else {
      this.fm.map = backTex(); this.fm.needsUpdate = true;
      this.mesh.rotation.y = 0;
    }
    this.bm.map = backTex(); this.bm.needsUpdate = true;
  }

  // FIX #5: deal animation first, then flip reveal after landing
  dealIn(tx, ty, faceUp) {
    const g = window.gsap; if (!g) return;
    const m = this.mesh;
    // Start face-down above, slide to position, then flip face-up after landing
    m.rotation.set(-0.22, Math.PI, (Math.random() - 0.5) * 0.14);
    m.position.set(tx + (Math.random() - 0.5) * 0.3, 2.4, 0.4);

    const tl = g.timeline({ onUpdate: this._onAnimate });
    tl.to(m.position, { x: tx, y: ty, z: 0, duration: 0.40, ease: 'power3.out' }, 0);
    tl.to(m.rotation, { x: 0, z: 0, duration: 0.40, ease: 'power3.out' }, 0);
    if (faceUp) {
      // flip from back (Math.PI) to front (0) after card lands
      tl.to(m.rotation, { y: 0, duration: 0.45, ease: 'power2.inOut' }, 0.28);
    } else {
      tl.to(m.rotation, { y: Math.PI, duration: 0.10 }, 0.38);
    }
  }

  hoverLift(on) {
    const g = window.gsap; if (!g) return;
    g.to(this.mesh.position, {
      y: on ? 0.14 : 0, z: on ? 0.07 : 0,
      duration: 0.18, ease: 'power2.out',
      onUpdate: this._onAnimate,
    });
  }
}

// ─── CardZone ─────────────────────────────────────────────────────────────
class CardZone {
  constructor(el, maxCards, opts) {
    this.el       = el;
    this.maxCards = maxCards;
    this.opts     = opts || {};
    this.cards    = [];
    this.dirty    = true;
    this._prev    = [];
    this._active  = true;   // FIX #2: loop stops when disposed
    this._resizeH = null;   // FIX #3: stored handler for removal
    this._pollId  = null;   // not used here but reserved
    this._build();
  }

  _build() {
    const canvas = document.createElement('canvas');
    canvas.className = 'p3d-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;border-radius:inherit;';
    this.canvas = canvas;
    this.el.style.position = 'relative';
    this.el.style.overflow = 'visible';
    this.el.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene  = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-4, 4, 2.5, -2.5, 0.01, 20);
    this.camera.position.z = 8;
    this._vy = this.opts.vy || 0.72;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.88));
    const sun = new THREE.DirectionalLight(0xfff6e0, 0.60); sun.position.set(1, 4, 6); this.scene.add(sun);
    const fil = new THREE.DirectionalLight(0xe8f0ff, 0.18); fil.position.set(-3,-1, 3); this.scene.add(fil);

    // FIX #5: pass markDirty callback into each card for animation updates
    const onAnim = () => { this.dirty = true; };
    for (let i = 0; i < this.maxCards; i++) this.cards.push(new PokerCard3D(this.scene, onAnim));

    this._resize();

    // FIX #3: store handler so it can be removed on dispose
    this._resizeH = () => { this._resize(); this.dirty = true; };
    window.addEventListener('resize', this._resizeH);

    if (this.opts.hover) this._bindHover(canvas);

    this._loop();
  }

  _resize() {
    const w = this.el.offsetWidth || 300;
    const h = this.el.offsetHeight || 110;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;

    // Dynamically widen the camera if needed so all maxCards always fit
    // horizontally with ~8% margin on each side, even on narrow screens.
    const sp5 = CW * (this.maxCards <= 2 ? 1.24 : this.maxCards <= 3 ? 1.18 : 1.06);
    const neededW = sp5 * (this.maxCards - 1) + CW;
    const vyForFit = neededW / (2 * aspect * 0.84); // 8% margin each side
    const vy = Math.max(this._vy, vyForFit);

    this.camera.left   = -vy * aspect;
    this.camera.right  =  vy * aspect;
    this.camera.top    =  vy;
    this.camera.bottom = -vy;
    this.camera.updateProjectionMatrix();
    // FIX #6: pass maxCards when nothing visible so spacing is correct
    this._layout(this._visible || this.maxCards);
    this.dirty = true;
  }

  _layout(count) {
    // FIX #6: never pass 0 or 1 when multiple slots exist
    if (!count || count < 1) count = this.maxCards;
    const sp = CW * (count <= 2 ? 1.24 : count <= 3 ? 1.18 : count <= 5 ? 1.12 : 1.06);
    const totalW = sp * (count - 1);
    for (let i = 0; i < this.maxCards; i++) {
      if (!this.cards[i]._animating) {
        this.cards[i].mesh.position.x = -totalW / 2 + i * sp;
      }
    }
  }

  update(cards) {
    const keys = cards.map(c => !c ? 'none' : c.faceDown ? 'back' : `${c.r}-${c.s}`);
    const changed = keys.some((k, i) => k !== this._prev[i]);
    if (!changed) return;
    this._prev = keys;

    // FIX #8: compute visibility BEFORE layout so positions are correct
    this._visible = cards.filter(c => !!c).length;
    this._layout(this._visible || this.maxCards);

    for (let i = 0; i < this.maxCards; i++) {
      const card = cards[i], c3d = this.cards[i];
      const wasEmpty = c3d.isEmpty;

      // FIX #5: setCard no longer starts its own flip — dealIn owns the full animation
      c3d.setCard(card || null);

      if (card && wasEmpty) {
        const tx = c3d.mesh.position.x;
        c3d._animating = true;
        c3d.dealIn(tx, 0, !card.faceDown);
        setTimeout(() => { c3d._animating = false; }, 600);
      }
    }
    this.dirty = true;
  }

  _bindHover(canvas) {
    canvas.style.pointerEvents = 'auto';
    const ray   = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hov = -1;

    const onMove = e => {
      const r = canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      mouse.x = ((cx - r.left)  / r.width)  * 2 - 1;
      mouse.y = -((cy - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(mouse, this.camera);
      const meshes = this.cards.filter(c => !c.isEmpty).map(c => c.mesh);
      const hits   = ray.intersectObjects(meshes);
      const idx    = hits.length ? this.cards.findIndex(c => c.mesh === hits[0].object) : -1;
      if (idx !== hov) {
        if (hov >= 0) this.cards[hov].hoverLift(false);
        if (idx >= 0) this.cards[idx].hoverLift(true);
        hov = idx;
      }
      this.dirty = true;
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', () => {
      if (hov >= 0) { this.cards[hov].hoverLift(false); hov = -1; }
      this.dirty = true;
    });
  }

  _loop() {
    // FIX #2: stop loop when disposed
    if (!this._active) return;
    // FIX #1: don't check globalTimeline (always "running") — dirty is set
    // explicitly by onUpdate callbacks in GSAP tweens and by markDirty()
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    requestAnimationFrame(() => this._loop());
  }

  markDirty() { this.dirty = true; }

  // FIX #2 + #3: proper cleanup
  dispose() {
    this._active = false;
    if (this._resizeH) window.removeEventListener('resize', this._resizeH);
    this.renderer.dispose();
  }
}

// ─── DOM helpers ──────────────────────────────────────────────────────────
function parseCards(el, max) {
  const imgs = el.querySelectorAll('img.card-img, img.card-img-sm');
  const out  = [];
  for (let i = 0; i < max; i++) {
    const img = imgs[i];
    out.push(img ? parseCardSrc(img.getAttribute('src') || img.src) : null);
  }
  return out;
}

function hideOriginals(el) {
  el.querySelectorAll('img.card-img, img.card-img-sm, .card-empty').forEach(n => {
    n.style.opacity       = '0';
    n.style.pointerEvents = 'none';
  });
}

// ─── CSS injection ────────────────────────────────────────────────────────
function injectCSS() {
  const s = document.createElement('style');
  s.textContent = `
/* ── poker-3d global enhancements ── */
body {
  background:
    radial-gradient(ellipse 80% 50% at 50% 55%, rgba(14,70,30,0.22) 0%, transparent 60%),
    linear-gradient(160deg,#050d06 0%,#091a0b 45%,#030a04 100%) !important;
}
.community-area {
  background: radial-gradient(ellipse at 50% 40%,
    rgba(18,90,40,0.95) 0%, rgba(8,48,20,0.98) 65%, rgba(4,26,10,1) 100%) !important;
  border: 2px solid rgba(255,210,0,0.28) !important;
  box-shadow:
    inset 0 3px 24px rgba(0,0,0,0.55),
    0 0 28px rgba(46,204,113,0.07) !important;
}
.hole-area {
  background: radial-gradient(ellipse at 50% 40%,
    rgba(12,60,26,0.95) 0%, rgba(5,28,12,0.98) 100%) !important;
  border: 1.5px solid rgba(46,204,113,0.28) !important;
  box-shadow:
    inset 0 2px 14px rgba(0,0,0,0.45),
    0 0 18px rgba(46,204,113,0.05) !important;
}
#d-community, #p-community {
  min-height: 110px !important;
  height: 110px !important;
  overflow: visible !important;
  justify-content: center;
}
#p-hole {
  min-height: 126px !important;
  height: 126px !important;
  overflow: visible !important;
  justify-content: center;
}
#overlay-cards {
  width: min(380px, 88vw) !important;
  height: 210px !important;
  overflow: visible !important;
}
@media (max-width: 430px) {
  #d-community, #p-community {
    min-height: 90px !important; height: 90px !important;
  }
  #p-hole {
    min-height: 104px !important; height: 104px !important;
  }
  #overlay-cards { height: 170px !important; }
}
#card-overlay {
  background: radial-gradient(ellipse 60% 40% at 50% 50%,
    rgba(8,30,50,0.97) 0%, rgba(2,8,15,0.99) 100%) !important;
}
.p3d-active img.card-img,
.p3d-active img.card-img-sm,
.p3d-active .card-empty { opacity: 0 !important; pointer-events: none !important; }
`;
  document.head.appendChild(s);
}

// ─── Zone watcher ─────────────────────────────────────────────────────────
const zones     = new Map();
const observers = [];
// FIX #4: store poll ID so it can be cleared
let _pollId = null;

function setupZone(el, maxCards, opts) {
  if (zones.has(el)) return zones.get(el);
  const zone = new CardZone(el, maxCards, opts);
  zones.set(el, zone);
  el.classList.add('p3d-active');

  // Guard: re-attach canvas when poker.js nukes innerHTML
  const guard = new MutationObserver(() => {
    if (!el.contains(zone.canvas)) {
      el.appendChild(zone.canvas);
      zone._resize();
      zone.markDirty();
    }
  });
  guard.observe(el, { childList: true });
  observers.push(guard);

  // Sync: update 3D cards when DOM cards change
  const sync = new MutationObserver(() => {
    if (!el.contains(zone.canvas)) return;
    hideOriginals(el);
    zone.update(parseCards(el, maxCards));
  });
  sync.observe(el, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['src'],
  });
  observers.push(sync);

  return zone;
}

function watchEl(id, maxCards, opts) {
  const el = document.getElementById(id);
  if (!el) return;
  const zone = setupZone(el, maxCards, opts);
  hideOriginals(el);
  zone.update(parseCards(el, maxCards));
}

// FIX #7: watch #card-overlay for display changes to resize overlay-cards immediately
function watchOverlayVisibility() {
  const overlay = document.getElementById('card-overlay');
  const zone    = zones.get(document.getElementById('overlay-cards'));
  if (!overlay || !zone) return;

  const obs = new MutationObserver(() => {
    if (overlay.classList.contains('active')) {
      // overlay just opened — resize immediately so cards render at correct resolution
      requestAnimationFrame(() => { zone._resize(); zone.markDirty(); });
    }
  });
  obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  observers.push(obs);
}

function startPoll() {
  // FIX #4: store ID, clear on unload
  _pollId = setInterval(() => {
    zones.forEach((zone, el) => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        zone._resize();
        hideOriginals(el);
        zone.update(parseCards(el, zone.maxCards));
      }
    });
  }, 600);

  window.addEventListener('pagehide', () => {
    clearInterval(_pollId);
    observers.forEach(o => o.disconnect());
    zones.forEach(z => z.dispose());
  });
}

// ─── innerHTML shim for p-hole ────────────────────────────────────────────
function shimHoleInnerHTML() {
  const el = document.getElementById('p-hole');
  if (!el) return;
  const nativeDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(el, 'innerHTML', {
    get() {
      const nonCanvas = Array.from(this.childNodes).filter(
        n => !(n.nodeType === 1 && n.tagName === 'CANVAS' && n.classList.contains('p3d-canvas'))
      );
      if (nonCanvas.length === 0) return '';
      return nativeDesc.get.call(this);
    },
    set(v) { nativeDesc.set.call(this, v); },
    configurable: true,
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────
function init() {
  injectCSS();
  watchEl('d-community',   5, { hover: true,  vy: 0.72 });
  watchEl('p-community',   5, { hover: false, vy: 0.72 });
  watchEl('p-hole',        2, { hover: false, vy: 0.72 });
  watchEl('overlay-cards', 2, { hover: false, vy: 0.66 });
  shimHoleInnerHTML();
  watchOverlayVisibility(); // FIX #7
  startPoll();
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();

})();
