#!/usr/bin/env node
// Per team, per tournament of one season: maps finishing 13-11 or in overtime / maps played.
// Columns are the season's tournaments in date order (small ones grouped as "Khác").
//
// Usage: node analysis/close_finish_events.js [--season 2026] [--regions americas,china,pacific]
//   [--exclude "Esports World Cup|Champions"] [--out reports/close-finish-events-2026.md]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const season = opt('--season', '2026');
const regions = opt('--regions', 'americas,china,pacific').split(',');
const out = opt('--out', `reports/close-finish-events-${season}${opt('--exclude') ? '-filtered' : ''}.md`);
// --exclude REGEX: leave out events whose name matches (e.g. "Esports World Cup|Champions").
const exclude = opt('--exclude') ? new RegExp(opt('--exclude')) : null;
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific' };

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${season === '2025' ? 'crawler/teams/2025' : 'crawler/teams'}/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
const all = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { teamsDir: 'crawler/teams/backtest' }).matches) if (m.day.startsWith(season)) all.set(m.url, m);

// Column name for an event.
const col = e => {
  if (/Kickoff/.test(e)) return 'Kickoff';
  if (/Stage 1/.test(e)) return 'Stage 1';
  if (/Stage 2/.test(e)) return 'Stage 2';
  if (/Esports World Cup.*Qualifier/.test(e)) return 'VL EWC';
  if (/Masters (\w+)/.test(e)) return `Masters ${e.match(/Masters (\w+)/)[1]}`;
  if (/Esports World Cup/.test(e)) return 'EWC';
  if (/Champions/.test(e)) return 'Champions';
  return 'Khác';
};
const ORDER = ['Kickoff', 'Masters Santiago', 'Stage 1', 'VL EWC', 'Masters London', 'EWC', 'Stage 2', 'Champions', 'Khác'];

const s = {}; // team → col → { n, c }
const events = {}; // col → Set(event names)
for (const m of all.values()) {
  if (!teamRegion[m.t1] || !teamRegion[m.t2]) continue;
  if (exclude && exclude.test(m.event)) continue;
  const c = col(m.event);
  (events[c] = events[c] || new Set()).add(m.event.replace('Valorant ', '').replace(/^VCT 20\d\d: /, ''));
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const [f1, f2] = mp.rounds[mp.rounds.length - 1].split('-').map(Number);
    const close = (Math.max(f1, f2) === 13 && Math.min(f1, f2) === 11) || f1 + f2 > 24;
    for (const t of [m.t1, m.t2]) {
      const x = ((s[t] = s[t] || {})[c] = s[t][c] || { n: 0, c: 0 });
      x.n++; x.c += close;
    }
  }
}

const cell = x => (x ? `${x.c}/${x.n} (${Math.round(100 * x.c / x.n)}%)` : '');
const md = [`# Tỉ lệ map 13-11 hoặc hiệp phụ theo giải — mùa ${season}`, '',
  (exclude ? `Không tính các giải khớp: ${exclude.source}. ` : '') + 'Mỗi ô: số map kết thúc 13-11 (thắng hoặc thua) hoặc hiệp phụ / số map đội đá ở giải đó. Chỉ trận giữa hai đội nhượng quyền. "Khác" gồm: ' +
  [...(events['Khác'] || [])].join(', ') + '.', ''];
for (const r of regions) {
  const teams = Object.keys(teamRegion).filter(t => teamRegion[t] === r && s[t]);
  const cols = ORDER.filter(c => teams.some(t => s[t][c]));
  const total = t => Object.values(s[t]).reduce((a, x) => ({ n: a.n + x.n, c: a.c + x.c }), { n: 0, c: 0 });
  teams.sort((a, b) => total(b).c / total(b).n - total(a).c / total(a).n);
  const rows = teams.map(t => {
    const row = { 'đội': t };
    for (const c of cols) row[c] = cell(s[t][c]);
    row['cả mùa'] = cell(total(t));
    return row;
  });
  // Region average per column.
  const avg = { 'đội': 'Trung bình khu vực' };
  for (const c of cols) { const a = teams.reduce((z, t) => (s[t][c] ? { n: z.n + s[t][c].n, c: z.c + s[t][c].c } : z), { n: 0, c: 0 }); avg[c] = cell(a); }
  avg['cả mùa'] = cell(teams.reduce((z, t) => ({ n: z.n + total(t).n, c: z.c + total(t).c }), { n: 0, c: 0 }));
  rows.push(avg);
  console.log(`\n=== ${NAME[r]}`);
  console.table(rows);
  md.push(`## ${NAME[r]}`, '', `| ${Object.keys(rows[0]).join(' | ')} |`, `|${Object.keys(rows[0]).map(() => '---').join('|')}|`);
  for (const row of rows) md.push(`| ${Object.values(row).map(v => v || '—').join(' | ')} |`);
  md.push('');
}
fs.writeFileSync(out, md.join('\n') + '\n');
console.log(`\nSaved ${out}`);
