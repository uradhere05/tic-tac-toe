import { chromium } from 'playwright';

const DB   = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const FILE = 'file:///Users/adml/ClaudeCodeCursor/mafia2.html';
const PLAYERS = ['Kuya AD', 'Matt', 'Gianne', 'Austin', 'Charm', 'Kee', 'Kriselle'];

const fb    = async (method, path, data) => {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (data !== undefined) opts.body = JSON.stringify(data);
  return (await fetch(`${DB}${path}.json`, opts)).json();
};
const sleep = ms  => new Promise(r => setTimeout(r, ms));
const enc   = n   => n.replace(/\s/g, '_');
const log   = msg => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

// Click a button by its exact onclick value
const clickOnclick = (page, fn) =>
  page.evaluate(fn => {
    const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('onclick') === fn);
    if (!b) throw new Error(`Button onclick="${fn}" not found`);
    b.click();
  }, fn);

async function openPlayer(browser, name) {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(n => localStorage.setItem('filoName', n), name);
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  return { page, ctx, name };
}

async function run() {
  log('=== MAFIA2 — 7-PLAYER TEST ===\n');

  log('Resetting Firebase /mafia2…');
  await fb('DELETE', '/mafia2');
  await sleep(800);

  const browser = await chromium.launch({ headless: true });
  try {
    // ── 7 contexts ───────────────────────────────────────────────────
    log('Launching 7 browser contexts…');
    const players = await Promise.all(PLAYERS.map(n => openPlayer(browser, n)));
    await sleep(1000);

    // ── Role select ──────────────────────────────────────────────────
    log('\n── Role Select ──');
    await clickOnclick(players[0].page, 'joinAsGameMaster()');
    log(`${players[0].name} → Game Master`);
    await sleep(500);
    for (const p of players.slice(1)) {
      await clickOnclick(p.page, 'joinAsPlayer()');
      log(`${p.name} → Player`);
      await sleep(150);
    }
    await sleep(1500);

    // ── Lobby: everyone ready ────────────────────────────────────────
    log('\n── Lobby ──');
    for (const p of players) {
      await p.page.locator('#lb-ready-btn').click();
      log(`${p.name} ready ✓`);
      await sleep(200);
    }
    log('Waiting for lobby sync (4s)…');
    await sleep(4000);

    // ── Proceed ──────────────────────────────────────────────────────
    log('\n── Role Assignment ──');
    const hp = players[0].page;
    const countLbl = await hp.locator('#lb-count-lbl').textContent();
    log(`Lobby: ${countLbl}`);
    await hp.locator('#lb-proceed-btn').click();
    log('Host clicked Proceed');
    await sleep(800);

    await hp.locator('#s-assign.active').waitFor({ timeout: 5000 });

    const roleSeq = { Matt:'murderer', Gianne:'doctor', Austin:'investigator', Charm:'civilian', Kee:'civilian', Kriselle:'civilian' };
    for (const [name, role] of Object.entries(roleSeq)) {
      await hp.evaluate(({ name, role }) => {
        const b = [...document.querySelectorAll('.rb')].find(b => {
          const oc = b.getAttribute('onclick') || '';
          return oc.includes(`'${name}'`) && oc.includes(`'${role}'`);
        });
        if (!b) throw new Error(`No role btn for ${name}/${role}`);
        b.click();
      }, { name, role });
      log(`  ${name} → ${role}`);
      await sleep(120);
    }
    await sleep(400);

    await hp.locator('#assign-start-btn').waitFor({ state: 'visible', timeout: 3000 });
    await hp.locator('#assign-start-btn').click();
    log('▶ Game started!');
    await sleep(2000);

    // ── Verify night phase ───────────────────────────────────────────
    const [phase, round, roles, alive] = await Promise.all([
      fb('GET', '/mafia2/phase'), fb('GET', '/mafia2/round'),
      fb('GET', '/mafia2/roles'), fb('GET', '/mafia2/alive'),
    ]);
    log(`\n── Game State (Round ${round}) ──`);
    log(`Phase : ${phase}`);
    if (roles) Object.entries(roles).forEach(([k,v]) => log(`  ${k.replace(/_/g,' ')}: ${v}`));
    log(`Alive : ${Object.values(alive||{}).filter(Boolean).length}/6`);

    if (phase !== 'night') { log(`FAIL: expected night, got ${phase}`); return; }
    log('\n✅ Night phase confirmed');

    // ── Night actions ────────────────────────────────────────────────
    log('\n── Night Actions ──');
    log('  Matt (murderer)    kills   Charm');
    log('  Gianne (doctor)    saves   Kee  (different → kill lands)');
    log('  Austin (invest.)   inspects Charm');
    await Promise.all([
      fb('PUT', '/mafia2/night/kill',    'Charm'),
      fb('PUT', '/mafia2/night/save',    'Kee'),
      fb('PUT', '/mafia2/night/inspect', 'Charm'),
    ]);
    await sleep(2000);

    // Host resolves night: "☀️ Announce & Begin Day"
    await clickOnclick(hp, 'resolveNight()');
    log('Host resolved night (resolveNight)');
    await sleep(1500);

    const phaseDay = await fb('GET', '/mafia2/phase');
    const ann      = await fb('GET', '/mafia2/announcement');
    log(`\n── After Night ──`);
    log(`Phase        : ${phaseDay}`);
    log(`Announcement : ${ann}`);

    if (phaseDay !== 'day') { log(`FAIL: expected day, got ${phaseDay}`); return; }
    log('✅ Day phase — Charm was killed\n');

    // ── Open vote ────────────────────────────────────────────────────
    log('── Voting ──');
    await clickOnclick(hp, 'hostOpenVote()');
    log('Host opened vote');
    await sleep(700);

    // All alive players vote for Matt (murderer)
    const aliveNow = await fb('GET', '/mafia2/alive');
    const alivePlayers = Object.entries(aliveNow || {})
      .filter(([,v]) => v).map(([k]) => k.replace(/_/g,' '));
    for (const voter of alivePlayers.filter(n => n !== 'Matt')) {
      await fb('PUT', `/mafia2/day/votes/${enc(voter)}`, 'Matt');
    }
    log(`  ${alivePlayers.length} alive, all voting Matt (murderer)`);
    await sleep(1500);

    // Host resolves vote: "⚖️ Resolve Vote"
    await clickOnclick(hp, 'hostResolveVote()');
    log('Host resolved vote');
    await sleep(1500);

    const finalPhase = await fb('GET', '/mafia2/phase');
    const winner     = await fb('GET', '/mafia2/winner');
    const finalAnn   = await fb('GET', '/mafia2/announcement');
    log(`\n── Final ──`);
    log(`Phase        : ${finalPhase}`);
    log(`Winner       : ${winner}`);
    log(`Announcement : ${finalAnn}`);

    if (winner === 'civilians') {
      log('\n🎉 PASS — Civilians win! Matt (murderer) correctly voted out.');
    } else {
      log(`\nFAIL — expected civilians, got: ${winner}`);
    }

  } finally {
    await fb('DELETE', '/mafia2');
    log('\nFirebase cleaned up.');
    await browser.close();
  }
}

run().catch(e => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
