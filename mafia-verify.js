/**
 * Mafia remaining-bug verification suite.
 * Tests the three bugs left unfixed after the previous audit:
 *
 *   Bug 7  — SSE stream only handles 'ended'/'reset'; backgrounded tabs
 *             miss night→day→vote phase transitions (polling stops on hide).
 *   Bug 8  — proceedToAssign() ignores ready flag; un-ready players are
 *             included in the game if the function is called directly.
 *   Bug 11 — Dead civilians receive win credit when civilians win.
 *
 * Run: node mafia-verify.js
 */
'use strict';
const { chromium } = require('playwright');

const DB    = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const MAFIA = 'http://localhost:8080/mafia2.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fb = (path, method = 'GET', body) => fetch(
  `${DB}${path}.json`,
  body !== undefined
    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method }
).then(r => r.json()).catch(() => null);

let passed = 0, failed = 0;
function assert(ok, label, detail = '') {
  if (ok) { console.log(`  ✅ PASS  ${label}`); passed++; }
  else     { console.log(`  ❌ FAIL  ${label}${detail ? '  ← ' + detail : ''}`); failed++; }
}
function assertBug(exists, label, detail = '') {
  // Bug-verification: we EXPECT the bug to manifest (exists=true means bug fires)
  if (exists) { console.log(`  🐛 BUG CONFIRMED   ${label}${detail ? '  (' + detail + ')' : ''}`); failed++; }
  else         { console.log(`  ✅ BUG NOT PRESENT ${label}`); passed++; }
}

async function openWindow(browser, simName, avatar, autoJoin, vpW = 440, vpH = 780) {
  const ctx  = await browser.newContext({ viewport: { width: vpW, height: vpH } });
  const page = await ctx.newPage();
  await page.goto(`${MAFIA}?simName=${encodeURIComponent(simName)}&simAvatar=${encodeURIComponent(avatar)}&autoJoin=${autoJoin}`);
  return page;
}

async function waitScreen(pages, id, timeout = 20000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const all = await Promise.all(pages.map(p =>
      p.evaluate(sid => document.getElementById(sid)?.classList.contains('active'), id).catch(() => false)
    ));
    if (all.every(Boolean)) return true;
    await sleep(400);
  }
  return false;
}

async function waitRole(page, timeout = 14000) {
  const dl = Date.now() + timeout;
  while (Date.now() < dl) {
    const r = await page.evaluate(() => myRole).catch(() => null);
    if (r) return r;
    await sleep(300);
  }
  return null;
}

/* ════════════════════════════════════════════════════════
   BUG 7 — Backgrounded tab misses mid-game phase transitions
   Method: open GM + Austin (investigator), start game to night,
   simulate tab backgrounding on Austin by calling stopIvs(),
   GM resolves night → phase becomes 'day',
   wait 4s (≥ 2 polling cycles if polling were running),
   check if Austin's UI is still on 'night'.
════════════════════════════════════════════════════════ */
async function verifyBug7(browser) {
  console.log('\n' + '─'.repeat(52));
  console.log('  🐛 Bug 7 — Backgrounded tab misses phase transition');
  console.log('─'.repeat(52));

  await fb('/mafia2', 'DELETE');
  await sleep(600);

  const gm     = await openWindow(browser, 'Kuya AD', '🕵️', 'host');
  const austin = await openWindow(browser, 'Austin',  '👨‍💼', 'player');
  const matt   = await openWindow(browser, 'Matt',    '🤵',   'player');
  const gianne = await openWindow(browser, 'Gianne',  '👩‍⚕️', 'player');
  const charm  = await openWindow(browser, 'Charm',   '👩‍💼', 'player');
  const kee    = await openWindow(browser, 'Kee',     '🧑‍🌾', 'player');
  const kris   = await openWindow(browser, 'Kriselle','👩‍🍳', 'player');
  const all6   = [matt, gianne, austin, charm, kee, kris];

  await waitScreen([gm, ...all6], 's-lobby', 18000);

  for (const p of all6) await p.evaluate(() => toggleReady()).catch(() => {});
  await sleep(2000);

  await gm.evaluate(async () => {
    if (!hostName) hostName = await fb('GET', '/mafia2/host') ?? myName;
    await proceedToAssign();
  });
  await sleep(1000);

  const roles = {Matt:'murderer',Gianne:'doctor',Austin:'investigator',Charm:'civilian',Kee:'civilian',Kriselle:'civilian'};
  for (const [name, role] of Object.entries(roles))
    await gm.evaluate(({n,r}) => assignRole(n,r), {n:name, r:role});
  await sleep(300);

  await gm.evaluate(() => hostStartGame());
  await waitRole(austin, 12000);
  await sleep(6000); // let role reveal countdown finish

  // ── Simulate Austin's tab going to background ──
  // In a real browser, visibilitychange → stopIvs(). Reproduce that:
  await austin.evaluate(() => stopIvs());
  console.log('  ⏸  Austin\'s tab "backgrounded" — polling stopped (stopIvs called)');

  // GM resolves night (murderer had no kill target → quiet night)
  await gm.evaluate(() => resolveNight());
  await sleep(4000); // 4s = more than 2 polling cycles would have been

  // Check what phase Austin thinks he's on
  const austinKnownPhase = await austin.evaluate(() => knownPhase).catch(() => null);
  const austinPhase      = await fb('/mafia2/phase');
  const stuckOnNight     = austinKnownPhase === 'night' && austinPhase === 'day';

  console.log(`  Firebase phase = "${austinPhase}"  |  Austin knownPhase = "${austinKnownPhase}"`);
  assertBug(stuckOnNight,
    'Backgrounded player misses night→day transition',
    stuckOnNight ? 'Austin still thinks it is night while phase is day' : 'SSE pushed the update correctly'
  );

  // Clean up
  for (const p of [gm, ...all6]) await p.context().close().catch(() => {});
  await fb('/mafia2', 'DELETE');
}

/* ════════════════════════════════════════════════════════
   BUG 8 — proceedToAssign() includes un-ready players
   Method: open GM + 6 players, have only 5 ready (Kriselle stays
   NOT ready), then call proceedToAssign() directly (bypassing
   the UI canProceed gate). Check if Kriselle appears in rolesMap.
════════════════════════════════════════════════════════ */
async function verifyBug8(browser) {
  console.log('\n' + '─'.repeat(52));
  console.log('  🐛 Bug 8 — proceedToAssign() includes un-ready players');
  console.log('─'.repeat(52));

  await fb('/mafia2', 'DELETE');
  await sleep(600);

  const gm   = await openWindow(browser, 'Kuya AD', '🕵️', 'host');
  const matt = await openWindow(browser, 'Matt',    '🤵',   'player');
  const gia  = await openWindow(browser, 'Gianne',  '👩‍⚕️', 'player');
  const aus  = await openWindow(browser, 'Austin',  '👨‍💼', 'player');
  const ch   = await openWindow(browser, 'Charm',   '👩‍💼', 'player');
  const kee  = await openWindow(browser, 'Kee',     '🧑‍🌾', 'player');
  const kris = await openWindow(browser, 'Kriselle','👩‍🍳', 'player'); // will NOT ready up
  const all6 = [matt, gia, aus, ch, kee, kris];

  await waitScreen([gm, ...all6], 's-lobby', 18000);

  // Only 5 of 6 players ready — Kriselle stays unready
  for (const p of [matt, gia, aus, ch, kee]) await p.evaluate(() => toggleReady()).catch(() => {});
  await sleep(2500);

  // Verify Kriselle is NOT ready in Firebase
  const lobbySnap  = await fb('/mafia2/lobby');
  const krisReady  = lobbySnap?.Kriselle?.ready ?? false;
  assert(!krisReady, 'Kriselle is NOT ready in Firebase (setup check)');

  // Bypass the UI gate and call proceedToAssign() directly
  await gm.evaluate(async () => {
    if (!hostName) hostName = await fb('GET', '/mafia2/host') ?? myName;
    await proceedToAssign();
  });
  await sleep(1500);

  // Check if Kriselle ended up in rolesMap on the GM page
  const rolesKeys = await gm.evaluate(() => Object.keys(rolesMap)).catch(() => []);
  const krisIncluded = rolesKeys.includes('Kriselle');
  console.log(`  rolesMap keys: [${rolesKeys.join(', ')}]`);
  assertBug(krisIncluded,
    'Un-ready player (Kriselle) included in rolesMap via proceedToAssign()',
    krisIncluded ? 'Kriselle was added despite not being ready' : 'Only ready players included'
  );

  for (const p of [gm, ...all6]) await p.context().close().catch(() => {});
  await fb('/mafia2', 'DELETE');
}

/* ════════════════════════════════════════════════════════
   BUG 11 — Dead civilian receives win credit
   Method: run a full game where Charm (civilian) is killed,
   civilians win. Check Charm's leaderboard entry increased.
════════════════════════════════════════════════════════ */
async function verifyBug11(browser) {
  console.log('\n' + '─'.repeat(52));
  console.log('  🐛 Bug 11 — Dead civilian receives win credit');
  console.log('─'.repeat(52));

  await fb('/mafia2', 'DELETE');
  await sleep(600);

  // Record Charm's win count before the game
  const weekKey = (() => {
    const now = new Date();
    const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
    const mon  = new Date(now); mon.setDate(now.getDate() + diff);
    return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
  })();
  const charmBefore = await fb(`/leaderboard/${weekKey}/Charm`) ?? 0;
  console.log(`  Charm wins before game: ${charmBefore}`);

  const gm    = await openWindow(browser, 'Kuya AD', '🕵️', 'host');
  const matt  = await openWindow(browser, 'Matt',    '🤵',   'player');
  const gia   = await openWindow(browser, 'Gianne',  '👩‍⚕️', 'player');
  const aus   = await openWindow(browser, 'Austin',  '👨‍💼', 'player');
  const charm = await openWindow(browser, 'Charm',   '👩‍💼', 'player');
  const kee   = await openWindow(browser, 'Kee',     '🧑‍🌾', 'player');
  const kris  = await openWindow(browser, 'Kriselle','👩‍🍳', 'player');
  const all6  = [matt, gia, aus, charm, kee, kris];

  await waitScreen([gm, ...all6], 's-lobby', 18000);
  for (const p of all6) await p.evaluate(() => toggleReady()).catch(() => {});
  await sleep(2000);

  await gm.evaluate(async () => {
    if (!hostName) hostName = await fb('GET', '/mafia2/host') ?? myName;
    await proceedToAssign();
  });
  await sleep(1000);

  const roles = {Matt:'murderer',Gianne:'doctor',Austin:'investigator',Charm:'civilian',Kee:'civilian',Kriselle:'civilian'};
  for (const [name, role] of Object.entries(roles))
    await gm.evaluate(({n,r}) => assignRole(n,r), {n:name, r:role});
  await sleep(300);

  await gm.evaluate(() => hostStartGame());

  // Wait for roles
  await Promise.all(all6.map(p => waitRole(p, 12000)));
  await sleep(6000); // role reveal

  // Night: Matt kills Charm, Gianne saves Kee, Austin inspects Matt
  await matt.evaluate(()  => submitAction('Charm')).catch(() => {});
  await gia.evaluate(()   => submitAction('Kee')).catch(() => {});
  await aus.evaluate(()   => submitAction('Matt')).catch(() => {});
  for (const p of [charm, kee, kris])
    await p.evaluate(() => submitSuspect('Matt')).catch(() => {});
  await sleep(2500);

  // GM resolves night (Charm dies)
  await gm.evaluate(() => resolveNight());
  await sleep(2000);

  const charmAlive = await fb('/mafia2/alive/Charm');
  assert(charmAlive === false, 'Charm is dead after night resolve');

  // GM opens vote, all alive players vote Matt
  await gm.evaluate(() => hostOpenVote());
  await sleep(1500);
  for (const [p, name] of [[matt,'Matt'],[gia,'Gianne'],[aus,'Austin'],[kee,'Kee'],[kris,'Kriselle']])
    await p.evaluate(() => submitVote('Matt')).catch(() => {});
  await sleep(2000);

  await gm.evaluate(() => hostResolveVote());
  await sleep(3000); // wait for recordWin to fire

  const winner       = await fb('/mafia2/winner');
  assert(winner === 'civilians', `Game winner = ${winner}`);

  const charmAfter   = await fb(`/leaderboard/${weekKey}/Charm`) ?? 0;
  const charmGotWin  = charmAfter > charmBefore;
  console.log(`  Charm wins after game: ${charmAfter}  (was ${charmBefore})`);
  assertBug(charmGotWin,
    'Dead civilian (Charm) received a win credit',
    charmGotWin
      ? `Charm +${charmAfter - charmBefore} win(s) despite being killed in round 1`
      : 'Charm did NOT receive a win — dead civilians excluded correctly'
  );

  for (const p of [gm, ...all6]) await p.context().close().catch(() => {});
  await fb('/mafia2', 'DELETE');
}

/* ════════════════════════════════════════════════════════
   RUNNER
════════════════════════════════════════════════════════ */
async function run() {
  console.log('\n🔬 Mafia Remaining-Bug Verification Suite\n');
  console.log('Verifying Bug 7 (backgrounded tab), Bug 8 (un-ready player),');
  console.log('Bug 11 (dead civilian wins)\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--window-size=460,820',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  try {
    await verifyBug7(browser);
    await verifyBug8(browser);
    await verifyBug11(browser);
  } finally {
    await browser.close();
  }

  console.log('\n' + '═'.repeat(52));
  console.log(`Results: ${passed} confirmed-safe, ${failed} bug(s) confirmed`);
  console.log(failed === 0
    ? '🎉 No remaining bugs confirmed — all clear!'
    : `🐛 ${failed} bug(s) verified — see fixes needed above`
  );
  console.log();
}

run().catch(err => {
  console.error('\n❌ Verify error:', err.message);
  process.exit(1);
});
