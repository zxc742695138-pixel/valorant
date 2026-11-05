#!/usr/bin/env node
// Group partner teams by how comeback maps go for them:
//   Mạnh           made − blown ≥ +NET  (often turns deficits around)
//   Yếu            made − blown ≤ −NET  (often loses leads)
//   Không ổn định  balanced, but made + blown ≥ VOLATILE (many comebacks both ways)
//   Trung bình     the rest
// "made": trailed by ≥ MIN_DIFF at total rounds ≥ MIN_TOTAL and still won the map;
// "blown": led like that and lost it. Only matches between two partner teams.
//
// Usage:
//   node analysis/team_groups.js [--data data-backtest] [--from 2026-01-01] [--to 2026-12-31]
//     [--net 2] [--volatile 6] [--out reports/team-groups-2026.md]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const NET = Number(opt('--net', 2));
const VOLATILE = Number(opt('--volatile', 6));
const outFile = opt('--out', 'reports/team-groups-2026.md');
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific' };
const ORDER = ['Mạnh', 'Không ổn định', 'Trung bình', 'Yếu'];

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir).matches) if (m.day >= from && m.day <= to) byUrl.set(m.url, m);

const st = {};
const get = t => st[t] || (st[t] = { maps: 0, wins: 0, lead: 0, blown: 0, trail: 0, made: 0 });
let lastDay = '';
for (const m of byUrl.values()) {
  if (m.day > lastDay) lastDay = m.day;
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const [f1, f2] = mp.rounds[mp.rounds.length - 1].split('-').map(Number);
    const winner = f1 > f2 ? 1 : 2;
    const a = analyzeMap(mp.rounds);
    for (const [t, side] of [[m.t1, 1], [m.t2, 2]]) {
      if (!teamRegion[t]) continue;
      const s = get(t);
      s.maps++;
      if (winner === side) s.wins++;
      if (a.leaders.has(side)) { s.lead++; if (a.blownBy === side) s.blown++; }
      const other = side === 1 ? 2 : 1;
      if (a.leaders.has(other)) { s.trail++; if (a.blownBy === other) s.made++; }
    }
  }
}

const group = x => {
  const net = x.made - x.blown;
  if (net >= NET) return 'Mạnh';
  if (net <= -NET) return 'Yếu';
  return x.made + x.blown >= VOLATILE ? 'Không ổn định' : 'Trung bình';
};
const pct = (k, n) => (n ? `${Math.round(100 * k / n)}%` : '—');

const md = [
  `# Phân nhóm đội theo lật kèo (${from.slice(0, 4)})`, '',
  `Dữ liệu ${from} → ${lastDay}, chỉ trận giữa hai đội nhượng quyền (kể cả quốc tế).`,
  `- Lật được: bị dẫn ≥ ${MIN_DIFF} khi tổng round ≥ ${MIN_TOTAL} nhưng thắng map. Bị lật: dẫn như vậy nhưng thua map.`,
  `- **Mạnh**: lật được − bị lật ≥ +${NET}. **Yếu**: ≤ −${NET}. **Không ổn định**: ở giữa nhưng lật được + bị lật ≥ ${VOLATILE}. **Trung bình**: còn lại.`, '',
];
const totals = {};
for (const r of REGIONS) {
  const rows = Object.entries(st).filter(([t]) => teamRegion[t] === r).map(([t, s]) => ({ t, ...s, g: group(s) }))
    .sort((a, b) => ORDER.indexOf(a.g) - ORDER.indexOf(b.g) || (b.made - b.blown) - (a.made - a.blown) || (b.made + b.blown) - (a.made + a.blown));
  console.log(`\n=== ${NAME[r]}`);
  console.table(rows.map(x => ({
    'đội': x.t, 'nhóm': x.g, 'lật được': `${x.made}/${x.trail}`, 'bị lật': `${x.blown}/${x.lead}`,
    'chênh lệch': `${x.made - x.blown > 0 ? '+' : ''}${x.made - x.blown}`, 'tổng dính': x.made + x.blown, 'thắng map': pct(x.wins, x.maps),
  })));
  md.push(`## ${NAME[r]}`, '', '| Đội | Nhóm | Lật được (/lần bị dẫn) | Bị lật (/lần dẫn) | Chênh lệch | Tổng dính | Thắng map |', '|---|---|---|---|---|---|---|');
  for (const x of rows) {
    md.push(`| ${x.t} | ${x.g} | ${x.made}/${x.trail} | ${x.blown}/${x.lead} | ${x.made - x.blown > 0 ? '+' : ''}${x.made - x.blown} | ${x.made + x.blown} | ${pct(x.wins, x.maps)} |`);
    const T = (totals[x.g] = totals[x.g] || { teams: 0, maps: 0, wins: 0 });
    T.teams++; T.maps += x.maps; T.wins += x.wins;
  }
  md.push('');
}
md.push('## Tổng hợp', '');
console.log('\nTổng hợp theo nhóm:');
for (const g of ORDER) {
  const T = totals[g];
  if (!T) continue;
  const line = `${g}: ${T.teams} đội, tỉ lệ thắng map trung bình ${pct(T.wins, T.maps)}`;
  console.log('  ' + line);
  md.push(`- ${line}`);
}
fs.writeFileSync(outFile, md.join('\n') + '\n');
console.log(`\nSaved ${outFile}`);
