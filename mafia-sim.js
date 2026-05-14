/**
 * Mafia game simulation — 6 players (1 host + 5), full game run.
 * Opens 6 visible Chrome windows and drives every action automatically.
 * Run: node mafia-sim.js
 */
const { chromium } = require('playwright');

const DB = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const BASE = 'file:///Users/adml/ClaudeCodeCursor/mafia2.html';

const PLAYERS = [
  { name: 'Kuya AD', avatar: '🕵️', host: true  },
  { name: 'Matt',    avatar: '👱', host: false },
  { name: 'Gianne',  avatar: '👩', host: false },
  { name: 'Austin',  avatar: '👨', host: false },
  { name: 'Charm',   avatar: '👧', host: false },
  { name: 'Kee',     avatar: '🧑', host: false },
];

const ROLES = {
  'Matt':   'murderer',
  'Gianne': 'doctor',
  'Austin': 'investigator',
  'Charm':  'civilian',
  'Kee':    'civilian',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fb(method, path, data) {
  const { default: fetch } = await import('node-fetch');
  const opts = { method };
  if (data !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(data);
  }
  const r = await fetch(`${DB}${path}.json`, opts);
  return r.json();
}

async function clickBtn(page, selector, desc) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector);
  console.log(`  ✓ ${desc}`);
}

async function waitForScreen(page, screenId, timeout = 10000) {
  await page.waitForSelector(`#${screenId}.active`, { timeout });
}

async function run() {
  console.log('\n🎭 Mafia Simulation Starting...\n');

  console.log('🔥 Clearing Firebase /mafia2...');
  await fb('DELETE', '/mafia2');
  await sleep(600);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=480,700'],
  });

  const pages = [];

  for (let i = 0; i < PLAYERS.length; i++) {
    const p = PLAYERS[i];
    const ctx = await browser.newContext({ viewport: { width: 480, height: 700 } });
    const page = await ctx.newPage();
    pages.push(page);

    const col = i % 3;
    const row = Math.floor(i / 3);
    await page.evaluate(({ x, y }) => window.moveTo(x, y), {
      x: col * 500 + 20,
      y: row * 740 + 40,
    });

    const url = p.host
      ? `${BASE}?simName=${encodeURIComponent(p.name)}&simAvatar=${encodeURIComponent(p.avatar)}&autoJoin=host`
      : `${BASE}?simName=${encodeURIComponent(p.name)}&simAvatar=${encodeURIComponent(p.avatar)}`;

    await page.goto(url);
    console.log(`  ✓ Window ${i + 1}: ${p.name}${p.host ? ' (HOST/GM)' : ''}`);
    await sleep(400);
  }

  const hostPage = pages[0];
  const playerPages = pages.slice(1);

  // ── Players ready up ──────────────────────────────────────────────
  console.log('\n⏳ Waiting for lobby to settle...');
  await sleep(2500);

  console.log('\n✅ Players + Host clicking Ready Up...');
  // All 6 must be ready — host too (proceed button requires readyCount === players.length)
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const name = PLAYERS[i].name;
    try {
      await waitForScreen(pg, 's-lobby', 10000);
      await clickBtn(pg, '#lb-ready-btn', `${name} ready`);
      await sleep(400);
    } catch (e) {
      console.log(`  ⚠ ${name}: ${e.message}`);
    }
  }

  // ── Host proceeds to assign ───────────────────────────────────────
  console.log('\n⏳ Waiting for host lobby to refresh...');
  await sleep(3500);

  console.log('\n▶ Host → Assign Roles...');
  try {
    // Proceed button is visible only when ALL players are ready
    await hostPage.waitForSelector('#lb-proceed-btn:not([style*="display: none"])', { timeout: 10000 });
    await clickBtn(hostPage, '#lb-proceed-btn', 'Assign Roles clicked');
  } catch (e) {
    console.log(`  ⚠ Proceed: ${e.message}`);
  }

  await sleep(1500);

  // ── Assign roles ──────────────────────────────────────────────────
  console.log('\n🎭 Assigning roles...');
  try {
    await waitForScreen(hostPage, 's-assign', 6000);
    for (const [name, role] of Object.entries(ROLES)) {
      await hostPage.click(
        `.ar-row:has(.ar-name:text-is("${name}")) .rb[data-role="${role}"]`
      );
      console.log(`  ✓ ${name} → ${role}`);
      await sleep(350);
    }
    await sleep(600);
    await clickBtn(hostPage, '#assign-start-btn', 'Start Game!');
  } catch (e) {
    console.log(`  ⚠ Assign: ${e.message}`);
  }

  // ── Night phase ───────────────────────────────────────────────────
  console.log('\n🌙 Night — submitting actions via Firebase...');
  await sleep(3500);

  await Promise.all([
    fb('PUT', '/mafia2/night/kill',            'Charm'),
    fb('PUT', '/mafia2/night/save',            'Austin'),
    fb('PUT', '/mafia2/night/inspect',         'Matt'),
    fb('PUT', '/mafia2/night/suspect/Charm',   'Matt'),
    fb('PUT', '/mafia2/night/suspect/Kee',     'Matt'),
  ]);
  console.log('  ✓ All night actions submitted (kill→Charm, save→Austin, inspect→Matt)');

  await sleep(2000);

  // ── Host resolves night ───────────────────────────────────────────
  console.log('\n☀️ Host resolving night...');
  try {
    await clickBtn(hostPage, 'button[onclick="resolveNight()"]', 'Night resolved');
  } catch (e) {
    console.log(`  ⚠ Resolve night: ${e.message}`);
  }

  await sleep(2000);

  // ── Open vote ─────────────────────────────────────────────────────
  console.log('\n🗳️ Host opening vote...');
  try {
    await clickBtn(hostPage, '#h-open-vote-btn', 'Vote opened');
  } catch (e) {
    console.log(`  ⚠ Open vote: ${e.message}`);
  }

  await sleep(1500);

  // ── Players vote Matt ─────────────────────────────────────────────
  console.log('\n🗳️ All players voting Matt (murderer)...');
  await Promise.all(
    ['Matt', 'Gianne', 'Austin', 'Charm', 'Kee'].map(name =>
      fb('PUT', `/mafia2/day/votes/${name.replace(/ /g, '_')}`, 'Matt')
    )
  );
  console.log('  ✓ 5 votes for Matt submitted');

  await sleep(2000);

  // ── Host resolves vote ────────────────────────────────────────────
  console.log('\n⚖️ Host resolving vote...');
  try {
    await clickBtn(hostPage, 'button[onclick="hostResolveVote()"]', 'Vote resolved');
  } catch (e) {
    console.log(`  ⚠ Resolve vote: ${e.message}`);
  }

  await sleep(2500);

  const winner = await fb('GET', '/mafia2/winner');
  const phase  = await fb('GET', '/mafia2/phase');
  console.log(`\n🏆 Result — phase: ${phase}, winner: ${winner}`);

  if (winner) {
    console.log(`\n🎉 CIVILIANS WIN! Game over.`);
    console.log(`\n⏱️  Watching for auto-reset (fires at ~60s)...\n`);

    for (let i = 1; i <= 75; i++) {
      await sleep(1000);
      const ph = await fb('GET', '/mafia2/phase');
      if (i % 5 === 0) process.stdout.write(`  ${i}s — phase: ${ph}\n`);
      if (ph === 'reset' || ph === null) {
        console.log(`\n✅ RESET SIGNAL at ${i}s! phase="${ph}"`);
        await sleep(4000);
        const data = await fb('GET', '/mafia2');
        if (!data || Object.keys(data).filter(k => k !== 'lobby' && k !== 'host').length === 0) {
          console.log('✅ Firebase /mafia2 cleared — auto-reset CONFIRMED!\n');
        } else {
          console.log(`Firebase state: ${JSON.stringify(data)}`);
        }
        break;
      }
    }
  } else {
    console.log('\n⚠ Game did not end cleanly — check windows.');
  }

  console.log('✅ Simulation done. Windows stay open for inspection.\n');
}

run().catch(err => {
  console.error('\n❌ Simulation error:', err.message);
  process.exit(1);
});
