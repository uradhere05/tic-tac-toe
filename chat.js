// Shared Arena Chat widget — drop <script src="/chat.js"></script> before </body>
(function () {
  const DB   = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
  const VAPID = 'BDkO2jrQb2hbZ8HiBJByJKeu8BSrT29cOUcI1svt3akFncLo0XGjpo3hJUJaFwDGZfhmmvhxWTeAHMASdk44qqk';

  // ── helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function getName() { return localStorage.getItem('filoName') || ''; }

  // ── inject CSS ─────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    body { overflow-x: hidden; max-width: 100vw; }
    #ac-bubble { position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
    #ac-toggle { width:54px; height:54px; border-radius:50%; background:linear-gradient(135deg,#f7971e,#ffd200); border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:1.4rem; box-shadow:0 4px 18px rgba(255,140,0,.45); -webkit-tap-highlight-color:transparent; transition:transform 150ms,box-shadow 150ms; position:relative; }
    #ac-toggle:active { transform:scale(.92); }
    #ac-toggle.open { background:linear-gradient(135deg,#4a3080,#6a40c0); box-shadow:0 4px 18px rgba(100,60,200,.45); }
    #ac-badge { position:absolute; top:-2px; right:-2px; background:#ff4444; color:#fff; border-radius:50%; width:18px; height:18px; font-size:.65rem; font-weight:700; display:none; align-items:center; justify-content:center; }
    #ac-panel { width:min(320px,calc(100vw - 40px)); background:rgba(8,4,24,0.95); backdrop-filter:blur(24px) saturate(160%); -webkit-backdrop-filter:blur(24px) saturate(160%); border:1px solid rgba(255,255,255,0.10); border-radius:20px; padding:14px; display:none; flex-direction:column; gap:10px; box-shadow:0 8px 32px rgba(0,0,0,.6); }
    #ac-panel.open { display:flex; }
    #ac-label { font-size:.6rem; letter-spacing:3px; text-transform:uppercase; opacity:.32; text-align:center; color:#fff; }
    #ac-log { text-align:left; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.065); border-radius:14px; height:200px; overflow-y:auto; padding:10px 12px; display:flex; flex-direction:column; gap:5px; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.1) transparent; }
    .ac-msg { font-size:.8rem; line-height:1.4; word-break:break-word; color:#e0e0e0; }
    .ac-msg .ac-name { font-weight:700; color:#ffd200; margin-right:4px; }
    .ac-msg.ac-mine .ac-name { color:#56ccf2; }
    .ac-msg .ac-time { font-size:.65rem; opacity:.38; margin-left:5px; }
    .ac-empty { font-size:.75rem; opacity:.38; text-align:center; color:#fff; padding:20px 0; }
    #ac-input-row { display:flex; gap:8px; }
    #ac-input { flex:1; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:9px 12px; color:#fff; font-size:.85rem; outline:none; -webkit-appearance:none; }
    #ac-input::placeholder { opacity:.35; }
    #ac-send { background:linear-gradient(135deg,#f7971e,#ffd200); border:none; border-radius:10px; padding:9px 14px; color:#08041c; font-weight:700; font-size:.8rem; cursor:pointer; white-space:nowrap; }
    #ac-send:active { opacity:.8; }
  `;
  document.head.appendChild(style);

  // ── inject HTML ────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div id="ac-bubble">
      <div id="ac-panel">
        <div id="ac-label">💬 Arena Chat</div>
        <div id="ac-log"><div class="ac-empty">No messages yet…</div></div>
        <div id="ac-input-row">
          <input id="ac-input" type="text" placeholder="Say something…" maxlength="120"
            autocomplete="off" autocorrect="off" autocapitalize="sentences" inputmode="text" />
          <button id="ac-send">Send</button>
        </div>
      </div>
      <button id="ac-toggle" title="Arena Chat">💬<span id="ac-badge"></span></button>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);

  // ── state ──────────────────────────────────────────────────────────────────
  let open    = false;
  let unread  = 0;
  let lastTs  = parseInt(localStorage.getItem('chatSeenTs') || '0');
  let pollIv  = null;

  // ── badge ──────────────────────────────────────────────────────────────────
  function updateBadge(msgs) {
    const latestTs = msgs.length ? msgs[msgs.length - 1].ts : 0;
    if (open) { lastTs = latestTs; localStorage.setItem('chatSeenTs', String(latestTs)); return; }
    const unseen = msgs.filter(m => m.ts > lastTs).length;
    const badge = document.getElementById('ac-badge');
    if (unseen > 0) {
      unread = unseen;
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = 'flex';
    } else if (!unread) {
      badge.style.display = 'none';
    }
  }

  // ── load messages ──────────────────────────────────────────────────────────
  async function loadChat() {
    const log = document.getElementById('ac-log');
    if (!log) return;
    try {
      const raw  = await fetch(`${DB}/chat.json`).then(r => r.json()).catch(() => ({}));
      const msgs = Object.values(raw || {}).filter(Boolean).sort((a, b) => a.ts - b.ts).slice(-20);
      if (!msgs.length) { log.innerHTML = '<div class="ac-empty">No messages yet…</div>'; updateBadge([]); return; }
      const me = getName();
      log.innerHTML = msgs.map(m => {
        const mine  = m.name === me;
        const d     = new Date(m.ts);
        const valid = !isNaN(d.getTime());
        const h12   = valid ? (d.getHours() % 12 || 12) : 12;
        const mm    = valid ? String(d.getMinutes()).padStart(2, '0') : '00';
        const ampm  = valid ? (d.getHours() < 12 ? 'AM' : 'PM') : '';
        return `<div class="ac-msg${mine ? ' ac-mine' : ''}"><span class="ac-name">${esc(m.name)}</span>${esc(m.text)}<span class="ac-time">${h12}:${mm} ${ampm}</span></div>`;
      }).join('');
      updateBadge(msgs);
      if (open) log.scrollTop = log.scrollHeight;
    } catch {}
  }

  // ── send ───────────────────────────────────────────────────────────────────
  async function sendChat() {
    const inp  = document.getElementById('ac-input');
    const text = (inp?.value || '').trim().slice(0, 300);
    const me   = getName();
    if (!text || !me) return;
    inp.value = '';
    const ts  = Date.now();
    const key = `${ts}_${Math.random().toString(36).slice(2, 7)}`;
    await fetch(`${DB}/chat/${key}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: me, text, ts })
    }).catch(() => {});
    loadChat();
  }

  // ── toggle ─────────────────────────────────────────────────────────────────
  function toggleChat() {
    open = !open;
    const panel = document.getElementById('ac-panel');
    const btn   = document.getElementById('ac-toggle');
    const badge = document.getElementById('ac-badge');
    panel.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    if (open) {
      unread = 0;
      badge.style.display = 'none';
      localStorage.setItem('chatSeenTs', String(lastTs));
      const log = document.getElementById('ac-log');
      if (log) log.scrollTop = log.scrollHeight;
      document.getElementById('ac-input')?.focus();
      const me = getName();
      if (me && Notification.permission !== 'denied') _refreshSub(me);
    }
  }

  // ── prune old messages once ────────────────────────────────────────────────
  function pruneOnce() {
    fetch(`${DB}/chat.json`).then(r => r.json()).then(async data => {
      const cutoff = Date.now() - 86400000;
      const stale  = Object.entries(data || {}).filter(([, v]) => v && v.ts < cutoff).map(([k]) => k);
      for (let i = 0; i < stale.length; i += 10)
        await Promise.all(stale.slice(i, i + 10).map(k => fetch(`${DB}/chat/${k}.json`, { method: 'DELETE' })));
    }).catch(() => {});
  }

  // ── push subscription ──────────────────────────────────────────────────────
  function _b64ToUint8(b) {
    const pad = '='.repeat((4 - b.length % 4) % 4);
    const raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  if ('serviceWorker' in navigator) {
    const swPath = document.currentScript?.src.replace(/\/[^/]+$/, '/sw.js') || '/sw.js';
    navigator.serviceWorker.register(swPath).catch(() => {});
  }

  async function _refreshSub(name) {
    if (!('PushManager' in window)) return;
    try {
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      const sw  = await navigator.serviceWorker.ready;
      let sub   = await sw.pushManager.getSubscription();
      if (!sub) sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToUint8(VAPID) });
      await fetch(`${DB}/push_subs/${encodeURIComponent(name)}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sub: JSON.stringify(sub), ts: Date.now() })
      });
    } catch {}
  }

  // ── wire events ────────────────────────────────────────────────────────────
  document.getElementById('ac-toggle').addEventListener('click', toggleChat);
  document.getElementById('ac-send').addEventListener('click', sendChat);
  document.getElementById('ac-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // Close chat when clicking outside the bubble
  document.addEventListener('click', e => {
    if (!open) return;
    const bubble = document.getElementById('ac-bubble');
    if (bubble && !bubble.contains(e.target)) {
      open = false;
      document.getElementById('ac-panel').classList.remove('open');
      document.getElementById('ac-toggle').classList.remove('open');
      localStorage.setItem('chatSeenTs', String(lastTs));
    }
  }, true);

  // ── start ──────────────────────────────────────────────────────────────────
  loadChat();
  pollIv = setInterval(loadChat, 2500);
  pruneOnce();
})();
