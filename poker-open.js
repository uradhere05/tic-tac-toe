'use strict';
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const URL    = 'https://filo-gang-arena.web.app/poker.html';
const LOG    = '/tmp/poker-open-bugs.log';
const DEALER = 'Kuya AD';
const PLAYERS = ['Matt', 'Gianne'];
const ALL = [DEALER, ...PLAYERS];

fs.writeFileSync(LOG, '');

function getScreenSize() {
  try {
    const out = execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const [,,w,h] = out.split(',').map(Number);
    return { w, h };
  } catch { return { w: 1440, h: 900 }; }
}
const { w: SW, h: SH } = getScreenSize();

function logBug(msg) {
  const line = `${new Date().toISOString().slice(11,19)} ${msg}\n`;
  process.stdout.write(`[BUG] ${line}`);
  fs.appendFileSync(LOG, line);
}

async function fbClear() {
  await fetch('https://filo-gang-tictactoe-default-rtdb.firebaseio.com/poker2.json', { method: 'DELETE' });
}

async function run() {
  console.log('Clearing Firebase /poker2…');
  await fbClear();
  console.log('Cleared.\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
  });

  for (let i = 0; i < ALL.length; i++) {
    const ctx  = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    const cdp  = await ctx.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    const left  = Math.round(i * SW / ALL.length);
    const right = Math.round((i + 1) * SW / ALL.length);
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left, top: 0, width: right - left, height: SH, windowState: 'normal' },
    });
    page.on('console', m => {
      if (m.type() === 'error') logBug(`[${ALL[i]}] ${m.text()}`);
    });
    page.on('pageerror', e => logBug(`[${ALL[i]}] PAGE ERR: ${e.message}`));
    await page.goto(URL);
    await page.evaluate(n => localStorage.setItem('filoName', n), ALL[i]);
    await page.reload();
    console.log(`  Window ${i + 1}: ${ALL[i]}${i === 0 ? ' — DEALER' : ' — player'}`);
  }

  console.log(`\n✅ ${ALL.length} windows open — play manually:`);
  console.log(`   Window 1  ${DEALER}  → "Be the Dealer"`);
  PLAYERS.forEach((n, i) => console.log(`   Window ${i + 2}  ${n}  → "Join as Player"`));
  console.log(`\n   Bugs logged live → ${LOG}`);
  console.log('   Ctrl-C to close.\n');

  setInterval(() => {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) console.log(`   [${new Date().toISOString().slice(11,19)}] ${lines.length} bug(s) so far`);
  }, 20000);

  await new Promise(() => {});
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
