#!/usr/bin/env node
// Every map with a qualifying lead (total rounds >= MIN_TOTAL, lead >= MIN_DIFF before
// the map ends) and which of them were comebacks (a team that held such a lead lost).
// With --exact3: only maps whose first qualifying lead is exactly 3, and a comeback
// means that first leader lost.
// Grouped by year → region → tournament (vlr.gg event); events with teams from several
// regions are listed as international. Only matches between partner teams of that year.
//
// Usage:
//   node analysis/lead3_list.js [--exact3] [--season 2026] [--data data-backtest] [--out reports/lead-maps.md]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const exact3 = argv.includes('--exact3');
// --season YYYY: only that year.
const season = opt('--season');
const out = opt('--out', `reports/${exact3 ? 'lead3-maps' : 'lead-maps'}${season ? `-${season}` : ''}.md`);
const LEAD = exact3 ? 'dẫn đúng 3' : `có dẫn ≥ ${MIN_DIFF}`;
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific', intl: 'Quốc tế' };

// Partner teams per year (2025 list for 2025 matches, current list for 2026).
const regionOf = {};
for (const [year, dir] of [['2025', 'crawler/teams/2025'], ['2026', 'crawler/teams']]) {
  regionOf[year] = {};
  for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${dir}/${r}.json`, 'utf8'))) regionOf[year][t.name] = r;
}

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));
const firstDay = matches[0].day, lastDay = matches[matches.length - 1].day;

// year → event → { regions, maps: [...] }
const years = {};
for (const m of matches) {
  const year = m.day.slice(0, 4);
  if (season && year !== season) continue;
  const reg = regionOf[year];
  if (!reg || !reg[m.t1] || !reg[m.t2]) continue;
  const ev = ((years[year] = years[year] || new Map()).get(m.event)
    || years[year].set(m.event, { regions: new Set(), first: m.day, last: m.day, maps: [] }).get(m.event));
  ev.regions.add(reg[m.t1]); ev.regions.add(reg[m.t2]);
  ev.last = m.day;
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const states = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = states[states.length - 1];
    const first = states.slice(0, -1).find(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
    if (!first || (exact3 && Math.abs(first[0] - first[1]) !== 3)) continue;
    let leader = first[0] > first[1] ? m.t1 : m.t2, at = `${first[0]}-${first[1]}`;
    let lost = (first[0] > first[1]) !== (f1 > f2);
    if (!exact3) {
      // Any team that held a qualifying lead and lost; show that team and its first lead.
      const a = analyzeMap(mp.rounds);
      lost = !!a.blownBy;
      if (lost) { leader = a.blownBy === 1 ? m.t1 : m.t2; at = a.leadAt[a.blownBy]; }
    }
    ev.maps.push({ day: m.day, t1: m.t1, t2: m.t2, map: mp.map, score: `${f1}-${f2}`, at, leader, lost });
  }
}

const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');
const dm = d => d.slice(5).split('-').reverse().join('/');
const short = s => s.replace('Valorant ', '').replace(/^VCT 20\d\d: /, '');
const md = [`# Map ${LEAD} và lật kèo theo mùa`, '',
  (exact3 ? `Map có thời điểm đầu tiên tổng round ≥ ${MIN_TOTAL} và một đội dẫn ≥ ${MIN_DIFF} mà mức dẫn lúc đó đúng 3; **lật kèo** = đội dẫn đó thua map.` : `Map có thời điểm (trước khi map kết thúc) tổng round ≥ ${MIN_TOTAL} và một đội dẫn ≥ ${MIN_DIFF}; **lật kèo** = đội từng dẫn như vậy thua map.`) + `  Chỉ trận giữa hai đội nhượng quyền của năm đó. Dữ liệu vlr.gg ${firstDay} → ${lastDay} (năm 2025 chỉ có từ cuối tháng 6).`, ''];

for (const year of Object.keys(years).sort()) {
  const groups = {};
  for (const [name, e] of years[year]) {
    if (!e.maps.length) continue;
    const g = e.regions.size === 1 ? [...e.regions][0] : 'intl';
    (groups[g] = groups[g] || []).push({ name, ...e });
  }
  const all = Object.values(groups).flat().flatMap(e => e.maps);
  const yl = all.filter(x => x.lost).length;
  md.push(`## Mùa ${year} — ${yl} lật kèo / ${all.length} map ${LEAD} (${pct(yl, all.length)})`, '');
  console.log(`\n##### Mùa ${year}: ${yl}/${all.length} (${pct(yl, all.length)})`);
  const summary = [];
  for (const g of [...REGIONS, 'intl']) {
    const list = (groups[g] || []).sort((a, b) => a.first.localeCompare(b.first));
    if (!list.length) continue;
    const maps = list.flatMap(e => e.maps), l = maps.filter(x => x.lost).length;
    summary.push({ 'khu vực': NAME[g], [`map ${LEAD}`]: maps.length, 'lật kèo': l, 'tỉ lệ': pct(l, maps.length) });
    md.push(`### ${NAME[g]} — ${l} / ${maps.length} (${pct(l, maps.length)})`, '');
    md.push(`| Giải | Thời gian | Map ${LEAD} | Lật kèo | Tỉ lệ |`, '|---|---|---|---|---|');
    for (const e of list) {
      const el = e.maps.filter(x => x.lost).length;
      md.push(`| ${short(e.name)} | ${dm(e.first)}–${dm(e.last)} | ${e.maps.length} | ${el} | ${pct(el, e.maps.length)} |`);
    }
    md.push('');
    for (const e of list) {
      const el = e.maps.filter(x => x.lost).length;
      md.push(`<details><summary>${short(e.name)} — ${el} lật / ${e.maps.length} map</summary>`, '',
        `| Ngày | Trận | Map | Tỉ số | ${exact3 ? 'Đội dẫn' : 'Đội dẫn (đội bị lật nếu lật kèo)'} (lúc dẫn) | Kết quả |`, '|---|---|---|---|---|---|');
      for (const x of e.maps) md.push(`| ${dm(x.day)} | ${x.t1} vs ${x.t2} | ${x.map} | ${x.score} | ${x.leader} (${x.at}) | ${x.lost ? '**LẬT KÈO**' : 'giữ được'} |`);
      md.push('', '</details>', '');
    }
  }
  console.table(summary);
}
fs.writeFileSync(out, md.join('\n') + '\n');
console.log(`\nSaved ${out}`);
