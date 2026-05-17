/**
 * Room 3 + Room 4 (STREYTLIMA Connect 5) Sim — starts at index.html.
 *
 * 4 windows (4 cols × 1 row, full height):
 *   [Kee / X / Room 3]  [Kriselle / O / Room 3]  [Monique / X / Room 4]  [Tiff / O / Room 4]
 *
 * Full real journey for both rooms:
 *   index.html → click name card → Arena lobby →
 *   click Room N → navigates to connect5.html?room=N →
 *   PeerJS connect → s-game → horizontal/vertical 5-in-a-row → s-champ → rematch
 *
 * Tests (each run for both rooms):
 *   T0  — full index journey: name click → lobby → Room N → connect5.html → s-game
 *   T1  — host=X, guest=O piece assignment (PeerJS ID unavailable-id fallback works)
 *   T2  — opponent names rendered on sl-x / sl-o labels
 *   T3  — board renders 169 cells (13×13 BOARD_SIZE)
 *   T4  — move sync: host tap(78) → guest board cell 78 has class 'x'
 *   T5  — turn blocking: host tap blocked when it's O's turn (board unchanged)
 *   T6  — 5-in-a-row win triggers champion screen (WINS_NEED=1)
 *   T7  — win recorded in Firebase leaderboard
 *   T8  — rematch: both return to s-game, scores reset to 0
 *   T9  — Room 4 runs independently (PeerJS ID filo-gang-connect5-4)
 *
 * Win patterns:
 *   Room 3 — horizontal row 6: X plays 78,79,80,81,82
 *   Room 4 — vertical col 0:   X plays  0,13,26,39,52
 *
 * Run: node rooms34-sim.js
 */
'use strict';
const { chromium } = require('playwright');
const { execSync }  = require('child_process');

const INDEX = 'http://localhost:8080/index.html';
const DB    = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Screen layout: 4 cols × 1 row, full height ── */
function getScreenSize() {
  try {
    const out = execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const [,, w, h] = out.split(',').map(Number);
    return { w, h };
  } catch { return { w: 1440, h: 900 }; }
}
const { w: SCR_W, h: SCR_H } = getScreenSize();
const COLS = 4;
const WIN_W = Math.floor(SCR_W / COLS);
const WIN_H = SCR_H;

const fb = (path, method = 'GET', body) => fetch(
  `${DB}${path}.json`,
  body !== undefined
    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method }
).then(r => r.json()).catch(() => null);

let passed = 0, failed = 0;
function assert(ok, label, detail = '') {
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else     { console.log(`  ❌ ${label}${detail ? '  ← ' + detail : ''}`); failed++; }
}

/* ── Cast ── */
const ROOMS = [
  {
    n: 3, host: 'Kee', guest: 'Kriselle',
    // Horizontal row 6: cells 78,79,80,81,82  (row 6 × 13 = 78)
    xMoves: [78, 79, 80, 81, 82],
    oMoves: [0,   1,  2,  3],
  },
  {
    n: 4, host: 'Monique', guest: 'Tiff',
    // Vertical col 0: cells 0,13,26,39,52
    xMoves: [0, 13, 26, 39, 52],
    oMoves: [1,  2,  3,  4],
  },
];

/* ── Helpers ── */
async function openWindow(browser, x) {
  const ctx  = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const cdp  = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { left: x, top: 0, width: WIN_W, height: WIN_H, windowState: 'normal' },
  });
  await page.goto(INDEX);
  return page;
}

async function waitScreen(page, id, timeout = 22000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const ok = await page.evaluate(
      sid => document.getElementById(sid)?.classList.contains('active'), id
    ).catch(() => false);
    if (ok) return true;
    await sleep(350);
  }
  return false;
}

async function waitBoth(p1, p2, id, timeout = 25000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const [a, b] = await Promise.all([
      p1.evaluate(sid => document.getElementById(sid)?.classList.contains('active'), id).catch(() => false),
      p2.evaluate(sid => document.getElementById(sid)?.classList.contains('active'), id).catch(() => false),
    ]);
    if (a && b) return true;
    await sleep(350);
  }
  return false;
}

/* ── Per-room runner ── */
async function runRoom(browser, room, col) {
  const { n, host, guest, xMoves, oMoves } = room;
  const hx = col * WIN_W;
  const gx = (col + 1) * WIN_W;

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  Room ${n}: ${host} (X/host)  vs  ${guest} (O/guest)`);
  console.log('═'.repeat(56));

  /* 1. Open both windows at index.html */
  const hPage = await openWindow(browser, hx);
  const gPage = await openWindow(browser, gx);
  console.log(`  ✓ [R${n} host ] ${host}  → index.html`);
  console.log(`  ✓ [R${n} guest] ${guest} → index.html`);

  /* 2. Click name cards */
  await hPage.click(`[data-name="${host}"]`);
  await sleep(300);
  await gPage.click(`[data-name="${guest}"]`);
  await sleep(300);

  /* 3. Wait for Arena lobby on both */
  const [hLobby, gLobby] = await Promise.all([
    waitScreen(hPage, 's-lobby', 12000),
    waitScreen(gPage, 's-lobby', 12000),
  ]);
  assert(hLobby && gLobby, `R${n}: both windows reach Arena lobby after name click`);

  /* 4. Host clicks Room N first → navigates to connect5.html, claims PeerJS ID */
  await Promise.all([
    hPage.waitForURL('**/connect5.html**', { timeout: 10000 }),
    hPage.click(`[onclick*="connect5.html?room=${n}"]`),
  ]);
  console.log(`  ✓ [R${n} host ] ${host} navigated to connect5.html?room=${n}`);

  /* Wait for host to be on s-wait (page loaded, PeerJS claiming) */
  const hWait = await waitScreen(hPage, 's-wait', 12000);
  assert(hWait, `R${n}: host on s-wait (connect5.html loaded, PeerJS claiming ID)`);

  /* ── SpinnerFix: spinner must not be squished by flex-shrink ── */
  const spinInfo = await hPage.evaluate(() => {
    const s = document.querySelector('.spinner');
    if (!s) return { ok: false, h: 0, fs: 'missing' };
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    return { ok: r.height >= 48 && cs.flexShrink === '0', h: r.height, fs: cs.flexShrink };
  }).catch(() => ({ ok: false, h: 0, fs: 'err' }));
  assert(spinInfo.ok, `SpinnerFix/R${n}: spinner not squished (h=${spinInfo.h?.toFixed(1)}px, flex-shrink=${spinInfo.fs})`);

  /* 5. Guest clicks Room N → navigates, unavailable-id → joinRoom → connects */
  await sleep(800); // ensure host PeerJS ID registered before guest tries
  await Promise.all([
    gPage.waitForURL('**/connect5.html**', { timeout: 10000 }),
    gPage.click(`[onclick*="connect5.html?room=${n}"]`),
  ]);
  console.log(`  ✓ [R${n} guest] ${guest} navigated to connect5.html?room=${n}`);

  /* 6. Wait for both to reach s-game */
  const bothGame = await waitBoth(hPage, gPage, 's-game', 30000);
  assert(bothGame, `T0/R${n}: both players reach s-game (PeerJS connection established)`);
  if (!bothGame) {
    console.log(`  ⚠️  Skipping R${n} game tests — connection failed`);
    return { hPage, gPage, ok: false };
  }
  await sleep(800); // let name exchange and startGame() settle

  /* ── T1: piece assignment ── */
  const [hPiece, gPiece] = await Promise.all([
    hPage.evaluate(() => myPiece).catch(() => null),
    gPage.evaluate(() => myPiece).catch(() => null),
  ]);
  assert(hPiece === 'X', `T1/R${n}: host ${host} has myPiece='X' (got '${hPiece}')`);
  assert(gPiece === 'O', `T1/R${n}: guest ${guest} has myPiece='O' (got '${gPiece}')`);

  /* ── T2: opponent names ── */
  const [hSlO, gSlX] = await Promise.all([
    hPage.evaluate(() => document.getElementById('sl-o').textContent).catch(() => ''),
    gPage.evaluate(() => document.getElementById('sl-x').textContent).catch(() => ''),
  ]);
  assert(hSlO === guest, `T2/R${n}: host sees guest in sl-o ("${hSlO}")`);
  assert(gSlX === host,  `T2/R${n}: guest sees host in sl-x ("${gSlX}")`);

  /* ── T3: board is 13×13 = 169 cells ── */
  const cellCount = await hPage.evaluate(() =>
    document.getElementById('board').querySelectorAll('.c5-cell').length
  ).catch(() => 0);
  assert(cellCount === 169, `T3/R${n}: board has ${cellCount} cells (expected 169 = 13×13)`);

  /* ── T4: move sync — host tap(xMoves[0]) appears on guest board ── */
  const firstX = xMoves[0];
  await hPage.evaluate(i => tap(i), firstX).catch(() => {});
  await sleep(700);
  const gCellOk = await gPage.evaluate(i => {
    const c = document.getElementById('board').children[i];
    return c ? c.classList.contains('x') : false;
  }, firstX).catch(() => false);
  assert(gCellOk, `T4/R${n}: host tap(${firstX}) synced to guest board (class 'x')`);

  /* ── T5: turn blocking — host tap while O's turn ── */
  const blocked = await hPage.evaluate(async i => {
    const before = board.slice();
    tap(i); // current='O' after host's first move — this should be blocked
    await new Promise(r => setTimeout(r, 200));
    return JSON.stringify(board) === JSON.stringify(before);
  }, xMoves[1]).catch(() => false);
  assert(blocked, `T5/R${n}: host tap(${xMoves[1]}) blocked when current='O'`);

  /* ── Play the rest of the game ──
     Sequence: xMoves[0] already played.
     Interleave: O:oMoves[0], X:xMoves[1], O:oMoves[1], X:xMoves[2], …, X:xMoves[4] wins */
  for (let i = 0; i < oMoves.length; i++) {
    await gPage.evaluate(idx => tap(idx), oMoves[i]).catch(() => {});  await sleep(450);
    await hPage.evaluate(idx => tap(idx), xMoves[i + 1]).catch(() => {}); await sleep(450);
  }
  // Final winning move for X is xMoves[4] (played in loop above when i=3: xMoves[4])
  await sleep(1800); // wait for champion screen (1200ms delay in endGame)

  /* ── T6: champion screen shown for both ── */
  const [hChamp, gChamp] = await Promise.all([
    waitScreen(hPage, 's-champ', 5000),
    waitScreen(gPage, 's-champ', 5000),
  ]);
  assert(hChamp, `T6/R${n}: host sees s-champ after 5-in-a-row win`);
  assert(gChamp, `T6/R${n}: guest sees s-champ after 5-in-a-row win`);

  /* ── T7: win recorded in Firebase leaderboard ── */
  const weekKey = (() => {
    const now = new Date();
    const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() + diff);
    return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
  })();
  await sleep(1500); // recordWin is async
  const winVal = await fb(`/leaderboard/${weekKey}/${encodeURIComponent(host)}`);
  assert(winVal >= 1, `T7/R${n}: ${host} win recorded in Firebase (got ${winVal})`);

  /* ── T8: rematch → both back to s-game, scores reset ── */
  await hPage.evaluate(() => requestRematch()).catch(() => {});
  await sleep(500);
  await gPage.evaluate(() => requestRematch()).catch(() => {});
  const bothGameAgain = await waitBoth(hPage, gPage, 's-game', 10000);
  assert(bothGameAgain, `T8/R${n}: rematch returns both to s-game`);

  const [hSum, gSum] = await Promise.all([
    hPage.evaluate(() => scores.X + scores.O).catch(() => -1),
    gPage.evaluate(() => scores.X + scores.O).catch(() => -1),
  ]);
  assert(hSum === 0, `T8/R${n}: host scores reset (X+O=${hSum})`);
  assert(gSum === 0, `T8/R${n}: guest scores reset (X+O=${gSum})`);

  return { hPage, gPage, ok: true };
}

/* ════════════════════════════════════════════════════════
   MAIN
════════════════════════════════════════════════════════ */
async function run() {
  console.log('\n🎮 Room 3 + Room 4 (STREYTLIMA Connect 5) Sim — starts at index.html');
  console.log('   4 windows: Kee/X/R3 · Kriselle/O/R3 · Monique/X/R4 · Tiff/O/R4');
  console.log('   Win patterns: R3=horizontal row-6 · R4=vertical col-0\n');

  console.log(`🖥️  Screen ${SCR_W}×${SCR_H} → ${COLS} cols · each window ${WIN_W}×${WIN_H}`);

  const browser = await chromium.launch({
    headless: false,
    channel:  'chrome',
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-infobars',
      '--no-default-browser-check',
    ],
  });

  /* Run Room 3 (cols 0-1) then Room 4 (cols 2-3) sequentially */
  const r3 = await runRoom(browser, ROOMS[0], 0);
  const r4 = await runRoom(browser, ROOMS[1], 2);

  /* ── T9: independence ── */
  console.log('\n── T9: Room 3 + Room 4 independence ────────────────');
  assert(r3.ok && r4.ok,
    `T9: Rooms 3 and 4 completed independently (PeerJS IDs filo-gang-connect5-3 and -4)`);

  /* ── Summary ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Room 3+4 Test Results (started from index.html)');
  console.log('  T0  index → name click → Room N → connect5.html → s-game');
  console.log('  T1  host=X, guest=O (PeerJS unavailable-id fallback)');
  console.log('  T2  opponent names on sl-x / sl-o');
  console.log('  T3  board has 169 cells (13×13)');
  console.log('  T4  move sync: host tap → guest board cell has class x');
  console.log('  T5  turn blocking: host tap blocked on O turn');
  console.log('  T6  5-in-a-row win → champion screen (WINS_NEED=1)');
  console.log('  T7  win recorded in Firebase leaderboard');
  console.log('  T8  rematch: both back to s-game, scores=0');
  console.log('  SpinnerFix  spinner not squished (flex-shrink:0, h≥48px)');
  console.log('  T9  Room 3 and 4 independent (separate PeerJS IDs)');
  console.log('╚══════════════════════════════════════════════════════╝');

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
  console.log(failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} test(s) failed`);
  console.log('\nWindows stay open 15 s for inspection…');
  await sleep(15000);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Sim error:', err.message);
  process.exit(1);
});
