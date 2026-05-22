/**
 * poker-cards.js — private hole-card reveal interactions
 *
 * Pure animation/interaction layer. Zero changes to poker.js, poker-3d.js,
 * or any game logic. Drops in after GSAP is loaded.
 *
 * What it does:
 *  - Covers dealt hole cards with realistic face-down card backs
 *  - Dealer-style slide-in animation when cards arrive
 *  - Tap  → animated fullscreen reveal with card flip
 *  - Hold → slow press-and-peek (backs retract from bottom, face peeks out)
 *  - Drag up → progressive drag reveal (backs follow finger)
 *  - Swipe down / tap outside → animated close back to table position
 *  - Auto-closes after player acts (Check / Call / Fold / Raise)
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  const HOLD_MS      = 160;  // ms before hold-peek activates
  const DRAG_THRESH  = 10;   // px movement before drag mode starts
  const DRAG_MAX     = 110;  // px drag distance for full reveal
  const DEAL_STAGGER = 0.20; // seconds between card deal animations

  /* ── State ─────────────────────────────────────────────────────────────── */
  let _faceDown   = false; // hole cards currently covered?
  let _isOpen     = false; // fullscreen overlay visible?
  let _peeking    = false; // hold/drag peek active?
  let _holdTimer  = null;
  let _dragOrigin = null;  // { y, dragging } at pointerdown
  let _peekTween  = null;  // active peek GSAP tween
  let _dealTl     = null;  // deal animation timeline
  let _openTl     = null;  // overlay open/close timeline
  let _backsEl    = null;  // .hc-backs DOM element (or null)

  /* ── Shortcuts ─────────────────────────────────────────────────────────── */
  const $        = id  => document.getElementById(id);
  const holeEl   = ()  => $('p-hole');
  const holeArea = ()  => document.querySelector('#s-player .hole-area');
  const overlayEl= ()  => $('card-overlay');
  const oCards   = ()  => $('overlay-cards');
  const strEl    = ()  => $('p-hand-strength');
  const G        = ()  => window.gsap; // GSAP reference

  /* ── CSS ───────────────────────────────────────────────────────────────── */
  function injectCSS() {
    const s = document.createElement('style');
    s.textContent = `
/* position context so .hc-backs can overlay the card images */
#p-hole { position: relative; }

/* ── card backs layer ── */
.hc-backs {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  z-index: 4;
  pointer-events: none;       /* taps pass through to .hole-area */
  transform-origin: top center;
  will-change: transform;
}

/* individual card back */
.hc-back-card {
  width: 66px;
  height: 96px;
  border-radius: 8px;
  background: linear-gradient(150deg, #14105e 0%, #241480 45%, #14105e 100%);
  border: 2px solid rgba(255,255,255,0.16);
  box-shadow: 0 4px 20px rgba(0,0,0,0.75),
              inset 0 1px 0 rgba(255,255,255,0.12);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  will-change: transform, opacity;
}
/* inner border frame */
.hc-back-card::before {
  content: '';
  position: absolute;
  inset: 5px;
  border: 1.5px solid rgba(255,255,255,0.16);
  border-radius: 4px;
  background: repeating-linear-gradient(
    45deg,
    transparent, transparent 4px,
    rgba(255,255,255,0.025) 4px, rgba(255,255,255,0.025) 5px
  );
}
/* subtle suit watermark */
.hc-back-card::after {
  content: '♠';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.6rem;
  color: rgba(255,255,255,0.07);
  pointer-events: none;
}

/* ── hole-area states ── */
.hole-area { cursor: pointer; -webkit-tap-highlight-color: transparent; }

.hole-area.hc-peeking {
  box-shadow: 0 0 28px rgba(46,204,113,0.22) !important;
}

/* ── overlay: always in layout, opacity-controlled ── */
#card-overlay {
  display: flex !important;   /* override display:none */
  opacity: 0;
  pointer-events: none;
  transition: none;           /* GSAP drives everything */
}

/* hand strength inside overlay */
#hc-ov-strength {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: #ffd200;
  text-shadow: 0 1px 8px rgba(0,0,0,0.8);
  opacity: 0.92;
}

/* peek-mode glow at bottom of backs to hint at cards below */
.hc-peeking .hc-backs .hc-back-card {
  box-shadow: 0 4px 20px rgba(0,0,0,0.75),
              0 12px 24px rgba(46,204,113,0.14),
              inset 0 1px 0 rgba(255,255,255,0.12);
}

@media (max-width: 480px) {
  .hc-back-card { width: 56px; height: 82px; }
  #card-overlay .card-img { height: 150px !important; }
}
`;
    document.head.appendChild(s);
  }

  /* ── Card backs layer ──────────────────────────────────────────────────── */
  function createBacks() {
    const hole = holeEl();
    if (!hole) return;
    if (_backsEl) { _backsEl.remove(); }
    const el = document.createElement('div');
    el.className = 'hc-backs';
    el.innerHTML = '<div class="hc-back-card"></div><div class="hc-back-card"></div>';
    hole.appendChild(el);
    _backsEl = el;
  }

  function removeBacks() {
    if (_backsEl) { _backsEl.remove(); _backsEl = null; }
    _faceDown = false;
    _peeking  = false;
  }

  /* ── Deal animation ────────────────────────────────────────────────────── */
  function animateDeal() {
    const g = G();
    if (!_backsEl || !g) return;
    if (_dealTl) _dealTl.kill();

    const cards = Array.from(_backsEl.querySelectorAll('.hc-back-card'));

    // Reset any leftover transforms first
    g.set(_backsEl, { scaleY: 1, clearProps: 'rotateX' });
    cards.forEach((c, i) => {
      // Start position: slide from top-right like a dealer toss
      g.set(c, {
        x: 55 + i * 18,
        y: -120,
        rotation: -14 + i * 10,
        scale: 0.78,
        opacity: 0,
      });
    });

    _dealTl = g.timeline();
    cards.forEach((c, i) => {
      _dealTl.to(c, {
        x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
        duration: 0.38,
        ease: 'power3.out',
      }, i * DEAL_STAGGER);
    });
  }

  /* ── MutationObserver ──────────────────────────────────────────────────── */
  function watchHole() {
    const hole = holeEl();
    if (!hole) return;

    const obs = new MutationObserver(() => {
      const imgs = hole.querySelectorAll('img.card-img');
      if (imgs.length === 2 && !_faceDown) {
        // Cards just arrived — cover them and play deal animation
        _faceDown = true;
        createBacks();
        animateDeal();
      } else if (imgs.length === 0 && _faceDown) {
        // Hand cleared — reset
        removeBacks();
        if (_isOpen) closeOverlay(true);
      }
    });

    obs.observe(hole, { childList: true });
  }

  /* ── Peek (backs retract from bottom exposing card face below) ─────────── */
  function applyPeekScale(scaleY, duration) {
    const g = G();
    if (!_backsEl || !g) return;
    if (_peekTween) _peekTween.kill();
    _peekTween = g.to(_backsEl, {
      scaleY: Math.max(0.04, scaleY),
      duration: duration ?? 0.16,
      ease: 'power2.out',
      transformOrigin: 'top center',
    });
  }

  function startHoldPeek() {
    if (!_faceDown || _isOpen || !_backsEl) return;
    _peeking = true;
    holeArea()?.classList.add('hc-peeking');
    // Slow, controlled partial retraction — feels like pressing a physical card
    const g = G();
    if (!g) return;
    if (_peekTween) _peekTween.kill();
    _peekTween = g.to(_backsEl, {
      scaleY: 0.38,
      duration: 0.55,
      ease: 'power1.inOut',
      transformOrigin: 'top center',
    });
  }

  function endPeek() {
    if (!_backsEl) { _peeking = false; return; }
    _peeking = false;
    holeArea()?.classList.remove('hc-peeking');
    applyPeekScale(1, 0.28);
  }

  /* ── Overlay open ──────────────────────────────────────────────────────── */
  function openOverlay() {
    if (_isOpen || !hasCards()) return;
    _isOpen = true;
    _peeking = false;
    clearHold();
    endPeek();
    window._p3dScene?.flipHoleCards(true);

    const ov  = overlayEl();
    const oc  = oCards();
    const g   = G();
    if (!ov || !oc) return;

    // Copy face-up card images into overlay
    const srcImgs = holeEl()?.querySelectorAll('img.card-img') ?? [];
    oc.innerHTML = Array.from(srcImgs)
      .map(img => `<img class="card-img" src="${img.src}" alt="${img.alt}">`)
      .join('');

    // Inject (once) strength label above hint
    ensureStrengthLabel();
    const sl = $('hc-ov-strength');
    if (sl) sl.textContent = strEl()?.textContent ?? '';

    if (!g) {
      ov.style.opacity = '1';
      ov.style.pointerEvents = 'auto';
      return;
    }

    // Source rect for fly-from effect
    const src  = holeEl()?.getBoundingClientRect() ?? { left: 0, top: 0, width: 140, height: 126 };
    const vw   = window.innerWidth, vh = window.innerHeight;
    const fromX = src.left + src.width  / 2 - vw / 2;
    const fromY = src.top  + src.height / 2 - vh / 2;
    // Scale factor so cards start at the same apparent size as the source panel
    const fromScale = Math.min(src.width / 340, 0.65);

    if (_openTl) _openTl.kill();

    const cardImgs = Array.from(oc.querySelectorAll('img.card-img'));

    // Initial state: overlay invisible, cards at source position, angled like face-down
    g.set(ov,       { opacity: 0, pointerEvents: 'none' });
    g.set(oc,       { x: fromX, y: fromY, scale: fromScale });
    // Cards start tilted toward player — gives the "revealing" feel
    g.set(cardImgs, { rotateX: 22, rotateY: -12, opacity: 0.6, transformOrigin: 'center bottom' });

    _openTl = g.timeline();
    _openTl
      // Fade in background
      .to(ov,       { opacity: 1, pointerEvents: 'auto', duration: 0.30, ease: 'power2.out' }, 0)
      // Fly cards to center
      .to(oc,       { x: 0, y: 0, scale: 1, duration: 0.44, ease: 'power3.out' }, 0)
      // Flatten cards as they arrive (tilt → straight)
      .to(cardImgs, {
        rotateX: 0, rotateY: 0, opacity: 1,
        duration: 0.48, ease: 'power2.out',
        stagger: 0.10,
      }, 0.08);
  }

  /* ── Overlay close ─────────────────────────────────────────────────────── */
  function closeOverlay(instant) {
    if (!_isOpen) return;
    _isOpen = false;
    window._p3dScene?.flipHoleCards(false);

    const ov = overlayEl();
    const oc = oCards();
    const g  = G();

    if (!g || instant) {
      if (ov) { ov.style.opacity = '0'; ov.style.pointerEvents = 'none'; }
      return;
    }

    // Fly cards back to source rect
    const src   = holeEl()?.getBoundingClientRect() ?? { left: 0, top: 0, width: 140, height: 126 };
    const vw    = window.innerWidth, vh = window.innerHeight;
    const toX   = src.left + src.width  / 2 - vw / 2;
    const toY   = src.top  + src.height / 2 - vh / 2;
    const toSc  = Math.min(src.width / 340, 0.65);

    if (_openTl) _openTl.kill();
    _openTl = g.timeline({
      onComplete() {
        ov.style.pointerEvents = 'none';
        g.set(oc, { clearProps: 'all' });
      },
    });
    _openTl
      .to(ov, { opacity: 0, duration: 0.24, ease: 'power2.in' }, 0)
      .to(oc, { x: toX, y: toY, scale: toSc, duration: 0.30, ease: 'power3.in' }, 0);
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */
  function hasCards() {
    return holeEl()?.querySelectorAll('img.card-img').length === 2;
  }

  function ensureStrengthLabel() {
    if ($('hc-ov-strength')) return;
    const el   = document.createElement('div');
    el.id      = 'hc-ov-strength';
    const hint = overlayEl()?.querySelector('.overlay-hint');
    hint
      ? hint.parentNode.insertBefore(el, hint)
      : overlayEl()?.appendChild(el);
  }

  function clearHold() {
    if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
  }

  /* ── Pointer event handlers ────────────────────────────────────────────── */
  function onDown(e) {
    if (!_faceDown || _isOpen) return;
    e.preventDefault();
    _dragOrigin = { y: e.clientY ?? e.touches?.[0]?.clientY, dragging: false };
    clearHold();
    _holdTimer = setTimeout(() => {
      if (_dragOrigin && !_dragOrigin.dragging) startHoldPeek();
    }, HOLD_MS);
  }

  function onMove(e) {
    if (!_dragOrigin || _isOpen) return;
    const y  = e.clientY ?? e.touches?.[0]?.clientY;
    const dy = _dragOrigin.y - y; // positive = dragging upward

    if (!_dragOrigin.dragging && Math.abs(dy) > DRAG_THRESH) {
      _dragOrigin.dragging = true;
      clearHold(); // cancel hold-peek when drag starts
    }

    if (_dragOrigin.dragging && dy > 0) {
      _peeking = true;
      // Map drag distance to backs scaleY: 1.0 → near 0
      const ratio  = Math.min(1, dy / DRAG_MAX);
      const scaleY = 1 - ratio * 0.96; // don't go fully to 0 while dragging
      applyPeekScale(scaleY, 0.05);    // near-instant response
      holeArea()?.classList.add('hc-peeking');
    }
  }

  function onUp(e) {
    if (!_faceDown || _isOpen) { clearHold(); _dragOrigin = null; return; }

    const wasDragging = _dragOrigin?.dragging;
    const wasPeeking  = _peeking;
    clearHold();
    _dragOrigin = null;

    if (wasDragging || wasPeeking) {
      endPeek(); // snap backs back to full coverage
    } else {
      openOverlay(); // short tap → fullscreen reveal
    }
  }

  /* ── Swipe-to-close overlay ────────────────────────────────────────────── */
  function attachOverlayGestures() {
    const ov = overlayEl();
    if (!ov) return;

    let swipeY = null;

    ov.addEventListener('touchstart', e => {
      swipeY = e.touches[0].clientY;
    }, { passive: true });

    ov.addEventListener('touchend', e => {
      if (swipeY !== null && e.changedTouches[0].clientY - swipeY > 55) {
        closeOverlay(false);
      }
      swipeY = null;
    }, { passive: true });

    // Tap outside cards to close
    ov.addEventListener('click', e => {
      const t = e.target;
      if (t === ov || t.classList.contains('overlay-hint') || t.id === 'hc-ov-strength') {
        closeOverlay(false);
      }
    });

    // Remove the original onclick="closeCardOverlay()" — we handle it above
    ov.removeAttribute('onclick');
  }

  /* ── Override poker.js overlay functions ───────────────────────────────── */
  function hookOverlay() {
    window.openCardOverlay  = openOverlay;
    window.closeCardOverlay = () => closeOverlay(false);
  }

  /* ── Auto-close after player acts ─────────────────────────────────────── */
  function watchActions() {
    document.addEventListener('click', e => {
      if (!_isOpen) return;
      const btn = e.target.closest('button');
      if (!btn) return;
      const t = btn.textContent.trim();
      if (['Check', 'Call', 'Fold', 'Raise', 'All-In'].some(a => t.startsWith(a))) {
        setTimeout(() => closeOverlay(false), 650);
      }
    }, true);
  }

  /* ── Wire up hole-area interactions ────────────────────────────────────── */
  function attachHoleArea() {
    const ha = holeArea();
    if (!ha) return;

    // Allow pointer events even during scroll
    ha.style.touchAction = 'none';
    ha.style.userSelect  = 'none';

    ha.addEventListener('pointerdown',   onDown);
    ha.addEventListener('pointermove',   onMove);
    ha.addEventListener('pointerup',     onUp);
    ha.addEventListener('pointercancel', () => { clearHold(); endPeek(); _dragOrigin = null; });
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  function init() {
    injectCSS();
    watchHole();
    attachHoleArea();
    attachOverlayGestures();
    hookOverlay();
    watchActions();

    // Ensure overlay starts fully hidden (GSAP inline style > CSS)
    const g = G(), ov = overlayEl();
    if (g && ov) g.set(ov, { opacity: 0, pointerEvents: 'none' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
