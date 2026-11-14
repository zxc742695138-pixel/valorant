#!/usr/bin/env node
// Economy edge: does information visible during the buy phase (each team's buy for the
// coming round, what kind of round was just lost, bank, side) move the real map-win
// probability away from a bookmaker that already prices score + strength + momentum?
//
// Data: data-econ/<match id>.json (crawler/crawl_economy.js) joined with data-backtest.
// Bookmaker model: logit P(A wins) = logit(P_hist(score)) + b1·Elo + b2·lastRound + b3·streak,
// fitted on all states. Excess = actual − model, by economy bucket (cluster bootstrap by map).
// Then hand rules per season at bookmaker odds 1/(p·1.07), one bet per map per side.
//
// Usage: node analysis/econ_edge.js [--econ data-econ] [--margin 0.07]

const fs = require('fs');
const path = require('path');
const { REGIONS, loadRegion } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const econDir = opt('--econ', 'data-econ');
const M = Number(opt('--margin', 0.07));
const idOf = url => (url.match(/vlr\.gg\/(\d+)\//) || [])[1];

// matches (all crawled, for Elo and the score baseline) + economy files
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { allOpponents: true, teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));
const elo = new Map(); const R = t => elo.get(t) ?? 1500; const games = new Map();
const scoreCount = new Map(); // score baseline from every map
const states = []; let mapId = 0, joined = 0, mismatched = 0;
for (const m of matches) {
  const ed = R(m.t1) - R(m.t2), g = Math.min(games.get(m.t1) || 0, games.get(m.t2) || 0);
  const ef = path.join(econDir, `${idOf(m.url)}.json`);
  const econ = fs.existsSync(ef) ? JSON.parse(fs.readFileSync(ef, 'utf8')) : null;
  const played = m.map_result.filter(mp => mp.rounds.length);
  played.forEach((mp, idx) => {
    const st = mp.rounds.map(s => s.split('-').map(Number)); const [f1, f2] = st[st.length - 1];
    if (f1 === f2 || Math.max(f1, f2) < 13) return;
    const y = f1 > f2 ? 1 : 0;
    for (const [a, b] of st.slice(1, -1)) for (const [k, yy] of [[`${a}-${b}`, y], [`${b}-${a}`, 1 - y]]) { const x = scoreCount.get(k) || scoreCount.set(k, { n: 0, w: 0 }).get(k); x.n++; x.w += yy; }
    // economy rows for this map: match by map name, else by order
    let er = null;
    if (econ && econ.maps.length) {
      const cand = econ.maps.filter(e => e.map && mp.map && e.map.toLowerCase() === mp.map.toLowerCase());
      er = (cand.length === 1 ? cand[0] : econ.maps[idx]) || null;
      if (er) {
        // consistency: winners must reproduce the score progression
        // the economy tab lists the 24 regulation rounds only (no overtime)
        let c1 = 0, c2 = 0, ok = er.rounds.length === Math.min(24, st.length - 1);
        if (ok) for (let i = 0; i < er.rounds.length; i++) { if (er.rounds[i].win === 1) c1++; else c2++; if (st[i + 1][0] !== c1 || st[i + 1][1] !== c2) { ok = false; break; } }
        if (!ok) { mismatched++; er = null; } else joined++;
      }
    }
    const id = mapId++;
    let streak = 0;
    for (let i = 1; i < st.length - 1; i++) {
      const [a, b] = st[i], [pa] = st[i - 1];
      const won = a > pa ? 1 : -1; streak = Math.sign(streak) === won ? streak + won : won;
      const row = { id, day: m.day, match: `${m.t1} vs ${m.t2}`, event: m.event, season: m.day.slice(0, 4), map: mp.map, a, b, t: a + b, y, mom: won, streak: Math.max(-5, Math.min(5, streak)), elo: ed / 100, g, econ: null };
      if (er && er.rounds[i]) {
        const prev = er.rounds[i - 1], next = er.rounds[i]; // prev = round i (just played), next = round i+1 (buy phase now)
        row.econ = { prevBuy: prev.buy, nextBuy: next.buy, nextLoad: next.load, bank: next.bank, side1: next.side1, prevWin: prev.win, prevLoad: prev.load };
      }
      states.push(row);
    }
    const e1 = 1 / (1 + 10 ** ((R(m.t2) - R(m.t1)) / 400)); elo.set(m.t1, R(m.t1) + 24 * (y - e1)); elo.set(m.t2, R(m.t2) - 24 * (y - e1));
  });
  games.set(m.t1, (games.get(m.t1) || 0) + 1); games.set(m.t2, (games.get(m.t2) || 0) + 1);
}
const pHist = (a, b) => { const x = scoreCount.get(`${a}-${b}`); return x && x.n >= 30 ? (x.w + 1) / (x.n + 2) : null; };
for (const s of states) s.pb = pHist(s.a, s.b);
const all = states.filter(s => s.pb !== null && s.g >= 10);
const logit = p => Math.log(p / (1 - p)), sig = z => 1 / (1 + Math.exp(-z));
const FE = ['elo', 'mom', 'streak'];
const w = (() => { const w = new Array(FE.length).fill(0); for (let it = 0; it < 400; it++) { const gr = new Array(w.length).fill(0); for (const r of all) { let z = logit(r.pb); FE.forEach((f, i) => { z += w[i] * r[f]; }); const e = sig(z) - r.y; FE.forEach((f, i) => { gr[i] += e * r[f]; }); } for (let i = 0; i < w.length; i++) w[i] -= 0.5 * gr[i] / all.length; } return w; })();
for (const s of all) { let z = logit(s.pb); FE.forEach((f, i) => { z += w[i] * s[f]; }); s.pq = sig(z); }
const E = all.filter(s => s.econ);
console.log(`${mapId} map có round; ${joined} map khớp dữ liệu kinh tế (${mismatched} map lệch, bỏ); ${E.length} tình huống có kinh tế`);
console.log(`Nhà cái mô phỏng = tỉ số + Elo (${w[0].toFixed(3)}/100) + round vừa rồi (${w[1].toFixed(3)}) + chuỗi (${w[2].toFixed(3)})\n`);
const pct = x => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;

// side-symmetric view: each state from both teams' perspective
const sides = E.flatMap(s => [1, -1].map(sg => {
  const e = s.econ, me = sg > 0 ? 0 : 1, op = 1 - me;
  return { id: s.id, day: s.day, match: s.match, event: s.event, season: s.season, map: s.map, team: sg > 0 ? s.match.split(' vs ')[0] : s.match.split(' vs ')[1], a: sg > 0 ? s.a : s.b, b: sg > 0 ? s.b : s.a, t: s.t, y: sg > 0 ? s.y : 1 - s.y, pq: sg > 0 ? s.pq : 1 - s.pq,
    mom: sg * s.mom, streak: sg * s.streak,
    myNext: e.nextBuy[me], opNext: e.nextBuy[op], myPrev: e.prevBuy[me], opPrev: e.prevBuy[op], wonPrev: e.prevWin === (sg > 0 ? 1 : 2),
    loadDiff: (e.nextLoad[me] ?? 0) - (e.nextLoad[op] ?? 0), bankDiff: (e.bank[me] ?? 0) - (e.bank[op] ?? 0),
    side: e.side1 ? (sg > 0 ? e.side1 : e.side1 === 't' ? 'ct' : 't') : null };
}));
function excess(rows, keyFn, label, minN = 200) {
  const g = new Map(); for (const r of rows) { const k = keyFn(r); if (k === null || k === undefined) continue; (g.get(k) || g.set(k, []).get(k)).push(r); }
  const out = [];
  for (const [k, list] of [...g.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) {
    if (list.length < minN) continue;
    const ex = list.reduce((s, r) => s + r.y - r.pq, 0) / list.length;
    const byMap = new Map(); for (const r of list) (byMap.get(r.id) || byMap.set(r.id, []).get(r.id)).push(r); const cl = [...byMap.values()]; const bs = [];
    for (let i = 0; i < 200; i++) { let sum = 0, n = 0; for (let j = 0; j < cl.length; j++) { const c = cl[Math.floor(Math.random() * cl.length)]; for (const r of c) { sum += r.y - r.pq; n++; } } bs.push(sum / n); }
    bs.sort((x, y) => x - y);
    out.push({ [label]: k, 'tình huống': list.length, 'map': cl.length, 'P nhà cái TB': `${(100 * list.reduce((s, r) => s + r.pq, 0) / list.length).toFixed(1)}%`, 'thực − nhà cái (điểm %)': pct(ex), 'khoảng 90%': `${pct(bs[10])} … ${pct(bs[189])}` });
  }
  console.table(out);
}
const B = b => ({ pistol: 'pistol', eco: 'eco', half: 'half', full: 'full' })[b] || '?';
console.log('[1] Round TỚI (đang buy phase): mình mua gì vs đối thủ mua gì');
excess(sides.filter(r => r.myNext && r.opNext && r.myNext !== 'pistol'), r => `mình ${B(r.myNext)} / đối ${B(r.opNext)}`, 'buy round tới');
console.log('[2] Round VỪA RỒI mình thua: thua khi mình mua gì (đối thủ full)');
excess(sides.filter(r => !r.wonPrev && r.opPrev === 'full' && r.myPrev), r => `thua ván ${B(r.myPrev)}`, 'ván vừa thua');
console.log('[3] Tình huống của bạn: vừa thua ván eco/half (đối full), round tới mình full buy');
excess(sides.filter(r => !r.wonPrev && r.opPrev === 'full' && r.myNext === 'full'), r => `vừa thua ván ${B(r.myPrev)} → full; đối round tới ${B(r.opNext)}`, 'vừa thua → round tới');
console.log('[4] Chuỗi thua 2+ round: các ván thua đó là tiết kiệm hay full?');
excess(sides.filter(r => r.streak <= -2), r => (r.myPrev === 'full' ? 'thua chuỗi, ván cuối full buy' : 'thua chuỗi, ván cuối eco/half'), 'chuỗi thua');
console.log('[5] Chênh tiền ngân hàng (mình − đối, nghìn $) trước round tới');
excess(sides.filter(r => r.t >= 3), r => (r.bankDiff <= -6 ? 'a. ≤ −6k' : r.bankDiff < -2 ? 'b. −6…−2k' : r.bankDiff <= 2 ? 'c. −2…+2k' : r.bankDiff < 6 ? 'd. +2…+6k' : 'e. ≥ +6k'), 'bank');
console.log('[6] Bên round tới (tấn công / phòng thủ) theo bản đồ');
excess(sides.filter(r => r.side), r => `${r.map} ${r.side === 't' ? 'tấn công' : 'phòng thủ'}`, 'map/bên', 300);

console.log('[6b] Xếp chồng: round tới mình full / đối eco, cộng thêm điều kiện');
const CT_MAPS = new Set(['Fracture', 'Ascent', 'Bind', 'Pearl', 'Icebox', 'Haven']);
excess(sides.filter(r => r.myNext === 'full' && r.opNext === 'eco'), r => [r.side === 'ct' && CT_MAPS.has(r.map) ? 'phòng thủ ở map thiên CT' : 'khác bên/map', !r.wonPrev && r.myPrev === 'eco' ? '+ vừa thua ván eco' : '', r.streak >= 2 ? '+ đang thắng 2+' : ''].filter(Boolean).join(' '), 'điều kiện thêm', 150);
// hand rules per season
console.log('\n[7] Quy tắc tay vs nhà cái (tỉ số+Elo+đà), phí 7%, mỗi map 1 kèo/bên:');
const RULES = {
  'Round tới: mình full, đối eco': r => r.myNext === 'full' && r.opNext === 'eco',
  'Round tới: mình full, đối eco/half': r => r.myNext === 'full' && (r.opNext === 'eco' || r.opNext === 'half'),
  'Vừa thua ván eco (đối full), round tới mình full': r => !r.wonPrev && r.myPrev === 'eco' && r.opPrev === 'full' && r.myNext === 'full',
  '… và đối thủ round tới KHÔNG full': r => !r.wonPrev && r.myPrev === 'eco' && r.opPrev === 'full' && r.myNext === 'full' && r.opNext !== 'full',
  'Thua chuỗi ≥2, ván cuối eco/half, round tới full': r => r.streak <= -2 && r.myPrev !== 'full' && r.myNext === 'full',
  'Bank hơn đối ≥ 6k, tỉ số sát (≤2)': r => r.bankDiff >= 6 && Math.abs(r.a - r.b) <= 2,
  'Đối chứng: round tới mình eco, đối full (cược mình)': r => r.myNext === 'eco' && r.opNext === 'full',
};
const rows = [];
for (const [name, f] of Object.entries(RULES)) {
  const row = { 'quy tắc': name };
  for (const season of ['2025', '2026']) {
    const seen = new Set(); let n = 0, wn = 0, pnl = 0, sq = 0;
    for (const r of sides.filter(s => s.season === season)) {
      if (!f(r)) continue; const q = r.pq * (1 + M); if (q >= 1) continue;
      const key = `${r.id}:${r.a > r.b ? 'lead' : r.a < r.b ? 'trail' : 'tie'}:${r.y}`; // one bet per map per side
      const k2 = `${r.id}:${r.y}`; if (seen.has(k2)) continue; seen.add(k2);
      n++; wn += r.y; sq += q; pnl += r.y ? 1 / q - 1 : -1;
    }
    row[season] = n ? `${n} kèo · thắng ${(100 * wn / n).toFixed(1)}% vs nhà cái ${(100 * sq / n).toFixed(1)}% · ROI ${(100 * pnl / n).toFixed(1)}%` : '—';
  }
  rows.push(row);
}
console.table(rows);

// --ledger [season]: the chosen rule as a betting ledger — month by month, odds bands, drawdown.
if (argv.includes('--ledger')) {
  const season = opt('--ledger', '2026');
  const stake = Number(opt('--stake', 1e6));
  // --max-odds X: ignore bets priced above X (extreme scores where the simulated price is unrealistic)
  const maxOdds = Number(opt('--max-odds', 99));
  const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${(Math.abs(x) / 1e6).toFixed(1)} tr`;
  const CT = new Set(['Fracture', 'Ascent', 'Bind', 'Pearl', 'Icebox', 'Haven']);
  const VARIANTS = {
    'Mình full, đối eco, không chuỗi thắng 2+': r => r.myNext === 'full' && r.opNext === 'eco' && r.streak < 2,
    '… + phòng thủ ở map thiên CT': r => r.myNext === 'full' && r.opNext === 'eco' && r.streak < 2 && r.side === 'ct' && CT.has(r.map),
    '… + vừa thua ván eco': r => r.myNext === 'full' && r.opNext === 'eco' && r.streak < 2 && !r.wonPrev && r.myPrev === 'eco',
    '… + chỉ khi ăn ≥ 1.5': r => r.myNext === 'full' && r.opNext === 'eco' && r.streak < 2 && r.pq * (1 + M) <= 1 / 1.5,
  };
  console.log(`\n[8] Sổ cược mùa ${season}, trận giữa đội nhượng quyền, mỗi kèo ${(stake / 1e6).toFixed(1)} tr, giá = 1/(P nhà cái × ${1 + M})${maxOdds < 99 ? `, chỉ kèo ăn ≤ ${maxOdds}` : ''}, mỗi map 1 kèo/bên`);
  const summary = [];
  let mainBets = null;
  for (const [name, f] of Object.entries(VARIANTS)) {
    const seen = new Set(); const bets = [];
    for (const r of sides.filter(x => x.season === season).sort((x, y) => x.day.localeCompare(y.day) || x.id - y.id || x.t - y.t)) {
      if (!f(r)) continue; const q = r.pq * (1 + M); if (q >= 1 || 1 / q > maxOdds) continue;
      const key = `${r.id}:${r.team}`; if (seen.has(key)) continue; seen.add(key);
      bets.push({ day: r.day, match: r.match, team: r.team, map: r.map, score: `${r.a}-${r.b}`, odds: 1 / q, y: r.y, pnl: r.y ? stake * (1 / q - 1) : -stake });
    }
    let bal = 0, peak = 0, dd = 0; for (const b of bets) { bal += b.pnl; peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal); }
    summary.push({ 'cách cược': name, 'kèo': bets.length, 'thắng': `${(100 * bets.filter(b => b.y).length / Math.max(1, bets.length)).toFixed(1)}%`, 'ăn TB': (bets.reduce((s, b) => s + b.odds, 0) / Math.max(1, bets.length)).toFixed(2), 'lãi': money(bal), 'ROI': `${(100 * bal / Math.max(1, bets.length * stake)).toFixed(1)}%`, 'sụt giảm lớn nhất': money(-dd) });
    if (!mainBets) mainBets = bets;
  }
  console.table(summary);
  const months = {}; let bal = 0;
  for (const b of mainBets) { const mo = b.day.slice(0, 7); const x = (months[mo] = months[mo] || { n: 0, w: 0, pnl: 0 }); x.n++; x.w += b.y; x.pnl += b.pnl; bal += b.pnl; x.end = bal; }
  console.log('Theo tháng (cách đầu tiên):');
  console.table(Object.entries(months).map(([mo, x]) => ({ 'tháng': mo, 'kèo': x.n, 'thắng': x.w, 'lãi tháng': money(x.pnl), 'lũy kế': money(x.end) })));
  const bands = [[1, 1.3], [1.3, 1.6], [1.6, 2], [2, 3], [3, 99]];
  console.log('Theo khoảng giá (cách đầu tiên):');
  console.table(bands.map(([lo, hi]) => { const l = mainBets.filter(b => b.odds >= lo && b.odds < hi); if (!l.length) return null; return { 'ăn': `${lo}–${hi}`, 'kèo': l.length, 'thắng': `${(100 * l.filter(b => b.y).length / l.length).toFixed(1)}%`, 'nhà cái ngụ ý': `${(100 * l.reduce((s, b) => s + 1 / b.odds, 0) / l.length).toFixed(1)}%`, 'lãi': money(l.reduce((s, b) => s + b.pnl, 0)) }; }).filter(Boolean));
}
