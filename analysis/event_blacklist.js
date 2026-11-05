#!/usr/bin/env node
// "Event blacklist" rule: every tournament (vlr.gg event, e.g. "VCT 2026: Pacific
// Kickoff", a Masters, an EWC qualifier) starts with an empty blacklist. Bet the team
// that first leads by >= MIN_DIFF at total rounds >= MIN_TOTAL on every map where
// neither team is blacklisted; when such a bet loses (the leader gets reversed),
// BOTH teams of that map are blacklisted until the end of that event, from the next
// map on. A new event starts empty again. Regions run in parallel (each event is
// separate).
//
// Usage:
//   node analysis/event_blacklist.js [--from 2026-01-01] [--to 2026-12-31]
//     [--regions pacific,americas,china] [--trigger loss|comeback] [--data data-backtest]

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const from = opt('--from', '2026-01-01');
const to = opt('--to', '2026-12-31');
const dataDir = opt('--data', 'data-backtest');
const stake = Number(opt('--stake', 1e6));
const betRegions = (opt('--regions', 'pacific,americas,china')).split(',');
// loss: only a lost bet blacklists (default); comeback: any comeback map in the event does.
const trigger = opt('--trigger', 'loss');

const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir).matches) if (m.day >= from && m.day <= to) byUrl.set(m.url, m);
const matches = [...byUrl.values()].filter(m => teamRegion[m.t1] && teamRegion[m.t2]).sort((a, b) => a.date.localeCompare(b.date));

function firstLead(rounds) {
  const states = rounds.map(s => s.split('-').map(Number));
  const [f1, f2] = states[states.length - 1];
  for (const [a, b] of states.slice(0, -1)) { // last state = final score, map over
    if (a + b >= MIN_TOTAL && Math.abs(a - b) >= MIN_DIFF) {
      const leader = a > b ? 1 : 2;
      return { lost: leader !== (f1 > f2 ? 1 : 2), size: Math.abs(a - b) };
    }
  }
  return null;
}

// Event blacklists, filled as the event goes on. `filter` decides which qualifying
// maps the strategy bets on (e.g. only 3-round leads); only those bets can lose.
function simulate(filter) {
  const lists = new Map(); // event → Set(team)
  const bets = [];
  for (const m of matches) {
    const inScope = betRegions.includes(teamRegion[m.t1]) && betRegions.includes(teamRegion[m.t2]);
    const list = lists.get(m.event) || lists.set(m.event, new Set()).get(m.event);
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const f = firstLead(mp.rounds);
      const blocked = list.has(m.t1) || list.has(m.t2);
      const bet = f && inScope && filter(f) && !blocked;
      if (bet) bets.push({ day: m.day, event: m.event, match: `${m.t1} vs ${m.t2}`, map: mp.map, score: mp.score, ...f });
      const hit = trigger === 'comeback' ? !!analyzeMap(mp.rounds).blownBy : bet && f.lost;
      if (hit) { list.add(m.t1); list.add(m.t2); }
    }
  }
  return bets;
}

const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${(Math.abs(x) / 1e6).toFixed(1)} tr`;
function summarize(bets, odds) {
  let bal = 0, peak = 0, dd = 0;
  const months = {};
  for (const b of bets) {
    bal += b.lost ? -stake : stake * (odds - 1);
    peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal);
    const mo = b.day.slice(0, 7);
    const x = (months[mo] = months[mo] || { n: 0, l: 0, end: 0 });
    x.n++; x.l += b.lost; x.end = bal;
  }
  return { n: bets.length, l: bets.filter(b => b.lost).length, bal, dd, months };
}

const all = b => true, lead3 = f => f.size === 3;
const plain = filter => matches.length && simulateNoList(filter);
function simulateNoList(filter) {
  const bets = [];
  for (const m of matches) {
    if (!(betRegions.includes(teamRegion[m.t1]) && betRegions.includes(teamRegion[m.t2]))) continue;
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const f = firstLead(mp.rounds);
      if (f && filter(f)) bets.push({ day: m.day, ...f });
    }
  }
  return bets;
}

const rows = [];
const add = (name, bets, odds) => {
  const s = summarize(bets, odds);
  rows.push({ 'cách cược': name, 'số cược': s.n, 'thua': s.l, 'lật kèo': s.n ? `${(100 * s.l / s.n).toFixed(1)}%` : '—', 'lãi': money(s.bal), 'sụt giảm lớn nhất': money(-s.dd) });
};
add('Mọi kèo · không lọc · ăn 1.10', plain(all), 1.10);
add('Mọi kèo · né theo giải · ăn 1.10', simulate(all), 1.10);
for (const o of [1.10, 1.12, 1.15]) {
  add(`Dẫn đúng 3 · không lọc · ăn ${o}`, plain(lead3), o);
  add(`Dẫn đúng 3 · né theo giải · ăn ${o}`, simulate(lead3), o);
}
console.log(`${from} → ${to}; trận giữa đội ${betRegions.join(', ')}; né khi: ${trigger === 'loss' ? 'thua kèo' : 'có map lật kèo'}; mỗi cược ${(stake / 1e6).toFixed(1)} tr\n`);
console.table(rows);

for (const [label, filter, odds] of [['dẫn đúng 3, ăn 1.12', lead3, 1.12], ['dẫn đúng 3, ăn 1.15', lead3, 1.15]]) {
  const s = summarize(simulate(filter), odds), z = summarize(plain(filter), odds);
  console.log(`Theo tháng (${label}): số kèo · thua · lũy kế — né theo giải so với không lọc`);
  console.table(Object.keys(z.months).map(mo => ({
    'tháng': mo,
    'né theo giải': s.months[mo] ? `${s.months[mo].n} · ${s.months[mo].l} · ${money(s.months[mo].end)}` : '0 kèo',
    'không lọc': `${z.months[mo].n} · ${z.months[mo].l} · ${money(z.months[mo].end)}`,
  })));
}

// Per event: bets, losses, teams blacklisted by the end (lead-3 strategy).
const bets3 = simulate(lead3);
const perEvent = {};
for (const b of bets3) { const e = (perEvent[b.event] = perEvent[b.event] || { n: 0, l: 0 }); e.n++; e.l += b.lost; }
console.log('Theo giải (dẫn đúng 3): số kèo · thua');
console.table(Object.entries(perEvent).map(([e, v]) => ({ 'giải': e.replace('Valorant ', ''), 'số kèo': v.n, 'thua': v.l, 'lật kèo': `${(100 * v.l / v.n).toFixed(0)}%` })));
