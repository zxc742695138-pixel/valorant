#!/usr/bin/env node
// "Season blacklist" rule: the blacklist starts empty at the start of the season;
// whenever a comeback map happens, BOTH teams of that map join the blacklist until
// the end of the season. Later matches skip every map involving a blacklisted team;
// the other qualifying maps are bet (1 unit on the team that first leads by
// >= MIN_DIFF at total rounds >= MIN_TOTAL). A new season resets the list.
//
// Usage:
//   node analysis/season_blacklist.js [--season 2026] [--regions pacific,americas,china]
//     [--data data-backtest] [--stake 1000000] [--who both|blown|made] [--side any|leader] [--expire N]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const season = opt('--season', '2026');
const dataDir = opt('--data', 'data-backtest');
const stake = Number(opt('--stake', 1e6));
const betRegions = (opt('--regions', 'pacific,americas,china')).split(',');
// --who both|blown|made: which team of a comeback map joins the list (default both).
const who = opt('--who', 'both');
// --expire N: a team leaves the list N days after it was added (default: end of season).
const expireDays = opt('--expire') ? Number(opt('--expire')) : null;
// --side any|leader: skip maps where a listed team plays (any, default) or only where a
// listed team is the one leading, i.e. the side we would bet on (leader).
const side = opt('--side', 'any');

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir).matches) if (m.day.startsWith(season)) byUrl.set(m.url, m);
const matches = [...byUrl.values()].filter(m => teamRegion[m.t1] && teamRegion[m.t2]).sort((a, b) => a.date.localeCompare(b.date));

function firstLead(rounds) {
  const states = rounds.map(s => s.split('-').map(Number));
  const [f1, f2] = states[states.length - 1];
  for (const [a, b] of states.slice(0, -1)) { // last state = final score, map over
    if (a + b >= MIN_TOTAL && Math.abs(a - b) >= MIN_DIFF) {
      const leader = a > b ? 1 : 2;
      return { lost: leader !== (f1 > f2 ? 1 : 2), size: Math.abs(a - b), leader };
    }
  }
  return null;
}

// Walk the season in order; the blacklist only changes after a match is played.
const blacklist = new Map(); // team → date added
const bets = [];
for (const m of matches) {
  const inScope = betRegions.includes(teamRegion[m.t1]) && betRegions.includes(teamRegion[m.t2]);
  const listed = t => blacklist.has(t) && (!expireDays || (Date.parse(m.day) - Date.parse(blacklist.get(t))) / 864e5 < expireDays);
  const blocked = listed(m.t1) || listed(m.t2);
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const f = firstLead(mp.rounds);
    if (f && inScope) bets.push({ day: m.day, match: `${m.t1} vs ${m.t2}`, map: mp.map, score: mp.score, ...f, leaderTeam: f.leader === 1 ? m.t1 : m.t2,
      skip: side === 'leader' ? listed(f.leader === 1 ? m.t1 : m.t2) : blocked });
  }
  for (const mp of m.map_result) {
    const a = mp.rounds.length ? analyzeMap(mp.rounds) : null;
    if (a && a.blownBy) {
      const blown = a.blownBy === 1 ? m.t1 : m.t2, made = a.blownBy === 1 ? m.t2 : m.t1;
      const add = who === 'blown' ? [blown] : who === 'made' ? [made] : [blown, made];
      // With --expire, a new comeback restarts the team's clock.
      for (const t of add) if (expireDays || !blacklist.has(t)) blacklist.set(t, m.day);
    }
  }
}

const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${(Math.abs(x) / 1e6).toFixed(1)} tr`;
function run(filter, odds) {
  let bal = 0, peak = 0, dd = 0, n = 0, l = 0;
  const months = {};
  for (const b of bets) {
    if (!filter(b)) continue;
    n++; l += b.lost;
    const p = b.lost ? -stake : stake * (odds - 1);
    bal += p; peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal);
    const mo = b.day.slice(0, 7);
    const x = (months[mo] = months[mo] || { n: 0, l: 0, end: 0 });
    x.n++; x.l += b.lost; x.end = bal;
  }
  return { n, l, bal, dd, months };
}

const STRATS = [
  ['Mọi kèo · không lọc', b => true, 1.10],
  ['Mọi kèo · blacklist mùa', b => !b.skip, 1.10],
  ...[1.10, 1.12, 1.15].flatMap(o => [
    [`Dẫn đúng 3 · không lọc · ăn ${o}`, b => b.size === 3, o],
    [`Dẫn đúng 3 · blacklist mùa · ăn ${o}`, b => b.size === 3 && !b.skip, o],
  ]),
];
console.log(`Mùa ${season}; cược trận giữa đội ${betRegions.join(', ')}; vào blacklist: ${who}; bỏ khi đội trong list ${side === 'leader' ? 'đang dẫn' : 'có mặt'}; ${expireDays ? `hết hạn sau ${expireDays} ngày` : 'tới hết mùa'}; mỗi cược ${(stake / 1e6).toFixed(1)} tr\n`);
console.table(STRATS.map(([name, f, o]) => {
  const r = run(f, o);
  return { 'cách cược': name, 'số cược': r.n, 'thua': r.l, 'lật kèo': r.n ? `${(100 * r.l / r.n).toFixed(1)}%` : '—', 'lãi': money(r.bal), 'sụt giảm lớn nhất': money(-r.dd) };
}));

console.log('Theo tháng (dẫn đúng 3, ăn 1.12): số kèo · thua · lũy kế — có blacklist mùa so với không lọc');
const a = run(b => b.size === 3 && !b.skip, 1.12), z = run(b => b.size === 3, 1.12);
console.table(Object.keys(z.months).map(mo => ({
  'tháng': mo,
  'blacklist mùa': a.months[mo] ? `${a.months[mo].n} · ${a.months[mo].l} · ${money(a.months[mo].end)}` : '0 kèo',
  'không lọc': `${z.months[mo].n} · ${z.months[mo].l} · ${money(z.months[mo].end)}`,
})));

const inList = [...blacklist.entries()].filter(([t]) => betRegions.includes(teamRegion[t]));
console.log(`Blacklist cuối mùa (${inList.length}/${Object.values(teamRegion).filter(r => betRegions.includes(r)).length} đội của các khu vực cược):`);
for (const r of betRegions) {
  const out = Object.keys(teamRegion).filter(t => teamRegion[t] === r && !blacklist.has(t));
  console.log(`  ${r}: còn được cược cả mùa: ${out.join(', ') || 'không đội nào'}`);
}
const byMonth = {};
for (const [, d] of inList) byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + 1;
console.log('  Số đội vào blacklist theo tháng:', Object.entries(byMonth).map(([k, v]) => `${k}: ${v}`).join(', '));
