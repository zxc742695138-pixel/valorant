#!/usr/bin/env node
// Per team, how its maps of a season ended: big wins / big losses (final gap >= GAP) vs
// close wins / close losses (gap < GAP), plus comeback involvement. Partner matches only.
//
// Usage: node analysis/team_map_margins.js [--season 2026] [--gap 4]
//   [--regions americas,china,pacific] [--out reports/team-margins-2026.md]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const season = opt('--season', '2026');
const GAP = Number(opt('--gap', 4));
const regions = opt('--regions', 'americas,china,pacific').split(',');
const out = opt('--out', `reports/team-margins-${season}.md`);
const teamsDir = season === '2025' ? 'crawler/teams/2025' : 'crawler/teams';
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific' };

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${teamsDir}/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { teamsDir: 'crawler/teams/backtest' }).matches) if (m.day.startsWith(season)) byUrl.set(m.url, m);

const s = {};
const get = t => s[t] || (s[t] = { n: 0, bw: 0, bl: 0, cw: 0, cl: 0, blown: 0, made: 0 });
for (const m of byUrl.values()) {
  if (!teamRegion[m.t1] || !teamRegion[m.t2]) continue;
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const [f1, f2] = mp.rounds[mp.rounds.length - 1].split('-').map(Number);
    const big = Math.abs(f1 - f2) >= GAP;
    const a = analyzeMap(mp.rounds);
    for (const [t, me, op, side] of [[m.t1, f1, f2, 1], [m.t2, f2, f1, 2]]) {
      const x = get(t); x.n++;
      if (me > op) big ? x.bw++ : x.cw++; else big ? x.bl++ : x.cl++;
      if (a.blownBy === side) x.blown++;
      if (a.blownBy && a.blownBy !== side) x.made++;
    }
  }
}

const pct = (k, n) => (n ? `${Math.round(100 * k / n)}%` : '—');
const md = [`# Tỉ số kết thúc map theo đội — mùa ${season}`, '',
  `Mỗi map đội đã đấu (chỉ trận giữa hai đội nhượng quyền). **Đậm** = kết thúc cách ≥ ${GAP} round, **sát** = cách < ${GAP}. Sắp xếp theo tỉ lệ map đậm.`, ''];
for (const r of regions) {
  const list = Object.keys(teamRegion).filter(t => teamRegion[t] === r && s[t]).sort((a, b) => (s[b].bw + s[b].bl) / s[b].n - (s[a].bw + s[a].bl) / s[a].n);
  const rows = list.map(t => {
    const x = s[t];
    return { 'đội': t, 'map': x.n, 'thắng đậm': x.bw, 'thua đậm': x.bl, 'thắng sát': x.cw, 'thua sát': x.cl,
      '% đậm': pct(x.bw + x.bl, x.n), '% sát': pct(x.cw + x.cl, x.n), 'bị lật': x.blown, 'lật được': x.made };
  });
  console.log(`\n=== ${NAME[r]}`);
  console.table(rows);
  md.push(`## ${NAME[r]}`, '', `| ${Object.keys(rows[0]).join(' | ')} |`, `|${Object.keys(rows[0]).map(() => '---').join('|')}|`);
  for (const row of rows) md.push(`| ${Object.values(row).join(' | ')} |`);
  md.push('');
}
fs.writeFileSync(out, md.join('\n') + '\n');
console.log(`\nSaved ${out}`);
