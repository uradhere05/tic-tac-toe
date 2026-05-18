'use strict';
/**
 * Poker Sim — 5 players, full multi-hand session, records Hall of Chips
 * Journey: index.html → name → Arena lobby → Room 7 → poker.html
 *          → role-select → lobby → N hands → end session → Hall of Chips
 *
 * Run: node poker-sim.js
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const BASE  = 'http://localhost:8080';
const DB    = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const N_HANDS = 5; // hands to play per session

function getScreenSize() {
  try {
    const out = execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const [,,w,h] = out.split(',').map(Number);
    return { w, h };
  } catch { return { w: 1440, h: 900 }; }
}
const { w: SCR_W, h: SCR_H } = getScreenSize();

const DEALER  = { name: 'Kuya AD' };
const PLAYERS = [
  { name: 'Matt' },
  { name: 'Gianne' },
  { name: 'Austin' },
];
const ALL = [DEALER, ...PLAYERS];
const COLS = ALL.length;           // 6 windows
const WIN_W = Math.floor(SCR_W / COLS);
const WIN_H = SCR_H;

/* ── Firebase helper ── */
const fb = (path, method = 'GET', body) =>
  fetch(`${DB}${path}.json`,
    body !== undefined
      ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method }
  ).then(r => r.json()).catch(() => null);

/* ── Assertions ── */
let passed = 0, failed = 0;
function assert(ok, label, detail = '') {
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else     { console.log(`  ❌ ${label}${detail ? '  ← ' + detail : ''}`); failed++; }
}

/* ── Open a positioned browser window ── */
async function openWindow(browser, x) {
  const ctx  = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  try {
    const cdp = await ctx.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', {
      windowId, bounds: { left: x, top: 0, width: WIN_W, height: WIN_H, windowState: 'normal' }
    });
  } catch {}
  await page.goto(`${BASE}/index.html`);
  return page;
}

/* ── Wait until a screen id is active on all pages ── */
async function waitScreen(pages, id, timeout = 22000) {
  const arr = Array.isArray(pages) ? pages : [pages];
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const ok = await Promise.all(
      arr.map(p => p.evaluate(sid => document.getElementById(sid)?.classList.contains('active'), id).catch(() => false))
    );
    if (ok.every(Boolean)) return true;
    await sleep(400);
  }
  return false;
}

/* ── Wait for a Firebase value ── */
async function waitFb(path, expected, timeout = 12000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    if ((await fb(path)) === expected) return true;
    await sleep(500);
  }
  return false;
}

/* ── Bet loop: call or check until betOn is null ── */
async function playBettingRound(playerPages, label) {
  console.log(`\n  🎰 ${label}…`);
  const byName = name => {
    const idx = PLAYERS.findIndex(p => p.name === name);
    return idx >= 0 ? playerPages[idx] : null;
  };

  for (let i = 0; i < 20; i++) {
    const on = await fb('/poker2/bet/on');
    if (!on) break;

    const curBet  = await fb('/poker2/bet/current')  || 0;
    const encOn   = on.replace(/ /g, '_');
    const myBetSt = await fb(`/poker2/bet/street/${encOn}`) || 0;
    const action  = curBet > myBetSt ? 'call' : 'check';

    console.log(`    ${on}: ${action}`);
    const pg = byName(on);
    if (pg) {
      await pg.evaluate(act => submitAction(act, 0), action).catch(() => {});
    }

    // Wait for betOn to change
    const dl = Date.now() + 8000;
    while (Date.now() < dl) {
      const next = await fb('/poker2/bet/on');
      if (next !== on) break;
      await sleep(350);
    }
  }
}

/* ── Play one complete hand ── */
async function playHand(dealerPage, playerPages, handNum) {
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  Hand #${handNum}`);
  console.log('─'.repeat(52));

  // Deal
  await dealerPage.evaluate(() => hostStartHand()).catch(() => {});
  if (!await waitFb('/poker2/phase', 'preflop', 10000)) {
    console.log('  ⚠️  preflop timeout — skipping hand');
    return false;
  }
  await sleep(1200);

  await playBettingRound(playerPages, 'Pre-flop');

  // Flop
  await dealerPage.evaluate(() => hostDealFlop()).catch(() => {});
  await waitFb('/poker2/phase', 'flop', 8000);
  await sleep(800);
  await playBettingRound(playerPages, 'Flop');

  // Turn
  await dealerPage.evaluate(() => hostDealTurn()).catch(() => {});
  await waitFb('/poker2/phase', 'turn', 8000);
  await sleep(800);
  await playBettingRound(playerPages, 'Turn');

  // River
  await dealerPage.evaluate(() => hostDealRiver()).catch(() => {});
  await waitFb('/poker2/phase', 'river', 8000);
  await sleep(800);
  await playBettingRound(playerPages, 'River');

  // Showdown
  await dealerPage.evaluate(() => hostShowdown()).catch(() => {});
  await waitFb('/poker2/phase', 'showdown', 8000);
  await sleep(1500);

  const winner = await fb('/poker2/winner');
  const pot    = await fb('/poker2/pot');
  const chips  = await fb('/poker2/chips') || {};
  const total  = Object.values(chips).reduce((s, v) => s + (v || 0), 0);
  console.log(`\n  Winner: ${winner || '?'}   Pot was: $${((pot || 0) / 100).toFixed(2)}`);
  console.log(`  Chips: ${Object.entries(chips).map(([k,v]) => `${k.replace(/_/g,' ')}=$${(v/100).toFixed(2)}`).join('  ')}`);
  console.log(`  Total chips conserved: $${(total / 100).toFixed(2)} ${total === PLAYERS.length * 2000 ? '✅' : '⚠️'}`);
  return true;
}

/* ── Main ── */
async function run() {
  console.log('\n🃏  Poker Sim — 5 players, multi-hand session');
  console.log(`    Screen ${SCR_W}×${SCR_H} → ${COLS} cols @ ${WIN_W}px each\n`);

  // Clear Firebase
  console.log('🗑️  Clearing /poker2 data…');
  await fb('/poker2', 'DELETE');
  await Promise.all(ALL.map(p => fb(`/online/${encodeURIComponent(p.name)}`, 'DELETE')));
  await sleep(600);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-infobars',
      '--no-default-browser-check',
    ],
  });

  // Open windows
  console.log(`🖥️  Opening ${ALL.length} windows…\n`);
  const allPages = [];
  for (let i = 0; i < ALL.length; i++) {
    allPages.push(await openWindow(browser, i * WIN_W));
    await sleep(200);
  }
  const dealerPage  = allPages[0];
  const playerPages = allPages.slice(1);

  // ── Step 1: Click names ──
  console.log('🖱️  Clicking name cards…');
  for (let i = 0; i < allPages.length; i++) {
    await allPages[i].evaluate(() => localStorage.clear());
    await allPages[i].reload();
    await sleep(300);
  }
  for (let i = 0; i < allPages.length; i++) {
    await allPages[i].click(`[data-name="${ALL[i].name}"]`).catch(() => {});
    await sleep(200);
  }
  assert(await waitScreen(allPages, 's-lobby', 18000), 'All reach Arena lobby');

  // ── Step 2: Click Room 7 (Poker) ──
  console.log('\n🚪 Clicking Room 7…');
  for (const p of allPages) {
    await p.click('.room-card-poker').catch(() => {});
    await sleep(200);
  }
  assert(await waitScreen(allPages, 's-role-select', 20000), 'All reach poker role-select');

  // ── Step 3: Select roles ──
  console.log('\n🎭 Kuya AD → Dealer | others → Player');
  await dealerPage.click('button:has-text("Be the Dealer")').catch(() => {});
  await sleep(300);
  for (const p of playerPages) {
    await p.click('button:has-text("Join as Player")').catch(() => {});
    await sleep(200);
  }
  assert(await waitScreen(allPages, 's-lobby', 20000), 'All reach poker lobby');
  await sleep(2500);

  // ── Step 4: Players ready up ──
  console.log('\n✅ Players readying up…');
  for (const p of playerPages) {
    await p.evaluate(() => toggleReady()).catch(() => {});
    await sleep(400);
  }
  await sleep(2000);

  // ── Step 5: Dealer starts game ──
  console.log('\n▶ Dealer starting game…');
  await dealerPage.evaluate(async () => { await startGame(); }).catch(() => {});
  await sleep(1000);
  await dealerPage.evaluate(() => confirmSeats()).catch(() => {});
  await sleep(1000);
  assert(await waitScreen([dealerPage], 's-dealer', 12000), 'Dealer on console');
  assert(await waitScreen(playerPages, 's-lobby', 12000), 'Players on poker lobby');
  await sleep(1000);

  // ── Step 6: Play N hands ──
  for (let h = 1; h <= N_HANDS; h++) {
    const ok = await playHand(dealerPage, playerPages, h);
    if (!ok) break;
    if (h < N_HANDS) await sleep(2000);
  }

  // ── Step 7: End session → records Hall of Chips ──
  console.log(`\n${'═'.repeat(52)}`);
  console.log('  🚫 Ending session → recording Hall of Chips…');
  await dealerPage.evaluate(() => endSession()).catch(() => {});
  await sleep(3000);

  // Read back Hall of Chips
  const monthKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  })();
  const hall = await fb(`/poker-hall/${monthKey}`) || {};
  const sessions = Object.values(hall.sessions || {}).filter(Boolean).sort((a, b) => b.gameNum - a.gameNum);

  console.log(`\n  Hall of Chips — sessions recorded: ${sessions.length}`);
  if (sessions.length) {
    const latest = sessions[0];
    console.log(`  Latest (Game #${latest.gameNum} · ${latest.date}):`);
    Object.entries(latest.results || {})
      .map(([k, v]) => { const net = typeof v === 'object' ? v.net : v; return [k.replace(/_/g, ' '), net]; })
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, net]) => {
        const sign = net >= 0 ? '+' : '-';
        console.log(`    ${name.padEnd(12)} ${sign}$${(Math.abs(net)/100).toFixed(2)}`);
      });
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '  🎉 All good!' : `  ⚠️  ${failed} issue(s)`);
  console.log('\n  Windows stay open 20s for inspection…');
  await sleep(20000);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Sim crashed:', err.message);
  process.exit(1);
});
