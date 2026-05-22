/**
 * poker-3window-test.js — full multiplayer run through flop
 * node poker-3window-test.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:7432/poker.html';
const DB   = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const WAIT = ms => new Promise(r => setTimeout(r, ms));

const ss = (page, name) =>
  page.screenshot({ path: `test-${name}.png`, type: 'png' })
      .then(() => console.log(`  📸 test-${name}.png`));

// Click a button if it becomes visible within timeout, return true/false
async function tryClick(page, text, timeout = 3000) {
  try {
    const loc = page.locator(`button:has-text("${text}")`);
    await loc.waitFor({ state: 'visible', timeout });
    await loc.click();
    return true;
  } catch { return false; }
}

// Wait for a button to appear, regardless of which page it lands on first
async function actWhenReady(pages, buttons = ['Check','Call','Fold'], timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const page of pages) {
      for (const btn of buttons) {
        try {
          const loc = page.locator(`button:has-text("${btn}")`);
          const vis = await loc.isVisible();
          if (vis) {
            await loc.click();
            console.log(`  ✅ Clicked "${btn}" on ${await page.title().then(() => 'player')}`);
            await WAIT(800);
            return true;
          }
        } catch {}
      }
    }
    await WAIT(500);
  }
  return false;
}

async function resetFirebase() {
  await fetch(`${DB}/poker2/phase.json`,  { method: 'PUT',    body: JSON.stringify('reset'), headers: {'Content-Type':'application/json'} });
  await fetch(`${DB}/poker2/chips.json`,  { method: 'DELETE' });
  await fetch(`${DB}/poker2/hands.json`,  { method: 'DELETE' });
  await fetch(`${DB}/poker2/bet.json`,    { method: 'DELETE' });
  await fetch(`${DB}/poker2/lobby.json`,  { method: 'DELETE' });
  await fetch(`${DB}/poker2/host.json`,   { method: 'DELETE' });
  await fetch(`${DB}/poker2/hostTs.json`, { method: 'DELETE' });
  await fetch(`${DB}/poker2/folded.json`, { method: 'DELETE' });
  await fetch(`${DB}/poker2/allIn.json`,  { method: 'DELETE' });
  await fetch(`${DB}/poker2/community.json`, { method: 'DELETE' });
  console.log('  🔄 Firebase reset');
}

(async () => {
  console.log('\n[0] Resetting Firebase…');
  await resetFirebase();
  await WAIT(800);

  const browser = await chromium.launch({ headless: false });

  // ── Dealer: Kuya AD ──────────────────────────────────────────────
  console.log('\n[1] Dealer — Kuya AD');
  const c1 = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const dealer = await c1.newPage();
  await dealer.goto(`${BASE}?simName=Kuya%20AD&simAvatar=%F0%9F%95%B5%EF%B8%8F`);
  await dealer.waitForSelector('.screen.active');
  await dealer.click('button:has-text("Be the Dealer")');
  await WAIT(1500);
  console.log('  ✅ Kuya AD in lobby as Dealer');
  await ss(dealer, '1-dealer-lobby');

  // ── Player: Matt ─────────────────────────────────────────────────
  console.log('\n[2] Player — Matt');
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const matt = await c2.newPage();
  await matt.goto(`${BASE}?simName=Matt&simAvatar=%F0%9F%A4%B5`);
  await matt.waitForSelector('.screen.active');
  await matt.click('button:has-text("Join as Player")');
  await WAIT(1500);
  await tryClick(matt, 'Ready Up');
  await WAIT(600);
  console.log('  ✅ Matt ready');
  await ss(matt, '2-matt-lobby');

  // ── Player: Gianne ───────────────────────────────────────────────
  console.log('\n[3] Player — Gianne');
  const c3 = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const gianne = await c3.newPage();
  await gianne.goto(`${BASE}?simName=Gianne&simAvatar=%F0%9F%91%A9%E2%80%8D%E2%9A%95%EF%B8%8F`);
  await gianne.waitForSelector('.screen.active');
  await gianne.click('button:has-text("Join as Player")');
  await WAIT(1500);
  await tryClick(gianne, 'Ready Up');
  await WAIT(600);
  console.log('  ✅ Gianne ready');
  await ss(gianne, '3-gianne-lobby');

  // ── Dealer starts game ───────────────────────────────────────────
  console.log('\n[4] Dealer waits for both players ready…');
  await WAIT(5000);
  await dealer.locator('#lb-start-btn').waitFor({ state: 'visible', timeout: 14000 });
  console.log('  ✅ Start button visible');
  await ss(dealer, '4-dealer-both-ready');
  await dealer.locator('#lb-start-btn').click();
  await WAIT(1200);

  // Confirm seat assignment
  await dealer.locator('button:has-text("Start Game")').waitFor({ timeout: 5000 });
  await dealer.locator('button:has-text("Start Game")').click();
  await WAIT(1500);
  console.log('  ✅ Game started');
  await ss(dealer, '5-dealer-console');

  // ── Deal hand ────────────────────────────────────────────────────
  console.log('\n[5] Dealing new hand…');
  await dealer.locator('button:has-text("Deal New Hand")').waitFor({ timeout: 8000 });
  await dealer.locator('button:has-text("Deal New Hand")').click();
  await WAIT(2500);
  console.log('  ✅ Preflop dealt');
  await ss(dealer, '6-dealer-preflop');

  // ── Players: wait for hole cards to arrive via poll ───────────────
  console.log('\n[6] Waiting for players to receive hole cards…');
  await WAIT(4500); // player poll fires every ~3s
  await ss(matt,   '7-matt-preflop');
  await ss(gianne, '8-gianne-preflop');

  // ── Preflop betting: act on whichever player has the button ──────
  console.log('\n[7] Preflop betting…');
  // Round 1 — first player to act (SB goes first preflop in 2-player)
  await actWhenReady([gianne, matt]);
  await WAIT(1200);
  // Round 2 — second player
  await actWhenReady([matt, gianne]);
  await WAIT(2000);

  // ── Deal flop ────────────────────────────────────────────────────
  console.log('\n[8] Dealing flop…');
  const flopOk = await tryClick(dealer, 'Deal Flop', 8000);
  if (flopOk) {
    console.log('  ✅ Flop dealt');
    await WAIT(3500); // let player poll pick up community cards
  } else {
    console.log('  ⚠️  Deal Flop not ready yet — taking snapshot anyway');
  }
  await ss(dealer, '9-dealer-flop');
  await ss(matt,   '10-matt-flop');
  await ss(gianne, '11-gianne-flop');

  // ── Flop betting round ────────────────────────────────────────────
  console.log('\n[9] Flop betting…');
  await actWhenReady([gianne, matt]);
  await WAIT(1200);
  await actWhenReady([matt, gianne]);
  await WAIT(2000);

  // ── Deal turn ────────────────────────────────────────────────────
  console.log('\n[10] Dealing turn…');
  const turnOk = await tryClick(dealer, 'Deal Turn', 8000);
  if (turnOk) {
    console.log('  ✅ Turn dealt');
    await WAIT(3500);
  }
  await ss(dealer, '12-dealer-turn');
  await ss(matt,   '13-matt-turn');
  await ss(gianne, '14-gianne-turn');

  console.log('\n════════════════════════════════════════');
  console.log('✅  Test complete — screenshots saved as test-*.png');
  console.log('   Windows stay open 30s for manual inspection.');
  console.log('════════════════════════════════════════\n');

  await WAIT(30000);
  await browser.close();
})().catch(err => { console.error('\n❌', err.message); process.exit(1); });
