#!/usr/bin/env node
// Are comebacks concentrated on some teams more than chance would produce?
//
// Unit: each map with a qualifying lead; the bet side is the team that FIRST leads by
// >= MIN_DIFF at total >= MIN_TOTAL; y = 1 when that team loses (it gets reversed).
// Null model: y depends only on the size of that first lead (3, 4, 5+), not on the teams.
//
// Test 1 (concentration): simulate y under the null many times and compare the spread
//   of per-team "times reversed" (chi-square vs expected, top count) with the real one.
// Test 2 (prediction): team reversal rate in the first half of the season vs the second.
// Test 3 (memory): maps where the leading team was reversed recently vs not.
//
// Usage: node analysis/team_randomness.js [--season 2026] [--sims 20000] [--data data-backtest]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const season = opt('--season', '2026');
const sims = Number(opt('--sims', 20000));
const dataDir = opt('--data', 'data-backtest');
// --role leader|trailer|both: whose count is tested — the team reversed (leader), the team
// making the comeback (trailer), or every team playing the map (both).
const role = opt('--role', 'leader');
const teamsOf = r => (role === 'leader' ? [r.leader] : role === 'trailer' ? [r.trailer] : [r.leader, r.trailer]);

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir).matches) if (m.day.startsWith(season)) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

const rows = [];
for (const m of matches) {
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const st = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = st[st.length - 1];
    const first = st.slice(0, -1).find(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
    if (!first) continue;
    const lead1 = first[0] > first[1];
    const size = Math.abs(first[0] - first[1]);
    rows.push({ day: m.day, leader: lead1 ? m.t1 : m.t2, trailer: lead1 ? m.t2 : m.t1, size: size >= 5 ? '5+' : String(size), y: lead1 !== (f1 > f2) ? 1 : 0 });
  }
}

// Null probabilities by lead size.
const bySize = {};
for (const r of rows) { const b = (bySize[r.size] = bySize[r.size] || { n: 0, k: 0 }); b.n++; b.k += r.y; }
const p = r => bySize[r.size].k / bySize[r.size].n;
const teams = [...new Set(rows.flatMap(r => [r.leader, r.trailer]))];
const pct = x => `${(100 * x).toFixed(1)}%`;

console.log(`Mùa ${season}: ${rows.length} map có dẫn ≥ ${MIN_DIFF} (tổng ≥ ${MIN_TOTAL}), ${rows.reduce((s, r) => s + r.y, 0)} lần đội dẫn trước bị lật; ${teams.length} đội`);
console.log('Xác suất bị lật theo mức dẫn (mô hình "ngẫu nhiên"):', Object.entries(bySize).map(([k, b]) => `dẫn ${k}: ${b.k}/${b.n} = ${pct(b.k / b.n)}`).join(' · '));

// ---- Test 1: concentration ----
function stats(ys) {
  const obs = {}, exp = {};
  rows.forEach((r, i) => { for (const t of teamsOf(r)) { obs[t] = (obs[t] || 0) + ys[i]; exp[t] = (exp[t] || 0) + p(r); } });
  let chi = 0, top = 0, zeros = 0;
  for (const t of teams) { const o = obs[t] || 0; chi += (o - exp[t]) ** 2 / exp[t]; top = Math.max(top, o); if (!o) zeros++; }
  return { chi, top, zeros, obs, exp };
}
const real = stats(rows.map(r => r.y));
let geChi = 0, geTop = 0, geZero = 0;
const simChi = [];
for (let s = 0; s < sims; s++) {
  const st = stats(rows.map(r => (Math.random() < p(r) ? 1 : 0)));
  simChi.push(st.chi);
  if (st.chi >= real.chi) geChi++;
  if (st.top >= real.top) geTop++;
  if (st.zeros >= real.zeros) geZero++;
}
simChi.sort((a, b) => a - b);
console.log(`\n[1] Mức tập trung theo đội — ${role === 'leader' ? 'số lần bị lật khi đang dẫn' : role === 'trailer' ? 'số lần lật kèo được khi bị dẫn' : 'số map lật kèo có đội tham gia (cả hai phía)'}:`);
console.log(`  độ lệch thực tế (chi²) = ${real.chi.toFixed(1)}; nếu ngẫu nhiên thường ở ${simChi[Math.floor(sims * 0.05)].toFixed(1)}–${simChi[Math.floor(sims * 0.95)].toFixed(1)} → p = ${(geChi / sims).toFixed(3)}`);
console.log(`  đội bị lật nhiều nhất: ${real.top} lần → ngẫu nhiên đạt ≥ ${real.top} trong ${pct(geTop / sims)} số lần mô phỏng`);
console.log(`  số đội chưa từng bị lật: ${real.zeros} → ngẫu nhiên có ≥ ${real.zeros} đội như vậy trong ${pct(geZero / sims)} số lần`);
console.table(teams.map(t => ({ 'đội': t, 'bị lật': real.obs[t] || 0, 'kỳ vọng nếu ngẫu nhiên': +real.exp[t].toFixed(1), 'số map': rows.filter(r => teamsOf(r).includes(t)).length }))
  .sort((a, b) => b['bị lật'] - a['bị lật'] || a['kỳ vọng nếu ngẫu nhiên'] - b['kỳ vọng nếu ngẫu nhiên']).slice(0, 15));

// ---- Test 2: first half vs second half ----
const mid = `${season}-07-01`;
const half = list => { const o = {}; for (const r of list) for (const t of teamsOf(r)) { const x = (o[t] = o[t] || { n: 0, k: 0, e: 0 }); x.n++; x.k += r.y; x.e += p(r); } return o; };
const h1 = half(rows.filter(r => r.day < mid)), h2 = half(rows.filter(r => r.day >= mid));
const both = teams.filter(t => h1[t] && h2[t]);
const ex = (o, t) => (o[t].k - o[t].e) / o[t].n; // excess reversal rate vs expectation
const xs = both.map(t => ex(h1, t)), ys = both.map(t => ex(h2, t));
const corr = (a, b) => { const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length; let num = 0, da = 0, db = 0; a.forEach((v, i) => { num += (v - ma) * (b[i] - mb); da += (v - ma) ** 2; db += (b[i] - mb) ** 2; }); return num / Math.sqrt(da * db); };
const rObs = corr(xs, ys);
let geR = 0;
for (let s = 0; s < sims; s++) { const sh = [...ys].sort(() => Math.random() - 0.5); if (corr(xs, sh) >= rObs) geR++; }
const worst = both.sort((a, b) => ex(h1, b) - ex(h1, a));
const k = Math.round(both.length / 3);
const agg = (list, o) => { const n = list.reduce((s, t) => s + o[t].n, 0), kk = list.reduce((s, t) => s + o[t].k, 0); return `${kk}/${n} = ${pct(kk / n)}`; };
console.log(`\n[2] Nửa đầu (trước ${mid}) có dự đoán được nửa sau không? (${both.length} đội có map ở cả hai nửa)`);
console.log(`  tương quan "bị lật nhiều hơn kỳ vọng" giữa hai nửa: r = ${rObs.toFixed(2)}, p = ${(geR / sims).toFixed(3)}`);
console.log(`  ${k} đội bị lật nhiều nhất nửa đầu: nửa đầu ${agg(worst.slice(0, k), h1)} → nửa sau ${agg(worst.slice(0, k), h2)}`);
console.log(`  ${k} đội ít bị lật nhất nửa đầu: nửa đầu ${agg(worst.slice(-k), h1)} → nửa sau ${agg(worst.slice(-k), h2)}`);

// ---- Test 3: recent memory ----
console.log('\n[3] Map có đội (theo vai trò trên) vừa dính lật kèo gần đây có dễ lật tiếp không?');
for (const days of [30, 60, 90]) {
  const last = {};
  const yes = [], no = [];
  for (const r of rows) {
    const t = last[r.leader];
    ((t && (Date.parse(r.day) - Date.parse(t)) / 864e5 <= days && t < r.day) ? yes : no).push(r);
  }
  // update after each day: rebuild in order, recording the reversal date only after the map
  const yes2 = [], no2 = []; const lastRev = {};
  let i = 0;
  while (i < rows.length) {
    const day = rows[i].day, today = [];
    while (i < rows.length && rows[i].day === day) today.push(rows[i++]);
    for (const r of today) { const recent = teamsOf(r).some(x => lastRev[x] && (Date.parse(day) - Date.parse(lastRev[x])) / 864e5 <= days); (recent ? yes2 : no2).push(r); }
    for (const r of today) if (r.y) for (const x of teamsOf(r)) lastRev[x] = day;
  }
  const rt = l => `${l.reduce((s, r) => s + r.y, 0)}/${l.length} = ${pct(l.reduce((s, r) => s + r.y, 0) / l.length)} (kỳ vọng theo mức dẫn ${pct(l.reduce((s, r) => s + p(r), 0) / l.length)})`;
  console.log(`  bị lật trong ${days} ngày trước: ${rt(yes2)} · không: ${rt(no2)}`);
}
