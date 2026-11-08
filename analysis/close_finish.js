#!/usr/bin/env node
// Per season, region and team: share of maps that finished 13-11 (either way) or went to
// overtime (total rounds > 24). Partner matches only. Sorted by that share.
//
// Usage: node analysis/close_finish.js [--seasons 2025,2026] [--regions americas,emea,china,pacific]
//   [--out reports/close-finish.md]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const seasons = opt('--seasons', '2025,2026').split(',');
const regions = opt('--regions', REGIONS.join(',')).split(',');
const out = opt('--out', 'reports/close-finish.md');
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific' };

const all = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { teamsDir: 'crawler/teams/backtest' }).matches) all.set(m.url, m);

const md = ['# Tỉ lệ map kết thúc 13-11 hoặc hiệp phụ, theo đội', '',
  'Chỉ trận giữa hai đội nhượng quyền của năm đó. **13-11** = thắng hoặc thua 13-11; **OT** = map phải đá hiệp phụ (tổng round > 24). Dữ liệu 2025 chỉ có từ 29/06/2025.', ''];
for (const season of seasons) {
  const teamRegion = {};
  for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${season === '2025' ? 'crawler/teams/2025' : 'crawler/teams'}/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
  const s = {};
  for (const m of all.values()) {
    if (!m.day.startsWith(season) || !teamRegion[m.t1] || !teamRegion[m.t2]) continue;
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const [f1, f2] = mp.rounds[mp.rounds.length - 1].split('-').map(Number);
      const is1311 = Math.max(f1, f2) === 13 && Math.min(f1, f2) === 11, ot = f1 + f2 > 24;
      for (const [t, won] of [[m.t1, f1 > f2], [m.t2, f2 > f1]]) {
        const x = (s[t] = s[t] || { n: 0, w1311: 0, l1311: 0, wot: 0, lot: 0 });
        x.n++;
        if (is1311) won ? x.w1311++ : x.l1311++;
        if (ot) won ? x.wot++ : x.lot++;
      }
    }
  }
  md.push(`## Mùa ${season}`, '');
  for (const r of regions) {
    const list = Object.keys(teamRegion).filter(t => teamRegion[t] === r && s[t]);
    const close = t => s[t].w1311 + s[t].l1311 + s[t].wot + s[t].lot;
    list.sort((a, b) => close(b) / s[b].n - close(a) / s[a].n);
    const tot = list.reduce((a, t) => ({ n: a.n + s[t].n, c: a.c + close(t) }), { n: 0, c: 0 });
    const rows = list.map(t => {
      const x = s[t];
      return { 'đội': t, 'map': x.n, '13-11 (thắng/thua)': `${x.w1311 + x.l1311} (${x.w1311}/${x.l1311})`, 'OT (thắng/thua)': `${x.wot + x.lot} (${x.wot}/${x.lot})`,
        '% 13-11 hoặc OT': `${(100 * close(t) / x.n).toFixed(1)}%` };
    });
    console.log(`\n=== Mùa ${season} · ${NAME[r]} (trung bình ${(100 * tot.c / tot.n).toFixed(1)}%)`);
    console.table(rows);
    md.push(`### ${NAME[r]} — trung bình ${(100 * tot.c / tot.n).toFixed(1)}%`, '', `| ${Object.keys(rows[0]).join(' | ')} |`, `|${Object.keys(rows[0]).map(() => '---').join('|')}|`);
    for (const row of rows) md.push(`| ${Object.values(row).join(' | ')} |`);
    md.push('');
  }
}
fs.writeFileSync(out, md.join('\n') + '\n');
console.log(`\nSaved ${out}`);
