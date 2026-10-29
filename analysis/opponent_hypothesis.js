#!/usr/bin/env node
// Hypothesis: teams with a low comeback rate are stable; the few comebacks in
// their maps happen when they face an unstable (high comeback rate) opponent.
//
// Pitfall: classifying a team by a rate computed on the same maps we then test
// is circular. With the full-data rate, comeback maps push their teams towards
// "high" (biased for the hypothesis); with a leave-one-out rate they push them
// towards "low" (biased against it), because with ~2 comebacks per team one map
// moves the rate across group thresholds. So:
//
//   Test A: is the comeback rate a team trait at all, or just noise? Compare the
//           spread of team rates with the spread when comeback labels are
//           shuffled between maps (permutation test).
//   Test B: cross-fitting. Split maps at random into halves; group teams by their
//           rate on half A, measure comebacks on half B (and vice versa), repeat.
//           Significance from the same procedure on label-shuffled data.
//
// Usage:
//   node analysis/opponent_hypothesis.js crawler/teams/*.json [--data data]

const fs = require('fs');
const path = require('path');
const { analyzeMap } = require('./comeback');

const argv = process.argv.slice(2);
const dataFlag = argv.indexOf('--data');
const dataDir = dataFlag >= 0 ? argv.splice(dataFlag, 2)[1] : 'data';

// "MIBR.LOS (MIBR)" → "MIBR"
const normalize = name => (name.match(/\(([^)]+)\)$/) || [null, name])[1].trim();

const teams = argv.flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const known = new Set(teams.map(t => t.name));

// Every qualifying map once, keyed by match url + map index.
const mapsByKey = new Map();
for (const t of teams) {
  const { matches } = JSON.parse(fs.readFileSync(path.join(dataDir, `${t.slug}.json`), 'utf8'));
  for (const m of matches) {
    m.map_result.forEach((mp, i) => {
      if (!mp.rounds.length) return;
      const r = analyzeMap(mp.rounds);
      if (!r.leaders.size) return;
      mapsByKey.set(`${m.url}#${i}`, {
        team1: normalize(m.team1), team2: normalize(m.team2), comeback: r.blownBy ? 1 : 0,
        map: mp.map, score: mp.score, date: m.date.slice(0, 10),
      });
    });
  }
}
const maps = [...mapsByKey.values()];
const sides = m => [m.team1, m.team2].filter(t => known.has(t));

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const shuffle = xs => {
  const a = xs.slice();
  for (let j = a.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [a[j], a[k]] = [a[k], a[j]];
  }
  return a;
};

// Comeback rate per known team over the given maps, with the given labels.
function teamRates(idx, labels) {
  const acc = {};
  for (const i of idx) {
    for (const t of sides(maps[i])) {
      acc[t] = acc[t] || { lead: 0, cb: 0 };
      acc[t].lead++;
      acc[t].cb += labels[i];
    }
  }
  return acc;
}

const labels = maps.map(m => m.comeback);
const all = maps.map((_, i) => i);

// ---- Test A: is there a team effect? ----
// Statistic: chi-square-like dispersion of team comeback counts around the pooled rate.
function dispersion(lbls) {
  const acc = teamRates(all, lbls);
  const p = mean(lbls);
  return Object.values(acc).reduce((s, { lead, cb }) => s + (cb - lead * p) ** 2 / (lead * p * (1 - p)), 0);
}
const obsDisp = dispersion(labels);
const NA = 5000;
let geA = 0;
for (let i = 0; i < NA; i++) if (dispersion(shuffle(labels)) >= obsDisp) geA++;

const rates = teamRates(all, labels);
const ranked = Object.keys(rates).sort((a, b) => rates[a].cb / rates[a].lead - rates[b].cb / rates[b].lead);
console.log(`Dữ liệu: ${maps.length} map có tình huống dẫn ≥3, ${ranked.length} đội, tỉ lệ lật kèo chung ${pct(mean(labels))}\n`);
console.log('Kiểm định A: tỉ lệ lật kèo có phải đặc điểm riêng của từng đội không?');
console.log(`  Độ phân tán giữa các đội: thực tế ${obsDisp.toFixed(1)}, trung bình khi xáo ngẫu nhiên ${(() => {
  let s = 0; for (let i = 0; i < 500; i++) s += dispersion(shuffle(labels)); return (s / 500).toFixed(1);
})()}`);
console.log(`  p-value = ${(geA / NA).toFixed(3)}  (nhỏ → khác biệt giữa các đội là thật; lớn → chủ yếu do may rủi)\n`);

// ---- Test B: cross-fitting ----
// Group teams into thirds by their rate on half A; on half B, compare comeback
// rates of maps where a "low" team meets a "high" vs a "low" opponent.
const ORDER = ['low', 'mid', 'high'];
function crossFit(lbls, reps) {
  const pairs = {};
  const lowVs = {};
  for (let r = 0; r < reps; r++) {
    const perm = shuffle(all);
    const halves = [perm.slice(0, perm.length >> 1), perm.slice(perm.length >> 1)];
    for (const [fit, test] of [[halves[0], halves[1]], [halves[1], halves[0]]]) {
      const acc = teamRates(fit, lbls);
      const order = Object.keys(acc).sort((a, b) => acc[a].cb / acc[a].lead - acc[b].cb / acc[b].lead || Math.random() - 0.5);
      const third = Math.ceil(order.length / 3);
      const group = {};
      order.forEach((t, i) => { group[t] = ORDER[Math.min(2, Math.floor(i / third))]; });
      for (const i of test) {
        const m = maps[i];
        const [g1, g2] = [group[m.team1], group[m.team2]];
        if (!g1 || !g2) continue;
        const key = [g1, g2].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join('-');
        pairs[key] = pairs[key] || { maps: 0, comebacks: 0 };
        pairs[key].maps++;
        pairs[key].comebacks += lbls[i];
        for (const [s, o] of [[g1, g2], [g2, g1]]) {
          if (s !== 'low') continue;
          lowVs[o] = lowVs[o] || { maps: 0, comebacks: 0 };
          lowVs[o].maps++;
          lowVs[o].comebacks += lbls[i];
        }
      }
    }
  }
  const rate = x => (x ? x.comebacks / x.maps : NaN);
  const lowNotHigh = { maps: (lowVs.low?.maps || 0) + (lowVs.mid?.maps || 0), comebacks: (lowVs.low?.comebacks || 0) + (lowVs.mid?.comebacks || 0) };
  return { pairs, lowVs, stat: rate(lowVs.high) - rate(lowNotHigh) };
}

const REPS = 200;
const obs = crossFit(labels, REPS);
const NB = 300;
let geB = 0;
for (let i = 0; i < NB; i++) if (crossFit(shuffle(labels), 10).stat >= obs.stat) geB++;

// Counts are summed over 2 × REPS fits, so divide to get "maps per fit".
const per = x => ({ maps: (x.maps / (2 * REPS)).toFixed(1), comebacks: (x.comebacks / (2 * REPS)).toFixed(1), rate: pct(x.comebacks / x.maps) });
console.log(`Kiểm định B: cross-fitting (${REPS} lần chia đôi; nhóm xếp ở nửa A, đo ở nửa B)`);
console.log('  Map của đội low, theo nhóm của đối thủ (trung bình mỗi lần đo):');
console.table(ORDER.filter(g => obs.lowVs[g]).map(g => ({ opponent: g, ...per(obs.lowVs[g]) })));
console.log('  Theo cặp nhóm:');
const pairKeys = ORDER.flatMap((a, i) => ORDER.slice(i).map(b => `${a}-${b}`));
console.table(pairKeys.filter(k => obs.pairs[k]).map(k => ({ pair: k, ...per(obs.pairs[k]) })));
console.log(`  Chênh lệch (low gặp high) − (low gặp low/mid): ${(100 * obs.stat).toFixed(1)} điểm %`);
console.log(`  p-value (permutation, 1 phía) = ${(geB / NB).toFixed(3)}\n`);

// ---- Descriptive: comeback maps of the full-data "low" third ----
const third = Math.ceil(ranked.length / 3);
const group = {};
ranked.forEach((t, i) => { group[t] = ORDER[Math.min(2, Math.floor(i / third))]; });
console.log(`Mô tả: các map lật kèo của nhóm low (xếp theo toàn bộ dữ liệu, ≤ ${pct(rates[ranked[third - 1]].cb / rates[ranked[third - 1]].lead)})`);
const details = [];
for (const m of maps) {
  if (!m.comeback || !known.has(m.team1) || !known.has(m.team2)) continue;
  for (const [s, o] of [[m.team1, m.team2], [m.team2, m.team1]]) {
    if (group[s] === 'low') details.push({ date: m.date, team: s, opponent: o, opp_group: group[o], map: m.map, score: `${m.team1} ${m.score} ${m.team2}` });
  }
}
console.table(details.sort((a, b) => a.team.localeCompare(b.team)));
