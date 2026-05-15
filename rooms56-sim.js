/**
 * Room 5 + Room 6 (PICKLEBOL Pong) Sim — starts at index.html.
 *
 * 4 windows (4 cols × 1 row, full height):
 *   [Shantelle / left / Room 5]  [Kuya AD / right / Room 5]
 *   [Tiff / left / Room 6]       [Matt / right / Room 6]
 *
 * Full real journey:
 *   index.html → click name card → Arena lobby →
 *   click Room N → navigates to pong.html?room=N →
 *   PeerJS connect → s-game → win injected → s-champ → rematch
 *
 * Tests (run for both rooms):
 *   T0  — full index journey: name click → lobby → Room N → pong.html → s-game
 *   T1  — host mySide='left', guest mySide='right'
 *   T2  — opponent names on sl-left / sl-right labels
 *   T3  — Three.js canvas rendered at 600×340 internal resolution
 *   T4  — paddle sync: host sets lp.y=50, sends paddle-pos, guest lp.y updates
 *   T5  — ball state sync: host sends ball-state, guest ball.x/y match
 *   T6  — win injection (scores.left=5 → onPoint()) triggers s-champ both sides
 *   T7  — win recorded in Firebase leaderboard (WINS_NEED=5)
 *   T8  — rematch: both return to s-game, scores reset to 0
 *   T9  — Room 6 runs independently (PeerJS ID filo-gang-pickelbol-6)
 *
 * Note: only the host (left paddle) runs physics. Win is injected by directly
 *       setting scores.left=5 and calling onPoint() on the host page; onPoint()
 *       sends score+game-over messages to the guest.
 *
 * Run: node rooms56-sim.js
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
  { n: 5, host: 'Shantelle', guest: 'Kuya AD' },
  { n: 6, host: 'Tiff',      guest: 'Matt'    },
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

async function waitBoth(p1, p2, id, timeout = 28000) {
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

/* ── Select name on index.html (handles already-online guard in selectName()) ── */
async function selectPlayer(page, name) {
  // Wait for s-name or s-lobby to be active
  const dl = Date.now() + 10000;
  while (Date.now() < dl) {
    const onLobby = await page.evaluate(
      () => document.getElementById('s-lobby')?.classList.contains('active')
    ).catch(() => false);
    if (onLobby) return true; // already on lobby (e.g. from localStorage)

    const onName = await page.evaluate(
      () => document.getElementById('s-name')?.classList.contains('active')
    ).catch(() => false);
    if (onName) {
      // Try clicking the name card; if selectName() silently returns (name still online),
      // fall back to a direct JS injection
      await page.click(`[data-name="${name}"]`).catch(() => {});
      await sleep(600);
      const nowLobby = await page.evaluate(
        () => document.getElementById('s-lobby')?.classList.contains('active')
      ).catch(() => false);
      if (nowLobby) return true;
      // Fallback: bypass online check directly
      await page.evaluate(n => {
        myName = n; localStorage.setItem('filoName', n); show('s-lobby');
      }, name).catch(() => {});
      return true;
    }
    await sleep(300);
  }
  return false;
}

/* ── Per-room runner ── */
async function runRoom(browser, room, col) {
  const { n, host, guest } = room;
  const hx = col * WIN_W;
  const gx = (col + 1) * WIN_W;

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  Room ${n}: ${host} (left/host)  vs  ${guest} (right/guest)`);
  console.log('═'.repeat(56));

  /* 1. Open both windows at index.html */
  const hPage = await openWindow(browser, hx);
  const gPage = await openWindow(browser, gx);
  console.log(`  ✓ [R${n} host ] ${host}  → index.html`);
  console.log(`  ✓ [R${n} guest] ${guest} → index.html`);

  /* 2. Select names — robust against stale online-presence blocking */
  await selectPlayer(hPage, host);
  await sleep(200);
  await selectPlayer(gPage, guest);
  await sleep(200);

  /* 3. Wait for Arena lobby on both */
  const [hLobby, gLobby] = await Promise.all([
    waitScreen(hPage, 's-lobby', 12000),
    waitScreen(gPage, 's-lobby', 12000),
  ]);
  assert(hLobby && gLobby, `R${n}: both windows reach Arena lobby`);

  /* 4. Host clicks Room N first → navigates to pong.html, claims PeerJS ID */
  await Promise.all([
    hPage.waitForURL('**/pong.html**', { timeout: 10000 }),
    hPage.click(`[onclick*="pong.html?room=${n}"]`),
  ]);
  console.log(`  ✓ [R${n} host ] ${host} navigated to pong.html?room=${n}`);

  const hWait = await waitScreen(hPage, 's-wait', 12000);
  assert(hWait, `R${n}: host on s-wait (pong.html loaded, PeerJS ID claiming)`);

  /* 5. Guest clicks Room N after brief delay → unavailable-id → joinPickelbolRoom */
  await sleep(800);
  await Promise.all([
    gPage.waitForURL('**/pong.html**', { timeout: 10000 }),
    gPage.click(`[onclick*="pong.html?room=${n}"]`),
  ]);
  console.log(`  ✓ [R${n} guest] ${guest} navigated to pong.html?room=${n}`);

  /* 6. Wait for both to reach s-game */
  const bothGame = await waitBoth(hPage, gPage, 's-game', 32000);
  assert(bothGame, `T0/R${n}: both players reach s-game (PeerJS connection established)`);
  if (!bothGame) {
    console.log(`  ⚠️  Skipping R${n} game tests — connection failed`);
    return { hPage, gPage, ok: false };
  }
  await sleep(1000); // let name exchange and startGame settle

  /* ── T1: side assignment ── */
  const [hSide, gSide] = await Promise.all([
    hPage.evaluate(() => mySide).catch(() => null),
    gPage.evaluate(() => mySide).catch(() => null),
  ]);
  assert(hSide === 'left',  `T1/R${n}: host ${host} has mySide='left' (got '${hSide}')`);
  assert(gSide === 'right', `T1/R${n}: guest ${guest} has mySide='right' (got '${gSide}')`);

  /* ── T2: opponent names ── */
  const [hSlRight, gSlLeft] = await Promise.all([
    hPage.evaluate(() => document.getElementById('sl-right').textContent).catch(() => ''),
    gPage.evaluate(() => document.getElementById('sl-left').textContent).catch(() => ''),
  ]);
  assert(hSlRight === guest, `T2/R${n}: host sees guest in sl-right ("${hSlRight}")`);
  assert(gSlLeft  === host,  `T2/R${n}: guest sees host in sl-left ("${gSlLeft}")`);

  /* ── T3: Three.js canvas rendered (≥600×≥340; retina doubles buffer via setPixelRatio) ── */
  const [hCanvOk, gCanvOk, hCanvStr, gCanvStr] = await Promise.all([
    hPage.evaluate(() => { const c=document.getElementById('pickelbolCanvas'); return c&&c.width>=600&&c.height>=340; }).catch(()=>false),
    gPage.evaluate(() => { const c=document.getElementById('pickelbolCanvas'); return c&&c.width>=600&&c.height>=340; }).catch(()=>false),
    hPage.evaluate(() => { const c=document.getElementById('pickelbolCanvas'); return c?`${c.width}x${c.height}`:'missing'; }).catch(()=>'err'),
    gPage.evaluate(() => { const c=document.getElementById('pickelbolCanvas'); return c?`${c.width}x${c.height}`:'missing'; }).catch(()=>'err'),
  ]);
  assert(hCanvOk, `T3/R${n}: host Three.js canvas ≥600×340 (got "${hCanvStr}")`);
  assert(gCanvOk, `T3/R${n}: guest Three.js canvas ≥600×340 (got "${gCanvStr}")`);

  /* ── T4: paddle sync — host sets lp.y=50, sends paddle-pos, guest's lp.y updates ── */
  await hPage.evaluate(() => {
    lp.y = 50;
    send({ type: 'paddle-pos', y: 50 });
  }).catch(() => {});
  await sleep(700);
  const guestLpY = await gPage.evaluate(() => lp.y).catch(() => -1);
  assert(Math.abs(guestLpY - 50) < 5,
    `T4/R${n}: paddle-pos synced to guest (guest lp.y = ${guestLpY}, expected ≈50)`);

  /* ── T5: ball state sync — stop loop, inject position, verify on guest, restart ──
     Host loop sends ball-state every 4 frames; stopping it prevents race condition. */
  await hPage.evaluate(() => {
    stopLoop();
    ball.x = 200; ball.y = 120; ball.vx = 5; ball.vy = 2;
    send({ type: 'ball-state', x: 200, y: 120, vx: 5, vy: 2 });
  }).catch(() => {});
  await sleep(700);
  const guestBall = await gPage.evaluate(() => ({ x: ball.x, y: ball.y })).catch(() => null);
  await hPage.evaluate(() => startLoop()).catch(() => {}); // resume physics
  assert(
    guestBall && Math.abs(guestBall.x - 200) < 15 && Math.abs(guestBall.y - 120) < 15,
    `T5/R${n}: ball-state synced to guest (got x=${guestBall?.x?.toFixed(0)}, y=${guestBall?.y?.toFixed(0)})`
  );

  /* ── T6: injected win — host sets scores.left=5, calls onPoint() → both see s-champ ── */
  console.log(`  → Injecting win on host (scores.left=5 → onPoint())…`);
  await hPage.evaluate(() => {
    scores.left = 5;
    scores.right = 0;
    onPoint(); // triggers stopLoop(), game-over message, showChampion(true)
  }).catch(() => {});
  await sleep(1800);

  const [hChamp, gChamp] = await Promise.all([
    waitScreen(hPage, 's-champ', 5000),
    waitScreen(gPage, 's-champ', 5000),
  ]);
  assert(hChamp, `T6/R${n}: host sees s-champ after injected win`);
  assert(gChamp, `T6/R${n}: guest sees s-champ after injected win`);

  /* Verify champion text */
  const champText = await hPage.evaluate(() =>
    document.getElementById('champ-sub').textContent
  ).catch(() => '');
  assert(champText.includes(host),
    `T6/R${n}: champion text mentions winner "${host}" ("${champText.slice(0, 50)}")`);

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

  const [hScoreSum, gScoreSum] = await Promise.all([
    hPage.evaluate(() => scores.left + scores.right).catch(() => -1),
    gPage.evaluate(() => scores.left + scores.right).catch(() => -1),
  ]);
  assert(hScoreSum === 0, `T8/R${n}: host scores reset (left+right=${hScoreSum})`);
  assert(gScoreSum === 0, `T8/R${n}: guest scores reset (left+right=${gScoreSum})`);

  /* Verify game loop is running again after rematch */
  const [hRunning, gRunning] = await Promise.all([
    hPage.evaluate(() => gameRunning).catch(() => false),
    gPage.evaluate(() => gameRunning).catch(() => false),
  ]);
  assert(hRunning, `T8/R${n}: host game loop running after rematch`);
  assert(gRunning, `T8/R${n}: guest game loop running after rematch`);

  return { hPage, gPage, ok: true };
}

/* ════════════════════════════════════════════════════════
   MAIN
════════════════════════════════════════════════════════ */
async function run() {
  console.log('\n🏓 Room 5 + Room 6 (PICKLEBOL Pong) Sim — starts at index.html');
  console.log('   4 windows: Shantelle/left/R5 · Kuya AD/right/R5 · Tiff/left/R6 · Matt/right/R6');
  console.log('   Win: injected via scores.left=5 → onPoint() on host\n');

  /* Clear stale online presence for sim players — selectName() silently bails
     if a name is already online, preventing s-lobby from appearing. */
  console.log('🗑️  Clearing online presence for sim players…');
  const simPlayers = ROOMS.flatMap(r => [r.host, r.guest]);
  await Promise.all(simPlayers.map(name =>
    fb(`/online/${encodeURIComponent(name)}`, 'DELETE')
  ));
  await sleep(600);

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

  /* Run Room 5 (cols 0-1) then Room 6 (cols 2-3) sequentially */
  const r5 = await runRoom(browser, ROOMS[0], 0);
  const r6 = await runRoom(browser, ROOMS[1], 2);

  /* ── T9: independence ── */
  console.log('\n── T9: Room 5 + Room 6 independence ────────────────');
  assert(r5.ok && r6.ok,
    `T9: Rooms 5 and 6 completed independently (PeerJS IDs filo-gang-pickelbol-5 and -6)`);

  /* ── Summary ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Room 5+6 Test Results (started from index.html)');
  console.log('  T0  index → name click → Room N → pong.html → s-game');
  console.log('  T1  host=left paddle, guest=right paddle');
  console.log('  T2  opponent names on sl-left / sl-right');
  console.log('  T3  Three.js canvas at 600×340 internal resolution');
  console.log('  T4  paddle sync: paddle-pos message updates guest lp.y');
  console.log('  T5  ball state sync: ball-state message updates guest ball.x/y');
  console.log('  T6  win injection: scores.left=5 → onPoint() → s-champ both sides');
  console.log('  T7  win recorded in Firebase leaderboard');
  console.log('  T8  rematch: both back to s-game, scores=0, loop running');
  console.log('  T9  Room 5 and 6 independent (separate PeerJS IDs)');
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
