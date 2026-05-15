/**
 * Mafia Game Simulation — 5 windows (1 GM + 4 players).
 *
 * Window layout (5 col × 1 row — full-height, whole page visible):
 *   [Kuya AD GM]  [Matt]  [Gianne]  [Austin]  [Charm]
 *
 * Roles: Matt=murderer · Gianne=doctor · Austin=investigator · Charm=civilian
 *
 * Game flows from index.html → Room 8 → mafia2.html (1 round):
 *   R1 night : Matt kills Charm · Gianne saves Austin · Austin inspects Matt
 *   R1 day   : Matt→Austin · Gianne→Austin · Austin→defer → Austin voted out
 *   → Alive: Matt + Gianne → civCount = 1 ≤ 1 → MURDERER WINS 🔪
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

/* ── Screen layout: 5 col × 1 row — full height so whole page is visible ── */
function getScreenSize() {
  try {
    const out = execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const [,, w, h] = out.split(',').map(Number);
    return { w, h };
  } catch { return { w: 1440, h: 900 }; }
}
const { w: SCR_W, h: SCR_H } = getScreenSize();
const COLS = 5, ROWS = 1;
const WIN_W = Math.floor(SCR_W / COLS);
const WIN_H = SCR_H; // full screen height — whole page visible
const POSITIONS = Array.from({ length: COLS }, (_, i) => [i * WIN_W, 0]);

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
  { name: 'Matt',   avatar: '🤵',   role: 'murderer'     },
  { name: 'Gianne', avatar: '👩‍⚕️', role: 'doctor'       },
  { name: 'Austin', avatar: '👨‍💼', role: 'investigator' },
  { name: 'Charm',  avatar: '👩‍💼', role: 'civilian'     },
];

/* ── Helpers ── */
async function openWindow(browser, name, x, y) {
  const ctx  = await browser.newContext({ viewport: null }); // match actual window size
  const page = await ctx.newPage();
  // CDP: reliably set exact window bounds — full-height cell
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

// Opens a fresh index.html observer page and reads rp-8 text after polling settles
async function rp8Text(browser) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 600 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  // Place observer off-screen to the right (doesn't interfere with the 5 main windows)
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { left: SCR_W, top: 0, width: 360, height: 600, windowState: 'normal' },
  });
  await page.goto(`${INDEX}?name=Monique`);
  await sleep(7000); // wait for 2 poll cycles (loadRoomPresence runs every 2 s)
  const text = await page.evaluate(() =>
    document.getElementById('rp-8')?.innerText?.trim() ?? ''
  ).catch(() => '');
  await ctx.close();
  return text;
}

/* ════════════════════════════════════════════════════════
   SIMULATION
════════════════════════════════════════════════════════ */
async function run() {
  console.log('\n🎭 Mafia Game Simulation — 5 Windows · Full-Height · Whole Page Visible');
  console.log('   Layout: 5 columns × 1 row  |  Murderer wins in 1 round\n');
  console.log('   Roles: Matt=🔪  Gianne=💊  Austin=🔍  Charm=👤\n');

  /* 0. Clear previous game data */
  console.log('🗑️  Clearing /mafia2 Firebase data…');
  await fb('/mafia2', 'DELETE');
  await sleep(800);
  assert(await fb('/mafia2/phase') === null, 'Firebase /mafia2 cleared');

  /* 1. Launch browser */
  console.log(`🖥️  Screen ${SCR_W}×${SCR_H} → ${COLS}×${ROWS} grid · each window ${WIN_W}×${WIN_H} (full height)\n`);

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

  /* 2. Open 5 windows — all start at index.html */
  console.log('\n── Opening 5 windows from index.html ───────────────\n');
  const gmPage = await openWindow(browser, GM.name, POSITIONS[0][0], POSITIONS[0][1]);
  console.log(`  ✓ [GM] ${GM.name}  (window 0 — full height)`);
  await sleep(400);

  const playerPages = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    const [x, y] = POSITIONS[i + 1];
    playerPages.push(await openWindow(browser, PLAYERS[i].name, x, y));
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name.padEnd(8)}  (${PLAYERS[i].role})`);
    await sleep(280);
  }

  const byName = name => playerPages[PLAYERS.findIndex(p => p.name === name)];

  /* 3. Wait for all 5 to reach Arena lobby */
  console.log('\n⏳ Waiting for all 5 windows to reach Arena lobby…');
  const allArena = await waitScreen([gmPage, ...playerPages], 's-lobby', 20000);
  assert(allArena, 'All 5 windows on Arena lobby (index.html)');
  if (!allArena) { await browser.close(); return; }
  console.log('  ✓ All windows in Arena — navigating to Room 8');

  /* 4. Navigate to Mafia (Room 8) */
  console.log('\n🚪 Navigating to Room 8 (Mafia)…');
  await gmPage.goto(`${MAFIA}?autoJoin=host`);
  console.log(`  ✓ [GM] Kuya AD → mafia2.html?autoJoin=host`);
  await sleep(350);

  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].click('.room-card-mafia').catch(() =>
      playerPages[i].evaluate(() => { window.location.href = 'mafia2.html'; })
    );
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name} → clicked Room 8`);
    await sleep(250);
  }

  console.log('\n⏳ Waiting for players to reach s-role-select, then joining…');
  await waitScreen(playerPages, 's-role-select', 18000);
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].evaluate(() => joinAsPlayer()).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → joined as player`);
    await sleep(200);
  }

  /* 5. Wait for all 5 to reach Mafia lobby */
  console.log('\n⏳ Waiting for all 5 windows to reach Mafia lobby…');
  const allMafia = await waitScreen([gmPage, ...playerPages], 's-lobby', 25000);
  assert(allMafia, 'All 5 windows in Mafia lobby');
  if (!allMafia) { await browser.close(); return; }

  /* 6. Players ready up */
  console.log('\n✅ Players readying up…');
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].evaluate(() => toggleReady()).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → Ready`);
    await sleep(420);
  }
  await sleep(2000);
  const lobbySnap = await fb('/mafia2/lobby');
  const readyN = lobbySnap ? Object.values(lobbySnap).filter(p => p?.ready).length : 0;
  assert(readyN >= 4, `4 players ready in Firebase (got ${readyN})`);

  /* 6b. Observer: rp-8 should now show lobby count (Bug 1 + 4 fix verification) */
  console.log('\n🔍 Observer check — rp-8 lobby status from index.html…');
  const lobbyStatus = await rp8Text(browser);
  assert(lobbyStatus.toLowerCase().includes('in lobby'), `rp-8 shows lobby count: "${lobbyStatus}"`);

  /* 6c. Observer: verify online presence isn't wiped on boot (Bug 2 fix verification) */
  const onlineSnap = await fb('/online');
  const onlineNames = onlineSnap
    ? Object.entries(onlineSnap).filter(([,v]) => v && Date.now() - v.ts < 75000).map(([k]) => decodeURIComponent(k))
    : [];
  assert(PLAYERS.every(p => onlineNames.includes(p.name)),
    `All 4 players still online in Firebase after lobby join (no race wipe)`);

  /* 7. GM proceeds to role assignment (calls proceedToAssign directly — bypasses MIN_READY UI gate) */
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
  assert(await waitScreen(playerPages, 's-player', 12000), 'All 4 players on Stand By');

  /* 8. Assign roles */
  console.log('\n🎭 GM assigning roles…');
  for (const { name, role } of PLAYERS) {
    await gmPage.evaluate(({ n, r }) => assignRole(n, r), { n: name, r: role }).catch(() => {});
    console.log(`  ✓ ${name.padEnd(8)} → ${role}`);
    await sleep(150);
  }
  await sleep(500);
  const rolesOk = await gmPage.evaluate(() => {
    const k = Object.keys(rolesMap);
    return k.length >= 4 && k.every(n => rolesMap[n]);
  }).catch(() => false);
  assert(rolesOk, 'All 4 roles assigned on GM page');

  /* 9. Start game */
  console.log('\n▶ GM starting the game…');
  await gmPage.evaluate(() => hostStartGame()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'Phase → "night"');

  /* 9b. Observer: rp-8 should show "Game in progress" (Bug 1 fix verification) */
  console.log('\n🔍 Observer check — rp-8 game-in-progress status from index.html…');
  const gameStatus = await rp8Text(browser);
  assert(gameStatus.toLowerCase().includes('game in progress'), `rp-8 shows game active: "${gameStatus}"`);

  /* ═══════════════════════════════════════════════════
     ROUND 1 — Matt kills Charm · Austin voted out → MURDERER WINS
  ═══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Charm · Gianne saves Austin · Austin inspects Matt');

  // Wait for roles (includes 5s role-reveal countdown on round 1)
  const r1Roles = await Promise.all(PLAYERS.map((_, i) => waitRole(playerPages[i], 16000)));
  r1Roles.forEach((r, i) => assert(r === PLAYERS[i].role, `${PLAYERS[i].name} role = "${r}"`));
  await sleep(6000); // role reveal countdown

  await byName('Matt').evaluate(() => submitAction('Charm')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Austin')).catch(() => {});
  await byName('Austin').evaluate(() => submitAction('Matt')).catch(() => {});
  await byName('Charm').evaluate(() => submitSuspect('Matt')).catch(() => {}); // Charm predicts Matt dies
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Charm',  'R1 kill = Charm');
  assert((await fb('/mafia2/night/save')) === 'Austin', 'R1 save = Austin');

  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'R1 Phase → "day"');
  assert(await fb('/mafia2/alive/Charm') === false, 'Charm eliminated overnight');
  await sleep(1500);

  // Alive: Matt, Gianne, Austin (Charm dead)
  console.log('🗳️  Vote: Matt→Austin · Gianne→Austin · Austin→defer');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'R1 Phase → "vote"');
  await sleep(1200);

  await byName('Matt').evaluate(() => submitVote('Austin')).catch(() => {});
  await byName('Gianne').evaluate(() => submitVote('Austin')).catch(() => {});
  await byName('Austin').evaluate(() => submitVote('defer')).catch(() => {});
  await sleep(1800);

  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(2000);
  assert(await fb('/mafia2/alive/Austin') === false, 'Austin voted out');

  // Alive after vote: Matt + Gianne → civCount = 1 ≤ 1 → MURDERER WINS (no round 2)
  console.log('\n⚰️  Austin out → alive: Matt + Gianne → civCount = 1 → MURDERER WINS 🔪');
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
  assert(pEndCount >= 3, `${pEndCount}/4 player windows show game-over result`);

  /* Bug 3 verification: clearMyRoomPresence (index.html) clears /mafia2/lobby entry */
  console.log('\n🔍 Bug 3 check — index.html boot clears Mafia lobby presence…');
  // Matt's lobby entry still exists (game ended but no one deleted it).
  // Loading index.html as Matt triggers clearMyRoomPresence() in the boot sequence.
  const bug3ctx = await browser.newContext({ viewport: { width: 360, height: 400 } });
  const bug3page = await bug3ctx.newPage();
  await bug3page.goto(`${INDEX}?name=Matt`);
  await sleep(3000); // wait for clearMyRoomPresence async DELETE to settle
  const mattLobby = await fb('/mafia2/lobby/Matt'); // encN('Matt') = 'Matt'
  assert(mattLobby === null, 'index.html boot deleted /mafia2/lobby/Matt via clearMyRoomPresence');
  await bug3ctx.close();

  /* ── Final summary ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Game Summary — Matt 🔪 WINS in 1 Round');
  console.log('  R1 night : Matt kills Charm · Gianne saves Austin · Austin inspects Matt');
  console.log('  R1 day   : Matt + Gianne vote Austin out (Austin defers)');
  console.log('  → Alive: Matt + Gianne · civCount = 1 → MURDERER WINS! 🔪');
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
