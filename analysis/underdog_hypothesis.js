#!/usr/bin/env node
// Hypothesis: maps involving teams rated low in their region end in comebacks more often.
//
// Team strength = map-level Elo built from every partner match before the day
// (K = 24, start 1500). Before each match day, the 12 teams of each region are
// ranked by Elo and split into tiers: Top (1–4), Giữa (5–8), Đáy (9–12). Each map
// with a qualifying lead is then labelled by the tiers of its two teams.
//
// Usage:
//   node analysis/underdog_hypothesis.js [--from 2026-01-01] [--to 2026-12-31]
//     [--regions americas,emea,china,pacific] [--perms 5000]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const regions = (opt('--regions', REGIONS.join(','))).split(',');
const perms = Number(opt('--perms', 5000));
const K = 24;

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

const elo = new Map();
const rating = t => elo.get(t) ?? 1500;
const tierOf = (team, day) => {
  const r = teamRegion[team];
  const ranked = Object.keys(teamRegion).filter(t => teamRegion[t] === r).sort((a, b) => rating(b) - rating(a));
  const i = ranked.indexOf(team);
  return i < 4 ? 'Top' : i < 8 ? 'Giữa' : 'Đáy';
};

const rows = [];
let i = 0;
while (i < matches.length) {
  const day = matches[i].day;
  const today = [];
  while (i < matches.length && matches[i].day === day) today.push(matches[i++]);
  if (day >= from && day <= to) {
    for (const m of today) {
      if (!teamRegion[m.t1] || !teamRegion[m.t2]) continue;
      if (!regions.includes(teamRegion[m.t1]) || !regions.includes(teamRegion[m.t2])) continue;
      const g1 = tierOf(m.t1, day), g2 = tierOf(m.t2, day);
      for (const mp of m.map_result) {
        if (!mp.rounds.length) continue;
        const a = analyzeMap(mp.rounds);
        if (!a.leaders.size) continue;
        // Tier of the team that led first and of the other one.
        const states = mp.rounds.map(s => s.split('-').map(Number)).slice(0, -1);
        const first = states.find(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
        const leaderSide = first[0] > first[1] ? 1 : 2;
        rows.push({
          day, y: a.blownBy ? 1 : 0, size: Math.abs(first[0] - first[1]),
          pair: [g1, g2].sort((p, q) => ['Top', 'Giữa', 'Đáy'].indexOf(p) - ['Top', 'Giữa', 'Đáy'].indexOf(q)).join(' vs '),
          hasBottom: g1 === 'Đáy' || g2 === 'Đáy', sameTier: g1 === g2,
          leaderTier: leaderSide === 1 ? g1 : g2, trailerTier: leaderSide === 1 ? g2 : g1,
        });
      }
    }
  }
  // Elo update with today's maps (after today's labels).
  for (const m of today) {
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const [f1, f2] = mp.rounds[mp.rounds.length - 1].split('-').map(Number);
      const e1 = 1 / (1 + 10 ** ((rating(m.t2) - rating(m.t1)) / 400));
      const s1 = f1 > f2 ? 1 : 0;
      elo.set(m.t1, rating(m.t1) + K * (s1 - e1));
      elo.set(m.t2, rating(m.t2) - K * (s1 - e1));
    }
  }
}

const rate = list => (list.length ? list.reduce((s, r) => s + r.y, 0) / list.length : NaN);
const pct = x => (Number.isNaN(x) ? '—' : `${(100 * x).toFixed(1)}%`);
const split = (list, key) => {
  const out = {};
  for (const r of list) (out[r[key]] = out[r[key]] || []).push(r);
  return out;
};
const halves = { 'cả giai đoạn': rows, 'nửa đầu (01–06)': rows.filter(r => r.day < '2026-07-01'), 'nửa sau (07–12)': rows.filter(r => r.day >= '2026-07-01') };

function permP(list, key, val) {
  const obs = rate(list.filter(r => r[key] === val)) - rate(list.filter(r => r[key] !== val));
  const ys = list.map(r => r.y), flags = list.map(r => r[key] === val);
  let ge = 0;
  for (let p = 0; p < perms; p++) {
    for (let j = ys.length - 1; j > 0; j--) { const x = Math.floor(Math.random() * (j + 1)); [ys[j], ys[x]] = [ys[x], ys[j]]; }
    let a = 0, na = 0, b = 0, nb = 0;
    ys.forEach((y, k) => { if (flags[k]) { a += y; na++; } else { b += y; nb++; } });
    if (a / na - b / nb >= obs) ge++;
  }
  return { diff: obs, p: ge / perms };
}

console.log(`Map ${from} → ${to} có tình huống dẫn ≥ ${MIN_DIFF} khi tổng round ≥ ${MIN_TOTAL}; khu vực: ${regions.join(', ')}; tầng theo Elo trước ngày thi đấu\n`);
for (const [name, list] of Object.entries(halves)) {
  const yes = list.filter(r => r.hasBottom), no = list.filter(r => !r.hasBottom);
  console.log(`${name}: có đội tầng Đáy ${pct(rate(yes))} (${yes.length} map) · không có ${pct(rate(no))} (${no.length} map)`);
}
const t = permP(rows, 'hasBottom', true);
console.log(`Chênh lệch cả giai đoạn: ${(100 * t.diff).toFixed(1)} điểm %, ${(100 * t.p).toFixed(1)}% khả năng do ngẫu nhiên (1 phía)\n`);

console.log('Theo cặp tầng của hai đội:');
console.table(Object.entries(split(rows, 'pair')).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({
  'cặp': k, 'số map': v.length, 'lật kèo': pct(rate(v)),
  'nửa đầu': pct(rate(v.filter(r => r.day < '2026-07-01'))), 'nửa sau': pct(rate(v.filter(r => r.day >= '2026-07-01'))),
})));
console.log('Theo tầng của đội đang dẫn / đội bị dẫn:');
console.table(['Top', 'Giữa', 'Đáy'].map(tier => ({
  'tầng': tier,
  'đội đang dẫn thuộc tầng này': `${pct(rate(rows.filter(r => r.leaderTier === tier)))} (${rows.filter(r => r.leaderTier === tier).length})`,
  'đội bị dẫn thuộc tầng này': `${pct(rate(rows.filter(r => r.trailerTier === tier)))} (${rows.filter(r => r.trailerTier === tier).length})`,
})));
const l3 = rows.filter(r => r.size === 3);
const y3 = l3.filter(r => r.hasBottom), n3 = l3.filter(r => !r.hasBottom);
console.log(`Riêng kèo dẫn đúng 3: có đội tầng Đáy ${pct(rate(y3))} (${y3.length}) · không có ${pct(rate(n3))} (${n3.length})`);
const t3 = permP(l3, 'hasBottom', true);
console.log(`  chênh lệch ${(100 * t3.diff).toFixed(1)} điểm %, ${(100 * t3.p).toFixed(1)}% khả năng do ngẫu nhiên`);

// Follow-up: evenly matched maps (both teams in the same tier) vs mismatched ones.
console.log('\nCùng tầng (hai đội ngang sức) so với khác tầng:');
for (const [name, list] of Object.entries(halves)) {
  const yes = list.filter(r => r.sameTier), no = list.filter(r => !r.sameTier);
  console.log(`  ${name}: cùng tầng ${pct(rate(yes))} (${yes.length}) · khác tầng ${pct(rate(no))} (${no.length})`);
}
const ts = permP(rows, 'sameTier', true);
console.log(`  chênh lệch ${(100 * ts.diff).toFixed(1)} điểm %, ${(100 * ts.p).toFixed(2)}% khả năng do ngẫu nhiên`);
const s3y = l3.filter(r => r.sameTier), s3n = l3.filter(r => !r.sameTier);
const ts3 = permP(l3, 'sameTier', true);
console.log(`  riêng kèo dẫn đúng 3: cùng tầng ${pct(rate(s3y))} (${s3y.length}) · khác tầng ${pct(rate(s3n))} (${s3n.length}); ${(100 * ts3.p).toFixed(2)}% do ngẫu nhiên`);
