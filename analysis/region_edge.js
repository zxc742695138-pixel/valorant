#!/usr/bin/env node
// Region-specific edges from score data only (what a bot can read from a live score feed):
// score state, streaks, pistol rounds, half-time result, overtime, series state, team
// strength (Elo) and map. Bookmaker = historical P(score) + Elo + last round + streak.
// For every region (both teams from the region; otherwise "intl") and situation we report
// actual − bookmaker per season with a cluster bootstrap by map, then hand rules as bets.
//
// Usage: node analysis/region_edge.js [--margin 0.07] [--max-odds 3] [--rules]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const M = Number(opt('--margin', 0.07)), MAX_ODDS = Number(opt('--max-odds', 3));
const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/backtest/${r}.json`, 'utf8'))) teamRegion[t.name] = r;
const NAME = { americas: 'Americas', emea: 'EMEA', china: 'China', pacific: 'Pacific', intl: 'Quốc tế' };

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { allOpponents: true, teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));
const elo = new Map(); const R = t => elo.get(t) ?? 1500; const games = new Map();
const states = []; let mapId = 0;
for (const m of matches) {
  const ed = R(m.t1) - R(m.t2), g = Math.min(games.get(m.t1) || 0, games.get(m.t2) || 0);
  const region = teamRegion[m.t1] && teamRegion[m.t2] ? (teamRegion[m.t1] === teamRegion[m.t2] ? teamRegion[m.t1] : 'intl') : null;
  let w1 = 0, w2 = 0;
  m.map_result.filter(mp => mp.rounds.length).forEach((mp, idx) => {
    const st = mp.rounds.map(s => s.split('-').map(Number)); const [f1, f2] = st[st.length - 1];
    if (f1 === f2 || Math.max(f1, f2) < 13) return;
    const y = f1 > f2 ? 1 : 0, id = mapId++;
    let streak = 0, p1 = 0, p13 = 0, h1 = 0, maxLead1 = 0, maxLead2 = 0;
    for (let i = 1; i < st.length - 1; i++) {
      const [a, b] = st[i], [pa] = st[i - 1];
      const won = a > pa ? 1 : -1; streak = Math.sign(streak) === won ? streak + won : won;
      const t = a + b;
      if (t === 1) p1 = won; if (t === 13) p13 = won; if (t === 12) h1 = a - 6;
      maxLead1 = Math.max(maxLead1, a - b); maxLead2 = Math.max(maxLead2, b - a);
      states.push({ id, region, season: m.day.slice(0, 4), day: m.day, map: mp.map, a, b, t, y, mom: won, streak: Math.max(-5, Math.min(5, streak)),
        p1, p13: t >= 13 ? p13 : 0, h1: t >= 12 ? h1 : 0, elo: ed / 100, g, ser: w1 - w2, mapIdx: idx, maxLead1, maxLead2, team1: m.t1, team2: m.t2 });
    }
    const e1 = 1 / (1 + 10 ** ((R(m.t2) - R(m.t1)) / 400)); elo.set(m.t1, R(m.t1) + 24 * (y - e1)); elo.set(m.t2, R(m.t2) - 24 * (y - e1));
    if (y) w1++; else w2++;
  });
  games.set(m.t1, (games.get(m.t1) || 0) + 1); games.set(m.t2, (games.get(m.t2) || 0) + 1);
}
// bookmaker
const c = new Map();
for (const s of states) for (const [k, yy] of [[`${s.a}-${s.b}`, s.y], [`${s.b}-${s.a}`, 1 - s.y]]) { const x = c.get(k) || c.set(k, { n: 0, w: 0 }).get(k); x.n++; x.w += yy; }
const pHist = (a, b) => { const x = c.get(`${a}-${b}`); return x && x.n >= 30 ? (x.w + 1) / (x.n + 2) : null; };
for (const s of states) s.pb = pHist(s.a, s.b);
const all = states.filter(s => s.pb !== null && s.g >= 10 && s.region);
const logit = p => Math.log(p / (1 - p)), sig = z => 1 / (1 + Math.exp(-z));
// Strength matters more early in a map: Elo enters both as a constant and scaled by rounds left.
for (const s of all) s.eloT = s.elo * Math.max(0, 24 - s.t) / 24;
const FE = ['elo', 'eloT', 'mom', 'streak'];
const w = (() => { const w = new Array(FE.length).fill(0); for (let it = 0; it < 400; it++) { const gr = new Array(w.length).fill(0); for (const r of all) { let z = logit(r.pb); FE.forEach((f, i) => { z += w[i] * r[f]; }); const e = sig(z) - r.y; FE.forEach((f, i) => { gr[i] += e * r[f]; }); } for (let i = 0; i < w.length; i++) w[i] -= 0.5 * gr[i] / all.length; } return w; })();
for (const s of all) { let z = logit(s.pb); FE.forEach((f, i) => { z += w[i] * s[f]; }); s.pq = sig(z); }
console.log(`${mapId} map, ${all.length} tình huống có khu vực; nhà cái = tỉ số + Elo (${w[0].toFixed(3)}/100 + ${w[1].toFixed(3)} × phần round còn lại) + round vừa rồi (${w[2].toFixed(3)}) + chuỗi (${w[3].toFixed(3)})`);
const pct = x => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`;

// both perspectives
const sides = all.flatMap(s => [1, -1].map(sg => ({ ...s, sg, eloT: sg * s.eloT, team: sg > 0 ? s.team1 : s.team2, a: sg > 0 ? s.a : s.b, b: sg > 0 ? s.b : s.a, y: sg > 0 ? s.y : 1 - s.y, pq: sg > 0 ? s.pq : 1 - s.pq,
  mom: sg * s.mom, streak: sg * s.streak, p1: sg * s.p1, p13: sg * s.p13, h1: sg * s.h1, elo: sg * s.elo, ser: sg * s.ser, myMax: sg > 0 ? s.maxLead1 : s.maxLead2, opMax: sg > 0 ? s.maxLead2 : s.maxLead1 })));

const SIT = {
  'Dẫn ≥3 khi tổng ≥17 (đội dẫn)': r => r.t >= 17 && r.a - r.b >= 3,
  'Dẫn đúng 3 khi tổng ≥17, vừa thắng round': r => r.t >= 17 && r.a - r.b === 3 && r.mom > 0,
  'Bị dẫn ≥3, vừa thắng 3+ round liền': r => r.b - r.a >= 3 && r.streak >= 3,
  'Đang thua 3+ round liền (bất kỳ tỉ số)': r => r.streak <= -3,
  'Thắng pistol hiệp 2 (round 13), xét round 14–16': r => r.p13 > 0 && r.t >= 13 && r.t <= 15,
  'Dẫn 2-0 sau pistol+bonus (round 2 xong)': r => r.t === 2 && r.a === 2,
  'Thắng cả pistol hiệp 2 lẫn round 14 (round 14 xong)': r => r.t === 14 && r.p13 > 0 && r.mom > 0 && r.streak >= 2,
  'Bị dẫn 0-2 sau pistol+bonus (cược đội đang thua)': r => r.t === 2 && r.b === 2,
  'Thua hiệp 1 ≤ 4-8, xét hiệp 2': r => r.h1 <= -2 && r.t >= 13 && r.t <= 24,
  'Thắng hiệp 1 ≥ 8-4, xét hiệp 2': r => r.h1 >= 2 && r.t >= 13 && r.t <= 24,
  'Hiệp phụ (từ 12-12), mình là đội từng dẫn ≥3 trước đó': r => r.t >= 24 && r.a === r.b && r.myMax >= 3 && r.opMax < 3,
  'Hiệp phụ, mình là đội từng bị dẫn ≥3 (đã gỡ)': r => r.t >= 24 && r.a === r.b && r.opMax >= 3 && r.myMax < 3,
  'Mạnh hơn ≥100 Elo, tỉ số sát (≤2)': r => r.elo >= 1 && Math.abs(r.a - r.b) <= 2,
  'Yếu hơn ≥100 Elo nhưng đang dẫn ≥2': r => r.elo <= -1 && r.a - r.b >= 2,
  'Map 2, đang thua series 0-1, tỉ số sát': r => r.mapIdx === 1 && r.ser === -1 && Math.abs(r.a - r.b) <= 2,
};
function cell(list) {
  const byMap = new Map(); for (const r of list) (byMap.get(r.id) || byMap.set(r.id, []).get(r.id)).push(r); const cl = [...byMap.values()];
  if (cl.length < 40) return `(${cl.length})`;
  const ex = list.reduce((s, r) => s + r.y - r.pq, 0) / list.length; const bs = [];
  for (let i = 0; i < 100; i++) { let sum = 0, n = 0; for (let j = 0; j < cl.length; j++) { const cc = cl[Math.floor(Math.random() * cl.length)]; for (const r of cc) { sum += r.y - r.pq; n++; } } bs.push(sum / n); }
  bs.sort((x, y) => x - y); const sig = bs[5] > 0 || bs[94] < 0;
  return `${sig ? '★ ' : ''}${pct(ex)} [${pct(bs[5])}…${pct(bs[94])}] n=${cl.length}`;
}
const REG = ['americas', 'emea', 'china', 'pacific', 'intl'];
for (const [name, f] of Object.entries(SIT)) {
  const hit = sides.filter(f);
  console.log(`\n=== ${name} — thật − nhà cái (điểm %) [khoảng 90%] n = map; ★ = khoảng không chạm 0`);
  console.table(REG.map(rg => { const row = { 'khu vực': NAME[rg] }; for (const se of ['2025', '2026']) row[se] = cell(hit.filter(r => r.region === rg && r.season === se)); row['cả hai'] = cell(hit.filter(r => r.region === rg)); return row; }));
}

if (argv.includes('--rules')) {
  console.log(`\n[Cược] giá = 1/(P nhà cái × ${1 + M}), chỉ kèo ăn ≤ ${MAX_ODDS}, mỗi map 1 kèo/bên, 1 đơn vị/kèo — ROI theo khu vực và mùa`);
  for (const [name, f] of Object.entries(SIT)) {
    const row = { 'tình huống': name };
    for (const rg of REG) {
      const parts = [];
      for (const se of ['2025', '2026']) {
        const seen = new Set(); let n = 0, pnl = 0;
        for (const r of sides.filter(x => x.region === rg && x.season === se)) { if (!f(r)) continue; const q = r.pq * (1 + M); if (q >= 1 || 1 / q > MAX_ODDS) continue; const k = `${r.id}:${r.team}`; if (seen.has(k)) continue; seen.add(k); n++; pnl += r.y ? 1 / q - 1 : -1; }
        parts.push(n >= 30 ? `${se}: ${(100 * pnl / n).toFixed(0)}% (${n})` : `${se}: (${n})`);
      }
      row[NAME[rg]] = parts.join(' · ');
    }
    console.log(name); console.table([row]);
  }
}

// --book: the region rulebook as a ledger (1 tr per bet): per rule and combined, per season.
if (argv.includes('--book')) {
  const stake = Number(opt('--stake', 1e6));
  const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${(Math.abs(x) / 1e6).toFixed(1)} tr`;
  const BOOK = [
    ['R1 Americas: cược đội 0-2 sau round 2', r => r.region === 'americas' && r.t === 2 && r.b === 2],
    ['R1 Quốc tế: cược đội 0-2 sau round 2', r => r.region === 'intl' && r.t === 2 && r.b === 2],
    ['R1 EMEA: cược đội 0-2 sau round 2', r => r.region === 'emea' && r.t === 2 && r.b === 2],
    ['R2 EMEA: thua hiệp 1 ≤ 4-8, cược đầu hiệp 2', r => r.region === 'emea' && r.h1 <= -2 && r.t === 13],
  ];
  for (const season of ['2025', '2026']) {
    console.log(`\n[Sổ cược mùa ${season}] mỗi kèo ${(stake / 1e6).toFixed(1)} tr, giá = 1/(P nhà cái × ${1 + M}), kèo ăn ≤ ${MAX_ODDS}`);
    const allBets = [];
    const rows = [];
    for (const [name, f] of BOOK) {
      const seen = new Set(); const bets = [];
      for (const r of sides.filter(x => x.season === season).sort((x, y) => x.day.localeCompare(y.day) || x.id - y.id || x.t - y.t)) {
        if (!f(r)) continue; const q = r.pq * (1 + M); if (q >= 1 || 1 / q > MAX_ODDS) continue;
        const k = `${r.id}:${r.team}`; if (seen.has(k)) continue; seen.add(k);
        bets.push({ day: r.day, rule: name, odds: 1 / q, y: r.y, pnl: r.y ? stake * (1 / q - 1) : -stake });
      }
      allBets.push(...bets);
      const pnl = bets.reduce((s, b) => s + b.pnl, 0);
      rows.push({ 'quy tắc': name, 'kèo': bets.length, 'thắng': `${(100 * bets.filter(b => b.y).length / Math.max(1, bets.length)).toFixed(1)}%`, 'ăn TB': (bets.reduce((s, b) => s + b.odds, 0) / Math.max(1, bets.length)).toFixed(2), 'lãi': money(pnl), 'ROI': `${(100 * pnl / Math.max(1, bets.length * stake)).toFixed(1)}%` });
    }
    allBets.sort((a, b) => a.day.localeCompare(b.day));
    let bal = 0, peak = 0, dd = 0; const months = {};
    for (const b of allBets) { bal += b.pnl; peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal); const mo = b.day.slice(0, 7); const x = (months[mo] = months[mo] || { n: 0, pnl: 0 }); x.n++; x.pnl += b.pnl; x.end = bal; }
    rows.push({ 'quy tắc': 'TỔNG', 'kèo': allBets.length, 'thắng': `${(100 * allBets.filter(b => b.y).length / Math.max(1, allBets.length)).toFixed(1)}%`, 'ăn TB': (allBets.reduce((s, b) => s + b.odds, 0) / Math.max(1, allBets.length)).toFixed(2), 'lãi': money(bal), 'ROI': `${(100 * bal / Math.max(1, allBets.length * stake)).toFixed(1)}%`, 'sụt giảm lớn nhất': money(-dd) });
    console.table(rows);
    console.table(Object.entries(months).map(([mo, x]) => ({ 'tháng': mo, 'kèo': x.n, 'lãi tháng': money(x.pnl), 'lũy kế': money(x.end) })));
  }
}

// --why02: where the profit of the 0-2 rule comes from (history vs bookmaker model vs actual).
if (argv.includes('--why02')) {
  const hist = pHist(0, 2);
  console.log(`\nP lịch sử đội 0-2 thắng map (mọi trận, mọi khu vực): ${(100 * hist).toFixed(1)}% → giá công bằng ${(1 / hist).toFixed(2)}, sau phí 7%: ${(1 / (hist * 1.07)).toFixed(2)}`);
  const rows = [];
  for (const rg of REG) {
    const l = sides.filter(r => r.region === rg && r.t === 2 && r.b === 2);
    const byMap = new Set(l.map(r => r.id)).size;
    const act = l.reduce((s, r) => s + r.y, 0) / l.length, model = l.reduce((s, r) => s + r.pq, 0) / l.length;
    const q = model * 1.07;
    rows.push({ 'khu vực': NAME[rg], 'map 0-2': byMap, 'thắng thật': `${(100 * act).toFixed(1)}%`, 'lịch sử chung': `${(100 * hist).toFixed(1)}%`, 'mô hình nhà cái (có đà)': `${(100 * model).toFixed(1)}%`, 'giá sau phí': (1 / q).toFixed(2),
      'ROI nếu nhà cái dùng mô hình đà': `${(100 * (act / q - 1)).toFixed(1)}%`, 'ROI nếu nhà cái chỉ dùng lịch sử tỉ số': `${(100 * (act / (hist * 1.07) - 1)).toFixed(1)}%` });
  }
  console.table(rows);
}

// --why02b: bookmaker fitted ON 0-2 states only (intercept + Elo), i.e. a bookmaker that
// prices this exact state with full pre-match strength. What is left per region?
if (argv.includes('--why02b')) {
  const S = sides.filter(r => r.t === 2 && r.b === 2); // the 0-2 team
  let a0 = 0, b0 = 0;
  for (let it = 0; it < 2000; it++) { let ga = 0, gb = 0; for (const r of S) { const e = sig(a0 + b0 * r.elo) - r.y; ga += e; gb += e * r.elo; } a0 -= 0.5 * ga / S.length; b0 -= 0.5 * gb / S.length; }
  console.log(`\nMô hình riêng cho tỉ số 0-2: P(đội 0-2 thắng) = sigmoid(${a0.toFixed(3)} + ${b0.toFixed(3)} × Elo/100) — ${S.length} map`);
  const rows = [];
  for (const rg of REG) for (const se of ['2025', '2026', 'cả hai']) {
    const l = S.filter(r => r.region === rg && (se === 'cả hai' || r.season === se)); if (l.length < 40) continue;
    const act = l.reduce((s, r) => s + r.y, 0) / l.length, pm = l.reduce((s, r) => s + sig(a0 + b0 * r.elo), 0) / l.length;
    let pnl = 0, n = 0; for (const r of l) { const q = sig(a0 + b0 * r.elo) * (1 + M); if (q >= 1 || 1 / q > MAX_ODDS) continue; n++; pnl += r.y ? 1 / q - 1 : -1; }
    rows.push({ 'khu vực': NAME[rg], 'mùa': se, 'map': l.length, 'thắng thật': `${(100 * act).toFixed(1)}%`, 'mô hình': `${(100 * pm).toFixed(1)}%`, 'chênh': pct(act - pm), [`ROI (phí 7%, ăn ≤ ${MAX_ODDS})`]: n ? `${(100 * pnl / n).toFixed(1)}% (${n} kèo)` : '—' });
  }
  console.table(rows);
}

// --deep REGION: a wider situation scan for one region, per season.
if (opt('--deep')) {
  const rg = opt('--deep');
  const P = sides.filter(r => r.region === rg);
  const SIT2 = {
    'Thắng pistol hiệp 1 (xét round 2–4)': r => r.p1 > 0 && r.t >= 1 && r.t <= 3,
    'Thắng pistol hiệp 2 (xét round 14–16)': r => r.p13 > 0 && r.t >= 13 && r.t <= 15,
    'Dẫn hiệp 1 ≥ 7-5 (xét ngay sau hiệp 1, t=12)': r => r.t === 12 && r.a >= 7,
    'Dẫn hiệp 1 ≥ 8-4 (t=12)': r => r.t === 12 && r.a >= 8,
    'Dẫn 2 round, tổng 9–16 (giữa map)': r => r.t >= 9 && r.t <= 16 && r.a - r.b === 2,
    'Dẫn 3–4 round, tổng 9–16': r => r.t >= 9 && r.t <= 16 && r.a - r.b >= 3 && r.a - r.b <= 4,
    'Dẫn ≥5 round, tổng ≥ 12': r => r.t >= 12 && r.a - r.b >= 5,
    'Đang 11-x (còn 2 round là thắng), bị dẫn ≤3 trước đó': r => r.a === 11 && r.b <= 8,
    'Đang 12-x (match point), x ≤ 10': r => r.a === 12 && r.b <= 10,
    'Hiệp phụ, bất kỳ (từng dẫn ≥3 trước đó)': r => r.t >= 24 && r.a === r.b && r.myMax >= 3 && r.opMax < 3,
    'Mạnh hơn ≥150 Elo, đang bị dẫn 1–3': r => r.elo >= 1.5 && r.b - r.a >= 1 && r.b - r.a <= 3,
    'Mạnh hơn ≥150 Elo, tỉ số sát (≤1)': r => r.elo >= 1.5 && Math.abs(r.a - r.b) <= 1,
    'Yếu hơn ≥150 Elo, đang dẫn ≥3': r => r.elo <= -1.5 && r.a - r.b >= 3,
    'Chuỗi thắng 4+ round': r => r.streak >= 4,
    'Chuỗi thua 4+ round': r => r.streak <= -4,
    'Map 1 của series, tỉ số sát': r => r.mapIdx === 0 && Math.abs(r.a - r.b) <= 1 && r.t >= 6,
    'Map 3 (quyết định), đội thắng map 2, tỉ số sát': r => r.mapIdx === 2 && r.ser === 0 && Math.abs(r.a - r.b) <= 1 && r.t >= 6,
  };
  console.log(`\n===== Quét sâu ${NAME[rg]} — thật − nhà cái (điểm %) [90%] n = map`);
  console.table(Object.entries(SIT2).map(([name, f]) => { const hit = P.filter(f); const row = { 'tình huống': name }; for (const se of ['2025', '2026']) row[se] = cell(hit.filter(r => r.season === se)); row['cả hai'] = cell(hit); return row; }));
  // by map (leader perspective, lead 2–4 mid-map) and by event type
  const etype = e => /Kickoff/.test(e) ? 'Kickoff' : /Stage/.test(e) ? 'Stage' : 'Khác';
  console.log('Theo bản đồ — đội dẫn ≥3 khi tổng ≥17 (comeback theo map):');
  const maps = [...new Set(P.map(r => r.map))];
  console.table(maps.map(mp => { const hit = P.filter(r => r.map === mp && r.t >= 17 && r.a - r.b >= 3); const row = { 'map': mp }; for (const se of ['2025', '2026']) row[se] = cell(hit.filter(r => r.season === se)); row['cả hai'] = cell(hit); return row; }).filter(r => !r['cả hai'].startsWith('(')));
}
