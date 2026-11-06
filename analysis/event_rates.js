#!/usr/bin/env node
// Comeback rate per tournament (vlr.gg event), grouped by region; events with teams
// from several regions are listed as international. Only matches between partner teams.
//
// Usage:
//   node analysis/event_rates.js [--data data-backtest] [--from 2026-01-01] [--to 2026-12-31]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific', intl: 'Quốc tế' };

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir).matches) if (m.day >= from && m.day <= to) byUrl.set(m.url, m);

const events = new Map();
for (const m of byUrl.values()) {
  const r1 = teamRegion[m.t1], r2 = teamRegion[m.t2];
  if (!r1 || !r2) continue;
  const e = events.get(m.event) || events.set(m.event, { regions: new Set(), first: m.day, last: m.day, lead: 0, cb: 0, lead3: 0, cb3: 0, matches: 0 }).get(m.event);
  e.regions.add(r1); e.regions.add(r2);
  if (m.day < e.first) e.first = m.day;
  if (m.day > e.last) e.last = m.day;
  e.matches++;
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const a = analyzeMap(mp.rounds);
    if (!a.leaders.size) continue;
    e.lead++; if (a.blownBy) e.cb++;
    const states = mp.rounds.map(s => s.split('-').map(Number)).slice(0, -1);
    const first = states.find(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
    if (Math.abs(first[0] - first[1]) === 3) {
      e.lead3++;
      const [f1, f2] = mp.rounds[mp.rounds.length - 1].split('-').map(Number);
      if ((first[0] > first[1]) !== (f1 > f2)) e.cb3++;
    }
  }
}

const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');
const short = s => s.replace('Valorant ', '').replace(/^VCT 20\d\d: /, '');
const groups = {};
for (const [name, e] of events) {
  const g = e.regions.size === 1 ? [...e.regions][0] : 'intl';
  (groups[g] = groups[g] || []).push({ name, ...e });
}
const md = [`# Tỉ lệ lật kèo theo giải (${from} → ${to})`, '',
  `Map có tình huống dẫn ≥ ${MIN_DIFF} khi tổng round ≥ ${MIN_TOTAL} (trước khi map kết thúc); chỉ trận giữa hai đội nhượng quyền.`, ''];
for (const g of [...REGIONS, 'intl']) {
  const list = (groups[g] || []).sort((a, b) => a.first.localeCompare(b.first));
  const tot = list.reduce((s, e) => ({ lead: s.lead + e.lead, cb: s.cb + e.cb, lead3: s.lead3 + e.lead3, cb3: s.cb3 + e.cb3 }), { lead: 0, cb: 0, lead3: 0, cb3: 0 });
  console.log(`\n=== ${NAME[g]}: ${pct(tot.cb, tot.lead)} (${tot.cb}/${tot.lead}); dẫn đúng 3: ${pct(tot.cb3, tot.lead3)} (${tot.cb3}/${tot.lead3})`);
  console.table(list.map(e => ({
    'giải': short(e.name), 'thời gian': `${e.first.slice(5).split('-').reverse().join('/')}–${e.last.slice(5).split('-').reverse().join('/')}`,
    'trận': e.matches, 'map có dẫn≥3': e.lead, 'lật kèo': `${e.cb} (${pct(e.cb, e.lead)})`, 'dẫn đúng 3': `${e.cb3}/${e.lead3} (${pct(e.cb3, e.lead3)})`,
  })));
  md.push(`## ${NAME[g]} — ${pct(tot.cb, tot.lead)} (${tot.cb}/${tot.lead}); dẫn đúng 3: ${pct(tot.cb3, tot.lead3)}`, '',
    '| Giải | Thời gian | Trận | Map có dẫn ≥ 3 | Lật kèo | Dẫn đúng 3: lật / kèo |', '|---|---|---|---|---|---|');
  for (const e of list) md.push(`| ${short(e.name)} | ${e.first.slice(5).split('-').reverse().join('/')}–${e.last.slice(5).split('-').reverse().join('/')} | ${e.matches} | ${e.lead} | ${e.cb} (${pct(e.cb, e.lead)}) | ${e.cb3}/${e.lead3} (${pct(e.cb3, e.lead3)}) |`);
  md.push('');
}
fs.writeFileSync(`reports/event-rates-${from.slice(0, 4)}.md`, md.join('\n') + '\n');
console.log(`\nSaved reports/event-rates-${from.slice(0, 4)}.md`);
