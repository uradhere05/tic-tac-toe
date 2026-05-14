/**
 * Mafia game simulation — MAX 10 players (1 host + 9), full game run.
 * Starts from index.html (the arena lobby), clicks Room 8, then plays.
 * Run: node mafia-sim.js
 */
const { chromium } = require('playwright');

const DB    = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const BASE  = 'file:///Users/adml/ClaudeCodeCursor/mafia2.html';
const INDEX = 'file:///Users/adml/ClaudeCodeCursor/index.html';

const PLAYERS = [
  { name: 'Kuya AD',   avatar: '🕵️', host: true  },
  { name: 'Matt',      avatar: '👱', host: false },
  { name: 'Gianne',    avatar: '👩', host: false },
  { name: 'Austin',    avatar: '👨', host: false },
  { name: 'Charm',     avatar: '👧', host: false },
  { name: 'Kee',       avatar: '🧑', host: false },
  { name: 'Kriselle',  avatar: '🧑‍🦱', host: false },
  { name: 'Monique',   avatar: '🧑‍🦰', host: false },
  { name: 'Tiff',      avatar: '🧑‍🦳', host: false },
  { name: 'Shantelle', avatar: '🧑‍🦲', host: false },
];

// 1 murderer, 1 doctor, 1 investigator, 6 civilians
const ROLES = {
  'Matt':      'murderer',
  'Gianne':    'doctor',
  'Austin':    'investigator',
  'Charm':     'civilian',
  'Kee':       'civilian',
  'Kriselle':  'civilian',
  'Monique':   'civilian',
  'Tiff':      'civilian',
  'Shantelle': 'civilian',
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

    const col = i % 4;
    const row = Math.floor(i / 4);

    // Inject localStorage before any page script runs
    await page.addInitScript(({ name, avatar }) => {
      localStorage.setItem('filoName', name);
      localStorage.setItem('filoAvatar', avatar);
    }, { name: p.name, avatar: p.avatar });

    // Navigate to index.html — name already in localStorage, skips name screen
    await page.goto(INDEX);
    await page.evaluate(({ x, y }) => window.moveTo(x, y), {
      x: col * 500 + 20,
      y: row * 740 + 40,
    });

    console.log(`  ✓ Window ${i + 1}: ${p.name}${p.host ? ' (HOST/GM)' : ''} — index.html`);
    await sleep(500);
  }

  const hostPage = pages[0];
  const playerPages = pages.slice(1);

  // ── All players click Room 8 (Mafia) from the index lobby ────────
  console.log('\n⏳ Waiting for index lobby to load...');
  await sleep(3000);

  console.log('\n🚪 All players clicking Room 8 — Filo Mafia...');
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const name = PLAYERS[i].name;
    try {
      // If index.html shows avatar picker first, skip it
      const hasAvatarScreen = await pg.$('#s-name-pick, .name-card, .av-grid').catch(() => null);
      if (hasAvatarScreen) {
        await pg.evaluate(() => {
          localStorage.setItem('filoAvatar', '🕵️');
          location.reload();
        });
        await sleep(1500);
      }
      // Click the Mafia room card (.room-card-mafia)
      await pg.waitForSelector('.room-card-mafia', { timeout: 8000 });
      await pg.click('.room-card-mafia');
      console.log(`  ✓ ${name} clicked Room 8 (Filo Mafia)`);
      await sleep(500);
    } catch (e) {
      console.log(`  ⚠ ${name}: ${e.message}`);
    }
  }

  console.log('\n⏳ Waiting for mafia2.html to load...');
  await sleep(3500);

  // ── Role-select screen: host → GM, players → Player ─────────────
  console.log('\n🎮 Selecting roles from role-select screen...');
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const p  = PLAYERS[i];
    try {
      await pg.waitForSelector('#s-role-select.active', { timeout: 10000 });
      if (p.host) {
        await clickBtn(pg, 'button[onclick="joinAsGameMaster()"]', `${p.name} → Game Master`);
      } else {
        await clickBtn(pg, 'button[onclick="joinAsPlayer()"]', `${p.name} → Player`);
      }
      await sleep(400);
    } catch (e) {
      console.log(`  ⚠ ${p.name} role-select: ${e.message.split('\n')[0]}`);
    }
  }
  await sleep(2000);

  // ── Players ready up ──────────────────────────────────────────────
  console.log('\n⏳ Waiting for mafia lobby to settle...');
  await sleep(1500);

  console.log('\n✅ All players clicking Ready Up...');
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
    fb('PUT', '/mafia2/night/kill',                 'Charm'),
    fb('PUT', '/mafia2/night/save',                 'Austin'),
    fb('PUT', '/mafia2/night/inspect',              'Matt'),
    fb('PUT', '/mafia2/night/suspect/Charm',        'Matt'),
    fb('PUT', '/mafia2/night/suspect/Kee',          'Matt'),
    fb('PUT', '/mafia2/night/suspect/Kriselle',     'Matt'),
    fb('PUT', '/mafia2/night/suspect/Monique',      'Matt'),
    fb('PUT', '/mafia2/night/suspect/Tiff',         'Matt'),
    fb('PUT', '/mafia2/night/suspect/Shantelle',    'Matt'),
  ]);
  console.log('  ✓ All night actions submitted (kill→Charm, save→Austin, inspect→Matt, 6 civilian suspects)');

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
  console.log('\n🗳️ All 9 players voting Matt (murderer)...');
  const voters = ['Matt','Gianne','Austin','Charm','Kee','Kriselle','Monique','Tiff','Shantelle'];
  await Promise.all(
    voters.map(name => fb('PUT', `/mafia2/day/votes/${name.replace(/ /g, '_')}`, 'Matt'))
  );
  console.log(`  ✓ ${voters.length} votes for Matt submitted`);

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
