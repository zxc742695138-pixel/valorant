#!/usr/bin/env node
// Bet-by-bet profit and loss over time for the rolling blacklist strategy
// (same rules as backtest_rolling.js), in money.
//
// Usage:
//   node analysis/pnl.js --data data-history --marks 2026-07-15,...,2026-11-01
//     [--half-life 60] [--regions americas,china,pacific] [--stake 1000000] [--odds 1.1]
//     [--train-days 180] [--steps 5] [--csv out.csv]

const fs = require('fs');
const { REGIONS, loadRegion, blacklist, firstLeadOutcome } = require('./betting');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-history');
const marks = (opt('--marks') || '').split(',').filter(Boolean);
const halfLife = opt('--half-life') ? Number(opt('--half-life')) : null;
const active = opt('--regions') ? opt('--regions').split(',') : REGIONS;
const stake = Number(opt('--stake', 1e6));
const odds = Number(opt('--odds', 1.1));
const trainDays = Number(opt('--train-days', 180));
const steps = Number(opt('--steps', 5));
const csvOut = opt('--csv');
if (marks.length < 2) {
  console.error('Usage: node analysis/pnl.js --marks YYYY-MM-DD,YYYY-MM-DD,... [--half-life 60] [--regions a,b] [--stake 1000000]');
  process.exit(1);
}

const minusDays = (day, n) => new Date(Date.parse(day) - n * 864e5).toISOString().slice(0, 10);
const teamsDir = opt('--teams-dir', 'crawler/teams');
const regions = Object.fromEntries(active.map(r => [r, loadRegion(r, dataDir, { teamsDir })]));

// Every bet once (a match can sit in two regions), with the blacklists of its period.
const bets = new Map();
for (let i = 0; i < marks.length - 1; i++) {
  const [start, end] = [marks[i], marks[i + 1]];
  const lists = active.map(r => blacklist(regions[r].teams, regions[r].matches.filter(m => m.day >= minusDays(start, trainDays) && m.day < start), steps, { halfLife, asOf: start }));
  const excluded = new Set(lists.flatMap(s => [...s]));
  for (const r of active) {
    for (const m of regions[r].matches) {
      if (m.day < start || m.day >= end || excluded.has(m.t1) || excluded.has(m.t2)) continue;
      m.map_result.forEach((mp, k) => {
        if (!mp.rounds.length) return;
        const o = firstLeadOutcome(mp.rounds);
        if (o) bets.set(`${m.url}#${k}`, { date: m.date, match: `${m.t1} vs ${m.t2}`, map: mp.map, score: mp.score, won: o.won });
      });
    }
  }
}

const ledger = [...bets.values()].sort((a, b) => a.date.localeCompare(b.date));
let balance = 0, peak = 0, maxDD = 0, streak = 0, maxStreak = 0;
for (const b of ledger) {
  b.pnl = b.won ? stake * (odds - 1) : -stake;
  balance += b.pnl;
  b.balance = balance;
  peak = Math.max(peak, balance);
  maxDD = Math.max(maxDD, peak - balance);
  streak = b.won ? 0 : streak + 1;
  maxStreak = Math.max(maxStreak, streak);
}

const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(Math.round(x)).toLocaleString('vi-VN')}đ`;

// Monthly summary
const months = {};
for (const b of ledger) {
  const k = b.date.slice(0, 7);
  const m = (months[k] = months[k] || { bets: 0, losses: 0, pnl: 0, end: 0 });
  m.bets++;
  m.losses += !b.won;
  m.pnl += b.pnl;
  m.end = b.balance;
}
console.log(`${ledger.length} cược, mỗi cược ${money(stake).slice(1)}, tỉ lệ ăn ${odds}; khu vực: ${active.join(', ')}; ${halfLife ? `bán rã ${halfLife} ngày` : 'không trọng số'}\n`);
console.table(Object.entries(months).map(([k, m]) => ({
  'tháng': k, 'số cược': m.bets, 'thua': m.losses, 'lãi trong tháng': money(m.pnl), 'lũy kế cuối tháng': money(m.end),
})));

console.log('\nCác lần thua (mỗi lần −1 cược):');
for (const b of ledger.filter(b => !b.won)) {
  console.log(`  ${b.date.slice(0, 10)}  ${b.match} — ${b.map} ${b.score}  → lũy kế ${money(b.balance)}`);
}
const losses = ledger.filter(b => !b.won).length;
console.log(`\nTổng: ${ledger.length - losses} thắng / ${losses} thua, lãi ${money(balance)}`);
console.log(`Tổng tiền đã đặt: ${money(ledger.length * stake).slice(1)} → lợi nhuận ${(100 * balance / (ledger.length * stake)).toFixed(1)}% trên tổng tiền đặt`);
console.log(`Sụt giảm lớn nhất từ đỉnh: ${money(-maxDD)}; chuỗi thua dài nhất: ${maxStreak}`);

if (csvOut) {
  fs.writeFileSync(csvOut, 'date,match,map,score,result,pnl,balance\n'
    + ledger.map(b => [b.date, `"${b.match}"`, b.map, b.score, b.won ? 'win' : 'loss', b.pnl, b.balance].join(',')).join('\n') + '\n');
  console.log(`Saved ${csvOut}`);
}
