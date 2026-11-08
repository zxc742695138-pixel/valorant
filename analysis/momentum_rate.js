#!/usr/bin/env node
// Comeback rate on maps where, at total rounds >= 17, a team leads by exactly 3 right after
// winning the round (9-7 → 10-7, 10-8 → 11-8). No team filters. Comeback = that team loses.
//   A: the FIRST moment with total >= 17 and lead >= 3 is such a moment (bet-rule view)
//   B: ANY such moment in the map (the first one counts)
// Per season and region (international = teams of different regions). Partner matches only.
//
// Usage: node analysis/momentum_rate.js [--seasons 2025,2026]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { MIN_TOTAL } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const seasons = opt('--seasons', '2025,2026').split(',');
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific', intl: 'Quốc tế' };

const all = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { teamsDir: 'crawler/teams/backtest' }).matches) all.set(m.url, m);
const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');

for (const season of seasons) {
  const teamRegion = {};
  for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${season === '2025' ? 'crawler/teams/2025' : 'crawler/teams'}/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
  const acc = {};
  const get = g => acc[g] || (acc[g] = { maps: 0, aN: 0, aL: 0, bN: 0, bL: 0, anyN: 0, anyL: 0, against: 0, againstL: 0 });
  for (const m of all.values()) {
    if (!m.day.startsWith(season) || !teamRegion[m.t1] || !teamRegion[m.t2]) continue;
    const g = teamRegion[m.t1] === teamRegion[m.t2] ? teamRegion[m.t1] : 'intl';
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const st = mp.rounds.map(s => s.split('-').map(Number));
      const [f1, f2] = st[st.length - 1];
      const x = get(g); x.maps++;
      const body = st.slice(0, -1); // final score = map over
      const isMom = i => {
        const [a, b] = body[i];
        if (a + b < MIN_TOTAL || Math.abs(a - b) !== 3 || i === 0) return false;
        return a > b ? a > body[i - 1][0] : b > body[i - 1][1];
      };
      const lost = i => (body[i][0] > body[i][1]) !== (f1 > f2);
      const fi = body.findIndex(([a, b]) => a + b >= MIN_TOTAL && Math.abs(a - b) >= 3);
      if (fi < 0) continue;
      x.anyN++; x.anyL += lost(fi);
      if (Math.abs(body[fi][0] - body[fi][1]) === 3 && !isMom(fi)) { x.against++; x.againstL += lost(fi); }
      if (isMom(fi)) { x.aN++; x.aL += lost(fi); }
      const bi = body.findIndex((_, i) => isMom(i));
      if (bi >= 0) { x.bN++; x.bL += lost(bi); }
    }
  }
  const rows = [...REGIONS, 'intl'].map(g => {
    const x = get(g);
    return { 'khu vực': NAME[g], 'map': x.maps, 'mọi map dẫn ≥ 3 (cũ)': `${x.anyL}/${x.anyN} (${pct(x.anyL, x.anyN)})`,
      'A: lần đầu dẫn 3, đội dẫn vừa thắng round': `${x.aL}/${x.aN} (${pct(x.aL, x.aN)})`,
      'đối chứng: lần đầu dẫn 3, đội bị dẫn vừa thắng round': `${x.againstL}/${x.against} (${pct(x.againstL, x.against)})`,
      'B: có lúc nào dẫn 3 sau khi thắng round': `${x.bL}/${x.bN} (${pct(x.bL, x.bN)})` };
  });
  const sum = k => Object.values(acc).reduce((s, x) => s + x[k], 0);
  const tot = { 'khu vực': 'Tổng', 'map': sum('maps'), 'mọi map dẫn ≥ 3 (cũ)': `${sum('anyL')}/${sum('anyN')} (${pct(sum('anyL'), sum('anyN'))})`,
    'A: lần đầu dẫn 3, đội dẫn vừa thắng round': `${sum('aL')}/${sum('aN')} (${pct(sum('aL'), sum('aN'))})`,
    'đối chứng: lần đầu dẫn 3, đội bị dẫn vừa thắng round': `${sum('againstL')}/${sum('against')} (${pct(sum('againstL'), sum('against'))})`,
    'B: có lúc nào dẫn 3 sau khi thắng round': `${sum('bL')}/${sum('bN')} (${pct(sum('bL'), sum('bN'))})` };
  console.log(`\n=== Mùa ${season}`);
  console.table([...rows, tot]);
}
