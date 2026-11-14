#!/usr/bin/env node
// Residual edges once the bookmaker prices score AND pre-match strength (Elo): what is
// left of momentum, series state, side switch and pistol; plus hand rules per season.
// Usage: node analysis/residual_edge.js
// Bookmaker = score + pre-match strength (Elo). What is left?

const { REGIONS, loadRegion } = require('./betting');
const M = 0.07;
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { allOpponents: true, teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));
const elo = new Map(); const R = t => elo.get(t) ?? 1500; const games = new Map();
const states = []; let id = 0;
for (const m of matches) {
  const ed = R(m.t1) - R(m.t2), g = Math.min(games.get(m.t1) || 0, games.get(m.t2) || 0);
  let w1 = 0, w2 = 0;
  m.map_result.forEach((mp, idx) => {
    if (!mp.rounds.length) return;
    const st = mp.rounds.map(s => s.split('-').map(Number)); const [f1, f2] = st[st.length - 1];
    if (f1 === f2 || Math.max(f1, f2) < 13) return; const y = f1 > f2 ? 1 : 0; const mid = id++;
    let streak = 0, h1 = 0, p13 = 0;
    for (let i = 1; i < st.length - 1; i++) { const [a, b] = st[i], [pa, pb] = st[i - 1]; const won = a > pa ? 1 : -1; streak = Math.sign(streak) === won ? streak + won : won; const t = a + b; if (t === 12) h1 = a - 6; if (t === 13) p13 = won;
      states.push({ id: mid, season: m.day.slice(0, 4), a, b, t, y, mom: won, streak: Math.max(-5, Math.min(5, streak)), h1: t >= 12 ? h1 : 0, p13: t >= 13 ? p13 : 0, elo: ed / 100, g, ser: w1 - w2, mapIdx: idx }); }
    const e1 = 1 / (1 + 10 ** ((R(m.t2) - R(m.t1)) / 400)); elo.set(m.t1, R(m.t1) + 24 * (y - e1)); elo.set(m.t2, R(m.t2) - 24 * (y - e1)); if (y) w1++; else w2++;
  });
  games.set(m.t1, (games.get(m.t1) || 0) + 1); games.set(m.t2, (games.get(m.t2) || 0) + 1);
}
const logit = p => Math.log(p / (1 - p)), sig = z => 1 / (1 + Math.exp(-z));
function base(rows) { const c = new Map(); for (const s of rows) for (const [k, yy] of [[`${s.a}-${s.b}`, s.y], [`${s.b}-${s.a}`, 1 - s.y]]) { const x = c.get(k) || c.set(k, { n: 0, w: 0 }).get(k); x.n++; x.w += yy; } return (a, b) => { const x = c.get(`${a}-${b}`); return x && x.n >= 30 ? (x.w + 1) / (x.n + 2) : null; }; }
function fit(rows, feats) { const w = new Array(feats.length).fill(0); for (let it = 0; it < 400; it++) { const gr = new Array(w.length).fill(0); for (const r of rows) { let z = logit(r.pb); feats.forEach((f, i) => { z += w[i] * r[f]; }); const e = sig(z) - r.y; feats.forEach((f, i) => { gr[i] += e * r[f]; }); } for (let i = 0; i < w.length; i++) w[i] -= 0.5 * gr[i] / rows.length; } return w; }
const pred = (w, feats, r) => { let z = logit(r.pb); feats.forEach((f, i) => { z += w[i] * r[f]; }); return sig(z); };
const pct = x => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;

// Bookie model: score baseline + elo (fit on all data, as a bookie with full history would)
const pAll = base(states); for (const s of states) s.pb = pAll(s.a, s.b);
const usable = states.filter(s => s.pb !== null && s.g >= 10);
const wB = fit(usable, ['elo']); console.log(`Nhà cái = tỉ số + Elo: hệ số Elo/100 = ${wB[0].toFixed(3)} (≈ ${pct(sig(logit(0.5) + wB[0]) - 0.5)} điểm ở tỉ số hòa cho mỗi 100 Elo)\n`);
for (const s of usable) s.pq = pred(wB, ['elo'], s);
function excess(rows, keyFn, label) {
  const groups = new Map(); for (const s of rows) { const k = keyFn(s); if (k === null || k === undefined) continue; (groups.get(k) || groups.set(k, []).get(k)).push(s); }
  const out = [];
  for (const [k, list] of [...groups.entries()].sort((x, y) => (typeof x[0] === 'number' ? x[0] - y[0] : String(x[0]).localeCompare(String(y[0]))))) {
    const ex = list.reduce((s, r) => s + r.y - r.pq, 0) / list.length;
    const byMap = new Map(); for (const r of list) (byMap.get(r.id) || byMap.set(r.id, []).get(r.id)).push(r); const cl = [...byMap.values()]; const bs = [];
    for (let i = 0; i < 200; i++) { let sum = 0, n = 0; for (let j = 0; j < cl.length; j++) { const c = cl[Math.floor(Math.random() * cl.length)]; for (const r of c) { sum += r.y - r.pq; n++; } } bs.push(sum / n); }
    bs.sort((x, y) => x - y); out.push({ [label]: k, 'tình huống': list.length, 'thực − nhà cái (điểm %)': pct(ex), 'khoảng 90%': `${pct(bs[10])} … ${pct(bs[189])}` });
  }
  console.table(out);
}
const second = usable.filter(s => s.t >= 13 && s.t <= 24);
console.log('[1] Chuỗi round liên tiếp (sau khi nhà cái đã tính sức mạnh):'); excess(usable, s => s.streak, 'chuỗi');
console.log('[2] Dẫn series trước map:'); excess(usable, s => s.ser, 'series A−B');
console.log('[3] Hiệp 1 của A (−6), xét hiệp 2:'); excess(second, s => Math.max(-4, Math.min(4, s.h1)), 'hiệp 1 − 6');
console.log('[4] Pistol round 13, xét hiệp 2:'); excess(second, s => s.p13, 'pistol 13');
console.log('[5] Chuỗi ≥3 theo vùng tỉ số (A đang thắng ≥3 round liên tiếp):');
excess(usable.filter(s => s.streak >= 3), s => (s.a - s.b <= -3 ? 'A bị dẫn ≥3' : s.a - s.b < 0 ? 'A bị dẫn 1–2' : s.a === s.b ? 'hòa' : s.a - s.b <= 2 ? 'A dẫn 1–2' : 'A dẫn ≥3'), 'vùng');

// Betting vs score+Elo bookie, residual model trained per season
const FE = ['mom', 'streak', 'ser', 'h1', 'p13', 'mapIdx'];
for (const [tr, te] of [['2025', '2026'], ['2026', '2025']]) {
  const T = usable.filter(s => s.season === tr).map(s => ({ ...s, pb: s.pq })), E = usable.filter(s => s.season === te).map(s => ({ ...s, pb: s.pq }));
  const w = fit(T, FE);
  console.log(`\n[6] Học ${tr} → cược ${te}; hệ số: ` + FE.map((f, i) => `${f} ${w[i].toFixed(3)}`).join(', '));
  for (const thr of [0, 0.02, 0.04]) {
    const seen = new Set(); let n = 0, pnl = 0; const band = {};
    for (const r of E) for (const side of [1, -1]) {
      const q0 = side > 0 ? r.pq : 1 - r.pq, pm = side > 0 ? pred(w, FE, r) : 1 - pred(w, FE, r), y = side > 0 ? r.y : 1 - r.y; const q = q0 * (1 + M); if (q >= 1 || pm - q <= thr) continue;
      const key = `${r.id}:${side}`; if (seen.has(key)) continue; seen.add(key);
      n++; const g = y ? 1 / q - 1 : -1; pnl += g; const o = 1 / q, bk = o < 1.25 ? '1.00–1.25' : o < 1.6 ? '1.25–1.60' : o < 2.2 ? '1.60–2.20' : '≥2.20'; const x = (band[bk] = band[bk] || { n: 0, pnl: 0 }); x.n++; x.pnl += g;
    }
    console.log(`  ngưỡng > ${100 * thr} điểm: ${n} kèo, ROI ${n ? (100 * pnl / n).toFixed(1) : '—'}%  ` + Object.entries(band).map(([k, x]) => `${k}: ${x.n} kèo ${(100 * x.pnl / x.n).toFixed(1)}%`).join(' · '));
  }
}

console.log('\n[7] Quy tắc tay so với nhà cái tỉ số+Elo, phí 7%, mỗi map 1 kèo/bên tại tình huống đầu tiên thỏa:');
const RULES = {
  'A bị dẫn ≥3, vừa thắng 3+ round liên tiếp': r => r.b - r.a >= 3 && r.streak >= 3,
  'A bị dẫn ≥2, vừa thắng 3+ round liên tiếp': r => r.b - r.a >= 2 && r.streak >= 3,
  'A hòa hoặc bị dẫn, vừa thắng 4+ round': r => r.b - r.a >= 0 && r.streak >= 4,
  'A thua hiệp 1 ≤ 2-10, cược đầu hiệp 2': r => r.h1 <= -4 && r.t === 13,
  'A thua hiệp 1 ≤ 3-9, cược đầu hiệp 2': r => r.h1 <= -3 && r.t === 13,
  'A thua hiệp 1 ≤ 2-10, bất kỳ lúc nào hiệp 2': r => r.h1 <= -4 && r.t >= 13 && r.t <= 24,
  'Đối chứng: A thắng hiệp 1 ≥ 10-2, đầu hiệp 2': r => r.h1 >= 4 && r.t === 13,
};
const rows = [];
for (const [name, f] of Object.entries(RULES)) {
  const row = { 'quy tắc': name };
  for (const season of ['2025', '2026']) {
    const seen = new Set(); let n = 0, w = 0, pnl = 0, sq = 0;
    for (const r of usable.filter(s => s.season === season)) for (const side of [1, -1]) {
      const v = { a: side > 0 ? r.a : r.b, b: side > 0 ? r.b : r.a, t: r.t, streak: side * r.streak, h1: side * r.h1 };
      if (!f(v)) continue; const q = (side > 0 ? r.pq : 1 - r.pq) * (1 + M); if (q >= 1) continue;
      const key = `${r.id}:${side}`; if (seen.has(key)) continue; seen.add(key);
      const y = side > 0 ? r.y : 1 - r.y; n++; w += y; sq += q; pnl += y ? 1 / q - 1 : -1;
    }
    row[season] = n ? `${n} kèo · thắng ${(100 * w / n).toFixed(1)}% vs nhà cái ${(100 * sq / n).toFixed(1)}% · ROI ${(100 * pnl / n).toFixed(1)}%` : '—';
  }
  rows.push(row);
}
console.table(rows);
