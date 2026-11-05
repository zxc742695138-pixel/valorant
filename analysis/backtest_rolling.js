#!/usr/bin/env node
// Rolling (walk-forward) backtest of the blacklist as a betting filter.
//
// For each period [mark_i, mark_i+1): choose the blacklist from the `trainDays`
// days before mark_i, then settle bets on matches inside the period. Each period
// uses only information available at its start, like a release published on mark_i.
// For comparison it also settles the same blacklist on its own training window
// (in-sample, optimistic by construction).
//
// Usage:
//   node analysis/backtest_rolling.js --data data-history --marks 2026-07-15,2026-08-01,...,2026-11-01
//     [--train-days 180] [--odds 1.1] [--steps 5] [--half-life 60] [--regions americas,china] [--all-opponents] [--candidates all] [--lists]

const { REGIONS, loadRegion, blacklist, settle } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-history');
const marks = (opt('--marks') || '').split(',').filter(Boolean);
const trainDays = Number(opt('--train-days', 180));
const odds = Number(opt('--odds', 1.1));
const steps = Number(opt('--steps', 5));
// --candidates all: the blacklist may pick any team seen in the region's matches
// (Challengers, other regions), not only the region's 12 partner teams.
const allCandidates = opt('--candidates') === 'all';
// --half-life N: rank teams by recency-weighted comeback maps (weight halves every N days).
const halfLife = opt('--half-life') ? Number(opt('--half-life')) : null;
// Only matches between two partner teams are used; --all-opponents keeps the rest too.
const allOpponents = argv.includes('--all-opponents');
if (marks.length < 2) {
  console.error('Usage: node analysis/backtest_rolling.js --marks YYYY-MM-DD,YYYY-MM-DD,... [--data dir] [--train-days 180] [--odds 1.1]');
  process.exit(1);
}

const minusDays = (day, n) => new Date(Date.parse(day) - n * 864e5).toISOString().slice(0, 10);
const ddmm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
// --regions americas,china: only bet on (and blacklist for) these regions.
const ACTIVE = opt('--regions') ? opt('--regions').split(',') : REGIONS;
// --teams-dir: team lists to use (e.g. crawler/teams/backtest = 2025 + 2026 partners).
const teamsDir = opt('--teams-dir', 'crawler/teams');
const regions = Object.fromEntries(ACTIVE.map(r => [r, loadRegion(r, dataDir, { allOpponents, teamsDir })]));
const earliest = Object.values(regions).flatMap(r => r.matches.map(m => m.day)).sort()[0];

const rows = [];
// Per period: all test matches and how many the filter kept, for the random baseline.
const periods = [];
const sum = { f: { bets: 0, wins: 0, profit: 0 }, a: { bets: 0, wins: 0, profit: 0 }, in: { bets: 0, wins: 0, profit: 0 } };
const add = (acc, r) => { acc.bets += r.bets; acc.wins += r.wins; acc.profit += r.profit; };
// Per region, own matches filtered by its own blacklist only.
const blank = () => ({ bets: 0, wins: 0, profit: 0 });
const byRegion = Object.fromEntries(ACTIVE.map(r => [r, { a: blank(), f: blank(), in: blank(), lists: [] }]));

for (let i = 0; i < marks.length - 1; i++) {
  const [start, end] = [marks[i], marks[i + 1]];
  const trainFrom = minusDays(start, trainDays);
  // A match can belong to two regions (international events): settle it once.
  const testAll = new Map(), testKept = new Map(), trainKept = new Map();
  const lists = {};
  for (const r of ACTIVE) {
    const { teams, opponents, matches } = regions[r];
    const train = matches.filter(m => m.day >= trainFrom && m.day < start);
    const ex = blacklist(allCandidates ? opponents : teams, train, steps, { halfLife, asOf: start });
    lists[r] = ex;
    const test = matches.filter(m => m.day >= start && m.day < end);
    const R = byRegion[r];
    add(R.a, settle(test, new Set(), odds));
    add(R.f, settle(test, ex, odds));
    add(R.in, settle(train, ex, odds));
    R.lists.push(`${ddmm(start)}: ${[...ex].join(', ')}`);
    for (const m of test) {
      testAll.set(m.url, m);
      if (!ex.has(m.t1) && !ex.has(m.t2)) testKept.set(m.url, m);
    }
    for (const m of train) if (!ex.has(m.t1) && !ex.has(m.t2)) trainKept.set(m.url, m);
  }
  const allEx = new Set(Object.values(lists).flatMap(s => [...s]));
  const a = settle([...testAll.values()], new Set(), odds);
  const f = settle([...testKept.values()], allEx, odds);
  const inS = settle([...trainKept.values()], allEx, odds);
  add(sum.a, a); add(sum.f, f); add(sum.in, inS);
  periods.push({ all: [...testAll.values()], kept: testKept.size });
  rows.push({
    'khoảng cược': `${ddmm(start)}→${ddmm(end)}`,
    'dữ liệu chọn': `${ddmm(trainFrom)}→${ddmm(minusDays(start, 1))}`,
    'cược trong 180 ngày (in-sample)': `${inS.bets} · lật ${pct(inS.losses, inS.bets)} · ${inS.profit >= 0 ? '+' : ''}${inS.profit.toFixed(1)}`,
    'không lọc': `${a.bets} · lật ${pct(a.losses, a.bets)} · ${a.profit >= 0 ? '+' : ''}${a.profit.toFixed(1)}`,
    'có lọc': `${f.bets} · lật ${pct(f.losses, f.bets)} · ${f.profit >= 0 ? '+' : ''}${f.profit.toFixed(1)}`,
    'lọc lãi?': f.bets ? (f.profit > 0 ? 'lãi' : 'lỗ') : '—',
  });
  if (trainFrom < earliest) rows[rows.length - 1]['dữ liệu chọn'] += ' (thiếu)';
}

console.log(`Mỗi khoảng: blacklist chọn từ ${trainDays} ngày trước ngày bắt đầu, cược trong khoảng đó. Tỉ lệ ăn ${odds}, hòa vốn khi lật kèo < ${(100 * (1 - 1 / odds)).toFixed(1)}%.`);
console.log('Mỗi ô: số cược · tỉ lệ lật kèo · lãi (unit)\n');
console.table(rows);
const line = (label, s) => console.log(`  ${label.padEnd(30)} ${s.bets} cược, lật ${pct(s.bets - s.wins, s.bets)}, lãi ${s.profit >= 0 ? '+' : ''}${s.profit.toFixed(1)} unit (${(100 * s.profit / s.bets).toFixed(1)}%/cược)`);
console.log('Cộng dồn các khoảng:');
line('Có lọc (thực tế)', sum.f);
line('Không lọc', sum.a);
line('In-sample (để tham khảo)', sum.in);

const cell = s => `${s.bets} · lật ${pct(s.bets - s.wins, s.bets)} · ${s.profit >= 0 ? '+' : ''}${s.profit.toFixed(1)}`;
console.log('\nTheo khu vực (cộng dồn các khoảng; mỗi khu vực chỉ lọc bằng blacklist của chính nó):');
console.table(ACTIVE.map(r => {
  const R = byRegion[r];
  const ra = (R.a.bets - R.a.wins) / R.a.bets, rf = (R.f.bets - R.f.wins) / R.f.bets;
  return {
    region: r, 'không lọc': cell(R.a), 'có lọc': cell(R.f), 'in-sample': cell(R.in),
    'lọc giảm lật kèo?': rf < ra ? `có (−${(100 * (ra - rf)).toFixed(1)} điểm)` : `không (+${(100 * (rf - ra)).toFixed(1)} điểm)`,
  };
}));
if (argv.includes('--lists')) for (const r of ACTIVE) console.log(`\n${r}:\n  ${byRegion[r].lists.join('\n  ')}`);

// Baseline: in each period keep the same number of matches as the filter, chosen at random.
const RUNS = 5000;
const profits = [];
for (let i = 0; i < RUNS; i++) {
  let p = 0;
  for (const { all, kept } of periods) {
    const pick = all.slice().sort(() => Math.random() - 0.5).slice(0, kept);
    p += settle(pick, new Set(), odds).profit;
  }
  profits.push(p);
}
profits.sort((x, y) => x - y);
const mean = profits.reduce((s, x) => s + x, 0) / RUNS;
const atLeast = profits.filter(x => x >= sum.f.profit).length / RUNS;
console.log(`\nSo với bỏ ngẫu nhiên cùng số trận (${RUNS} lần): lãi trung bình ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} unit, `
  + `khoảng 90% ${profits[Math.floor(RUNS * 0.05)].toFixed(1)} → ${profits[Math.floor(RUNS * 0.95)].toFixed(1)}; `
  + `${(100 * atLeast).toFixed(1)}% số lần chọn ngẫu nhiên lãi bằng hoặc hơn có lọc.`);

// Spread of the filtered result itself: SD per bet for a win/lose bet at this win rate.
const p = sum.f.wins / sum.f.bets;
const sd = Math.sqrt(p * (1 - p)) * odds;
const se = sd / Math.sqrt(sum.f.bets);
const perBet = sum.f.profit / sum.f.bets;
console.log(`Lãi mỗi cược khi có lọc: ${(100 * perBet).toFixed(1)}%, khoảng tin cậy 95% ≈ ${(100 * (perBet - 1.96 * se)).toFixed(1)}% → ${(100 * (perBet + 1.96 * se)).toFixed(1)}%.`);
