#!/usr/bin/env node
// Edge search against a bookmaker that prices a live map purely from the current round
// score. Baseline = historical P(team wins map | score a-b). For every round state we ask
// which extra information (available at that moment) shifts the real win probability away
// from the baseline, and whether the shift beats the bookmaker's margin.
//
// Features per state, from the perspective of team A:
//   mom1    A won the last round (+1) or lost it (-1)
//   streak  signed length of the current run of rounds (A positive), clipped to ±5
//   h1      A's first-half rounds − 6 (side-switch proxy; 0 before half time)
//   p1/p13  A won the pistol round of the 1st / 2nd half (+1/-1; 0 if not played yet)
//   elo     (Elo A − Elo B)/100 before the match (map-level Elo, K=24)
//   ser     maps A leads by in the series before this map
//   mapIdx  map number in the series − 1
//
// Part 1: excess win rate (actual − baseline) per feature bucket, cluster bootstrap by map.
// Part 2: logistic model on the baseline logit + features, trained on one season and bet on
//         the other at bookmaker odds 1/(p_base·(1+margin)); ROI by odds band.
//
// Usage: node analysis/edge_search.js [--margin 0.07] [--train 2025 --test 2026] [--min-state 30]

const { REGIONS, loadRegion } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const MARGIN = Number(opt('--margin', 0.07));
const TRAIN = opt('--train', '2025'), TEST = opt('--test', '2026');
const MIN_STATE = Number(opt('--min-state', 30));
const allOpp = !argv.includes('--partners-only');

// ---- data ----
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { allOpponents: allOpp, teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

const elo = new Map();
const R = t => elo.get(t) ?? 1500;
const states = []; // one row per (map, round state)
let mapId = 0;
for (const m of matches) {
  const eloDiff = R(m.t1) - R(m.t2);
  let w1 = 0, w2 = 0;
  m.map_result.forEach((mp, idx) => {
    if (!mp.rounds.length) return;
    const st = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = st[st.length - 1];
    if (f1 === f2 || Math.max(f1, f2) < 13) return;
    const y = f1 > f2 ? 1 : 0;
    const id = mapId++;
    const season = m.day.slice(0, 4);
    let streak = 0, p1 = 0, p13 = 0, h1 = 0;
    for (let i = 1; i < st.length - 1; i++) { // st[0] = 0-0, last = final (map over)
      const [a, b] = st[i], [pa, pb] = st[i - 1];
      const won = a > pa ? 1 : b > pb ? -1 : 0;
      if (!won) continue;
      streak = Math.sign(streak) === won ? streak + won : won;
      const t = a + b;
      if (t === 1) p1 = won;
      if (t === 13) p13 = won;
      if (t === 12) h1 = a - 6;
      states.push({ id, season, map: mp.map, a, b, t, y, mom1: won, streak: Math.max(-5, Math.min(5, streak)),
        h1: t >= 12 ? h1 : 0, p1, p13: t >= 13 ? p13 : 0, elo: eloDiff / 100, ser: w1 - w2, mapIdx: idx });
    }
    // Elo update per map
    const e1 = 1 / (1 + 10 ** ((R(m.t2) - R(m.t1)) / 400));
    elo.set(m.t1, R(m.t1) + 24 * (y - e1)); elo.set(m.t2, R(m.t2) - 24 * (y - e1));
    if (y) w1++; else w2++;
  });
}
console.log(`${mapId} map, ${states.length} tình huống tỉ số; mùa: ${[...new Set(states.map(s => s.season))].join(', ')}; ${allOpp ? 'mọi trận đã crawl' : 'chỉ trận giữa đội nhượng quyền'}\n`);

// ---- baseline P(A wins | a-b), symmetric, from a given set of rows ----
function baseline(rows) {
  const c = new Map();
  for (const s of rows) {
    const k = `${s.a}-${s.b}`, kr = `${s.b}-${s.a}`;
    const x = c.get(k) || c.set(k, { n: 0, w: 0 }).get(k); x.n++; x.w += s.y;
    const z = c.get(kr) || c.set(kr, { n: 0, w: 0 }).get(kr); z.n++; z.w += 1 - s.y;
  }
  return (a, b) => { const x = c.get(`${a}-${b}`); return x && x.n >= MIN_STATE ? (x.w + 1) / (x.n + 2) : null; };
}
const pAll = baseline(states);
for (const s of states) s.pb = pAll(s.a, s.b);
const usable = states.filter(s => s.pb !== null);
const pct = x => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;

// ---- Part 0: the bookmaker's table ----
console.log('Xác suất lịch sử đội dẫn thắng map theo tỉ số (đây là thứ nhà cái định giá), và tỉ lệ ăn sau phí 7%:');
const tbl = [];
for (const [a, b] of [[7, 5], [8, 4], [9, 7], [10, 7], [11, 8], [12, 9], [10, 6], [11, 6], [12, 10], [11, 11], [12, 12], [9, 9], [6, 6]]) {
  const p = pAll(a, b); if (p === null) continue;
  tbl.push({ 'tỉ số': `${a}-${b}`, 'P(đội dẫn thắng)': `${(100 * p).toFixed(1)}%`, 'ăn công bằng': (1 / p).toFixed(3), [`ăn sau phí ${100 * MARGIN}%`]: (1 / (p * (1 + MARGIN))).toFixed(3), 'cần P thật ≥': `${(100 * Math.min(1, p * (1 + MARGIN))).toFixed(1)}%` });
}
console.table(tbl);

// ---- Part 1: excess by feature bucket, cluster bootstrap by map ----
function excess(rows, keyFn, label) {
  const groups = new Map();
  for (const s of rows) { const k = keyFn(s); if (k === null || k === undefined) continue; (groups.get(k) || groups.set(k, []).get(k)).push(s); }
  const out = [];
  for (const [k, list] of [...groups.entries()].sort((x, y) => (typeof x[0] === 'number' ? x[0] - y[0] : String(x[0]).localeCompare(String(y[0]))))) {
    const ex = list.reduce((s, r) => s + r.y - r.pb, 0) / list.length;
    // cluster bootstrap by map id
    const byMap = new Map();
    for (const r of list) (byMap.get(r.id) || byMap.set(r.id, []).get(r.id)).push(r);
    const clusters = [...byMap.values()];
    const bs = [];
    for (let i = 0; i < 200; i++) {
      let sum = 0, n = 0;
      for (let j = 0; j < clusters.length; j++) { const c = clusters[Math.floor(Math.random() * clusters.length)]; for (const r of c) { sum += r.y - r.pb; n++; } }
      bs.push(sum / n);
    }
    bs.sort((x, y) => x - y);
    out.push({ [label]: k, 'tình huống': list.length, 'map': clusters.length, 'thắng thực − lịch sử (điểm %)': pct(ex), 'khoảng 90%': `${pct(bs[10])} … ${pct(bs[189])}` });
  }
  console.table(out);
}
const second = usable.filter(s => s.t >= 13 && s.t <= 24);
console.log('\n[1] Đà (round vừa rồi ai thắng), mọi tỉ số:');
excess(usable, s => (s.mom1 > 0 ? 'A vừa thắng round' : 'A vừa thua round'), 'đà');
console.log('[1b] Đà theo chuỗi round liên tiếp (dương = A đang thắng liên tiếp):');
excess(usable, s => s.streak, 'chuỗi');
console.log('[2] Hiệp 1 của A (số round hơn/kém 6) — chỉ xét hiệp 2, sau khi đổi bên:');
excess(second, s => Math.max(-4, Math.min(4, s.h1)), 'hiệp 1 − 6');
console.log('[3] Pistol hiệp 2 (round 13), xét hiệp 2:');
excess(second, s => (s.p13 > 0 ? 'A thắng pistol 13' : s.p13 < 0 ? 'A thua pistol 13' : null), 'pistol');
console.log('[4] Chênh Elo trước trận (A − B), theo khoảng 100 điểm:');
excess(usable, s => Math.max(-3, Math.min(3, Math.round(s.elo))), 'Elo/100');
console.log('[5] Thế trận series trước map này (A đang dẫn series):');
excess(usable, s => s.ser, 'series A−B');
console.log('[6] Map thứ mấy trong series:');
excess(usable, s => s.mapIdx + 1, 'map #');
console.log('[7] Theo bản đồ (mọi tỉ số, góc nhìn đội đang dẫn):');
excess(usable.filter(s => s.a !== s.b).map(s => (s.a > s.b ? s : { ...s, y: 1 - s.y, pb: 1 - s.pb })), s => s.map, 'map');

// ---- Part 2: logistic model with baseline offset, train one season, bet the other ----
const FEATS = ['mom1', 'streak', 'h1', 'p13', 'elo', 'ser', 'mapIdx'];
const logit = p => Math.log(p / (1 - p)), sig = z => 1 / (1 + Math.exp(-z));
function fit(rows) {
  const w = new Array(FEATS.length + 1).fill(0); // + intercept
  for (let it = 0; it < 300; it++) {
    const g = new Array(w.length).fill(0);
    for (const r of rows) {
      let z = logit(r.pb) + w[0];
      FEATS.forEach((f, i) => { z += w[i + 1] * r[f]; });
      const e = sig(z) - r.y;
      g[0] += e; FEATS.forEach((f, i) => { g[i + 1] += e * r[f]; });
    }
    for (let i = 0; i < w.length; i++) w[i] -= 0.5 * g[i] / rows.length;
  }
  return w;
}
const predict = (w, r) => { let z = logit(r.pb) + w[0]; FEATS.forEach((f, i) => { z += w[i + 1] * r[f]; }); return sig(z); };

for (const [tr, te] of [[TRAIN, TEST], [TEST, TRAIN]]) {
  const trainRows = usable.filter(s => s.season === tr), testRows = usable.filter(s => s.season === te);
  if (!trainRows.length || !testRows.length) continue;
  // baseline from the training season only (the bookmaker also only knows the past)
  const pTr = baseline(trainRows);
  const tRows = trainRows.map(s => ({ ...s, pb: pTr(s.a, s.b) })).filter(s => s.pb !== null);
  const eRows = testRows.map(s => ({ ...s, pb: pTr(s.a, s.b) })).filter(s => s.pb !== null);
  const w = fit(tRows);
  console.log(`\n[8] Mô hình học trên mùa ${tr}, kiểm tra trên mùa ${te} (hệ số logit): ` + FEATS.map((f, i) => `${f} ${w[i + 1].toFixed(3)}`).join(', '));
  const ll = (rows, f) => -rows.reduce((s, r) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, f(r))); return s + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / rows.length;
  console.log(`  log-loss: chỉ tỉ số ${ll(eRows, r => r.pb).toFixed(4)} → có thêm đặc trưng ${ll(eRows, r => predict(w, r)).toFixed(4)}`);
  // Betting: both sides considered; bookmaker odds from p_base with margin; one bet per map per side at first qualifying state.
  for (const thr of [0, 0.02, 0.04]) {
    const betted = new Set();
    const bets = [];
    for (const r of eRows) {
      for (const side of [1, -1]) {
        const pb = side > 0 ? r.pb : 1 - r.pb, pm = side > 0 ? predict(w, r) : 1 - predict(w, r), y = side > 0 ? r.y : 1 - r.y;
        const q = pb * (1 + MARGIN); if (q >= 1) continue;
        const key = `${r.id}:${side}`;
        if (pm - q > thr && !betted.has(key)) { betted.add(key); bets.push({ odds: 1 / q, y, pm, q, t: r.t }); }
      }
    }
    const band = o => (o < 1.25 ? '1.00–1.25' : o < 1.6 ? '1.25–1.60' : o < 2.2 ? '1.60–2.20' : '≥ 2.20');
    const rows = {};
    for (const b of bets) { const x = (rows[band(b.odds)] = rows[band(b.odds)] || { n: 0, w: 0, pnl: 0, pm: 0, q: 0 }); x.n++; x.w += b.y; x.pnl += b.y ? b.odds - 1 : -1; x.pm += b.pm; x.q += b.q; }
    const tot = bets.reduce((s, b) => ({ n: s.n + 1, pnl: s.pnl + (b.y ? b.odds - 1 : -1) }), { n: 0, pnl: 0 });
    console.log(`  Cược 1 đơn vị khi P(mô hình) − P(nhà cái) > ${(100 * thr).toFixed(0)} điểm %: ${tot.n} kèo, lãi ${tot.pnl >= 0 ? '+' : ''}${tot.pnl.toFixed(1)} đơn vị (ROI ${(100 * tot.pnl / Math.max(1, tot.n)).toFixed(1)}%)`);
    console.table(Object.entries(rows).map(([k, x]) => ({ 'tỉ lệ ăn': k, 'kèo': x.n, 'thắng': `${(100 * x.w / x.n).toFixed(1)}%`, 'P nhà cái TB': `${(100 * x.q / x.n).toFixed(1)}%`, 'P mô hình TB': `${(100 * x.pm / x.n).toFixed(1)}%`, 'lãi': `${x.pnl >= 0 ? '+' : ''}${x.pnl.toFixed(1)}`, 'ROI': `${(100 * x.pnl / x.n).toFixed(1)}%` })));
  }
}
