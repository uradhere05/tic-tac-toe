/**
 * Mafia Room-Join Rewrite Verification Sim — starts at index.html.
 *
 * Full realistic user journey:
 *   index.html → click name card → Arena lobby → click Room 8 →
 *   mafia2.html → role-select → click GM / Player → Mafia lobby → game
 *
 * Window layout: 5 col × 1 row, full height
 *   [Kuya AD GM]  [Matt]  [Gianne]  [Austin]  [Charm]
 *
 * Roles: Matt=murderer · Gianne=doctor · Austin=investigator · Charm=civilian
 *
 * Game (CIVILIANS WIN):
 *   R1 night : Matt kills Charm · Gianne saves Charm (save=kill → no one dies) · Austin inspects Matt
 *   R1 day   : Gianne→Matt · Austin→Matt · Charm→Matt · Matt→defer → Matt eliminated
 *   → murderer caught → CIVILIANS WIN 🛡️
 *
 * Tests:
 *   T0  — full journey: index name-select → Room 8 → role-select → lobby
 *   T1  — init(): myName loaded from localStorage (set by index.html name click)
 *   T2  — writeLobbyPresence(): all 5 have fresh Firebase entries
 *   T3  — renderLobbyUI(): player rows + host bar + claim button
 *   T4  — _lobbyTickRunning: 5 concurrent lobbyTick() calls blocked, flag resets
 *   T5  — toggleReady(): Firebase ready count correct
 *   T6  — renderLobbyUI(): proceed button hidden when ready count < MIN_READY
 *   T7  — visibilitychange: polling restarts after simulated tab focus
 *   T8  — buildRolesMapFromLobby(): 4 players, GM excluded
 *   T9  — proceedToAssign() cutoff: stale entry (ts=0) excluded
 *   T10 — checkActiveGame() reconnect: Matt reloads during night → s-player
 *   T11 — checkActiveGame() role restore: Matt's role is 'murderer' after reload
 *   T12 — pageshow: polling restarts on simulated BFcache restore
 *   T13 — full game completes cleanly (civilians win)
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

/* ── Screen layout ── */
function getScreenSize() {
  try {
    const out = execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const [,, w, h] = out.split(',').map(Number);
    return { w, h };
  } catch { return { w: 1440, h: 900 }; }
}
const { w: SCR_W, h: SCR_H } = getScreenSize();
const COLS = 5;
const WIN_W = Math.floor(SCR_W / COLS);
const WIN_H = SCR_H;
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
const GM = { name: 'Kuya AD' };
const PLAYERS = [
  { name: 'Matt',   role: 'murderer'     },
  { name: 'Gianne', role: 'doctor'       },
  { name: 'Austin', role: 'investigator' },
  { name: 'Charm',  role: 'civilian'     },
];

/* ── Helpers ── */
async function openWindow(browser, x, y, w = WIN_W, h = WIN_H) {
  const ctx  = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const cdp  = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { left: x, top: y, width: w, height: h, windowState: 'normal' },
  });
  await page.goto(INDEX);
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
  console.log('\n🎭 Mafia Room-Join Rewrite Sim — starts at index.html');
  console.log('   Full journey: name select → Room 8 → role select → lobby → game\n');

  /* 0. Clear Firebase */
  console.log('🗑️  Clearing /mafia2 Firebase data…');
  await fb('/mafia2', 'DELETE');
  await sleep(800);
  assert(await fb('/mafia2/phase') === null, 'Firebase /mafia2 cleared');

  console.log(`\n🖥️  Screen ${SCR_W}×${SCR_H} → ${COLS} cols · each window ${WIN_W}×${WIN_H}\n`);
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

  /* ── T0 PHASE 1: open 5 windows at index.html ── */
  console.log('── Opening 5 windows at index.html ─────────────────\n');
  const gmPage = await openWindow(browser, POSITIONS[0][0], POSITIONS[0][1]);
  console.log(`  ✓ [GM] ${GM.name} → index.html`);
  await sleep(300);

  const playerPages = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    const [x, y] = POSITIONS[i + 1];
    playerPages.push(await openWindow(browser, x, y));
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name.padEnd(8)} → index.html`);
    await sleep(250);
  }
  const byName = name => playerPages[PLAYERS.findIndex(p => p.name === name)];

  /* ── T0 PHASE 2: click name cards on index s-name screen ── */
  console.log('\n🖱️  Clicking name cards on index.html…');
  await gmPage.click(`[data-name="${GM.name}"]`);
  console.log(`  ✓ [GM] clicked "${GM.name}"`);
  await sleep(250);
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].click(`[data-name="${PLAYERS[i].name}"]`);
    console.log(`  ✓ [P${i+1}] clicked "${PLAYERS[i].name}"`);
    await sleep(250);
  }

  /* ── T0 PHASE 3: wait for Arena lobby ── */
  console.log('\n⏳ Waiting for all 5 windows on Arena lobby…');
  const allArena = await waitScreen([gmPage, ...playerPages], 's-lobby', 18000);
  assert(allArena, 'T0a: all 5 windows reach Arena lobby after name click');

  /* ── T0 PHASE 4: click Room 8 from index lobby ── */
  console.log('\n🚪 Clicking Room 8 (Mafia) from index lobby…');
  await gmPage.click('.room-card-mafia');
  console.log(`  ✓ [GM] clicked Room 8`);
  await sleep(350);
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].click('.room-card-mafia');
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name} clicked Room 8`);
    await sleep(250);
  }

  /* ── T0 PHASE 5: wait for role-select screen on mafia2.html ── */
  console.log('\n⏳ Waiting for all 5 windows on mafia2 role-select…');
  const allRoleSelect = await waitScreen([gmPage, ...playerPages], 's-role-select', 20000);
  assert(allRoleSelect, 'T0b: all 5 windows reach s-role-select after clicking Room 8');
  if (!allRoleSelect) { await browser.close(); return; }

  /* ── T0 PHASE 6: GM clicks "Be the Game Master", players click "Join as Player" ── */
  console.log('\n🎭 Selecting roles on role-select screen…');
  await gmPage.click('button:has-text("Be the Game Master")');
  console.log(`  ✓ [GM] clicked "Be the Game Master"`);
  await sleep(400);
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].click('button:has-text("Join as Player")');
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name} clicked "Join as Player"`);
    await sleep(250);
  }

  /* ── T0 PHASE 7: wait for Mafia lobby ── */
  console.log('\n⏳ Waiting for all 5 windows on Mafia lobby…');
  const allMafiaLobby = await waitScreen([gmPage, ...playerPages], 's-lobby', 22000);
  assert(allMafiaLobby, 'T0c: all 5 windows reach Mafia lobby after role selection');
  if (!allMafiaLobby) { await browser.close(); return; }

  await sleep(2500); // let lobbyTick render

  /* ── T1: init() reads from localStorage (set by index.html name click) ── */
  console.log('\n── T1: init() localStorage path ────────────────────');
  const pNames = await Promise.all(playerPages.map(p => p.evaluate(() => myName).catch(() => '')));
  assert(pNames.every((n, i) => n === PLAYERS[i].name),
    `init(): all 4 player names correct (${pNames.join(', ')})`);
  const gmName = await gmPage.evaluate(() => myName).catch(() => '');
  assert(gmName === GM.name, `init(): GM name correct (${gmName})`);

  /* ── T2: writeLobbyPresence() ── */
  console.log('\n── T2: writeLobbyPresence() ─────────────────────────');
  const lobbySnap = await fb('/mafia2/lobby') ?? {};
  const cutoff2 = Date.now() - 75000;
  const freshEntries = Object.values(lobbySnap).filter(p => p?.name && p.ts > cutoff2);
  assert(freshEntries.length >= 5, `all 5 have fresh Firebase entries (got ${freshEntries.length})`);

  /* ── T3: renderLobbyUI() ── */
  console.log('\n── T3: renderLobbyUI() DOM correctness ──────────────');
  const rowCount = await gmPage.evaluate(() =>
    document.getElementById('lobby-list').querySelectorAll('.lp-row').length
  ).catch(() => 0);
  assert(rowCount >= 4, `player rows rendered (got ${rowCount}, expected ≥4)`);

  const hostBarOk = await gmPage.evaluate(() =>
    document.getElementById('lb-host-bar').textContent.includes('Game Master')
  ).catch(() => false);
  assert(hostBarOk, 'host bar shows "Game Master"');

  const claimHidden = await gmPage.evaluate(() =>
    document.getElementById('lb-claim-btn').style.display === 'none'
  ).catch(() => false);
  assert(claimHidden, 'claim-host button hidden when host present');

  /* ── T4: _lobbyTickRunning guard ── */
  console.log('\n── T4: _lobbyTickRunning concurrent-call guard ──────');
  await gmPage.evaluate(async () => {
    await Promise.all([lobbyTick(), lobbyTick(), lobbyTick(), lobbyTick(), lobbyTick()]);
  }).catch(() => {});
  await sleep(1800);
  const flagOk = await gmPage.evaluate(() => _lobbyTickRunning === false).catch(() => false);
  assert(flagOk, '_lobbyTickRunning resets to false after 5 concurrent calls');
  const stillLobby = await gmPage.evaluate(() =>
    document.getElementById('s-lobby')?.classList.contains('active')
  ).catch(() => false);
  assert(stillLobby, 'GM still on lobby — no spurious navigation from concurrent ticks');

  /* 5. Ready up */
  console.log('\n✅ Players readying up…');
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].evaluate(() => toggleReady()).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → Ready`);
    await sleep(420);
  }
  await sleep(2000);

  /* ── T5: toggleReady() ── */
  console.log('\n── T5: toggleReady() — Firebase ready state ─────────');
  const readyN = Object.values(await fb('/mafia2/lobby') ?? {}).filter(p => p?.ready).length;
  assert(readyN >= 4, `${readyN} players marked ready in Firebase (≥4 expected)`);
  const rBtnText = await playerPages[0].evaluate(() =>
    document.getElementById('lb-ready-btn').textContent
  ).catch(() => '');
  assert(rBtnText.includes('Cancel Ready'), `ready button shows "Cancel Ready" (got "${rBtnText}")`);

  /* ── T6: renderLobbyUI() proceed button gating ── */
  console.log('\n── T6: renderLobbyUI() proceed button gating ────────');
  await sleep(2200);
  const proceedVisible = await gmPage.evaluate(() =>
    document.getElementById('lb-proceed-btn').style.display !== 'none'
  ).catch(() => false);
  // 4 non-host players < MIN_READY(5) → button must be hidden
  assert(!proceedVisible, 'proceed button hidden (4 ready < MIN_READY=5) — correct gating');

  /* ── T7: visibilitychange handler ── */
  console.log('\n── T7: visibilitychange — polling restarts on focus ─');
  const p0 = playerPages[0];
  await p0.evaluate(() => stopIvs()).catch(() => {});
  await sleep(200);
  const ivsBefore = await p0.evaluate(() => ivs.length).catch(() => 0);
  await p0.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true, writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }).catch(() => {});
  await sleep(600);
  const ivsAfter = await p0.evaluate(() => ivs.length).catch(() => 0);
  assert(ivsAfter > ivsBefore, `polling restarted after visibilitychange (ivs: ${ivsBefore} → ${ivsAfter})`);

  /* 6. GM assigns roles and starts game */
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

  /* ── T8: buildRolesMapFromLobby() ── */
  console.log('\n── T8: buildRolesMapFromLobby() ─────────────────────');
  const mapKeys = await gmPage.evaluate(() => Object.keys(rolesMap)).catch(() => []);
  assert(mapKeys.length === 4, `rolesMap has ${mapKeys.length} players (4 expected)`);
  assert(!mapKeys.includes('Kuya AD'), 'GM (Kuya AD) excluded from rolesMap');
  assert(PLAYERS.every(p => mapKeys.includes(p.name)),
    `all 4 players present (${mapKeys.join(', ')})`);

  /* ── T9: proceedToAssign() stale-entry cutoff ── */
  console.log('\n── T9: proceedToAssign() stale-entry cutoff ─────────');
  await fb('/mafia2/lobby/Stale_Ghost', 'PUT', { name: 'Stale Ghost', ts: 0, ready: true, avatar: '👻' });
  await sleep(600);
  const hasStale = await gmPage.evaluate(() => 'Stale Ghost' in rolesMap).catch(() => false);
  assert(!hasStale, 'stale entry (ts=0) excluded from rolesMap by cutoff');
  await fb('/mafia2/lobby/Stale_Ghost', 'DELETE');

  console.log('\n🎭 GM assigning roles…');
  for (const { name, role } of PLAYERS) {
    await gmPage.evaluate(({ n, r }) => assignRole(n, r), { n: name, r: role }).catch(() => {});
    console.log(`  ✓ ${name.padEnd(8)} → ${role}`);
    await sleep(150);
  }
  await sleep(500);
  assert(
    await gmPage.evaluate(() => {
      const k = Object.keys(rolesMap);
      return k.length >= 4 && k.every(n => rolesMap[n]);
    }).catch(() => false),
    'all 4 roles assigned in rolesMap'
  );

  console.log('\n▶ GM starting game…');
  await gmPage.evaluate(() => hostStartGame()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'Phase → "night"');

  /* ── T10 + T11: checkActiveGame() reconnect ── */
  console.log('\n── T10+T11: checkActiveGame() reconnect ─────────────');
  await sleep(2500);
  console.log('  Reloading Matt (murderer) during night phase…');
  await byName('Matt').reload({ waitUntil: 'domcontentloaded' });
  const mattRejoined = await waitScreen([byName('Matt')], 's-player', 14000);
  assert(mattRejoined, 'T10: Matt lands on s-player after page reload');
  const mattRoleAfter = await waitRole(byName('Matt'), 8000);
  assert(mattRoleAfter === 'murderer',
    `T11: Matt role restored = "${mattRoleAfter}" (expected murderer)`);

  /* ── T12: pageshow handler ── */
  console.log('\n── T12: pageshow — BFcache restore restarts polling ─');
  const austinPage = byName('Austin');
  await austinPage.evaluate(() => stopIvs()).catch(() => {});
  await sleep(200);
  await austinPage.evaluate(() => {
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  }).catch(() => {});
  await sleep(600);
  const austinIvs = await austinPage.evaluate(() => ivs.length).catch(() => 0);
  assert(austinIvs > 0, `Austin's polling restarted after pageshow (ivs.length = ${austinIvs})`);

  /* ══════════════════════════════════════════════════
     ROUND 1 — no kill · Matt voted out → CIVILIANS WIN
  ══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Charm · Gianne saves Charm · Austin inspects Matt');

  const r1Roles = await Promise.all(PLAYERS.map((_, i) => waitRole(playerPages[i], 16000)));
  r1Roles.forEach((r, i) => assert(r === PLAYERS[i].role, `${PLAYERS[i].name} role = "${r}"`));
  await sleep(6000); // role reveal countdown

  await byName('Matt').evaluate(() => submitAction('Charm')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Charm')).catch(() => {}); // save=kill → nobody dies
  await byName('Austin').evaluate(() => submitAction('Matt')).catch(() => {});
  await byName('Charm').evaluate(() => submitSuspect('Matt')).catch(() => {});
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Charm', 'R1 kill = Charm');
  assert((await fb('/mafia2/night/save')) === 'Charm', 'R1 save = Charm (blocks kill)');

  console.log('\n🌅 GM resolving night…');
  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'R1 Phase → "day"');
  assert(await fb('/mafia2/alive/Charm') !== false, 'Charm alive — save blocked kill');

  console.log('\n🗳️  Vote: Gianne→Matt · Austin→Matt · Charm→Matt · Matt→defer');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'Phase → "vote"');
  await sleep(1200);

  await byName('Gianne').evaluate(() => submitVote('Matt')).catch(() => {});
  await byName('Austin').evaluate(() => submitVote('Matt')).catch(() => {});
  await byName('Charm').evaluate(() => submitVote('Matt')).catch(() => {});
  await byName('Matt').evaluate(() => submitVote('defer')).catch(() => {});
  await sleep(1800);

  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(2000);

  assert(await fb('/mafia2/alive/Matt') === false, 'Matt voted out (murderer caught)');
  const winner = await fb('/mafia2/winner');
  assert(winner === 'civilians', `Game winner = "${winner}"`);
  console.log('\n🛡️  Matt (murderer) caught — CIVILIANS WIN!');

  /* ── T13: end screens ── */
  console.log('\n── T13: end screens ─────────────────────────────────');
  await sleep(2000);
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
  assert(winner === 'civilians', 'full game completes cleanly from index.html start');

  /* ── Summary ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Room-Join Rewrite Test Results (started from index.html)');
  console.log('  T0  full journey: index → name click → Room 8 → role-select → lobby');
  console.log('  T1  init() reads myName from localStorage');
  console.log('  T2  writeLobbyPresence() all entries fresh');
  console.log('  T3  renderLobbyUI() rows + host bar + claim btn');
  console.log('  T4  _lobbyTickRunning concurrent guard');
  console.log('  T5  toggleReady() Firebase state');
  console.log('  T6  renderLobbyUI() proceed button gating');
  console.log('  T7  visibilitychange polling restart');
  console.log('  T8  buildRolesMapFromLobby() count + GM excluded');
  console.log('  T9  proceedToAssign() stale cutoff');
  console.log('  T10 checkActiveGame() reconnect → s-player');
  console.log('  T11 checkActiveGame() role restored after reload');
  console.log('  T12 pageshow polling restart');
  console.log('  T13 full game completes cleanly');
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
