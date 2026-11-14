#!/usr/bin/env node
// Analyse real live odds you logged in odds/log.csv: implied margin, calibration (implied
// probability vs actual map wins), and whether the bookmaker's price already contains
// strength (Elo) and momentum (last round) beyond the score. Needs result = 1 or 2 for
// calibration; rows without result still count for the margin check.
//
// CSV columns: date,event,team1,team2,map,score1,score2,last_round,odds1,odds2,bet_on,stake,result,note
//
// Usage: node analysis/odds_log.js [odds/log.csv]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { elo } = require('./elo');

const file = process.argv[2] || 'odds/log.csv';
const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
const head = lines[0].split(',');
const parse = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return Object.fromEntries(head.map((h, i) => [h, (out[i] || '').trim()])); };
const rows = lines.slice(1).map(parse).filter(r => r.odds1 && r.odds2 && !/ví dụ/.test(r.event)).map(r => ({ ...r, s1: +r.score1, s2: +r.score2, o1: +r.odds1, o2: +r.odds2, lr: +r.last_round, res: +r.result || 0 }));
if (!rows.length) { console.log('Chưa có dòng nào trong', file); process.exit(0); }

// Historical P(win | score) from our data (score-only bookmaker)
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, 'data-backtest', { allOpponents: true, teamsDir: 'crawler/teams/backtest' }).matches) byUrl.set(m.url, m);
const c = new Map();
for (const m of byUrl.values()) for (const mp of m.map_result) {
  if (!mp.rounds.length) continue; const st = mp.rounds.map(s => s.split('-').map(Number)); const [f1, f2] = st[st.length - 1]; if (f1 === f2) continue;
  for (const [a, b] of st.slice(1, -1)) for (const [k, y] of [[`${a}-${b}`, f1 > f2 ? 1 : 0], [`${b}-${a}`, f1 > f2 ? 0 : 1]]) { const x = c.get(k) || c.set(k, { n: 0, w: 0 }).get(k); x.n++; x.w += y; }
}
const pHist = (a, b) => { const x = c.get(`${a}-${b}`); return x && x.n >= 30 ? (x.w + 1) / (x.n + 2) : null; };
const R = t => elo.get(t) ?? null;
const pct = x => `${(100 * x).toFixed(1)}%`;

// 1. margin
const margins = rows.map(r => 1 / r.o1 + 1 / r.o2 - 1);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`${rows.length} dòng giá; phí trung bình (1/odds1 + 1/odds2 − 1) = ${pct(mean(margins))}, từ ${pct(Math.min(...margins))} đến ${pct(Math.max(...margins))}`);

// 2. does the price follow score only? compare implied p1 (margin removed proportionally) with historical P(score)
const impl = rows.map(r => { const q1 = 1 / r.o1, q2 = 1 / r.o2; const p1 = q1 / (q1 + q2); return { ...r, p1, ph: pHist(r.s1, r.s2), e: R(r.team1) !== null && R(r.team2) !== null ? (R(r.team1) - R(r.team2)) / 100 : null }; }).filter(r => r.ph !== null);
const diff = impl.map(r => r.p1 - r.ph);
console.log(`\nGiá nhà cái so với xác suất lịch sử theo tỉ số (đội 1): chênh trung bình ${pct(mean(diff))}, độ lệch chuẩn ${pct(Math.sqrt(mean(diff.map(d => (d - mean(diff)) ** 2))))}`);
console.log('  Nếu độ lệch chuẩn gần 0 → nhà cái chỉ nhìn tỉ số. Càng lớn → giá có thêm thông tin khác.');
const bucket = (list, key, label) => {
  const g = new Map(); for (const r of list) { const k = key(r); if (k === null) continue; (g.get(k) || g.set(k, []).get(k)).push(r); }
  console.table([...g.entries()].sort().map(([k, l]) => ({ [label]: k, 'dòng': l.length, 'giá − lịch sử (đội 1)': pct(mean(l.map(r => r.p1 - r.ph))), ...(l.some(r => r.res) ? { 'thắng thật (đội 1)': pct(mean(l.filter(r => r.res).map(r => (r.res === 1 ? 1 : 0)))), 'giá TB': pct(mean(l.filter(r => r.res).map(r => r.p1))) } : {}) })));
};
console.log('\nTheo đà (đội 1 vừa thắng round hay không) — nếu giá − lịch sử dương khi đội 1 vừa thắng round thì nhà cái có tính đà:');
bucket(impl.filter(r => r.lr === 1 || r.lr === 2), r => (r.lr === 1 ? 'đội 1 vừa thắng round' : 'đội 1 vừa thua round'), 'đà');
console.log('Theo chênh Elo (đội 1 − đội 2, /100) — nếu giá − lịch sử tăng theo Elo thì nhà cái có tính sức mạnh:');
bucket(impl.filter(r => r.e !== null), r => Math.max(-2, Math.min(2, Math.round(r.e))), 'Elo/100');

// 3. calibration on settled rows
const done = rows.filter(r => r.res === 1 || r.res === 2);
if (done.length) {
  console.log(`\nHiệu chỉnh trên ${done.length} dòng đã có kết quả: cược 1 đơn vị vào MỌI đội theo khoảng giá`);
  const sides = done.flatMap(r => [{ o: r.o1, y: r.res === 1 ? 1 : 0 }, { o: r.o2, y: r.res === 2 ? 1 : 0 }]);
  const bands = [[1, 1.15], [1.15, 1.35], [1.35, 1.7], [1.7, 2.3], [2.3, 4], [4, 99]];
  console.table(bands.map(([lo, hi]) => { const l = sides.filter(s => s.o >= lo && s.o < hi); if (!l.length) return null; const w = mean(l.map(s => s.y)); const pnl = l.reduce((s, x) => s + (x.y ? x.o - 1 : -1), 0); return { 'khoảng ăn': `${lo}–${hi}`, 'kèo': l.length, 'nhà cái ngụ ý': pct(mean(l.map(s => 1 / s.o))), 'thắng thật': pct(w), 'ROI nếu cược hết': `${(100 * pnl / l.length).toFixed(1)}%` }; }).filter(Boolean));
  console.log('  ROI dương ổn định ở một khoảng ăn = nhà cái định giá hụt ở khoảng đó.');
  const bets = done.filter(r => r.bet_on === '1' || r.bet_on === '2');
  if (bets.length) { const pnl = bets.reduce((s, r) => { const st = +r.stake || 1, o = r.bet_on === '1' ? r.o1 : r.o2; return s + (+r.bet_on === r.res ? st * (o - 1) : -st); }, 0); console.log(`\nKèo bạn đã cược thật: ${bets.length}, thắng ${bets.filter(r => +r.bet_on === r.res).length}, lãi ${pnl.toFixed(2)}`); }
} else console.log('\nChưa có dòng nào điền result, nên chưa đo được hiệu chỉnh. Điền 1 hoặc 2 vào cột result khi map kết thúc.');
