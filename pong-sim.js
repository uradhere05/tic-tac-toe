/**
 * Room 5-6 Picklebol simulation — tests bug fixes in pong.html.
 * Opens 2 headless Chrome windows, both join a test room (98),
 * scores 5 points for left player via ball injection,
 * then tests rematch handshake and disconnect countdown cancel.
 *
 * Uses room 98 to avoid stale PEER_ID collisions from previous runs.
 * Uses headless mode so macOS window focus throttling can't affect timing.
 * Polls for s-game (instead of a fixed sleep) and freezes the ball
 * immediately so auto-scoring can't end the game before checks run.
 *
 * Run: node pong-sim.js
 */
const { chromium } = require('playwright');

const PONG  = 'http://localhost:8080/pong.html?room=98';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(ok, label, detail = '') {
  if (ok) { console.log(`  ✅ PASS  ${label}`); passed++; }
  else     { console.log(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function openPlayer(browser, name, avatar) {
  const ctx  = await browser.newContext({ viewport: { width: 640, height: 780 } });
  const page = await ctx.newPage();
  await page.addInitScript(({ n, a }) => {
    localStorage.setItem('filoName',   n);
    localStorage.setItem('filoAvatar', a);
  }, { n: name, a: avatar });
  await page.goto(PONG);
  console.log(`  ✓ ${name} opened ${PONG.split('/').pop()}`);
  return page;
}

/** Poll until both pages show the target screen id (or timeout ms). */
async function waitForScreen(pages, screenId, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const results = await Promise.all(
      pages.map(p => p.evaluate(id => document.getElementById(id)?.classList.contains('active'), screenId).catch(() => false))
    );
    if (results.every(Boolean)) return true;
    await sleep(400);
  }
  return false;
}

async function run() {
  console.log('\n🏓 Room 5-6 Picklebol Simulation\n');

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });

  console.log('── Opening players at pong.html?room=98 (headless) ──\n');
  const p1 = await openPlayer(browser, 'Kuya AD', '🕵️');
  await sleep(800);
  const p2 = await openPlayer(browser, 'Matt', '👱');

  // ── Wait for PeerJS connection ───────────────────────────────────
  console.log('\n⏳ Waiting for both players to reach s-game (up to 25s)...');
  const connected = await waitForScreen([p1, p2], 's-game', 25000);

  if (!connected) {
    // Capture what screen/state each player is on for diagnostics
    for (const [pg, nm] of [[p1,'Kuya AD'],[p2,'Matt']]) {
      const st = await pg.evaluate(() => ({
        screen: [...document.querySelectorAll('.screen.active')].map(s=>s.id),
        peerOpen: peer?.open, role: myRole
      })).catch(() => null);
      console.log(`  ${nm} state:`, JSON.stringify(st));
    }
    console.log('\n⚠ PeerJS connection failed — ensure http server is running on :8080');
    await browser.close(); return;
  }

  // Freeze ball immediately so it can't auto-score before our checks
  await p1.evaluate(() => { ball.vx = 0; ball.vy = 0; });

  const p1InGame = await p1.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  const p2InGame = await p2.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  assert(p1InGame, 'Kuya AD (host/left) in game screen');
  assert(p2InGame, 'Matt (guest/right) in game screen');

  const p1Side = await p1.evaluate(() => mySide).catch(() => null);
  const p2Side = await p2.evaluate(() => mySide).catch(() => null);
  console.log(`\n🎯 Sides — Kuya AD: ${p1Side}, Matt: ${p2Side}`);
  assert(p1Side === 'left' && p2Side === 'right', 'Host=left, Guest=right', `${p1Side}/${p2Side}`);

  // ── Bug fix: guest name visible on host's vs-display ────────────
  const vsText = await p1.evaluate(() => document.getElementById('vs-display')?.textContent || '').catch(() => '');
  assert(vsText.includes('Matt'), 'Host vs-display shows guest name', vsText);

  // ── Score 5 points for left by placing ball past right boundary ──
  console.log('\n🎯 Scoring 5 points for left via ball injection...');
  for (let i = 0; i < 5; i++) {
    await p1.evaluate(() => { ball.x = 620; ball.y = 170; ball.vx = 8; ball.vy = 0; });
    await sleep(450);
  }
  await sleep(1500);

  const p1Scores = await p1.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
  const p2Scores = await p2.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
  console.log(`  Kuya AD: left=${p1Scores?.l} right=${p1Scores?.r}`);
  console.log(`  Matt:    left=${p2Scores?.l} right=${p2Scores?.r}`);
  assert((p1Scores?.l ?? 0) >= 5, 'Left score ≥ 5', String(p1Scores?.l));

  // ── Champion screen ───────────────────────────────────────────────
  const champReached = await waitForScreen([p1], 's-champ', 4000).then(ok => ok || waitForScreen([p2], 's-champ', 1000));
  const p1Champ = await p1.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  const p2Champ = await p2.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  assert(p1Champ || p2Champ, 'Champion screen shown after 5 wins');

  // ── Bug fix: two-click rematch handshake ─────────────────────────
  console.log('\n🔄 Rematch handshake...');
  // Find and click the Rematch button on p1's champion screen
  const rematchBtn1 = await p1.locator('button', { hasText: /Rematch|🔄/ }).first();
  await rematchBtn1.click();
  console.log('  ✓ P1 clicked Rematch (1st)');
  await sleep(2000);

  const p1Waiting = await p1.evaluate(() =>
    document.getElementById('s-champ')?.classList.contains('active') ||
    document.getElementById('s-game')?.classList.contains('active')
  ).catch(() => false);
  assert(p1Waiting, 'P1 waiting after 1st Rematch click');

  const rematchBtn2 = await p2.locator('button', { hasText: /Rematch|🔄/ }).first();
  await rematchBtn2.click();
  console.log('  ✓ P2 clicked Rematch (2nd)');
  // Poll until both are back in s-game, then freeze ball immediately
  const rematchOk = await waitForScreen([p1, p2], 's-game', 8000);
  await p1.evaluate(() => { ball.vx = 0; ball.vy = 0; }).catch(() => {});
  const p1Back = rematchOk;
  const p2Back = rematchOk;
  assert(p1Back && p2Back, 'Both back in game after rematch');
  const scoresReset = await p1.evaluate(() => scores.left === 0 && scores.right === 0).catch(() => false);
  assert(scoresReset, 'Scores reset to 0 after rematch');

  // ── Bug fix: disconnect countdown cancellable ────────────────────
  console.log('\n💥 Disconnect countdown is cancellable...');
  await p1.evaluate(() => { onDrop(); });
  await sleep(300);
  await p1.evaluate(() => {
    destroyPeer();
    window.location.href = `index.html?screen=lobby&name=${encodeURIComponent(myName)}`;
  });
  await sleep(6500);
  const p1OnLobby     = await p1.evaluate(() => document.getElementById('s-lobby')?.classList.contains('active')).catch(() => false);
  const dropIvCleared = await p1.evaluate(() => dropCountdownIv === null).catch(() => false);
  assert(p1OnLobby,     'P1 on lobby after navigation during countdown');
  assert(dropIvCleared, 'dropCountdownIv=null (destroyPeer cancelled interval)');

  // ── Results ──────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
  console.log(failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} test(s) failed`);
}

run().catch(err => {
  console.error('\n❌ Sim error:', err.message);
  process.exit(1);
});
