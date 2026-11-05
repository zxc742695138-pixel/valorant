#!/usr/bin/env node
// Walk-forward backtest of the blacklist as a live-betting filter, with one split.
// The blacklist is chosen ONLY from matches before the split date, then bets are
// settled on matches after it (see betting.js for the bet). For several periods
// in a row, use backtest_rolling.js.
//
// Usage:
//   node analysis/backtest.js --split 2026-08-01 [--odds 1.1] [--steps 5] [--data data] [--train-days 90]

const { REGIONS, loadRegion, blacklist, settle } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const split = opt('--split');
const odds = Number(opt('--odds', 1.1));
const steps = Number(opt('--steps', 5));
const dataDir = opt('--data', 'data');
const trainDays = opt('--train-days') ? Number(opt('--train-days')) : null;
if (!split) {
  console.error('Usage: node analysis/backtest.js --split YYYY-MM-DD [--odds 1.1] [--steps 5] [--train-days N]');
  process.exit(1);
}
const trainFrom = trainDays ? new Date(Date.parse(split) - trainDays * 864e5).toISOString().slice(0, 10) : '0000';

const pct = x => `${(100 * x).toFixed(1)}%`;
const rows = [];
const seenAll = new Map();
const seenFiltered = new Map();
const lists = {};

for (const region of REGIONS) {
  const { teams, matches } = loadRegion(region, dataDir);
  const train = matches.filter(m => m.day < split && m.day >= trainFrom);
  const test = matches.filter(m => m.day >= split);
  const excluded = blacklist(teams, train, steps);
  lists[region] = [...excluded];
  const f = settle(test, excluded, odds);
  const a = settle(test, new Set(), odds);
  rows.push({
    region, train_matches: train.length, test_matches: test.length,
    bets_all: a.bets, comeback_all: pct(a.losses / a.bets), profit_all: +a.profit.toFixed(1),
    bets_filtered: f.bets, comeback_filtered: pct(f.losses / f.bets), profit_filtered: +f.profit.toFixed(1),
  });
  // Global totals: count each match once even when it appears in two regions.
  for (const m of test) {
    if (!seenAll.has(m.url)) seenAll.set(m.url, m);
    if (!seenFiltered.has(m.url) && !excluded.has(m.t1) && !excluded.has(m.t2)) seenFiltered.set(m.url, m);
  }
}

console.log(`Blacklist chọn từ trận ${trainDays ? `${trainFrom} → ` : 'trước '}${split}, kiểm tra trên trận từ ${split}. Tỉ lệ cược ${odds}, hòa vốn khi tỉ lệ lật kèo < ${pct(1 - 1 / odds)}\n`);
for (const r of REGIONS) console.log(`  ${r.padEnd(9)} ${lists[r].join(', ')}`);
console.log();
console.table(rows);
const ga = settle([...seenAll.values()], new Set(), odds);
// A match kept in its own region could involve another region's blacklisted team; settle with every list.
const gf = settle([...seenFiltered.values()], new Set(Object.values(lists).flat()), odds);
console.log('Tổng (mỗi trận tính 1 lần):');
console.log(`  Không lọc: ${ga.bets} cược, lật kèo ${pct(ga.losses / ga.bets)}, lãi ${ga.profit.toFixed(1)} unit (${(100 * ga.profit / ga.bets).toFixed(1)}%/cược)`);
console.log(`  Có lọc:    ${gf.bets} cược, lật kèo ${pct(gf.losses / gf.bets)}, lãi ${gf.profit.toFixed(1)} unit (${(100 * gf.profit / gf.bets).toFixed(1)}%/cược)`);
