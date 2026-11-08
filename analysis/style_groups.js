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
//   [--regions americas,emea,china,pacific] [--data data-backtest] [--top 8] [--list] [--momentum]

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
    const fi = st.slice(0, -1).findIndex(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
    const first = fi >= 0 ? st[fi] : null;
    // momentum: the round that produced this lead was won by the leader (9-7 → 10-7, not 10-6 → 10-7).
    const momentum = first && fi > 0 ? (first[0] > first[1] ? first[0] > st[fi - 1][0] : first[1] > st[fi - 1][1]) : false;
    let lead = null;
    if (first) {
      const l1 = first[0] > first[1];
      // reversed: ANY team that held a qualifying lead lost (the comeback definition).
      const leaders = new Set(st.slice(0, -1).filter(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF).map(([x, y]) => (x > y ? 1 : 2)));
      lead = { leader: l1 ? m.t1 : m.t2, size: Math.abs(first[0] - first[1]), momentum, lost: l1 !== (f1 > f2), comeback: [...leaders].some(s => s !== (f1 > f2 ? 1 : 2)) };
    }
    maps.push({ day: m.day, event: m.event, t1: m.t1, t2: m.t2, map: mp.map, score: `${f1}-${f2}`, at: first ? `${first[0]}-${first[1]}` : null, gap: Math.abs(f1 - f2), lead });
  }
}

const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');
const share = list => { const s = {}; for (const x of list) for (const t of [x.t1, x.t2]) { const v = (s[t] = s[t] || { n: 0, big: 0 }); v.n++; v.big += x.gap >= GAP; } return s; };
// Split the teams of each region at the median share (teams with < need maps stay unclassified).
function classify(s, need) {
  const g = {};
  for (const r of REGIONS) {
    const list = Object.keys(teamRegion).filter(t => teamRegion[t] === r && s[t] && s[t].n >= need).sort((a, b) => s[b].big / s[b].n - s[a].big / s[a].n);
    // --top K: the K teams (of 12) with the highest share are "Một chiều" (default: half).
    const k = opt('--top') ? Math.round(Number(opt('--top')) * list.length / 12) : list.length / 2;
    list.forEach((t, i) => { g[t] = i < k ? 'Một chiều' : 'Giằng co'; });
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

// ---- Betting (walk-forward): 1 unit on the first leader, lead exactly 3 only ----
// (leads of 4+ are priced lower by the bookmaker, so they are not mixed in at the same odds)
const stake = Number(opt('--stake', 1e6));
const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${(Math.abs(x) / 1e6).toFixed(1)} tr`;
// --momentum: only bet a 3-round lead when the leader won the round that produced it.
const mom = argv.includes('--momentum');
const allLead3 = maps.filter(x => x.lead && inScope(x) && x.lead.size === 3 && (!mom || x.lead.momentum));
const wf3 = rowsWf.filter(r => r.lead.size === 3 && (!mom || r.lead.momentum));
const STRATS = [
  ['Mọi kèo dẫn 3 (không lọc)', allLead3],
  ['Bỏ Giằng co vs Giằng co', wf3.filter(r => r.pair !== 'Giằng co vs Giằng co')],
  ['Chỉ Một chiều vs Một chiều', wf3.filter(r => r.pair === 'Một chiều vs Một chiều')],
];
function run(list, odds) {
  let bal = 0, peak = 0, dd = 0, l = 0;
  const months = {};
  for (const b of list) {
    l += b.lead.lost;
    bal += b.lead.lost ? -stake : stake * (odds - 1);
    peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal);
    const mo = b.day.slice(0, 7);
    const x = (months[mo] = months[mo] || { n: 0, l: 0, end: 0 });
    x.n++; x.l += b.lead.lost; x.end = bal;
  }
  return { n: list.length, l, bal, dd, months };
}
console.log(`\n[C] Cược ${(stake / 1e6).toFixed(1)} tr mỗi kèo dẫn đúng 3${mom ? ', chỉ khi đội dẫn vừa thắng round tạo ra mức dẫn' : ''} (cuốn chiếu):`);
console.table(STRATS.flatMap(([name, list]) => [1.10, 1.12, 1.15].map(o => {
  const s = run(list, o);
  return { 'cách cược': name, 'ăn': o, 'số kèo': s.n, 'thua': s.l, 'lật kèo': pct(s.l, s.n), 'lãi': money(s.bal), 'sụt giảm lớn nhất': money(-s.dd) };
})));
const mc = run(STRATS[2][1], 1.15), base = run(STRATS[0][1], 1.15);
console.log('Theo tháng (ăn 1.15): số kèo · thua · lũy kế');
console.table(Object.keys(base.months).map(mo => ({
  'tháng': mo,
  'chỉ Một chiều vs Một chiều': mc.months[mo] ? `${mc.months[mo].n} · ${mc.months[mo].l} · ${money(mc.months[mo].end)}` : '0 kèo',
  'không lọc': `${base.months[mo].n} · ${base.months[mo].l} · ${money(base.months[mo].end)}`,
})));
if (argv.includes('--list')) {
  console.log('Toàn bộ kèo "chỉ Một chiều vs Một chiều" (dẫn đúng 3):');
  let bal = 0;
  for (const b of STRATS[2][1]) {
    bal += b.lead.lost ? -stake : stake * 0.15;
    console.log(`  ${b.day.slice(8)}/${b.day.slice(5, 7)}  ${b.t1} ${b.score} ${b.t2} (${b.map}) · cược ${b.lead.leader} lúc ${b.at} · ${b.lead.lost ? 'THUA' : 'thắng'} · ${b.event.replace('Valorant ', '').replace(/^VCT 2026: /, '')} · lũy kế 1.15: ${money(bal)}`);
  }
}
console.log('Các kèo thua của "chỉ Một chiều vs Một chiều":');
for (const b of STRATS[2][1].filter(b => b.lead.lost)) console.log(`  ${b.day}  ${b.t1} vs ${b.t2} · cược ${b.lead.leader} · ${b.event.replace('Valorant ', '')}`);
