#!/usr/bin/env node
// Walk-forward backtest of the blacklist as a live-betting filter.
//
// Bet: on every map where, at total rounds >= MIN_TOTAL, a team first leads by
// >= MIN_DIFF rounds, stake 1 unit on that leader at decimal odds ODDS
// (win → +ODDS-1, loss → -1). Skip maps involving a blacklisted team.
//
// The blacklist is chosen ONLY from matches before the split date (same
// iterative algorithm as iterative_exclude.js), then bets are settled on
// matches after it, so the result is out-of-sample.
//
// Usage:
//   node analysis/backtest.js --split 2026-08-01 [--odds 1.1] [--steps 5] [--data data] [--train-days 90]

const fs = require('fs');
const path = require('path');
const { MIN_TOTAL, MIN_DIFF, analyzeMatches } = require('./comeback');

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

const normalize = name => (name.match(/\(([^)]+)\)$/) || [null, name])[1].trim();
const REGIONS = ['americas', 'emea', 'china', 'pacific'];

// The leader at the first qualifying moment, and whether that leader won the map.
function firstLeadOutcome(rounds) {
  const states = rounds.map(s => s.split('-').map(Number));
  const [f1, f2] = states[states.length - 1];
  for (const [a, b] of states) {
    if (a + b >= MIN_TOTAL && Math.abs(a - b) >= MIN_DIFF) return { won: (a > b) === (f1 > f2) };
  }
  return null;
}

// Same greedy algorithm as iterative_exclude.js, on the given matches.
function blacklist(teams, matches) {
  const excluded = new Set();
  for (let s = 0; s < steps; s++) {
    const keep = matches.filter(m => !excluded.has(m.t1) && !excluded.has(m.t2));
    const rows = teams.filter(t => !excluded.has(t)).map(t => {
      const r = analyzeMatches(keep.filter(m => m.t1 === t || m.t2 === t));
      return { t, cb: r.comebacks, rate: r.rate || 0 };
    }).sort((a, b) => b.cb - a.cb || b.rate - a.rate);
    excluded.add(rows[0].t);
  }
  return excluded;
}

function settle(matches, excluded) {
  const res = { bets: 0, wins: 0 };
  for (const m of matches) {
    if (excluded.has(m.t1) || excluded.has(m.t2)) continue;
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const o = firstLeadOutcome(mp.rounds);
      if (!o) continue;
      res.bets++;
      res.wins += o.won;
    }
  }
  res.profit = res.wins * (odds - 1) - (res.bets - res.wins);
  return res;
}

const pct = x => `${(100 * x).toFixed(1)}%`;
const rows = [];
const total = { filtered: { bets: 0, wins: 0, profit: 0 }, all: { bets: 0, wins: 0, profit: 0 } };
const seenAll = new Map();
const seenFiltered = new Map();
const lists = {};

for (const region of REGIONS) {
  const teamList = JSON.parse(fs.readFileSync(`crawler/teams/${region}.json`, 'utf8'));
  const byUrl = new Map();
  for (const t of teamList) {
    for (const m of JSON.parse(fs.readFileSync(path.join(dataDir, `${t.slug}.json`), 'utf8')).matches) {
      byUrl.set(m.url, { ...m, t1: normalize(m.team1), t2: normalize(m.team2) });
    }
  }
  const all = [...byUrl.values()];
  const train = all.filter(m => m.date.slice(0, 10) < split && m.date.slice(0, 10) >= trainFrom);
  const test = all.filter(m => m.date.slice(0, 10) >= split);
  const excluded = blacklist(teamList.map(t => t.name), train);
  lists[region] = [...excluded];
  const f = settle(test, excluded);
  const a = settle(test, new Set());
  rows.push({
    region, train_matches: train.length, test_matches: test.length,
    bets_all: a.bets, comeback_all: pct(1 - a.wins / a.bets), profit_all: +a.profit.toFixed(1),
    bets_filtered: f.bets, comeback_filtered: pct(1 - f.wins / f.bets), profit_filtered: +f.profit.toFixed(1),
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
const ga = settle([...seenAll.values()], new Set());
// A match kept in its own region could involve another region's blacklisted team; settle with every list.
const allExcluded = new Set(Object.values(lists).flat());
const gf = settle([...seenFiltered.values()], allExcluded);
console.log(`Tổng (mỗi trận tính 1 lần):`);
console.log(`  Không lọc: ${ga.bets} cược, lật kèo ${pct(1 - ga.wins / ga.bets)}, lãi ${ga.profit.toFixed(1)} unit (${(100 * ga.profit / ga.bets).toFixed(1)}%/cược)`);
console.log(`  Có lọc:    ${gf.bets} cược, lật kèo ${pct(1 - gf.wins / gf.bets)}, lãi ${gf.profit.toFixed(1)} unit (${(100 * gf.profit / gf.bets).toFixed(1)}%/cược)`);
