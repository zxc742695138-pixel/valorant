#!/usr/bin/env node
// Rule: bet on the leader only if the leader's group (see team_groups.js) is in
// --allow (default "Mạnh,Trung bình"); skip when the leader is "Yếu" or "Không ổn định".
//
// Walk-forward: each team's group is computed from matches strictly before the
// bet's day, over the last --window days (default 365) of history. For reference,
// --lookahead uses the groups of the whole test period instead (optimistic).
//
// Usage:
//   node analysis/group_rule.js [--data data-backtest] [--teams-dir crawler/teams/backtest]
//     [--from 2026-01-01] [--to 2026-12-31] [--window 365] [--net 2] [--volatile 6]
//     [--allow "Mạnh,Trung bình"] [--odds 1.1]

const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const teamsDir = opt('--teams-dir', 'crawler/teams/backtest');
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const windowDays = Number(opt('--window', 365));
const NET = Number(opt('--net', 2));
const VOLATILE = Number(opt('--volatile', 6));
const allow = new Set(opt('--allow', 'Mạnh,Trung bình').split(','));
const odds = Number(opt('--odds', 1.1));

const teamRegion = {};
for (const r of REGIONS) for (const t of require('../' + teamsDir + '/' + r + '.json')) teamRegion[t.name] = r;
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { teamsDir }).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

// Per map: first qualifying lead (bet) and comeback roles (made/blown) per team.
const events = []; // { day, team, made, blown }
const bets = [];
for (const m of matches) {
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const a = analyzeMap(mp.rounds);
    if (!a.leaders.size) continue;
    const states = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = states[states.length - 1];
    const first = states.find(([x, y]) => x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF);
    const leaderSide = first[0] > first[1] ? 1 : 2;
    const leader = leaderSide === 1 ? m.t1 : m.t2;
    if (m.day >= from && m.day <= to) {
      bets.push({ day: m.day, leader, region: teamRegion[leader], size: Math.abs(first[0] - first[1]),
        lost: leaderSide !== (f1 > f2 ? 1 : 2) });
    }
    for (const [t, side] of [[m.t1, 1], [m.t2, 2]]) {
      const other = side === 1 ? 2 : 1;
      events.push({ day: m.day, team: t, made: a.leaders.has(other) && a.blownBy === other ? 1 : 0, blown: a.blownBy === side ? 1 : 0 });
    }
  }
}

const groupOf = (made, blown) => {
  const net = made - blown;
  if (net >= NET) return 'Mạnh';
  if (net <= -NET) return 'Yếu';
  return made + blown >= VOLATILE ? 'Không ổn định' : 'Trung bình';
};
const groupAt = (team, day) => {
  const start = new Date(Date.parse(day) - windowDays * 864e5).toISOString().slice(0, 10);
  let made = 0, blown = 0;
  for (const e of events) if (e.team === team && e.day >= start && e.day < day) { made += e.made; blown += e.blown; }
  return groupOf(made, blown);
};
// Look-ahead groups: whole test period.
const look = {};
for (const e of events) if (e.day >= from && e.day <= to) {
  look[e.team] = look[e.team] || { made: 0, blown: 0 };
  look[e.team].made += e.made; look[e.team].blown += e.blown;
}
for (const b of bets) {
  b.group = groupAt(b.leader, b.day);
  b.lookGroup = look[b.leader] ? groupOf(look[b.leader].made, look[b.leader].blown) : 'Trung bình';
}

const sum = list => {
  const n = list.length, l = list.filter(b => b.lost).length;
  return { n, l, p: (n - l) * (odds - 1) - l };
};
const row = (label, s, base) => ({
  'quy tắc': label, 'số cược': s.n, 'thua': s.l, 'lật kèo': s.n ? `${(100 * s.l / s.n).toFixed(1)}%` : '—',
  'lãi (tr)': +s.p.toFixed(1), '%/cược': s.n ? `${(100 * s.p / s.n).toFixed(1)}%` : '—', 'giữ lại': `${Math.round(100 * s.n / base)}%`,
});

console.log(`Kèo ${from} → ${to}: ${bets.length}. Nhóm của đội dẫn tính từ ${windowDays} ngày trước trận (mạnh: chênh ≥ +${NET}, yếu: ≤ −${NET}, không ổn định: tổng ≥ ${VOLATILE}). Tỉ lệ ăn ${odds}.\n`);
const all = sum(bets);
console.table([
  row('Cược tất cả', all, all.n),
  row(`Thực tế: đội dẫn thuộc ${[...allow].join(' / ')}`, sum(bets.filter(b => allow.has(b.group))), all.n),
  row('Tham khảo (nhìn trước cả năm): cùng quy tắc', sum(bets.filter(b => allow.has(b.lookGroup))), all.n),
]);

console.log('Tỉ lệ lật kèo theo nhóm của đội dẫn (thực tế, không nhìn trước):');
console.table(['Mạnh', 'Trung bình', 'Không ổn định', 'Yếu'].map(g => row(g, sum(bets.filter(b => b.group === g)), all.n)));

console.log('Tách theo số round dẫn:');
const split = [];
for (const [label, cond] of [['dẫn 3', b => b.size === 3], ['dẫn ≥ 4', b => b.size >= 4]]) {
  const part = bets.filter(cond);
  split.push(row(`${label} · tất cả`, sum(part), part.length));
  split.push(row(`${label} · quy tắc`, sum(part.filter(b => allow.has(b.group))), part.length));
}
console.table(split);

console.log('Theo khu vực của đội dẫn (thực tế):');
console.table(REGIONS.map(r => {
  const part = bets.filter(b => b.region === r), kept = sum(part.filter(b => allow.has(b.group))), base = sum(part);
  return { 'khu vực': r, 'tất cả': `${base.n} · lật ${(100 * base.l / base.n).toFixed(1)}% · ${base.p.toFixed(1)}`, 'quy tắc': `${kept.n} · lật ${kept.n ? (100 * kept.l / kept.n).toFixed(1) : '—'}% · ${kept.p.toFixed(1)}` };
}));
