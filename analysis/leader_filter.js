#!/usr/bin/env node
// "Only bet on leaders that rarely blow leads": walk-forward test.
//
// For every map in the test period with a qualifying lead (see betting.js), the
// leader's past blow rate is computed from matches strictly before that day
// (shrunk toward the overall mean), and the bet is placed only when that rate is
// below a threshold. Results are compared with betting every qualifying map.
//
// Usage:
//   node analysis/leader_filter.js [--data data-backtest] [--teams-dir crawler/teams/backtest]
//     [--from 2026-01-01] [--to 2026-12-31] [--odds 1.1] [--window all|180] [--regions a,b]

const { REGIONS, loadRegion } = require('./betting');
const { MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const teamsDir = opt('--teams-dir', 'crawler/teams/backtest');
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const odds = Number(opt('--odds', 1.1));
const windowDays = opt('--window', 'all') === 'all' ? null : Number(opt('--window'));
const regions = opt('--regions') ? opt('--regions').split(',') : REGIONS;
const BASE = 0.08, PRIOR = 10;

const teamRegion = {};
for (const r of REGIONS) for (const t of require('../' + teamsDir + '/' + r + '.json')) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { teamsDir }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

function firstLead(rounds) {
  const states = rounds.map(s => s.split('-').map(Number));
  const [f1, f2] = states[states.length - 1];
  for (const [a, b] of states) {
    if (a + b >= MIN_TOTAL && Math.abs(a - b) >= MIN_DIFF) {
      const leader = a > b ? 1 : 2;
      return { leader, reversed: leader !== (f1 > f2 ? 1 : 2), size: Math.abs(a - b) };
    }
  }
  return null;
}

// Past leads per team: list of { day, reversed } (kept in order).
const leads = new Map();
const pastRate = (team, day) => {
  const list = leads.get(team) || [];
  const cutoff = windowDays ? new Date(Date.parse(day) - windowDays * 864e5).toISOString().slice(0, 10) : '';
  let n = 0, k = 0;
  for (const l of list) if (l.day >= cutoff) { n++; k += l.reversed; }
  return { rate: (k + BASE * PRIOR) / (n + PRIOR), n, k };
};

const bets = [];
let i = 0;
while (i < matches.length) {
  const day = matches[i].day;
  const today = [];
  while (i < matches.length && matches[i].day === day) today.push(matches[i++]);
  for (const m of today) {
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const f = firstLead(mp.rounds);
      if (!f) continue;
      const leader = f.leader === 1 ? m.t1 : m.t2;
      const inScope = regions.includes(teamRegion[m.t1]) || regions.includes(teamRegion[m.t2]);
      if (day >= from && day <= to && inScope) bets.push({ day, leader, region: teamRegion[leader], reversed: f.reversed, size: f.size, ...pastRate(leader, day) });
    }
  }
  for (const m of today) {
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const f = firstLead(mp.rounds);
      if (!f) continue;
      const leader = f.leader === 1 ? m.t1 : m.t2;
      if (!leads.has(leader)) leads.set(leader, []);
      leads.get(leader).push({ day, reversed: f.reversed });
    }
  }
}

const summarize = list => {
  const n = list.length, l = list.filter(b => b.reversed).length;
  const profit = (n - l) * (odds - 1) - l;
  return { n, l, profit };
};
const fmt = (label, s, all) => ({
  'quy tắc': label, 'số cược': s.n, 'thua': s.l, 'lật kèo': s.n ? `${(100 * s.l / s.n).toFixed(1)}%` : '—',
  'lãi (tr)': +s.profit.toFixed(1), '%/cược': s.n ? `${(100 * s.profit / s.n).toFixed(1)}%` : '—',
  'giữ lại': `${(100 * s.n / all).toFixed(0)}%`,
});

const all = summarize(bets);
console.log(`Kèo ${from} → ${to}${regions.length < 4 ? ` (${regions.join(', ')})` : ''}: ${bets.length}; lịch sử đội: ${windowDays ? `${windowDays} ngày gần nhất` : 'toàn bộ trước trận'}; tỉ lệ ăn ${odds}\n`);
const rows = [fmt('Cược tất cả', all, all.n)];
for (const th of [0.05, 0.06, 0.07, 0.08, 0.09]) {
  rows.push(fmt(`Đội dẫn có tỉ lệ bị lật ≤ ${(th * 100).toFixed(0)}%`, summarize(bets.filter(b => b.rate <= th)), all.n));
}
// Relative: leader in the safest third of the bets seen so far is hard to do walk-forward; use the
// rate ordering within the test set only for a descriptive check.
const sorted = bets.slice().sort((a, b) => a.rate - b.rate);
for (const [label, part] of [['1/3 kèo đội dẫn ít bị lật nhất', sorted.slice(0, Math.floor(sorted.length / 3))],
                             ['1/3 kèo đội dẫn hay bị lật nhất', sorted.slice(-Math.floor(sorted.length / 3))]]) {
  rows.push(fmt(label, summarize(part), all.n));
}
console.table(rows);

// Same rule split by lead size (the dominant factor).
console.log('Tách theo số round dẫn (dẫn 3 so với dẫn ≥ 4):');
const bySize = [];
for (const [label, cond] of [['dẫn 3', b => b.size === 3], ['dẫn ≥ 4', b => b.size >= 4]]) {
  const part = bets.filter(cond);
  bySize.push(fmt(`${label} · tất cả`, summarize(part), part.length));
  bySize.push(fmt(`${label} · đội dẫn ≤ 7%`, summarize(part.filter(b => b.rate <= 0.07)), part.length));
}
console.table(bySize);
