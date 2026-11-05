#!/usr/bin/env node
// List every comeback map in a period, grouped by region (domestic) plus international.
// A comeback map: before the map ends, with total rounds >= MIN_TOTAL, a team leads by
// >= MIN_DIFF rounds, and that team loses the map. Only matches between partner teams.
//
// Usage:
//   node analysis/list_comebacks.js [--data data-backtest] [--from 2026-01-01] [--to 2026-12-31]
//     [--out reports/comebacks-2026.md]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const outFile = opt('--out', `reports/comebacks-${from.slice(0, 4)}.md`);
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific', intl: 'Quốc tế (giữa các khu vực)' };

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir).matches) if (m.day >= from && m.day <= to) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));
const lastDay = matches.length ? matches[matches.length - 1].day : to;

const groups = Object.fromEntries([...REGIONS, 'intl'].map(g => [g, { list: [], leadMaps: 0 }]));
const short = e => e.replace('Valorant ', '').replace(/^VCT 20\d\d: /, '');
for (const m of matches) {
  const r1 = teamRegion[m.t1], r2 = teamRegion[m.t2];
  if (!r1 || !r2) continue;
  const g = groups[r1 === r2 ? r1 : 'intl'];
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const a = analyzeMap(mp.rounds);
    if (!a.leaders.size) continue;
    g.leadMaps++;
    if (!a.blownBy) continue;
    g.list.push({
      day: m.day, map: mp.map, score: `${m.t1} ${mp.score} ${m.t2}`,
      blown: a.blownBy === 1 ? m.t1 : m.t2, winner: a.blownBy === 1 ? m.t2 : m.t1,
      lead: a.leadAt[a.blownBy], event: short(m.event),
    });
  }
}

const md = [
  `# Map lật kèo ${from.slice(0, 4)}`, '',
  `Định nghĩa: trước khi map kết thúc, có thời điểm tổng round ≥ ${MIN_TOTAL} mà một đội dẫn ≥ ${MIN_DIFF} round, nhưng đội đó thua map. ` +
  `Chỉ tính trận giữa hai đội nhượng quyền. Dữ liệu vlr.gg, ${from} → ${lastDay}.`, '',
];
let total = 0, totalLead = 0;
for (const [g, { list, leadMaps }] of Object.entries(groups)) {
  total += list.length; totalLead += leadMaps;
  md.push(`## ${NAME[g]} — ${list.length} map lật kèo / ${leadMaps} map có tình huống dẫn ≥ ${MIN_DIFF} (${(100 * list.length / leadMaps).toFixed(1)}%)`, '',
    '| Ngày | Map | Tỉ số | Đội bị lật (lúc dẫn) | Đội lật kèo | Giải |', '|---|---|---|---|---|---|');
  for (const x of list) md.push(`| ${x.day.slice(8, 10)}/${x.day.slice(5, 7)} | ${x.map} | ${x.score} | ${x.blown} (${x.lead}) | ${x.winner} | ${x.event} |`);
  md.push('');
  console.log(`${NAME[g]}: ${list.length} / ${leadMaps} (${(100 * list.length / leadMaps).toFixed(1)}%)`);
}
md.splice(4, 0, `**Tổng: ${total} map lật kèo / ${totalLead} map có tình huống dẫn ≥ ${MIN_DIFF} (${(100 * total / totalLead).toFixed(1)}%).**`, '');
fs.writeFileSync(outFile, md.join('\n') + '\n');
console.log(`Tổng: ${total} / ${totalLead}. Saved ${outFile}`);
