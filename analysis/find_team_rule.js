#!/usr/bin/env node
// Which map-history features separate a hand-picked set of teams from the rest of their
// region? For each team (season, partner matches only) we compute many features from the
// map scores and round-by-round progression, convert each to a within-region rank, and
// measure how well it separates the picked teams (AUC: 1 = perfect, 0.5 = random).
//
// Usage: node analysis/find_team_rule.js [--season 2026] [--to 2026-12-31]
//   [--teams "ENVY,Cloud9,..."] [--regions americas,china,pacific]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const season = opt('--season', '2026');
const from = opt('--from', `${season}-01-01`);
const to = opt('--to', `${season}-12-31`);
const regions = opt('--regions', 'americas,china,pacific').split(',');
const picked = new Set(opt('--teams', 'ENVY,Cloud9,Evil Geniuses,Sentinels,Xi Lai Gaming,All Gamers,FunPlus Phoenix,Trace Esports,T1,Nongshim RedForce,VARREL').split(','));
const teamsDir = season === '2025' ? 'crawler/teams/2025' : 'crawler/teams';

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`${teamsDir}/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
for (const t of picked) if (!teamRegion[t]) { console.error(`Unknown team: ${t}`); process.exit(1); }
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { teamsDir: 'crawler/teams/backtest' }).matches) if (m.day >= from && m.day <= to) byUrl.set(m.url, m);

const acc = {};
const get = t => acc[t] || (acc[t] = { maps: 0, win: 0, bigW: 0, bigL: 0, closeW: 0, closeL: 0, ot: 0, margin: 0,
  leadMaps: 0, cbInv: 0, blown: 0, made: 0, led3: 0, trailed3: 0, both3: 0, changes: 0, maxDefWon: 0, wonMaps: 0, maxLeadLost: 0, lostMaps: 0,
  rounds: 0, roundsWon: 0, half1Flip: 0, early3: 0, earlyWinLost: 0 });
for (const m of byUrl.values()) {
  if (!teamRegion[m.t1] || !teamRegion[m.t2]) continue;
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const st = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = st[st.length - 1];
    const a = analyzeMap(mp.rounds);
    const h = st.find(([x, y]) => x + y === 12);
    for (const side of [1, 2]) {
      const t = side === 1 ? m.t1 : m.t2, x = get(t);
      const me = s => (side === 1 ? s[0] - s[1] : s[1] - s[0]); // my lead at a state
      const myF = side === 1 ? f1 : f2, opF = side === 1 ? f2 : f1;
      const won = myF > opF, gap = Math.abs(f1 - f2);
      x.maps++; x.win += won; x.margin += myF - opF;
      x.rounds += f1 + f2; x.roundsWon += myF;
      if (gap >= 4) won ? x.bigW++ : x.bigL++; else won ? x.closeW++ : x.closeL++;
      if (f1 + f2 > 24) x.ot++;
      const leads = st.slice(0, -1).map(me);
      const maxL = Math.max(0, ...leads), maxD = Math.max(0, ...leads.map(v => -v));
      if (maxL >= 3) x.led3++;
      if (maxD >= 3) x.trailed3++;
      if (maxL >= 3 && maxD >= 3) x.both3++;
      let prev = 0;
      for (const v of leads) { const sg = Math.sign(v); if (sg && prev && sg !== prev) x.changes++; if (sg) prev = sg; }
      if (won) { x.wonMaps++; x.maxDefWon += maxD; } else { x.lostMaps++; x.maxLeadLost += maxL; }
      if (h && Math.sign(me(h)) && Math.sign(me(h)) !== Math.sign(myF - opF)) x.half1Flip++;
      // early lead >= 3 at any point before total 17, then lost the map
      if (st.some(s => s[0] + s[1] < MIN_TOTAL && me(s) >= 3)) { x.early3++; if (!won) x.earlyWinLost++; }
      if (a.leaders.size) {
        x.leadMaps++;
        if (a.blownBy) { x.cbInv++; if (a.blownBy === side) x.blown++; else x.made++; }
      }
    }
  }
}

const FEATURES = {
  'tỉ lệ thắng map': x => x.win / x.maps,
  'tỉ lệ thắng round': x => x.roundsWon / x.rounds,
  'hiệu số round TB/map': x => x.margin / x.maps,
  '% map đậm (cách ≥4)': x => (x.bigW + x.bigL) / x.maps,
  '% thắng đậm': x => x.bigW / x.maps,
  '% thua đậm': x => x.bigL / x.maps,
  '% map sát (cách <4)': x => (x.closeW + x.closeL) / x.maps,
  'tỉ lệ thắng map sát': x => x.closeW / Math.max(1, x.closeW + x.closeL),
  '% map hiệp phụ': x => x.ot / x.maps,
  '% map từng dẫn ≥3': x => x.led3 / x.maps,
  '% map từng bị dẫn ≥3': x => x.trailed3 / x.maps,
  '% map cả dẫn ≥3 lẫn bị dẫn ≥3': x => x.both3 / x.maps,
  'số lần đổi người dẫn TB/map': x => x.changes / x.maps,
  'bị dẫn tối đa TB ở map thắng': x => x.maxDefWon / Math.max(1, x.wonMaps),
  'dẫn tối đa TB ở map thua': x => x.maxLeadLost / Math.max(1, x.lostMaps),
  '% map hiệp 1 và kết quả ngược nhau': x => x.half1Flip / x.maps,
  '% thua khi từng dẫn ≥3 trước round 17': x => x.earlyWinLost / Math.max(1, x.early3),
  '% map dính lật kèo (cả 2 phía, /map có dẫn≥3)': x => x.cbInv / Math.max(1, x.leadMaps),
  '% map bị lật': x => x.blown / Math.max(1, x.leadMaps),
  '% map lật được': x => x.made / Math.max(1, x.leadMaps),
  'số map': x => x.maps,
};

const teams = Object.keys(teamRegion).filter(t => regions.includes(teamRegion[t]) && acc[t]);
// Within-region percentile rank (0 = lowest, 1 = highest) so regions are comparable.
const rankIn = (f) => {
  const out = {};
  for (const r of regions) {
    const list = teams.filter(t => teamRegion[t] === r).sort((a, b) => f(acc[a]) - f(acc[b]));
    list.forEach((t, i) => { out[t] = i / (list.length - 1); });
  }
  return out;
};
const auc = (score) => {
  const pos = teams.filter(t => picked.has(t)), neg = teams.filter(t => !picked.has(t));
  let s = 0;
  for (const p of pos) for (const n of neg) s += score[p] > score[n] ? 1 : score[p] === score[n] ? 0.5 : 0;
  return s / (pos.length * neg.length);
};
const res = Object.entries(FEATURES).map(([name, f]) => { const r = rankIn(f); const a = auc(r); return { name, f, r, a, dir: a >= 0.5 ? 'cao' : 'thấp', sep: Math.max(a, 1 - a) }; })
  .sort((a, b) => b.sep - a.sep);

console.log(`Mùa ${season} (${from} → ${to}); ${teams.length} đội của ${regions.join(', ')}; đội được chọn: ${[...picked].join(', ')}\n`);
console.log('Mức tách nhóm của từng chỉ số (AUC trên thứ hạng trong khu vực; 1 = tách hoàn hảo, 0.5 = như ngẫu nhiên):');
console.table(res.map(x => ({ 'chỉ số': x.name, 'đội được chọn có xu hướng': x.dir, 'AUC': x.sep.toFixed(2) })));

// Show the best few features per team.
const top = res.slice(0, 4);
for (const r of regions) {
  console.log(`\n=== ${r}`);
  console.table(teams.filter(t => teamRegion[t] === r).sort((a, b) => (picked.has(b) - picked.has(a)) || a.localeCompare(b)).map(t => {
    const row = { 'đội': `${picked.has(t) ? '★ ' : ''}${t}` };
    for (const x of top) { const v = x.f(acc[t]); row[x.name] = v < 1.5 && x.name !== 'số map' && !x.name.includes('TB') ? `${(100 * v).toFixed(0)}%` : v.toFixed(2); }
    return row;
  }));
}
