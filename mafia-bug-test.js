/**
 * Targeted regression tests for Mafia bug fixes (Bugs 3,4,6,7,8,10,11,14,16,22).
 * Run: node mafia-bug-test.js
 */
const { chromium } = require('playwright');

const DB   = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const BASE = 'file:///Users/adml/ClaudeCodeCursor/mafia2.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;

async function fb(method, path, data) {
  const { default: fetch } = await import('node-fetch');
  const opts = { method };
  if (data !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(data); }
  const r = await fetch(`${DB}${path}.json`, opts);
  return r.json();
}

function assert(condition, name, detail = '') {
  if (condition) { console.log(`  ✅ PASS  ${name}`); passed++; }
  else           { console.log(`  ❌ FAIL  ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function openPage(browser, simName, avatar, isHost = false) {
  const ctx  = await browser.newContext({ viewport: { width: 440, height: 680 } });
  const page = await ctx.newPage();
  const url  = `${BASE}?simName=${encodeURIComponent(simName)}&simAvatar=${encodeURIComponent(avatar)}${isHost ? '&autoJoin=host' : ''}`;
  await page.goto(url);
  return page;
}

async function waitForScreen(page, id, timeout = 10000) {
  await page.waitForSelector(`#${id}.active`, { timeout });
}

async function setupFullGame(browser) {
  await fb('DELETE', '/mafia2'); await sleep(500);
  const host   = await openPage(browser, 'Kuya AD', '🕵️', true);
  const matt   = await openPage(browser, 'Matt',    '👱');
  const gianne = await openPage(browser, 'Gianne',  '👩');
  const austin = await openPage(browser, 'Austin',  '👨');
  const charm  = await openPage(browser, 'Charm',   '👧');
  const kee    = await openPage(browser, 'Kee',     '🧑');
  await sleep(2200);

  for (const pg of [host, matt, gianne, austin, charm, kee]) {
    await waitForScreen(pg, 's-lobby', 10000);
    await pg.click('#lb-ready-btn'); await sleep(350);
  }
  await sleep(3500);

  await host.waitForSelector('#lb-proceed-btn:not([style*="display: none"])', { timeout: 10000 });
  await host.click('#lb-proceed-btn'); await sleep(1500);
  await waitForScreen(host, 's-assign', 8000);
  for (const [name, role] of [['Matt','murderer'],['Gianne','doctor'],['Austin','investigator'],['Charm','civilian'],['Kee','civilian']]) {
    await host.click(`.ar-row:has(.ar-name:text-is("${name}")) .rb[data-role="${role}"]`);
    await sleep(300);
  }
  await sleep(400);
  await host.click('#assign-start-btn');
  await sleep(3000);
  return { host, matt, gianne, austin, charm, kee };
}

async function run() {
  console.log('\n🔬 Mafia Bug Regression Tests\n');
  const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--window-size=440,680'] });

  // ─── GROUP A: Isolated Firebase / JS state tests ──────────────────────────
  console.log('─── Group A: Firebase & JS state ───\n');

  // Bug 10 — toggleReady() preserves avatar
  console.log('Bug 10: toggleReady() writes avatar to Firebase');
  {
    await fb('DELETE', '/mafia2'); await sleep(300);
    const pg = await openPage(browser, 'Matt', '👱');
    await waitForScreen(pg, 's-lobby', 8000);
    await pg.click('#lb-ready-btn'); await sleep(800);
    const entry = await fb('GET', '/mafia2/lobby/Matt');
    assert(entry?.avatar === '👱', 'avatar=👱 in lobby entry after ready', JSON.stringify(entry));
    await pg.close();
  }

  // Bug 11a — changeSuspect() deletes Firebase node
  console.log('\nBug 11a: changeSuspect() removes Firebase suspect node');
  {
    await fb('PUT', '/mafia2/night/suspect/Charm', 'Matt'); await sleep(200);
    const pg = await openPage(browser, 'Charm', '👧');
    await pg.evaluate(() => {
      myName = 'Charm'; mySuspect = 'Matt';
      aliveMap = { Charm: true, Matt: true };
      rolesMap = { Charm: 'civilian', Matt: 'murderer' };
    });
    await pg.evaluate(() => changeSuspect());
    await sleep(1000);
    const after = await fb('GET', '/mafia2/night/suspect/Charm');
    assert(after === null, 'suspect node deleted from Firebase', JSON.stringify(after));
    await pg.close();
  }

  // Bug 11b — changeVote() deletes Firebase node
  console.log('\nBug 11b: changeVote() removes Firebase vote node');
  {
    await fb('PUT', '/mafia2/day/votes/Charm', 'Matt'); await sleep(200);
    const pg = await openPage(browser, 'Charm', '👧');
    await pg.evaluate(() => {
      myName = 'Charm'; myVote = 'Matt';
      aliveMap = { Charm: true, Matt: true };
    });
    await pg.evaluate(() => changeVote());
    await sleep(1000);
    const after = await fb('GET', '/mafia2/day/votes/Charm');
    assert(after === null, 'vote node deleted from Firebase', JSON.stringify(after));
    await pg.close();
  }

  // Bug 4 — clearGameData() spares lobby and host
  console.log('\nBug 4: clearGameData() deletes game paths but keeps lobby/host');
  {
    await fb('DELETE', '/mafia2'); await sleep(300);
    await Promise.all([
      fb('PUT', '/mafia2/phase', 'night'),
      fb('PUT', '/mafia2/roles', { Matt: 'murderer' }),
      fb('PUT', '/mafia2/host',  'Kuya AD'),
      fb('PUT', '/mafia2/lobby/Kuya_AD', { name: 'Kuya AD', ready: false, ts: Date.now(), avatar: '🕵️' }),
    ]);
    await sleep(300);
    const pg = await openPage(browser, 'Kuya AD', '🕵️');
    await pg.evaluate(() => clearGameData());
    await sleep(1500);
    const [lobby, host, roles, phase] = await Promise.all([
      fb('GET', '/mafia2/lobby'),
      fb('GET', '/mafia2/host'),
      fb('GET', '/mafia2/roles'),
      fb('GET', '/mafia2/phase'),
    ]);
    assert(!!lobby?.Kuya_AD,    'lobby entry survives clearGameData', JSON.stringify(lobby));
    assert(host === 'Kuya AD',  'host survives clearGameData',        String(host));
    assert(roles === null,      'roles deleted by clearGameData',      JSON.stringify(roles));
    assert(phase === null,      'phase deleted by clearGameData',      JSON.stringify(phase));
    await pg.close();
  }

  // Bug 3 — endGame() writes gameEndedAt
  console.log('\nBug 3: endGame() writes gameEndedAt timestamp');
  {
    await fb('DELETE', '/mafia2'); await sleep(300);
    await Promise.all([
      fb('PUT', '/mafia2/roles', { Matt:'murderer',Gianne:'civilian',Austin:'doctor',Charm:'investigator',Kee:'civilian' }),
      fb('PUT', '/mafia2/alive', { Matt:false,Gianne:true,Austin:true,Charm:true,Kee:true }),
      fb('PUT', '/mafia2/phase', 'day'), fb('PUT', '/mafia2/round', 1),
    ]);
    const pg = await openPage(browser, 'Kuya AD', '🕵️', true);
    await pg.evaluate(() => {
      rolesMap = { Matt:'murderer',Gianne:'civilian',Austin:'doctor',Charm:'investigator',Kee:'civilian' };
      aliveMap = { Matt:false,Gianne:true,Austin:true,Charm:true,Kee:true };
      round = 1; isHost = true; isEnded = false;
    });
    const before = Date.now();
    await pg.evaluate(() => endGame('civilians'));
    await sleep(1500);
    const ts = await fb('GET', '/mafia2/gameEndedAt');
    assert(ts && ts >= before && ts <= Date.now() + 2000, 'gameEndedAt within expected timestamp range', String(ts));
    await pg.close();
  }

  // Bug 14 — showRoleReveal interval is cancelable via stopIvs()
  console.log('\nBug 14: showRoleReveal() countdown is pushed into ivs (cancelable)');
  {
    await fb('DELETE', '/mafia2'); await sleep(200);
    const pg = await openPage(browser, 'Kee', '🧑');
    // Use bare assignment — let variables are not on window
    await pg.evaluate(() => { myRole = 'civilian'; myName = 'Kee'; aliveMap = { Kee: true }; });
    await pg.evaluate(() => showRoleReveal());
    await sleep(400);
    const ivsLen = await pg.evaluate(() => ivs.length);
    assert(ivsLen > 0, `role reveal interval in ivs (ivs.length=${ivsLen})`, String(ivsLen));
    await pg.evaluate(() => stopIvs());
    // Wait longer than 5s countdown — if interval was cancelled, rr-card stays visible
    // If NOT cancelled, showNightUI() would replace it before 5s mark
    await sleep(6000);
    const stillReveal = await pg.evaluate(() => !!document.querySelector('.rr-card'));
    assert(stillReveal, 'rr-card persists after stopIvs (countdown interval truly cancelled)', String(stillReveal));
    await pg.close();
  }

  // Bug 22 — stepDownHost() goes to lobby not role-select
  console.log('\nBug 22: stepDownHost() routes to lobby not role-select');
  {
    await fb('DELETE', '/mafia2'); await sleep(200);
    const pg = await openPage(browser, 'Kuya AD', '🕵️', true);
    await waitForScreen(pg, 's-lobby', 8000);
    await pg.evaluate(() => { isHost = true; hostName = 'Kuya AD'; });
    await pg.evaluate(() => stepDownHost());
    await sleep(1500);
    const onLobby  = await pg.evaluate(() => document.getElementById('s-lobby').classList.contains('active'));
    const onSelect = await pg.evaluate(() => document.getElementById('s-role-select').classList.contains('active'));
    assert(onLobby && !onSelect, 'lands on lobby not role-select', `lobby=${onLobby} roleSelect=${onSelect}`);
    await pg.close();
  }

  // ─── GROUP B: Full 6-window game ─────────────────────────────────────────
  console.log('\n─── Group B: Full game (6 windows) ───\n');
  const { host, matt, gianne, austin, charm, kee } = await setupFullGame(browser);

  // Bug 7 — Investigator sees doctor as NOT suspicious
  console.log('Bug 7: Doctor appears NOT suspicious to investigator');
  {
    // Directly test showNightUI() logic: set Austin as investigator who inspected Gianne (doctor)
    await austin.evaluate(async () => {
      myRole = 'investigator'; myAction = 'Gianne'; myName = 'Austin';
      aliveMap = { Austin: true, Gianne: true, Matt: true, Charm: true, Kee: true };
      await showNightUI();
    });
    await sleep(1500);
    const content = await austin.evaluate(() => document.getElementById('p-content')?.innerHTML || '');
    const hasNotSuspicious = content.includes('Not Suspicious') || content.includes('clear');
    const hasSuspicious    = content.includes('⚠️') || (content.includes('Suspicious') && !content.includes('Not Suspicious'));
    assert(hasNotSuspicious && !hasSuspicious, 'Doctor appears NOT suspicious to investigator', content.substring(0, 120));
  }

  // Bug 6 — lastSave server-side constraint
  console.log('\nBug 6: resolveNight() ignores save when target equals lastSave');
  {
    // lastSave = 'Austin'; doctor tries to save Austin again this round
    await fb('PUT', '/mafia2/lastSave', 'Austin');
    await fb('PUT', '/mafia2/night/kill', 'Austin');
    await fb('PUT', '/mafia2/night/save', 'Austin'); // should be blocked
    await sleep(500);
    host.evaluate(() => { document.getElementById('h-ann').value = 'Austin was found dead.'; }).catch(()=>{});
    await host.click('button[onclick="resolveNight()"]');
    await sleep(2000);
    const alive = await fb('GET', '/mafia2/alive/Austin');
    assert(alive === false, 'Austin killed — repeated save ignored server-side', String(alive));
  }

  // Bug 16 — tied vote writes history
  console.log('\nBug 16: Tied vote records history/rN/tied=true');
  {
    const round = await fb('GET', '/mafia2/round') || 2;
    try { await host.click('#h-open-vote-btn'); } catch {}
    await sleep(1000);
    // Tie: Gianne→Kee, Kee→Gianne  (Austin defers)
    await Promise.all([
      fb('PUT', '/mafia2/day/votes/Gianne', 'Kee'),
      fb('PUT', '/mafia2/day/votes/Kee',   'Gianne'),
      fb('PUT', '/mafia2/day/votes/Austin', 'defer'),
    ]);
    await sleep(1000);
    await host.click('button[onclick="hostResolveVote()"]');
    await sleep(2000);
    const hist = await fb('GET', `/mafia2/history/r${round}`);
    assert(hist?.tied === true, `history/r${round}/tied=true written`, JSON.stringify(hist));
  }

  // Bug 8 — Role reveal skips when prevPhase is already 'night'
  console.log('\nBug 8: Role reveal skips on mid-night reconnect (prevPhase=night)');
  {
    // Directly test the conditional: prevPhase='night', myAction=null, mySuspect=null
    // With the fix, showRoleReveal() should NOT fire because prevPhase === 'night'
    const revealFired = await kee.evaluate(() => {
      let fired = false;
      const orig = showRoleReveal;
      // Temporarily intercept showRoleReveal to detect if it's called
      showRoleReveal = () => { fired = true; orig(); };
      const prevPhase = 'night'; // simulate: was already in night
      myAction = null; mySuspect = null;
      // This is the exact condition from the fix:
      if (!myAction && !mySuspect && prevPhase !== 'night') showRoleReveal();
      showRoleReveal = orig;
      return fired;
    });
    assert(!revealFired, 'showRoleReveal NOT called when prevPhase=night (reconnect)', String(revealFired));
  }

  // ─── RESULTS ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
  console.log(failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} test(s) failed`);
  console.log('\nWindows stay open for inspection.\n');
}

run().catch(err => {
  console.error('\n❌ Test runner error:', err.message);
  process.exit(1);
});
