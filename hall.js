// Shared Hall of Chips renderer — included by index.html and poker.html
(function () {
  // ── Inject shared CSS once ────────────────────────────────────────────────
  if (!document.getElementById('hall-shared-css')) {
    const s = document.createElement('style');
    s.id = 'hall-shared-css';
    s.textContent = `
      .hall-sub-hdr      { font-size:.56rem; letter-spacing:2px; text-transform:uppercase; opacity:.32; margin:10px 0 6px; }
      .hall-sub-hdr:first-child { margin-top:0; }
      .hall-total-row    { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid rgba(255,255,255,.04); }
      .hall-tr-rank      { font-size:.72rem; min-width:20px; }
      .hall-tr-name      { flex:1; font-size:.82rem; text-align:left; }
      .hall-tr-buyin     { font-size:.62rem; opacity:.38; font-variant-numeric:tabular-nums; margin-right:4px; }
      .hall-tr-amt       { font-size:.86rem; font-weight:700; font-variant-numeric:tabular-nums; min-width:52px; text-align:right; }
      .hall-session      { margin-bottom:8px; background:rgba(255,255,255,.022); border-radius:8px; padding:8px 10px; }
      .hall-session-hdr  { font-size:.62rem; font-weight:700; letter-spacing:1px; opacity:.45; margin-bottom:5px; }
      .hall-session-row  { display:flex; align-items:center; gap:6px; padding:2px 0; }
      .hall-sr-name      { flex:1; font-size:.77rem; text-align:left; }
      .hall-sr-buyin     { font-size:.6rem; opacity:.35; font-variant-numeric:tabular-nums; }
      .hall-sr-amt       { font-size:.79rem; font-weight:700; font-variant-numeric:tabular-nums; min-width:48px; text-align:right; }
      .hall-history-toggle { cursor:pointer; user-select:none; display:flex; align-items:center; justify-content:space-between; }
      .hall-history-caret  { font-size:.7rem; opacity:.5; display:inline-block; transition:transform 150ms; margin-left:4px; }
      .hall-history-body   { margin-top:8px; }
      .chip-pos  { color:#2ecc71; }
      .chip-neg  { color:#e74c3c; }
      .chip-zero { opacity:.4; }
    `;
    document.head.appendChild(s);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmtNet(cents) {
    if (cents === 0) return '$0.00';
    return (cents > 0 ? '+' : '-') + '$' + (Math.abs(cents) / 100).toFixed(2);
  }
  function netCls(cents) { return cents > 0 ? 'chip-pos' : cents < 0 ? 'chip-neg' : 'chip-zero'; }

  // ── Toggle handler (inline-safe) ──────────────────────────────────────────
  window._hallToggle = function (el) {
    const body = el.nextElementSibling;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    const caret = el.querySelector('.hall-history-caret');
    if (caret) caret.style.transform = open ? '' : 'rotate(180deg)';
  };

  // ── Main render function ──────────────────────────────────────────────────
  // sessions  : sorted array of session objects
  // decodeName: function(encodedKey) → display name string
  // parseEntry: function(val) → { buyIn, net }
  window.buildHallHtml = function (sessions, decodeName, parseEntry) {
    if (!sessions || !sessions.length) return '<div class="hall-empty">No sessions this month</div>';

    // Monthly totals
    const totals = {};
    for (const s of sessions) {
      for (const [enc, val] of Object.entries(s.results || {})) {
        const n = decodeName(enc);
        const { buyIn, net } = parseEntry(val);
        if (!totals[n]) totals[n] = { buyIn: 0, net: 0 };
        totals[n].buyIn += buyIn;
        totals[n].net   += net;
      }
    }
    const medals = ['🥇', '🥈', '🥉'];
    const sorted = Object.entries(totals).sort((a, b) => b[1].net - a[1].net);

    let html = '<div class="hall-sub-hdr">Monthly Totals</div>';
    sorted.forEach(([name, t], i) => {
      html += `<div class="hall-total-row">
        <span class="hall-tr-rank">${medals[i] || (i + 1) + '.'}</span>
        <span class="hall-tr-name">${name}</span>
        <span class="hall-tr-buyin">$${(t.buyIn / 100).toFixed(0)} in</span>
        <span class="hall-tr-amt ${netCls(t.net)}">${fmtNet(t.net)}</span>
      </div>`;
    });

    // Session history — collapsed by default
    html += '<div class="hall-sub-hdr hall-history-toggle" onclick="_hallToggle(this)">Session History <span class="hall-history-caret">▾</span></div>';
    html += '<div class="hall-history-body" style="display:none">';
    for (const s of sessions) {
      const d       = new Date(s.date + 'T12:00:00');
      const dateStr = d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
      const players = Object.entries(s.results || {})
        .map(([k, v]) => { const { buyIn, net } = parseEntry(v); return [decodeName(k), buyIn, net]; })
        .sort((a, b) => b[2] - a[2]);
      html += `<div class="hall-session"><div class="hall-session-hdr">Game #${s.gameNum} · ${dateStr}${s.time ? ' · ' + s.time : ''}</div>`;
      players.forEach(([name, buyIn, net]) => {
        html += `<div class="hall-session-row">
          <span class="hall-sr-name">${name}</span>
          <span class="hall-sr-buyin">$${(buyIn / 100).toFixed(0)}</span>
          <span class="hall-sr-amt ${netCls(net)}">${fmtNet(net)}</span>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  };
})();
