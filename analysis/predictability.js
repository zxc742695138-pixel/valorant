#!/usr/bin/env node
// Can comeback maps be predicted from information available before the match?
//
// For every map in the test period where, at total rounds >= MIN_TOTAL, a team
// first leads by >= MIN_DIFF rounds, compute features from matches strictly
// before that day (expanding history), then measure how well each feature ranks
// comeback maps above the others (AUC: 0.5 = no skill).
//
// Features (rates are shrunk toward the overall mean with a small prior):
//   leader_blown    share of the leader's past qualifying leads that were reversed
//   trailer_cb      share of the trailer's past qualifying deficits it reversed
//   strength_gap    trailer's past map win rate − leader's
//   involvement     both teams' past share of qualifying maps that ended in a comeback
//                   (either direction), summed
//   lead_size       rounds of lead at that moment (smaller = riskier)
//   round_no        total rounds played at that moment (earlier = riskier)
//
// Usage:
//   node analysis/predictability.js [--data data-backtest] [--teams-dir crawler/teams/backtest]
//     [--from 2026-01-01] [--to 2026-12-31] [--perms 2000]

const { REGIONS, loadRegion } = require('./betting');
const { MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const teamsDir = opt('--teams-dir', 'crawler/teams/backtest');
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const perms = Number(opt('--perms', 2000));

// ---- All partner matches once, oldest first ----
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { teamsDir }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

// First qualifying moment of a map: who led (1/2), lead size, round number, and the result.
function firstLead(rounds) {
  const states = rounds.map(s => s.split('-').map(Number));
  const [f1, f2] = states[states.length - 1];
  const winner = f1 > f2 ? 1 : 2;
  for (const [a, b] of states.slice(0, -1)) { // last state = final score, map over
    if (a + b >= MIN_TOTAL && Math.abs(a - b) >= MIN_DIFF) {
      const leader = a > b ? 1 : 2;
      return { leader, size: Math.abs(a - b), roundNo: a + b, reversed: leader !== winner, winner };
    }
  }
  return { leader: null, winner };
}

// ---- Expanding per-team history ----
const hist = new Map(); // team → { lead, blown, trail, cb, maps, wins }
const get = t => hist.get(t) || (hist.set(t, { lead: 0, blown: 0, trail: 0, cb: 0, maps: 0, wins: 0 }), hist.get(t));
const BASE = 0.08, PRIOR = 10; // shrink comeback rates toward 8% with 10 pseudo-maps
const shrink = (k, n, p = BASE, w = PRIOR) => (k + p * w) / (n + w);

const rows = [];
let i = 0;
while (i < matches.length) {
  const day = matches[i].day;
  const today = [];
  while (i < matches.length && matches[i].day === day) today.push(matches[i++]);
  // 1) features for today's maps from history before today
  if (day >= from && day <= to) {
    for (const m of today) {
      for (const mp of m.map_result) {
        if (!mp.rounds.length) continue;
        const f = firstLead(mp.rounds);
        if (!f.leader) continue;
        const L = get(f.leader === 1 ? m.t1 : m.t2), T = get(f.leader === 1 ? m.t2 : m.t1);
        rows.push({
          y: f.reversed ? 1 : 0,
          leader_blown: shrink(L.blown, L.lead),
          trailer_cb: shrink(T.cb, T.trail),
          strength_gap: shrink(T.wins, T.maps, 0.5) - shrink(L.wins, L.maps, 0.5),
          involvement: shrink(L.blown + L.cb, L.lead + L.trail) + shrink(T.blown + T.cb, T.lead + T.trail),
          lead_size: -f.size,
          round_no: -f.roundNo,
          leaderHist: L.lead, trailerHist: T.trail,
        });
      }
    }
  }
  // 2) update history with today's results
  for (const m of today) {
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const f = firstLead(mp.rounds);
      for (const side of [1, 2]) {
        const h = get(side === 1 ? m.t1 : m.t2);
        h.maps++;
        if (f.winner === side) h.wins++;
        if (!f.leader) continue;
        if (f.leader === side) { h.lead++; if (f.reversed) h.blown++; }
        else { h.trail++; if (f.reversed) h.cb++; }
      }
    }
  }
}

// ---- AUC (Mann-Whitney), bootstrap CI, permutation p ----
function auc(scores, ys) {
  const idx = scores.map((s, k) => k).sort((a, b) => scores[a] - scores[b]);
  let rank = 0, sumPos = 0, nPos = 0;
  for (let k = 0; k < idx.length;) {
    let j = k;
    while (j < idx.length && scores[idx[j]] === scores[idx[k]]) j++;
    const avg = (k + 1 + j) / 2; // average rank for ties
    for (let q = k; q < j; q++) if (ys[idx[q]]) { sumPos += avg; nPos++; }
    k = j;
  }
  const nNeg = ys.length - nPos;
  return (sumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}
const ys = rows.map(r => r.y);
const FEATURES = {
  leader_blown: 'Tỉ lệ bị lật của đội đang dẫn (lịch sử)',
  trailer_cb: 'Tỉ lệ lật được của đội bị dẫn (lịch sử)',
  strength_gap: 'Chênh lệch sức mạnh (đội bị dẫn − đội dẫn)',
  involvement: 'Mức độ dính lật kèo của cả hai đội (bị lật + lật được)',
  lead_size: 'Dẫn ít round hơn',
  round_no: 'Thời điểm sớm hơn (round nhỏ hơn)',
};
const pos = ys.reduce((s, y) => s + y, 0);
console.log(`Map ${from} → ${to} có tình huống dẫn ≥ ${MIN_DIFF} khi tổng round ≥ ${MIN_TOTAL}: ${rows.length}; bị lật: ${pos} (${(100 * pos / rows.length).toFixed(1)}%)\n`);

const out = [];
for (const [key, label] of Object.entries(FEATURES)) {
  const s = rows.map(r => r[key]);
  const a = auc(s, ys);
  const boots = [];
  for (let b = 0; b < 1000; b++) {
    const pick = rows.map(() => Math.floor(Math.random() * rows.length));
    boots.push(auc(pick.map(k => s[k]), pick.map(k => ys[k])));
  }
  boots.sort((x, y) => x - y);
  let ge = 0;
  const yy = ys.slice();
  for (let p = 0; p < perms; p++) {
    for (let j = yy.length - 1; j > 0; j--) { const x = Math.floor(Math.random() * (j + 1)); [yy[j], yy[x]] = [yy[x], yy[j]]; }
    if (auc(s, yy) >= a) ge++;
  }
  out.push({ 'chỉ số': label, AUC: a.toFixed(3), 'khoảng tin cậy 95%': `${boots[25].toFixed(3)} – ${boots[975].toFixed(3)}`, 'p (ngẫu nhiên ≥)': (ge / perms).toFixed(3) });
}
console.table(out);

// Comeback rate by quintile of each team-history feature.
const quint = key => {
  const sorted = rows.slice().sort((a, b) => a[key] - b[key]);
  const n = sorted.length;
  return [0, 1, 2, 3, 4].map(q => {
    const part = sorted.slice(Math.floor(q * n / 5), Math.floor((q + 1) * n / 5));
    return `${(100 * part.reduce((s, r) => s + r.y, 0) / part.length).toFixed(1)}%`;
  });
};
console.log('\nTỉ lệ lật kèo theo 5 nhóm của từng chỉ số (nhóm 1 = thấp nhất / an toàn nhất theo chỉ số, nhóm 5 = cao nhất):');
console.table(Object.fromEntries(Object.entries(FEATURES).map(([k, label]) => [label, Object.fromEntries(quint(k).map((v, q) => [`nhóm ${q + 1}`, v]))])));

// Exact lead states
console.log('Tỉ lệ lật kèo theo tỉ số lúc đủ điều kiện (round đã đánh · dẫn bao nhiêu):');
const states = {};
for (const r of rows) {
  const k = `round ${-r.round_no} · dẫn ${-r.lead_size}`;
  states[k] = states[k] || { maps: 0, cb: 0 };
  states[k].maps++; states[k].cb += r.y;
}
console.table(Object.entries(states).filter(([, v]) => v.maps >= 20).sort((a, b) => b[1].maps - a[1].maps)
  .map(([k, v]) => ({ 'tình huống': k, 'số map': v.maps, 'bị lật': v.cb, 'tỉ lệ': `${(100 * v.cb / v.maps).toFixed(1)}%`, 'tỉ lệ ăn hòa vốn': (1 / (1 - v.cb / v.maps)).toFixed(3) })));
