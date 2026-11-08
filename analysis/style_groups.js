#!/usr/bin/env node
// Hypothesis: some teams play "one-sided" maps (they win or lose big, final round gap >= 4)
// and take part in fewer comebacks than "close" teams (final gap usually < 4).
//
// Per season (calendar year) and region, each team's style = share of its maps whose final
// score gap is >= GAP. Teams of a region are split at the region median: the upper half is
// "Một chiều", the lower half "Giằng co".
//
// Two views:
//   in-sample  — style from the whole season, comeback rate on the same season's maps.
//                Biased: comeback maps end close by nature, so they push teams to "Giằng co".
//   walk-forward — style from the team's maps earlier in the same season only (at least
//                --min-maps), then comeback rate on the next day's maps. This is the honest
//                test of whether the style predicts comebacks.
//
// Usage: node analysis/style_groups.js [--season 2026] [--gap 4] [--min-maps 10]
//   [--regions americas,emea,china,pacific] [--data data-backtest]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const season = opt('--season', '2026');
const GAP = Number(opt('--gap', 4));
const minMaps = Number(opt('--min-maps', 10));
const regions = opt('--regions', REGIONS.join(',')).split(',');
const dataDir = opt('--data', 'data-backtest');
const teamsDir = season === '2025' ? 'crawler/teams/2025' : 'crawler/teams';

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${teamsDir}/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { teamsDir: 'crawler/teams/backtest' }).matches) if (m.day.startsWith(season)) byUrl.set(m.url, m);
const matches = [...byUrl.values()].filter(m => teamRegion[m.t1] && teamRegion[m.t2]).sort((a, b) => a.date.localeCompare(b.date));

// One row per played map.
const maps = [];
for (const m of matches) {
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const st = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = st[st.length - 1];
    const first = st.slice(0, -1).find(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
    let lead = null;
    if (first) {
      const l1 = first[0] > first[1];
      // reversed: ANY team that held a qualifying lead lost (the comeback definition).
      const leaders = new Set(st.slice(0, -1).filter(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF).map(([x, y]) => (x > y ? 1 : 2)));
      lead = { leader: l1 ? m.t1 : m.t2, size: Math.abs(first[0] - first[1]), lost: l1 !== (f1 > f2), comeback: [...leaders].some(s => s !== (f1 > f2 ? 1 : 2)) };
    }
    maps.push({ day: m.day, event: m.event, t1: m.t1, t2: m.t2, gap: Math.abs(f1 - f2), lead });
  }
}

const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');
const share = list => { const s = {}; for (const x of list) for (const t of [x.t1, x.t2]) { const v = (s[t] = s[t] || { n: 0, big: 0 }); v.n++; v.big += x.gap >= GAP; } return s; };
// Split the teams of each region at the median share (teams with < need maps stay unclassified).
function classify(s, need) {
  const g = {};
  for (const r of REGIONS) {
    const list = Object.keys(teamRegion).filter(t => teamRegion[t] === r && s[t] && s[t].n >= need).sort((a, b) => s[b].big / s[b].n - s[a].big / s[a].n);
    list.forEach((t, i) => { g[t] = i < list.length / 2 ? 'Một chiều' : 'Giằng co'; });
  }
  return g;
}
const pairOf = (g, x) => {
  const a = g[x.t1], b = g[x.t2];
  if (!a || !b) return null;
  return a === b ? `${a} vs ${a}` : 'Một chiều vs Giằng co';
};
const PAIRS = ['Một chiều vs Một chiều', 'Một chiều vs Giằng co', 'Giằng co vs Giằng co'];
function report(rows, title) {
  console.log(title);
  console.table(PAIRS.map(p => {
    const l = rows.filter(r => r.pair === p), c = l.filter(r => r.lead.comeback).length;
    const l3 = l.filter(r => r.lead.size === 3), c3 = l3.filter(r => r.lead.lost).length;
    return { 'cặp': p, 'map có dẫn ≥ 3': l.length, 'lật kèo': c, 'tỉ lệ': pct(c, l.length), 'dẫn đúng 3: lật / kèo': `${c3}/${l3.length} (${pct(c3, l3.length)})` };
  }));
  console.table(['Một chiều', 'Giằng co'].map(gr => {
    const l = rows.filter(r => r.leaderGroup === gr), c = l.filter(r => r.lead.lost).length;
    return { 'đội đang dẫn thuộc nhóm': gr, 'số map': l.length, 'bị lật': c, 'tỉ lệ': pct(c, l.length) };
  }));
}

// ---- In-sample ----
const inScope = x => regions.includes(teamRegion[x.t1]) && regions.includes(teamRegion[x.t2]);
const fullShare = share(maps);
const g0 = classify(fullShare, 1);
console.log(`Mùa ${season}; "một chiều" = map kết thúc cách nhau ≥ ${GAP} round; khu vực cược: ${regions.join(', ')}\n`);
console.log('Phân nhóm theo cả mùa (tỉ lệ map thắng/thua cách ≥ ' + GAP + ' round):');
for (const r of REGIONS) {
  const list = Object.keys(teamRegion).filter(t => teamRegion[t] === r && fullShare[t]).sort((a, b) => fullShare[b].big / fullShare[b].n - fullShare[a].big / fullShare[a].n);
  console.log(`  ${r}:`);
  console.log(`    Một chiều: ${list.filter(t => g0[t] === 'Một chiều').map(t => `${t} ${pct(fullShare[t].big, fullShare[t].n)}`).join(', ')}`);
  console.log(`    Giằng co:  ${list.filter(t => g0[t] === 'Giằng co').map(t => `${t} ${pct(fullShare[t].big, fullShare[t].n)}`).join(', ')}`);
}
const rowsIn = maps.filter(x => x.lead && inScope(x)).map(x => ({ ...x, pair: pairOf(g0, x), leaderGroup: g0[x.lead.leader] }));
report(rowsIn, '\n[A] Trong cùng mùa (nhìn lại — bị thiên lệch vì map lật kèo tự nó kết thúc sát nút):');

// ---- Walk-forward ----
const rowsWf = [];
let i = 0;
while (i < maps.length) {
  const day = maps[i].day;
  const g = classify(share(maps.slice(0, i)), minMaps);
  while (i < maps.length && maps[i].day === day) {
    const x = maps[i++];
    if (!x.lead || !inScope(x)) continue;
    const pair = pairOf(g, x);
    if (pair) rowsWf.push({ ...x, pair, leaderGroup: g[x.lead.leader] });
  }
}
report(rowsWf, `\n[B] Cuốn chiếu (nhóm xếp từ các map TRƯỚC ngày đấu trong mùa, mỗi đội ≥ ${minMaps} map) — đây mới là phép thử thật:`);
const half = d => (d < `${season}-07-01` ? 'nửa đầu' : 'nửa sau');
console.log('Theo nửa mùa (cuốn chiếu), tỉ lệ lật kèo:');
console.table(PAIRS.map(p => {
  const o = { 'cặp': p };
  for (const h of ['nửa đầu', 'nửa sau']) { const l = rowsWf.filter(r => r.pair === p && half(r.day) === h); o[h] = `${l.filter(r => r.lead.comeback).length}/${l.length} (${pct(l.filter(r => r.lead.comeback).length, l.length)})`; }
  return o;
}));
