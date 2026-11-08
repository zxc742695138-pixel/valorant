#!/usr/bin/env node
// Filter: skip maps involving teams that often go to overtime.
// Before each match day, each team's overtime share (maps with total rounds > 24) is computed
// from its earlier maps (season to date, or the last --window days). In each region the
// --top teams with the highest share (at least --min-maps maps) are flagged. Bets: 1 unit on the
// team that first leads by >= MIN_DIFF at total >= MIN_TOTAL, lead exactly 3 only, on maps
// where neither team is flagged.
//
// Usage: node analysis/ot_filter.js [--season 2026] [--window season|90] [--top 4]
//   [--min-maps 10] [--regions americas,china,pacific] [--stake 1000000]
//   [--metric ot|close] [--exclude REGEX] [--bet-exclude REGEX] [--fixed] [--quiet]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const season = opt('--season', '2026');
const windowOpt = opt('--window', 'season');
const TOP = Number(opt('--top', 4));
const minMaps = Number(opt('--min-maps', 10));
const regions = opt('--regions', 'americas,china,pacific').split(',');
const stake = Number(opt('--stake', 1e6));
const quiet = argv.includes('--quiet');
// --metric ot|close: overtime share, or share of maps finishing 13-11 or in overtime.
const metric = opt('--metric', 'ot');
// --exclude REGEX: events left out of the team statistics; --bet-exclude REGEX: events not bet on.
const statExclude = opt('--exclude') ? new RegExp(opt('--exclude')) : null;
const betExclude = opt('--bet-exclude') ? new RegExp(opt('--bet-exclude')) : null;
// --fixed: flag the top teams of the whole season once (hindsight, for comparison only).
const fixed = argv.includes('--fixed');
const teamsDir = season === '2025' ? 'crawler/teams/2025' : 'crawler/teams';

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${teamsDir}/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
// Keep earlier matches too, for --window N reaching back before the season.
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

const maps = [];
for (const m of matches) {
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const st = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = st[st.length - 1];
    const first = st.slice(0, -1).find(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
    const lead = first ? { leader: first[0] > first[1] ? m.t1 : m.t2, size: Math.abs(first[0] - first[1]), lost: (first[0] > first[1]) !== (f1 > f2) } : null;
    const close = metric === 'close' ? (Math.max(f1, f2) === 13 && Math.min(f1, f2) === 11) || f1 + f2 > 24 : f1 + f2 > 24;
    maps.push({ day: m.day, event: m.event, t1: m.t1, t2: m.t2, ot: close, lead });
  }
}

const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');
const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${(Math.abs(x) / 1e6).toFixed(1)} tr`;

function flaggedAt(day, idx) {
  const start = windowOpt === 'season' ? `${day.slice(0, 4)}-01-01` : new Date(Date.parse(day) - Number(windowOpt) * 864e5).toISOString().slice(0, 10);
  const s = {};
  for (let j = 0; j < idx; j++) {
    const x = maps[j];
    if (x.day < start) continue;
    if (statExclude && statExclude.test(x.event)) continue;
    for (const t of [x.t1, x.t2]) { const v = (s[t] = s[t] || { n: 0, ot: 0 }); v.n++; v.ot += x.ot; }
  }
  const flagged = new Set();
  for (const r of REGIONS) {
    Object.keys(teamRegion).filter(t => teamRegion[t] === r && s[t] && s[t].n >= minMaps)
      .sort((a, b) => s[b].ot / s[b].n - s[a].ot / s[a].n).slice(0, TOP).forEach(t => flagged.add(t));
  }
  return flagged;
}

const rows = [];
let fixedFlags = null;
let i = 0;
while (i < maps.length) {
  const day = maps[i].day;
  const inSeason = day.startsWith(season);
  const flagged = !inSeason ? null : fixed ? (fixedFlags || (fixedFlags = flaggedAt(`${season}-12-31`, maps.length))) : flaggedAt(day, i);
  while (i < maps.length && maps[i].day === day) {
    const x = maps[i++];
    if (!inSeason || !x.lead || !teamRegion[x.t1] || !teamRegion[x.t2]) continue;
    if (!regions.includes(teamRegion[x.t1]) || !regions.includes(teamRegion[x.t2])) continue;
    if (betExclude && betExclude.test(x.event)) continue;
    const nFlag = [x.t1, x.t2].filter(t => flagged.has(t)).length;
    rows.push({ ...x, nFlag, leaderFlag: flagged.has(x.lead.leader) });
  }
}

function run(list, odds) {
  let bal = 0, peak = 0, dd = 0, l = 0;
  const months = {};
  for (const b of list) {
    l += b.lead.lost; bal += b.lead.lost ? -stake : stake * (odds - 1);
    peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal);
    const mo = b.day.slice(0, 7), x = (months[mo] = months[mo] || { n: 0, l: 0, end: 0 });
    x.n++; x.l += b.lead.lost; x.end = bal;
  }
  return { n: list.length, l, bal, dd, months };
}

const r3 = rows.filter(r => r.lead.size === 3);
console.log(`Mùa ${season}; ${regions.join(', ')}; gắn cờ ${TOP} đội/khu vực có % map ${metric === 'close' ? '13-11 hoặc hiệp phụ' : 'hiệp phụ'} cao nhất (${fixed ? 'tính một lần trên cả mùa — nhìn lại' : `${windowOpt === 'season' ? 'từ đầu mùa' : `${windowOpt} ngày gần nhất`}, ≥ ${minMaps} map, tính trước mỗi ngày đấu`})${statExclude ? `; thống kê bỏ: ${statExclude.source}` : ''}${betExclude ? `; không cược: ${betExclude.source}` : ''}\n`);
if (fixed) for (const r of regions) console.log(`  ${r}: ${[...flaggedAt(`${season}-12-31`, maps.length)].filter(t => teamRegion[t] === r).join(', ')}`);
console.log('Tỉ lệ lật kèo theo số đội bị gắn cờ trong map:');
console.table([0, 1, 2].map(k => {
  const a = rows.filter(r => r.nFlag === k), b = r3.filter(r => r.nFlag === k);
  return { 'số đội bị gắn cờ': k, 'map có dẫn ≥ 3': a.length, 'lật': a.filter(r => r.lead.lost).length, 'tỉ lệ': pct(a.filter(r => r.lead.lost).length, a.length), 'dẫn đúng 3': `${b.filter(r => r.lead.lost).length}/${b.length} (${pct(b.filter(r => r.lead.lost).length, b.length)})` };
}));
const STRATS = [
  ['Không lọc', r3],
  ['Bỏ map có đội bị gắn cờ', r3.filter(r => r.nFlag === 0)],
  ['Bỏ khi đội đang dẫn bị gắn cờ', r3.filter(r => !r.leaderFlag)],
];
console.log('Cược 1 tr mỗi kèo dẫn đúng 3:');
console.table(STRATS.flatMap(([name, list]) => [1.10, 1.12, 1.15].map(o => {
  const s = run(list, o);
  return { 'cách cược': name, 'ăn': o, 'số kèo': s.n, 'thua': s.l, 'lật kèo': pct(s.l, s.n), 'lãi': money(s.bal), 'sụt giảm lớn nhất': money(-s.dd) };
})));
if (!quiet) {
  const a = run(STRATS[1][1], 1.15), z = run(r3, 1.15);
  console.log('Theo tháng (ăn 1.15): số kèo · thua · lũy kế');
  console.table(Object.keys(z.months).map(mo => ({ 'tháng': mo, 'bỏ map có đội bị gắn cờ': a.months[mo] ? `${a.months[mo].n} · ${a.months[mo].l} · ${money(a.months[mo].end)}` : '0 kèo', 'không lọc': `${z.months[mo].n} · ${z.months[mo].l} · ${money(z.months[mo].end)}` })));
}
