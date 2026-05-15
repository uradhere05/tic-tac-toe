/**
 * Mafia Bug-Fix Sim — starts at index.html.
 *
 * Full realistic user journey:
 *   index.html → click name card → Arena lobby → click Room 8 →
 *   mafia2.html → role-select → GM / Player → Mafia lobby → 2-round game
 *
 * Window layout: 5 cols × 1 row, full height
 *   [Kuya AD GM]  [Matt]  [Gianne]  [Austin]  [Charm]
 *
 * Roles: Matt=murderer · Gianne=doctor · Austin=investigator · Charm=civilian
 *
 * Game (CIVILIANS WIN in 2 rounds):
 *   R1 night : Matt→Charm · Gianne saves Charm (save=kill → no death)
 *              Austin inspects Matt · Charm suspects Matt
 *   R1 vote  : Gianne→Matt(1) · Austin→defer · Charm→defer · Matt→Gianne(1)
 *              → TIE → nobody eliminated
 *   R2 night : Matt→Gianne · Gianne saves herself (save=kill → no death)
 *              Austin inspects Matt · Charm suspects Matt
 *   R2 vote  : Gianne→Matt(1) · Austin→Matt(1) · Charm→Matt(1) · Matt→defer
 *              → 3-0 → Matt eliminated → CIVILIANS WIN 🛡️
 *
 * Tests:
 *   T0a   — all 5 windows reach Arena lobby (index.html name click)
 *   T0b   — all 5 windows reach s-role-select after clicking Room 8
 *   T0c   — all 5 windows reach Mafia lobby after role selection
 *   T1    — init(): myName loaded from localStorage
 *   T2    — writeLobbyPresence(): fresh Firebase entries
 *   T3    — renderLobbyUI(): player rows + host bar + claim button hidden
 *   T4    — _lobbyTickRunning: 5 concurrent calls blocked, flag resets
 *   T5    — toggleReady(): Firebase ready count ≥ 4
 *   T6    — renderLobbyUI(): proceed button hidden (4 < MIN_READY=5)
 *   T7    — visibilitychange on s-lobby: polling restarts
 *   T8    — buildRolesMapFromLobby(): 4 players, GM excluded
 *   T9    — proceedToAssign() cutoff: stale entry excluded
 *   Bug2  — visibilitychange on s-assign: _assignPoller restarts (fix #2)
 *   T10   — checkActiveGame() reconnect: Matt reload during night → s-player
 *   T11   — checkActiveGame() role restore: Matt's role = murderer after reload
 *   T12   — pageshow: Austin polling restarts on BFcache restore
 *   Bug4  — tied vote writes history r1/eliminated='tied' (fix #4)
 *   T13   — GM h-end visible + ≥3 player windows show game-over text
 *   T14   — checkActiveGame 'ended': GM reload → s-host + h-end, not s-player (fix #1)
 *   T15   — reconnectHost('ended'): h-end visible on direct call (fix #3)
 *
 * Run: node mafia-sim.js
 */
'use strict';
const { chromium } = require('playwright');
const { execSync }  = require('child_process');

const INDEX = 'http://localhost:8080/index.html';
const DB    = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Screen layout ── */
function getScreenSize() {
  try {
    const out = execSync("osascript -e 'tell application \"Finder\" to get bounds of window of desktop'").toString().trim();
    const [,, w, h] = out.split(',').map(Number);
    return { w, h };
  } catch { return { w: 1440, h: 900 }; }
}
const { w: SCR_W, h: SCR_H } = getScreenSize();
const COLS  = 5;
const WIN_W = Math.floor(SCR_W / COLS);
const WIN_H = SCR_H;

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
const GM      = { name: 'Kuya AD' };
const PLAYERS = [
  { name: 'Matt',   role: 'murderer'     },
  { name: 'Gianne', role: 'doctor'       },
  { name: 'Austin', role: 'investigator' },
  { name: 'Charm',  role: 'civilian'     },
];

/* ── Helpers ── */
async function openWindow(browser, x) {
  const ctx  = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const cdp  = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { left: x, top: 0, width: WIN_W, height: WIN_H, windowState: 'normal' },
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
  console.log('\n🎭 Mafia Bug-Fix Sim — starts at index.html');
  console.log('   Full journey: name select → Room 8 → role select → lobby → 2-round game\n');

  /* 0. Clear Firebase */
  console.log('🗑️  Clearing /mafia2 Firebase data…');
  await fb('/mafia2', 'DELETE');
  /* Also clear stale online presence for sim players */
  await Promise.all([GM, ...PLAYERS].map(p => fb(`/online/${encodeURIComponent(p.name)}`, 'DELETE')));
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

  /* ── Open 5 windows at index.html ── */
  console.log('── Opening 5 windows at index.html ─────────────────\n');
  const gmPage = await openWindow(browser, 0);
  console.log(`  ✓ [GM] ${GM.name} → index.html`);
  await sleep(300);
  const playerPages = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    playerPages.push(await openWindow(browser, (i + 1) * WIN_W));
    console.log(`  ✓ [P${i+1}] ${PLAYERS[i].name.padEnd(8)} → index.html`);
    await sleep(250);
  }
  const byName = name => playerPages[PLAYERS.findIndex(p => p.name === name)];

  /* ── T0a: click name cards → Arena lobby ── */
  console.log('\n🖱️  Clicking name cards on index.html…');
  await gmPage.click(`[data-name="${GM.name}"]`);
  await sleep(250);
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].click(`[data-name="${PLAYERS[i].name}"]`);
    await sleep(250);
  }
  console.log('\n⏳ Waiting for all 5 windows on Arena lobby…');
  const allArena = await waitScreen([gmPage, ...playerPages], 's-lobby', 18000);
  assert(allArena, 'T0a: all 5 windows reach Arena lobby after name click');

  /* ── T0b: click Room 8 → role-select ── */
  console.log('\n🚪 Clicking Room 8 (Mafia) from index lobby…');
  await gmPage.click('.room-card-mafia');
  await sleep(350);
  for (const p of playerPages) { await p.click('.room-card-mafia'); await sleep(250); }
  console.log('\n⏳ Waiting for all 5 windows on mafia2 role-select…');
  const allRoleSelect = await waitScreen([gmPage, ...playerPages], 's-role-select', 22000);
  assert(allRoleSelect, 'T0b: all 5 windows reach s-role-select after clicking Room 8');
  if (!allRoleSelect) { await browser.close(); return; }

  /* ── T0c: choose roles → Mafia lobby ── */
  console.log('\n🎭 Selecting roles on role-select screen…');
  await gmPage.click('button:has-text("Be the Game Master")');
  await sleep(400);
  for (const p of playerPages) { await p.click('button:has-text("Join as Player")'); await sleep(250); }
  console.log('\n⏳ Waiting for all 5 windows on Mafia lobby…');
  const allMafiaLobby = await waitScreen([gmPage, ...playerPages], 's-lobby', 22000);
  assert(allMafiaLobby, 'T0c: all 5 windows reach Mafia lobby after role selection');
  if (!allMafiaLobby) { await browser.close(); return; }
  await sleep(2500); // let lobbyTick render

  /* ── T1: init() localStorage ── */
  console.log('\n── T1: init() localStorage path ────────────────────');
  const pNames = await Promise.all(playerPages.map(p => p.evaluate(() => myName).catch(() => '')));
  assert(pNames.every((n, i) => n === PLAYERS[i].name),
    `all 4 player names correct (${pNames.join(', ')})`);
  assert(await gmPage.evaluate(() => myName).catch(() => '') === GM.name, `GM name = "${GM.name}"`);

  /* ── T2: writeLobbyPresence() ── */
  console.log('\n── T2: writeLobbyPresence() ─────────────────────────');
  const lobbySnap  = await fb('/mafia2/lobby') ?? {};
  const freshCount = Object.values(lobbySnap).filter(p => p?.name && p.ts > Date.now() - 75000).length;
  assert(freshCount >= 5, `all 5 have fresh Firebase entries (got ${freshCount})`);

  /* ── T3: renderLobbyUI() ── */
  console.log('\n── T3: renderLobbyUI() DOM correctness ──────────────');
  const rowCount = await gmPage.evaluate(() =>
    document.getElementById('lobby-list').querySelectorAll('.lp-row').length
  ).catch(() => 0);
  assert(rowCount >= 4, `player rows rendered (got ${rowCount}, expected ≥4)`);
  assert(
    await gmPage.evaluate(() => document.getElementById('lb-host-bar').textContent.includes('Game Master')).catch(() => false),
    'host bar shows "Game Master"'
  );
  assert(
    await gmPage.evaluate(() => document.getElementById('lb-claim-btn').style.display === 'none').catch(() => false),
    'claim-host button hidden when host present'
  );

  /* ── T4: _lobbyTickRunning guard ── */
  console.log('\n── T4: _lobbyTickRunning concurrent-call guard ──────');
  await gmPage.evaluate(async () => {
    await Promise.all([lobbyTick(), lobbyTick(), lobbyTick(), lobbyTick(), lobbyTick()]);
  }).catch(() => {});
  await sleep(1800);
  assert(
    await gmPage.evaluate(() => _lobbyTickRunning === false).catch(() => false),
    '_lobbyTickRunning resets to false after 5 concurrent calls'
  );
  assert(
    await gmPage.evaluate(() => document.getElementById('s-lobby')?.classList.contains('active')).catch(() => false),
    'GM still on lobby — no spurious navigation from concurrent ticks'
  );

  /* ── T5: toggleReady() ── */
  console.log('\n✅ Players readying up…');
  for (let i = 0; i < playerPages.length; i++) {
    await playerPages[i].evaluate(() => toggleReady()).catch(() => {});
    console.log(`  ✓ ${PLAYERS[i].name} → Ready`);
    await sleep(420);
  }
  await sleep(2000);
  console.log('\n── T5: toggleReady() — Firebase ready state ─────────');
  const readyN = Object.values(await fb('/mafia2/lobby') ?? {}).filter(p => p?.ready).length;
  assert(readyN >= 4, `${readyN} players marked ready in Firebase (≥4 expected)`);
  assert(
    (await playerPages[0].evaluate(() => document.getElementById('lb-ready-btn').textContent).catch(() => '')).includes('Cancel Ready'),
    'ready button shows "Cancel Ready"'
  );

  /* ── T6: proceed button gating ── */
  console.log('\n── T6: renderLobbyUI() proceed button gating ────────');
  await sleep(2200);
  const proceedVisible = await gmPage.evaluate(() =>
    document.getElementById('lb-proceed-btn').style.display !== 'none'
  ).catch(() => false);
  assert(!proceedVisible, 'proceed button hidden (4 ready < MIN_READY=5) — correct gating');

  /* ── T7: visibilitychange on s-lobby ── */
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
  assert(ivsAfter > ivsBefore, `polling restarted (ivs: ${ivsBefore} → ${ivsAfter})`);

  /* ── GM proceeds to assign ── */
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
  assert(await waitScreen(playerPages, 's-player', 12000), 'all 4 players on Stand By');

  /* ── T8: buildRolesMapFromLobby() ── */
  console.log('\n── T8: buildRolesMapFromLobby() ─────────────────────');
  const mapKeys = await gmPage.evaluate(() => Object.keys(rolesMap)).catch(() => []);
  assert(mapKeys.length === 4, `rolesMap has ${mapKeys.length} players (4 expected)`);
  assert(!mapKeys.includes('Kuya AD'), 'GM (Kuya AD) excluded from rolesMap');
  assert(PLAYERS.every(p => mapKeys.includes(p.name)), `all 4 players present (${mapKeys.join(', ')})`);

  /* ── T9: proceedToAssign() stale cutoff ── */
  console.log('\n── T9: proceedToAssign() stale-entry cutoff ─────────');
  await fb('/mafia2/lobby/Stale_Ghost', 'PUT', { name: 'Stale Ghost', ts: 0, ready: true, avatar: '👻' });
  await sleep(600);
  assert(
    !await gmPage.evaluate(() => 'Stale Ghost' in rolesMap).catch(() => true),
    'stale entry (ts=0) excluded from rolesMap by cutoff'
  );
  await fb('/mafia2/lobby/Stale_Ghost', 'DELETE');

  /* ── Bug2-fix: visibilitychange on s-assign restarts _assignPoller ── */
  console.log('\n── Bug2-fix: visibilitychange on s-assign ────────────');
  await gmPage.evaluate(() => {
    clearInterval(window._assignPoller); window._assignPoller = null;
  }).catch(() => {});
  await sleep(200);
  await gmPage.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true, writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }).catch(() => {});
  await sleep(800);
  assert(
    await gmPage.evaluate(() => !!window._assignPoller).catch(() => false),
    'Bug2-fix: visibilitychange on s-assign restarts _assignPoller'
  );

  /* ── Assign roles ── */
  console.log('\n🎭 GM assigning roles…');
  for (const { name, role } of PLAYERS) {
    await gmPage.evaluate(({ n, r }) => assignRole(n, r), { n: name, r: role }).catch(() => {});
    console.log(`  ✓ ${name.padEnd(8)} → ${role}`);
    await sleep(150);
  }
  await sleep(500);
  assert(
    await gmPage.evaluate(() => Object.keys(rolesMap).length >= 4 && Object.keys(rolesMap).every(n => rolesMap[n])).catch(() => false),
    'all 4 roles assigned in rolesMap'
  );

  /* ── Start game ── */
  console.log('\n▶ GM starting game…');
  await gmPage.evaluate(() => hostStartGame()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'night', 8000), 'Phase → "night"');

  /* ── T10+T11: checkActiveGame() reconnect during R1 night ── */
  console.log('\n── T10+T11: checkActiveGame() reconnect ─────────────');
  await sleep(2500);
  console.log('  Reloading Matt (murderer) during night phase…');
  await byName('Matt').reload({ waitUntil: 'domcontentloaded' });
  assert(
    await waitScreen([byName('Matt')], 's-player', 14000),
    'T10: Matt lands on s-player after page reload during night'
  );
  assert(
    await waitRole(byName('Matt'), 8000) === 'murderer',
    'T11: Matt role restored = "murderer" after reload'
  );

  /* ── T12: pageshow handler ── */
  console.log('\n── T12: pageshow — BFcache restore restarts polling ─');
  const austinPage = byName('Austin');
  await austinPage.evaluate(() => stopIvs()).catch(() => {});
  await sleep(200);
  await austinPage.evaluate(() => {
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  }).catch(() => {});
  await sleep(600);
  assert(
    await austinPage.evaluate(() => ivs.length).catch(() => 0) > 0,
    'T12: Austin polling restarted after pageshow'
  );

  /* ── Wait for all roles + role reveal countdowns ── */
  console.log('\n⏳ Waiting for all player roles + role-reveal countdown (6 s)…');
  const r1Roles = await Promise.all(PLAYERS.map((_, i) => waitRole(playerPages[i], 16000)));
  r1Roles.forEach((r, i) => assert(r === PLAYERS[i].role, `${PLAYERS[i].name} role = "${r}"`));
  await sleep(6000);

  /* ══════════════════════════════════════════════════
     ROUND 1
  ══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Charm · Gianne saves Charm · Austin inspects Matt · Charm suspects Matt');

  await byName('Matt').evaluate(() => submitAction('Charm')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Charm')).catch(() => {});   // save=kill → no death
  await byName('Austin').evaluate(() => submitAction('Matt')).catch(() => {});
  await byName('Charm').evaluate(() => submitSuspect('Matt')).catch(() => {});
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Charm', 'R1 kill = Charm');
  assert((await fb('/mafia2/night/save')) === 'Charm', 'R1 save = Charm (blocks kill)');

  console.log('\n🌅 GM resolving R1 night…');
  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'R1 Phase → "day"');
  assert(await fb('/mafia2/alive/Charm') !== false, 'Charm alive — save blocked kill');

  console.log('\n🗳️  R1 vote: Gianne→Matt · Austin→defer · Charm→defer · Matt→Gianne → TIE');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'R1 Phase → "vote"');
  await sleep(1200);

  await byName('Gianne').evaluate(() => submitVote('Matt')).catch(() => {});
  await byName('Austin').evaluate(() => submitVote('defer')).catch(() => {});
  await byName('Charm').evaluate(() => submitVote('defer')).catch(() => {});
  await byName('Matt').evaluate(() => submitVote('Gianne')).catch(() => {});
  await sleep(1800);

  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(2000);

  /* ── Bug4-fix: tied vote writes history entry ── */
  console.log('\n── Bug4-fix: tied vote history ──────────────────────');
  const r1Elim = await fb('/mafia2/history/r1/eliminated');
  assert(r1Elim === 'tied', `Bug4-fix: history/r1/eliminated = "${r1Elim}" (expected "tied")`);
  assert(await fb('/mafia2/phase') === 'night', 'R2 night phase started after tied vote');
  assert(await fb('/mafia2/round') === 2, 'round incremented to 2');

  /* ══════════════════════════════════════════════════
     ROUND 2
  ══════════════════════════════════════════════════ */
  console.log('\n━━━ ROUND 2 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌙 Night: Matt→Gianne · Gianne saves herself · Austin inspects Matt · Charm suspects Matt');

  /* Wait for players to pick up R2 night via pollPhase (no role-reveal delay in R2) */
  await sleep(4000);

  await byName('Matt').evaluate(() => submitAction('Gianne')).catch(() => {});
  await byName('Gianne').evaluate(() => submitAction('Gianne')).catch(() => {}); // self-save, blocks kill; lastSave was Charm so this is allowed
  await byName('Austin').evaluate(() => submitAction('Matt')).catch(() => {});
  await byName('Charm').evaluate(() => submitSuspect('Matt')).catch(() => {});
  await sleep(2200);

  assert((await fb('/mafia2/night/kill')) === 'Gianne', 'R2 kill = Gianne');
  assert((await fb('/mafia2/night/save')) === 'Gianne', 'R2 save = Gianne (self-save blocks kill)');

  console.log('\n🌅 GM resolving R2 night…');
  await gmPage.evaluate(() => resolveNight()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'day', 8000), 'R2 Phase → "day"');
  assert(await fb('/mafia2/alive/Gianne') !== false, 'Gianne alive — self-save blocked kill');

  console.log('\n🗳️  R2 vote: Gianne→Matt · Austin→Matt · Charm→Matt · Matt→defer → 3-0');
  await gmPage.evaluate(() => hostOpenVote()).catch(() => {});
  assert(await waitFb('/mafia2/phase', 'vote', 6000), 'R2 Phase → "vote"');
  await sleep(1200);

  await byName('Gianne').evaluate(() => submitVote('Matt')).catch(() => {});
  await byName('Austin').evaluate(() => submitVote('Matt')).catch(() => {});
  await byName('Charm').evaluate(() => submitVote('Matt')).catch(() => {});
  await byName('Matt').evaluate(() => submitVote('defer')).catch(() => {});
  await sleep(1800);

  await gmPage.evaluate(() => hostResolveVote()).catch(() => {});
  await sleep(2500);

  assert(await fb('/mafia2/alive/Matt') === false, 'Matt voted out (murderer caught)');
  const winner = await fb('/mafia2/winner');
  assert(winner === 'civilians', `Game winner = "${winner}"`);
  console.log('\n🛡️  Matt (murderer) caught — CIVILIANS WIN!');

  /* ── T13: end screens ── */
  console.log('\n── T13: end screens ─────────────────────────────────');
  await sleep(2000);
  assert(
    await gmPage.evaluate(() => {
      const el = document.getElementById('h-end');
      return el && getComputedStyle(el).display !== 'none';
    }).catch(() => false),
    'T13: GM sees h-end panel'
  );
  const pEndCount = (await Promise.all(
    playerPages.map(p => p.evaluate(() => {
      const c = document.getElementById('p-content')?.innerHTML ?? '';
      return c.includes('MURDERER WINS') || c.includes('CIVILIANS WIN') ||
             c.includes('Better luck') || c.includes('You won');
    }).catch(() => false))
  )).filter(Boolean).length;
  assert(pEndCount >= 3, `T13: ${pEndCount}/4 player windows show game-over text`);

  /* ── T14: Bug1-fix — GM reload → s-host + h-end (not s-player) ── */
  console.log('\n── T14: Bug1-fix — GM reload routes to s-host+h-end ─');
  await gmPage.reload({ waitUntil: 'domcontentloaded' });
  assert(
    await waitScreen([gmPage], 's-host', 14000),
    'T14: GM reload lands on s-host (not s-player)'
  );
  assert(
    await gmPage.evaluate(() => {
      const el = document.getElementById('h-end');
      return el && getComputedStyle(el).display !== 'none';
    }).catch(() => false),
    'T14: h-end panel visible after GM reload (checkActiveGame ended branch)'
  );
  assert(
    !await gmPage.evaluate(() => document.getElementById('s-player')?.classList.contains('active')).catch(() => true),
    'T14: s-player NOT active — host correctly routed to s-host'
  );

  /* ── T15: Bug3-fix — reconnectHost('ended') shows h-end ── */
  console.log('\n── T15: Bug3-fix — reconnectHost(ended) ─────────────');
  /* First switch away from h-end to simulate a stale state */
  await gmPage.evaluate(() => hShow('h-night')).catch(() => {});
  await sleep(300);
  await gmPage.evaluate(() => reconnectHost('ended')).catch(() => {});
  await sleep(2000);
  assert(
    await gmPage.evaluate(() => {
      const el = document.getElementById('h-end');
      return el && getComputedStyle(el).display !== 'none';
    }).catch(() => false),
    'T15: reconnectHost("ended") restores h-end panel'
  );

  /* ── Summary ── */
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('  📋 Mafia Bug-Fix Test Results (started from index.html)');
  console.log('  T0    full journey: index → name click → Room 8 → role-select → lobby');
  console.log('  T1    init() reads myName from localStorage');
  console.log('  T2    writeLobbyPresence() all entries fresh');
  console.log('  T3    renderLobbyUI() rows + host bar + claim btn');
  console.log('  T4    _lobbyTickRunning concurrent guard');
  console.log('  T5    toggleReady() Firebase state');
  console.log('  T6    renderLobbyUI() proceed button gating');
  console.log('  T7    visibilitychange polling restart (s-lobby)');
  console.log('  T8    buildRolesMapFromLobby() 4 players, GM excluded');
  console.log('  T9    proceedToAssign() stale cutoff');
  console.log('  Bug2  visibilitychange on s-assign restarts _assignPoller');
  console.log('  T10   checkActiveGame() reconnect → s-player during night');
  console.log('  T11   checkActiveGame() role restored = murderer');
  console.log('  T12   pageshow polling restart');
  console.log('  Bug4  tied vote writes history r1/eliminated="tied"');
  console.log('  T13   GM h-end + ≥3 player windows show game-over text');
  console.log('  T14   GM reload → s-host + h-end (Bug1-fix: not s-player)');
  console.log('  T15   reconnectHost("ended") restores h-end (Bug3-fix)');
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
