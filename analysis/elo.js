#!/usr/bin/env node
// Map-level Elo (K=24, start 1500) over every crawled match in date order; prints the
// current rating of each partner team per region. Used to judge strength gaps live.
//
// Usage: node analysis/elo.js [--data data-backtest] [--regions pacific,americas,china,emea]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const regions = opt('--regions', 'pacific,americas,china,emea').split(',');
const K = 24;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { allOpponents: true, teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const elo = new Map(), games = new Map(), last = new Map();
const R = t => elo.get(t) ?? 1500;
for (const m of [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date))) {
  for (const mp of m.map_result) {
    if (!mp.score) continue;
    const [f1, f2] = mp.score.split('-').map(Number);
    if (!(f1 + f2) || f1 === f2) continue;
    const y = f1 > f2 ? 1 : 0, e1 = 1 / (1 + 10 ** ((R(m.t2) - R(m.t1)) / 400));
    elo.set(m.t1, R(m.t1) + K * (y - e1)); elo.set(m.t2, R(m.t2) - K * (y - e1));
    for (const t of [m.t1, m.t2]) { games.set(t, (games.get(t) || 0) + 1); last.set(t, m.day); }
  }
}
module.exports = { elo };
if (require.main === module) {
  const teamRegion = {};
  for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
  for (const r of regions) {
    console.log(`\n=== ${r}`);
    console.table(Object.keys(teamRegion).filter(t => teamRegion[t] === r).sort((a, b) => R(b) - R(a)).map(t => ({ 'đội': t, Elo: Math.round(R(t)), 'map đã tính': games.get(t) || 0, 'trận cuối': last.get(t) || '—' })));
  }
}
