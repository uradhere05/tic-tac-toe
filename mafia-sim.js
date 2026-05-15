/**
 * Mafia Game Simulation — 10 players, 10 visible Chrome windows.
 *
 * Window layout (5 col × 2 row):
 *   [Kuya AD GM]  [Matt]  [Gianne]  [Austin]  [Charm]
 *   [Kee]  [Kriselle]  [Monique]  [Tiff]  [Shantelle]
 *
 * Roles: Matt=murderer · Gianne=doctor · Austin=investigator
 *        Charm/Kee/Kriselle/Monique/Tiff/Shantelle=civilian (6)
 *
 * Game flows from index.html → Room 8 → mafia2.html (4 rounds):
 *   R1 night: Matt kills Charm  · Gianne saves Kriselle · Shantelle voted out
 *   R2 night: Matt kills Tiff   · Gianne saves Monique  · Kriselle voted out
 *   R3 night: Matt kills Kee    · Gianne saves Austin   · Austin voted out
 *   R4 night: Matt kills Gianne · Gianne saves Monique  → civs ≤ 1 → MURDERER WINS 🔪
 *
 * Run: node mafia-sim.js
 */
'use strict';
const { chromium } = require('playwright');
const { execSync }  = require('child_process');

const INDEX = 'http://localhost:8080/index.html';
const MAFIA  = 'http://localhost:8080/mafia2.html';
const DB     = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const sleep  = ms => new Promise(r => setTimeout(r, ms));

/* ── Screen layout: 5 col × 2 row, each window fills its cell ── */
function getScreenSize() {
  try {
    const out = execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const [,, w, h] = out.split(',').map(Number);
    return { w, h };
  } catch { return { w: 1440, h: 900 }; }
}
const { w: SCR_W, h: SCR_H } = getScreenSize();
const COLS = 5, ROWS = 2;
const WIN_W  = Math.floor(SCR_W / COLS);
const WIN_H  = Math.floor(SCR_H / ROWS);
const POSITIONS = Array.from({ length: COLS * ROWS }, (_, i) => [
  (i % COLS) * WIN_W,
  Math.floor(i / COLS) * WIN_H,
]);

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
const GM = { name: 'Kuya AD', avatar: '🕵️' };
const PLAYERS = [
  { name: 'Matt',     avatar: '🤵',   role: 'murderer'     },
  { name: 'Gianne',   avatar: '👩‍⚕️', role: 'doctor'       },
  { name: 'Austin',   avatar: '👨‍💼', role: 'investigator' },
  { name: 'Charm',    avatar: '👩‍💼', role: 'civilian'     },
  { name: 'Kee',      avatar: '🧑‍🌾', role: 'civilian'     },
  { name: 'Kriselle', avatar: '👩‍🍳', role: 'civilian'     },
  { name: 'Monique',  avatar: '🧑‍🔧', role: 'civilian'     },
  { name: 'Tiff',     avatar: '👮',   role: 'civilian'     },
  { name: 'Shantelle',avatar: '👨‍🍳', role: 'civilian'     },
];

/* ── Helpers ── */
async function openWindow(browser, name, x, y) {
  // viewport:null lets the actual window size drive the viewport
  const ctx  = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  // CDP: set exact window bounds before navigating (reliable cross-platform)
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { left: x, top: y, width: WIN_W, height: WIN_H, windowState: 'normal' },
  });
  await page.goto(`${INDEX}?name=${encodeURIComponent(name)}`);
  return page;
}

async function waitScreen(pages, id, timeout = 22000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const results = await Promise.all(
      pages.map(p =>
        p.evaluate(sid => document.getElementById(sid)?.classList.contains('active'), id)
          .catch(() => false)
      )
    );
    if (results.every(Boolean)) return true;
    await sleep(400);
  }
  return false;
}

async function waitRole(page, timeout = 16000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const r = await page.evaluate(() => myRole).catch(() => null);
    if (r) return r;
    await sleep(300);
  }
  return null;
}

async function waitFb(path, expected, timeout = 12000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    if ((await fb(path)) === expected) return true;
    await sleep(500);
  }
  return false;
}

/* ════════════════════════════════════════════════════════
   SIMULATION
════════════════════════════════════════════════════════ */
async function run() {
  console.log('\n🎭 Mafia Game Simulation — 10 Players · 10 Chrome Windows');
  console.log('   Starting from index.html  |  Murderer wins in 4 rounds\n');
  console.log('   Roles: Matt=🔪  Gianne=💊  Austin=🔍');
  console.log('          Charm/Kee/Kriselle/Monique/Tiff/Shantelle=👤\n');

  /* 0. Clear previous game data */
  console.log('🗑️  Clearing /mafia2 Firebase data…');
  await fb('/mafia2', 'DELETE');
  await sleep(800);
  assert(await fb('/mafia2/phase') === null, 'Firebase /mafia2 cleared');

  /* 1. Launch browser */
  console.log(`🖥️  Screen ${SCR_W}×${SCR_H} → ${COLS}×${ROWS} grid · each window ${WIN_W}×${WIN_H} (fullscreen cells via CDP)\n`);

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

  /* 2. Open 10 windows — all start at index.html */
  console.log('\n── Opening 10 windows from index.html ──────────────\n');
  const gmPage = await openWindow(browser, GM.name, POSITIONS[0][0], POSITIONS[0][1]);
  console.log(`  ✓ [GM] ${GM.name}`);
  await sleep(400);

  const playerPages = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    const [x, y] = POSITIONS[i + 1];
    playerPages.push(await openWindow(browser, PLAYERS[i].name, x, y));
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name}  (${PLAYERS[i].role})`);
    await sleep(280);
  }

  // Helper: page by player name
  const byName = name => playerPages[PLAYERS.findIndex(p => p.name === name)];

  /* 3. Wait for all 10 to reach the Arena lobby (index.html s-lobby) */
  console.log('\n⏳ Waiting for all 10 windows to reach Arena lobby…');
  const allArena = await waitScreen([gmPage, ...playerPages], 's-lobby', 20000);
  assert(allArena, 'All 10 windows on Arena lobby (index.html)');
  if (!allArena) { await browser.close(); return; }
  console.log('  ✓ All players in Arena — now navigating to Room 8');

  /* 4. Navigate to Mafia (Room 8) */
  console.log('\n🚪 Navigating to Room 8 (Mafia)…');
  // GM: index.html has no "Be the GM" button; navigate directly with autoJoin=host
  // (localStorage already has filoName=Kuya AD from step 3)
  await gmPage.goto(`${MAFIA}?autoJoin=host`);
  console.log(`  ✓ [GM] Kuya AD → mafia2.html?autoJoin=host`);
  await sleep(350);

  // Players: click the Room 8 card on index.html → lands on s-role-select
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].click('.room-card-mafia').catch(() =>
      playerPages[i].evaluate(() => { window.location.href = 'mafia2.html'; })
    );
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name} → clicked Room 8`);
    await sleep(250);
  }

  // After navigation, players are on s-role-select ("Join as Player / Be the GM").
  // Wait for s-role-select then auto-click "Join as Player" for each player.
  console.log('\n⏳ Waiting for players to reach s-role-select, then joining…');
  await waitScreen(playerPages, 's-role-select', 18000);
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].evaluate(() => joinAsPlayer()).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → joined as player`);
    await sleep(200);
  }

  /* 5. Wait for all 10 to reach Mafia lobby (mafia2.html s-lobby) */
  console.log('\n⏳ Waiting for all 10 windows to reach Mafia lobby…');
  const allMafia = await waitScreen([gmPage, ...playerPages], 's-lobby', 25000);
  assert(allMafia, 'All 10 windows in Mafia lobby');
  if (!allMafia) { await browser.close(); return; }

  /* 6. Players ready up */
  console.log('\n✅ Players readying up…');
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].evaluate(() => toggleReady()).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → Ready`);
    await sleep(420);
  }
  await sleep(2500);
  const lobbySnap = await fb('/mafia2/lobby');
  const readyN = lobbySnap ? Object.values(lobbySnap).filter(p => p?.ready).length : 0;
  assert(readyN >= 9, `9 players ready in Firebase (got ${readyN})`);

  /* 7. GM proceeds to role assignment */
  console.log('\n🎲 GM proceeding to role assignment…');
  await gmPage.evaluate(async () => {
    if (!hostName) hostName = await fb('GET', '/mafia2/host') ?? myName;
    await proceedToAssign();
  }).catch(() => {});
  await sleep(1500);
  assert(
    await gmPage.evaluate(() => document.getElementById('s-assign')?.classList.contains('active')).catch(() => false),
    'GM on s-assign screen'
  );
  assert(await waitScreen(playerPages, 's-player', 12000), 'All 9 players on Stand By');

  /* 8. Assign roles */
  console.log('\n🎭 GM assigning roles…');
  for (const { name, role } of PLAYERS) {
    await gmPage.evaluate(({ n, r }) => assignRole(n, r), { n: name, r: role }).catch(() => {});
    console.log(`  ✓ ${name.padEnd(10)} → ${role}`);
    await sleep(150);
  }
  await sleep(500);
  const rolesOk = await gmPage.evaluate(() => {
    const k = Object.keys(rolesMap);
    return k.length >= 9 && k.every(n => rolesMap[n]);
  }).catch(() => false);
  assert(rolesOk, 'All 9 roles assigned on GM page');

  /* 9. Start game */
  console.log('\n▶ GM starting the game…');
  await gmPage.evaluate(() => hostStartGame()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'Phase → "night"');

  /* ═══════════════════════════════════════════════════
     ROUND 1 — Matt kills Charm · Shantelle voted out
  ═══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Charm · Gianne saves Kriselle · Austin inspects Kee');

  // Wait for all players to receive their role (includes 5s role-reveal countdown)
  const r1Roles = await Promise.all(PLAYERS.map((_, i) => waitRole(playerPages[i], 16000)));
  r1Roles.forEach((r, i) => assert(r === PLAYERS[i].role, `${PLAYERS[i].name} role = "${r}"`));
  await sleep(6000); // role reveal countdown

  await byName('Matt').evaluate(() => submitAction('Charm')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Kriselle')).catch(() => {});
  await byName('Austin').evaluate(() => submitAction('Kee')).catch(() => {});
  for (const { name, role } of PLAYERS)
    if (role === 'civilian')
      await byName(name).evaluate(() => submitSuspect('Shantelle')).catch(() => {});
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Charm',    'R1 kill = Charm');
  assert((await fb('/mafia2/night/save')) === 'Kriselle', 'R1 save = Kriselle');

  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'R1 Phase → "day"');
  assert(await fb('/mafia2/alive/Charm') === false, 'Charm eliminated overnight');
  await sleep(1500);

  console.log('🗳️  Vote: all alive → Shantelle');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'R1 Phase → "vote"');
  await sleep(1200);

  // Alive: Matt Gianne Austin Kee Kriselle Monique Tiff Shantelle (Charm dead)
  for (const { name } of PLAYERS)
    if (name !== 'Charm')
      await byName(name).evaluate(() => submitVote('Shantelle')).catch(() => {});
  await sleep(1800);

  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(1500);
  assert(await fb('/mafia2/alive/Shantelle') === false, 'Shantelle voted out');
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'R1 → R2 night');

  /* ═══════════════════════════════════════════════════
     ROUND 2 — Matt kills Tiff · Kriselle voted out
  ═══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 2 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Tiff · Gianne saves Monique · Austin inspects Matt');
  await sleep(2000);

  await byName('Matt').evaluate(() => submitAction('Tiff')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Monique')).catch(() => {});   // lastSave was Kriselle → Monique OK
  await byName('Austin').evaluate(() => submitAction('Matt')).catch(() => {});
  // Living civilians (Charm/Shantelle dead): Kee Kriselle Monique Tiff
  for (const name of ['Kee', 'Kriselle', 'Monique', 'Tiff'])
    await byName(name).evaluate(() => submitSuspect('Kriselle')).catch(() => {});
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Tiff',    'R2 kill = Tiff');
  assert((await fb('/mafia2/night/save')) === 'Monique', 'R2 save = Monique');

  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'R2 Phase → "day"');
  assert(await fb('/mafia2/alive/Tiff') === false, 'Tiff eliminated overnight');
  await sleep(1500);

  console.log('🗳️  Vote: all alive → Kriselle');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'R2 Phase → "vote"');
  await sleep(1200);

  // Alive: Matt Gianne Austin Kee Kriselle Monique (Charm/Tiff/Shantelle dead)
  for (const { name } of PLAYERS)
    if (!['Charm', 'Tiff', 'Shantelle'].includes(name))
      await byName(name).evaluate(() => submitVote('Kriselle')).catch(() => {});
  await sleep(1800);

  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(1500);
  assert(await fb('/mafia2/alive/Kriselle') === false, 'Kriselle voted out');
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'R2 → R3 night');

  /* ═══════════════════════════════════════════════════
     ROUND 3 — Matt kills Kee · Austin voted out
  ═══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 3 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Kee · Gianne saves Austin · Austin inspects Monique');
  await sleep(2000);

  await byName('Matt').evaluate(() => submitAction('Kee')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Austin')).catch(() => {}); // lastSave was Monique → Austin OK
  await byName('Austin').evaluate(() => submitAction('Monique')).catch(() => {});
  // Living civilians: Kee Monique (Kriselle voted out, Charm/Tiff/Shantelle dead)
  await byName('Kee').evaluate(() => submitSuspect('Austin')).catch(() => {});
  await byName('Monique').evaluate(() => submitSuspect('Austin')).catch(() => {});
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Kee',    'R3 kill = Kee');
  assert((await fb('/mafia2/night/save')) === 'Austin', 'R3 save = Austin');

  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'R3 Phase → "day"');
  assert(await fb('/mafia2/alive/Kee') === false, 'Kee eliminated overnight');
  await sleep(1500);

  console.log('🗳️  Vote: all alive → Austin');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'R3 Phase → "vote"');
  await sleep(1200);

  // Alive: Matt Gianne Austin Monique (Kee/Kriselle/Charm/Tiff/Shantelle dead)
  for (const { name } of PLAYERS)
    if (!['Charm', 'Tiff', 'Shantelle', 'Kriselle', 'Kee'].includes(name))
      await byName(name).evaluate(() => submitVote('Austin')).catch(() => {});
  await sleep(1800);

  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(1500);
  assert(await fb('/mafia2/alive/Austin') === false, 'Austin voted out');
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'R3 → R4 night');

  /* ═══════════════════════════════════════════════════
     ROUND 4 — Matt kills Gianne (doctor) → MURDERER WINS
  ═══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 4 — MURDERER WINS 🔪 ━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Gianne · Gianne saves Monique');
  await sleep(2000);

  // Alive: Matt Gianne Monique (civCount = 2 before kill)
  await byName('Matt').evaluate(() => submitAction('Gianne')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Monique')).catch(() => {}); // lastSave was Austin → Monique OK
  await byName('Monique').evaluate(() => submitSuspect('Gianne')).catch(() => {});
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Gianne',  'R4 kill = Gianne (doctor)');
  assert((await fb('/mafia2/night/save')) === 'Monique', 'R4 save = Monique');

  console.log('\n⚰️  GM resolves night — Gianne (doctor) dies → civs alive = 1 → MURDERER WINS');
  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  await sleep(3000);

  assert(await fb('/mafia2/alive/Gianne') === false, 'Gianne eliminated — doctor gone');
  const winner = await fb('/mafia2/winner');
  assert(winner === 'murderer', `Game winner = "${winner}"`, 'expected murderer');

  /* End screens */
  console.log('\n🏁 Checking end screens…');
  await sleep(3500);
  const gmEnd = await gmPage.evaluate(() => {
    const el = document.getElementById('h-end');
    return el && getComputedStyle(el).display !== 'none';
  }).catch(() => false);
  assert(gmEnd, 'GM sees end screen (h-end visible)');

  const pEndCount = (await Promise.all(
    playerPages.map(p => p.evaluate(() => {
      const c = document.getElementById('p-content')?.innerHTML ?? '';
      return c.includes('MURDERER WINS') || c.includes('CIVILIANS WIN') ||
             c.includes('Better luck') || c.includes('You won');
    }).catch(() => false))
  )).filter(Boolean).length;
  assert(pEndCount >= 7, `${pEndCount}/9 player windows show game-over result`);

  /* ── Final summary ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Game Summary — Matt 🔪 WINS');
  console.log('  R1: Matt kills Charm    · Shantelle voted out');
  console.log('  R2: Matt kills Tiff     · Kriselle voted out');
  console.log('  R3: Matt kills Kee      · Austin voted out');
  console.log('  R4: Matt kills Gianne (doctor!) → only Monique left');
  console.log('  ⟹ Alive non-murderers = 1 → MURDERER WINS! 🔪');
  console.log('╚══════════════════════════════════════════════════════╝');

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
  console.log(failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} test(s) failed`);
  console.log('\nWindows stay open 12 s for inspection…');
  await sleep(12000);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Sim error:', err.message);
  process.exit(1);
});
