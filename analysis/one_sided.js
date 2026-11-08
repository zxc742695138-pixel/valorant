// One-sided whitelist: for every partner team, the share of its maps this season (from 1
// January of the year of `to`, up to `to`) whose final score gap is >= `gap` rounds — won or
// lost big. In each region the teams with at least `minMaps` maps are ranked by that share
// and the top `top` of 12 (scaled when fewer teams qualify) are "Một chiều" = the whitelist.
// Use: bet only on maps where BOTH teams are in the whitelist (see analysis/style_groups.js
// for the walk-forward backtest of this rule).
//
// Used by pipeline/update.js; can also be run directly:
//   node analysis/one_sided.js [--data data] [--to 2026-11-08] [--top 8] [--gap 4] [--min-maps 10]

const fs = require('fs');
const path = require('path');
const { REGIONS, loadRegion } = require('./betting');

function computeOneSided({ dataDir, teamsDir, to, top = 8, gap = 4, minMaps = 10, regions = REGIONS }) {
  const from = `${to.slice(0, 4)}-01-01`;
  const byUrl = new Map();
  for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { teamsDir }).matches) byUrl.set(m.url, m);

  const stats = {};
  let lastDay = '';
  for (const m of byUrl.values()) {
    if (m.day < from || m.day > to) continue;
    for (const mp of m.map_result) {
      const fin = mp.rounds.length ? mp.rounds[mp.rounds.length - 1] : mp.score;
      if (!fin) continue;
      const [f1, f2] = fin.split('-').map(Number);
      if (!(f1 + f2)) continue;
      if (m.day > lastDay) lastDay = m.day;
      const big = Math.abs(f1 - f2) >= gap;
      for (const [t, won] of [[m.t1, f1 > f2], [m.t2, f2 > f1]]) {
        const x = (stats[t] = stats[t] || { maps: 0, bigW: 0, bigL: 0 });
        x.maps++;
        if (big) won ? x.bigW++ : x.bigL++;
      }
    }
  }

  const out = {};
  for (const r of regions) {
    const names = JSON.parse(fs.readFileSync(path.join(teamsDir, `${r}.json`), 'utf8')).map(t => t.name);
    const teams = names.map(team => {
      const x = stats[team] || { maps: 0, bigW: 0, bigL: 0 };
      return { team, maps: x.maps, bigW: x.bigW, bigL: x.bigL, share: x.maps ? (x.bigW + x.bigL) / x.maps : 0, enough: x.maps >= minMaps };
    }).sort((a, b) => b.enough - a.enough || b.share - a.share || b.maps - a.maps || a.team.localeCompare(b.team));
    const ranked = teams.filter(t => t.enough);
    const k = Math.round(top * ranked.length / names.length);
    const whitelist = ranked.slice(0, k).map(t => t.team);
    out[r] = { teams: teams.map(t => ({ ...t, group: !t.enough ? 'Chưa đủ dữ liệu' : whitelist.includes(t.team) ? 'Một chiều' : 'Giằng co' })), whitelist };
  }
  return { from, to, lastDay, regions: out };
}

module.exports = { computeOneSided };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const res = computeOneSided({
    dataDir: opt('--data', 'data'), teamsDir: opt('--teams', 'crawler/teams'),
    to: opt('--to', new Date().toISOString().slice(0, 10)), top: Number(opt('--top', 8)),
    gap: Number(opt('--gap', 4)), minMaps: Number(opt('--min-maps', 10)),
    regions: opt('--regions', 'pacific,americas,china').split(','),
  });
  console.log(`Mùa ${res.from.slice(0, 4)}: ${res.from} → ${res.to} (trận cuối ${res.lastDay})`);
  for (const [r, v] of Object.entries(res.regions)) {
    console.log(`\n${r}: Một chiều ${v.whitelist.join(', ')}`);
    console.table(v.teams.map(t => ({ 'đội': t.team, map: t.maps, 'thắng đậm': t.bigW, 'thua đậm': t.bigL, '% đậm': `${(100 * t.share).toFixed(1)}%`, 'nhóm': t.group })));
  }
}
