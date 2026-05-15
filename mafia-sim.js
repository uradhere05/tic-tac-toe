/**
 * Mafia Game Simulation — 7 players, 7 visible Chrome windows.
 *
 * Window layout:
 *   [GM: Kuya AD]  [Matt]  [Gianne]
 *   [Austin]  [Charm]  [Kee]  [Kriselle]
 *
 * Game scenario (1 round, civilians win):
 *   Roles: Matt=murderer · Gianne=doctor · Austin=investigator
 *          Charm/Kee/Kriselle=civilian
 *   Night: Matt kills Charm · Gianne saves Kee (≠ Charm) ·
 *          Austin inspects Matt (finds murderer)
 *   Result: Charm dies
 *   Vote: All 5 alive players vote Matt → Matt eliminated → Civilians win!
 *
 * Uses ?simName= URL params (built into mafia2.js) so all 7 windows
 * can have different player identities on the same browser origin.
 *
 * Run: node mafia-sim.js
 */
'use strict';
const { chromium } = require('playwright');

const DB    = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const MAFIA = 'http://localhost:8080/mafia2.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Firebase REST helper */
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
  { name: 'Matt',     avatar: '🤵',   role: 'murderer'     },  // kills Charm
  { name: 'Gianne',   avatar: '👩‍⚕️', role: 'doctor'       },  // saves Kee
  { name: 'Austin',   avatar: '👨‍💼', role: 'investigator' },  // inspects Matt
  { name: 'Charm',    avatar: '👩‍💼', role: 'civilian'     },  // dies tonight
  { name: 'Kee',      avatar: '🧑‍🌾', role: 'civilian'     },  // saved
  { name: 'Kriselle', avatar: '👩‍🍳', role: 'civilian'     },
];

/* ── Window helper ── */
async function openWindow(browser, simName, avatar, autoJoin, x, y, vpW, vpH) {
  const ctx  = await browser.newContext({ viewport: { width: vpW, height: vpH } });
  const page = await ctx.newPage();
  await page.goto(
    `${MAFIA}?simName=${encodeURIComponent(simName)}&simAvatar=${encodeURIComponent(avatar)}&autoJoin=${autoJoin}`
  );
  await page.evaluate((px, py) => window.moveTo(px, py), x, y).catch(() => {});
  return page;
}

/* ── Poll helpers ── */
async function waitScreen(pages, id, timeout = 20000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const all = await Promise.all(
      pages.map(p => p.evaluate(sid => document.getElementById(sid)?.classList.contains('active'), id).catch(() => false))
    );
    if (all.every(Boolean)) return true;
    await sleep(400);
  }
  return false;
}

async function waitRole(page, timeout = 15000) {
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
  console.log('\n🎭 Mafia Game Simulation — 7 Players · 7 Chrome Windows\n');
  console.log('  Roles: Matt=🔪  Gianne=💊  Austin=🔍  Charm/Kee/Kriselle=👤\n');

  /* 0. Clear previous game data */
  console.log('🗑️  Clearing /mafia2 Firebase data…');
  await fb('/mafia2', 'DELETE');
  await sleep(800);
  assert(await fb('/mafia2/phase') === null, 'Firebase /mafia2 cleared');

  /* 1. Launch browser */
  const browser = await chromium.launch({
    headless: false,
    channel:  'chrome',
    args: [
      '--window-size=460,820',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  /* 2. Open 7 windows */
  console.log('\n── Opening 7 windows ───────────────────────────────\n');
  //  Row 0: [GM 0,0] [Matt 460,0] [Gianne 920,0]
  //  Row 1: [Austin 0,430] [Charm 460,430] [Kee 920,430] [Kriselle 0,860]
  const gmPage = await openWindow(browser, GM.name, GM.avatar, 'host', 0, 0, 450, 820);
  console.log(`  ✓ [GM]  ${GM.name}`);
  await sleep(600);

  const POS = [[460,0],[920,0],[0,430],[460,430],[920,430],[0,860]];
  const playerPages = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    const { name, avatar } = PLAYERS[i];
    const [x, y] = POS[i];
    playerPages.push(await openWindow(browser, name, avatar, 'player', x, y, 440, 420));
    console.log(`  ✓ [P${i + 1}] ${name}  (${PLAYERS[i].role})`);
    await sleep(350);
  }

  /* 3. Wait for lobby */
  console.log('\n⏳ Waiting for all 7 windows to reach s-lobby…');
  const allLobby = await waitScreen([gmPage, ...playerPages], 's-lobby', 20000);
  assert(allLobby, 'All 7 windows in lobby');
  if (!allLobby) { await browser.close(); return; }

  /* 4. Players ready up */
  console.log('\n✅ Players readying up…');
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].evaluate(() => toggleReady()).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → Ready`);
    await sleep(450);
  }
  await sleep(2500);
  const lobbySnap = await fb('/mafia2/lobby');
  const readyN = lobbySnap ? Object.values(lobbySnap).filter(p => p?.ready).length : 0;
  assert(readyN >= 6, `6 players ready in Firebase (${readyN}/6)`, String(readyN));

  /* 5. GM proceeds to assign */
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
  assert(await waitScreen(playerPages, 's-player', 10000), 'All 6 players on Stand By');

  /* 6. GM assigns roles */
  console.log('\n🎭 GM assigning roles…');
  for (const { name, role } of PLAYERS) {
    await gmPage.evaluate(({ n, r }) => assignRole(n, r), { n: name, r: role }).catch(() => {});
    console.log(`  ✓ ${name} → ${role}`);
    await sleep(180);
  }
  await sleep(500);
  const rolesOk = await gmPage.evaluate(() => {
    const k = Object.keys(rolesMap);
    return k.length >= 6 && k.every(n => rolesMap[n]);
  }).catch(() => false);
  assert(rolesOk, 'All 6 roles assigned on GM page');

  /* 7. GM starts the game */
  console.log('\n▶ GM starting the game…');
  await gmPage.evaluate(() => hostStartGame()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'Phase → "night"');

  /* 8. Night — wait for each player to receive their role */
  console.log('\n🌙 Night Phase — polling until all players have myRole…');
  // pollPhase() runs every 1.5 s; round-1 role reveal shows a 5-second countdown.
  const roles = await Promise.all(PLAYERS.map((_, i) => waitRole(playerPages[i], 14000)));
  roles.forEach((r, i) => assert(r === PLAYERS[i].role, `${PLAYERS[i].name} role = ${r}`));

  /* 9. Submit night actions */
  console.log('\n  Night actions:');
  const mIdx = PLAYERS.findIndex(p => p.role === 'murderer');
  const dIdx = PLAYERS.findIndex(p => p.role === 'doctor');
  const iIdx = PLAYERS.findIndex(p => p.role === 'investigator');
  const cIdxs = PLAYERS.map((p, i) => p.role === 'civilian' ? i : -1).filter(i => i >= 0);

  await playerPages[mIdx].evaluate(() => submitAction('Charm')).catch(() => {});
  console.log('  🔪 Matt   → targets Charm');
  await playerPages[dIdx].evaluate(() => submitAction('Kee')).catch(() => {});
  console.log('  💊 Gianne → saves Kee');
  await playerPages[iIdx].evaluate(() => submitAction('Matt')).catch(() => {});
  console.log('  🔍 Austin → inspects Matt');
  for (const ci of cIdxs) {
    await playerPages[ci].evaluate(() => submitSuspect('Matt')).catch(() => {});
    console.log(`  👤 ${PLAYERS[ci].name.padEnd(8)} → predicts Matt dies`);
    await sleep(200);
  }
  await sleep(2500);

  const [killD, saveD, inspD] = await Promise.all([
    fb('/mafia2/night/kill'), fb('/mafia2/night/save'), fb('/mafia2/night/inspect'),
  ]);
  assert(killD === 'Charm', `Kill   = ${killD}`, 'expected Charm');
  assert(saveD === 'Kee',   `Save   = ${saveD}`, 'expected Kee');
  assert(inspD === 'Matt',  `Inspect = ${inspD}`, 'expected Matt');

  /* 10. GM resolves night */
  console.log('\n☀️  GM resolving night…');
  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'Phase → "day"');

  const charmAlive = await fb('/mafia2/alive/Charm');
  assert(charmAlive === false, 'Charm eliminated overnight', String(charmAlive));

  const ann = await fb('/mafia2/announcement');
  console.log(`\n  📢 "${ann}"`);
  assert(ann?.toLowerCase().includes('charm'), 'Announcement mentions Charm', String(ann));
  await sleep(2000);

  /* 11. GM opens vote */
  console.log('\n🗳️  GM opening vote…');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'Phase → "vote"');
  await sleep(1500);

  /* 12. Alive players vote for Matt */
  console.log('\n  Votes:');
  for (let i = 0; i < PLAYERS.length; i++) {
    if (PLAYERS[i].name === 'Charm') continue;   // dead
    await playerPages[i].evaluate(() => submitVote('Matt')).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → Matt`);
    await sleep(300);
  }
  await sleep(2000);
  const votes   = await fb('/mafia2/day/votes');
  const mattVoteN = votes ? Object.values(votes).filter(v => v === 'Matt').length : 0;
  assert(mattVoteN >= 5, `Matt received ${mattVoteN}/5 votes`, String(mattVoteN));

  /* 13. GM resolves vote */
  console.log('\n⚖️  GM resolving vote…');
  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(2000);

  const mattAlive = await fb('/mafia2/alive/Matt');
  assert(mattAlive === false, 'Matt eliminated by vote (murderer caught!)', String(mattAlive));

  const winner = await fb('/mafia2/winner');
  assert(winner === 'civilians', `Winner: "${winner}"`, 'expected civilians');

  /* 14. End screens */
  console.log('\n🏁 Checking end screens…');
  await sleep(3500);
  const gmEnd = await gmPage.evaluate(() =>
    document.getElementById('h-end') && getComputedStyle(document.getElementById('h-end')).display !== 'none'
  ).catch(() => false);
  assert(gmEnd, 'GM sees end screen (h-end visible)');

  const pEndCount = (await Promise.all(
    playerPages.map(p => p.evaluate(() => {
      const c = document.getElementById('p-content')?.innerHTML ?? '';
      return c.includes('CIVILIANS WIN') || c.includes('MURDERER WINS') || c.includes('Better luck') || c.includes('You won');
    }).catch(() => false))
  )).filter(Boolean).length;
  assert(pEndCount >= 5, `${pEndCount}/6 player windows show game-over result`);

  /* ── Final summary ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Game Summary');
  console.log('  • Matt 🔪 murdered Charm overnight');
  console.log('  • Gianne 💊 saved Kee (not Charm → Charm dies)');
  console.log('  • Austin 🔍 identified Matt as the murderer');
  console.log('  • Town voted Matt out → Civilians win! 🛡️');
  console.log('╚══════════════════════════════════════════════════════╝');

  console.log(`\n${'═'.repeat(54)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
  console.log(failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} test(s) failed`);
  console.log('\nWindows stay open 10 s for inspection…');
  await sleep(10000);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Sim error:', err.message);
  process.exit(1);
});
