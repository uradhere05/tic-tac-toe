'use strict';
// Simulate 5 poker sessions (5 players) → writes to Hall of Chips + leaderboard
// node poker-hall-sim.js

const DB = 'https://filo-gang-tictactoe-default-rtdb.firebaseio.com';
const STARTING_CHIPS = 2000; // $20.00 in cents

const encN = n => n.replace(/ /g, '_');

async function fb(method, path, data) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (data !== undefined) opts.body = JSON.stringify(data);
  const r = await fetch(`${DB}${path}.json`, opts);
  return r.json();
}

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}
function getWeekKey() {
  const now = new Date();
  const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() + diff);
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
}
function fmtNet(cents) {
  const sign = cents >= 0 ? '+' : '-';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// 5 players — net changes must sum to 0 each game (chips conserved)
const PLAYERS = ['Kuya AD', 'Matt', 'Gianne', 'Austin', 'Charm'];

const GAMES = [
  {
    date: '2026-05-14',
    nets: { 'Kuya AD': -500, 'Matt': 1800, 'Gianne': -400, 'Austin': -300, 'Charm': -600 },
    // Matt wins big: bluffed the river
  },
  {
    date: '2026-05-15',
    nets: { 'Kuya AD': -700, 'Matt': -800, 'Gianne': -300, 'Austin': 2200, 'Charm': -400 },
    // Austin hits a full house
  },
  {
    date: '2026-05-16',
    nets: { 'Kuya AD': 1500, 'Matt': -700, 'Gianne': -800, 'Austin': -500, 'Charm': 500 },
    // Kuya AD flopped the nuts
  },
  {
    date: '2026-05-17',
    nets: { 'Kuya AD': -800, 'Matt': -1200, 'Gianne': 3000, 'Austin': -500, 'Charm': -500 },
    // Gianne clean sweeps — pocket aces held up
  },
  {
    date: '2026-05-18',
    nets: { 'Kuya AD': -700, 'Matt': -600, 'Gianne': -700, 'Austin': 800, 'Charm': 1200 },
    // Charm rivers a straight
  },
];

// Validate each game: nets must sum to 0
GAMES.forEach((g, i) => {
  const sum = Object.values(g.nets).reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new Error(`Game ${i+1} nets don't sum to 0 (got ${sum})`);
});

async function run() {
  const monthKey = getMonthKey();
  const weekKey  = getWeekKey();

  console.log('♠ Poker Hall of Chips — Simulation');
  console.log(`  Month : ${monthKey}   Week : ${weekKey}`);
  console.log(`  Players : ${PLAYERS.join(', ')}\n`);

  // Clear this month's hall data for a clean sim
  await fb('DELETE', `/poker-hall/${monthKey}/sessions`);
  await fb('DELETE', `/poker-hall/${monthKey}/count`);
  console.log('  Cleared previous hall data for this month.\n');

  const monthlyTotals = {};
  PLAYERS.forEach(n => (monthlyTotals[n] = 0));

  for (let i = 0; i < GAMES.length; i++) {
    const g       = GAMES[i];
    const gameNum = i + 1;

    // Build encoded results for Firebase
    const results = {};
    for (const [name, net] of Object.entries(g.nets)) {
      results[encN(name)] = net;
      monthlyTotals[name] += net;
    }

    // Write session record
    await fb('PUT', `/poker-hall/${monthKey}/sessions/${gameNum}`, {
      date: g.date,
      gameNum,
      results,
    });
    await fb('PUT', `/poker-hall/${monthKey}/count`, gameNum);

    // Biggest net winner gets a leaderboard poker win
    const winner = Object.entries(g.nets).sort((a, b) => b[1] - a[1])[0][0];
    const lbPath = `/leaderboard/${weekKey}/${encodeURIComponent(winner)}/poker.json`;
    const curWins = await fetch(`${DB}${lbPath}`).then(r => r.json()).catch(() => 0) || 0;
    await fetch(`${DB}${lbPath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(curWins + 1),
    });

    // Print game summary
    const sorted = Object.entries(g.nets).sort((a, b) => b[1] - a[1]);
    console.log(`  Game #${gameNum} · ${g.date}`);
    sorted.forEach(([name, net]) => {
      const bar = net > 0 ? '▲' : net < 0 ? '▽' : '—';
      const tag = name === winner ? ' 🏆' : '';
      console.log(`    ${bar} ${name.padEnd(12)} ${fmtNet(net)}${tag}`);
    });
    console.log();
  }

  // Print monthly totals
  const sorted = Object.entries(monthlyTotals).sort((a, b) => b[1] - a[1]);
  console.log('═'.repeat(38));
  console.log('  Hall of Chips — May 2026 Totals');
  console.log('═'.repeat(38));
  sorted.forEach(([name, total], i) => {
    const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
    console.log(`  ${medal} ${name.padEnd(12)} ${fmtNet(total)}`);
  });
  console.log();
  console.log('✅ Done — open poker.html lobby to see the Hall of Chips');
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
