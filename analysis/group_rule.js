#!/usr/bin/env node
// Bet only on maps where both teams belong to chosen groups (see team_groups.js),
// with groups recomputed before every match day from the previous WINDOW days.
//
// Usage:
//   node analysis/group_rule.js [--groups "Trung bình"] [--window 300] [--from 2026-05-01]
//     [--to 2026-12-31] [--data data-backtest] [--odds 1.1] [--net 2] [--volatile 6]
//     [--fixed reports-year]   (use groups computed once on the whole test period instead)

const fs = require('fs');
const { REGIONS, loadRegion } = require('./betting');
const { analyzeMap, MIN_TOTAL, MIN_DIFF } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const from = opt('--from', '2026-05-01');
const to = opt('--to', '2026-12-31');
const windowDays = Number(opt('--window', 300));
// --last-matches M: judge each team on its own M most recent matches before the day
// (any age) instead of every match in the last --window days.
const lastMatches = opt('--last-matches') ? Number(opt('--last-matches')) : null;
// --season: groups use every match since the start of the current season (1 January
// of the day's year) instead of the last --window days; the season start resets them.
const seasonMode = argv.includes('--season');
const odds = Number(opt('--odds', 1.1));
const NET = Number(opt('--net', 2));
const VOLATILE = Number(opt('--volatile', 6));
const wanted = (opt('--groups', 'Trung bình')).split(',');
const fixed = argv.includes('--fixed');
// --regions a,b: only bet on maps where both teams belong to these regions.
const betRegions = opt('--regions') ? opt('--regions').split(',') : null;
const teamRegion = {};
for (const r of REGIONS) for (const t of JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8'))) teamRegion[t.name] = r;

const partners = new Set(REGIONS.flatMap(r => JSON.parse(fs.readFileSync(`crawler/teams/${r}.json`, 'utf8')).map(t => t.name)));
const byUrl = new Map();
for (const r of REGIONS) for (const m of loadRegion(r, dataDir).matches) byUrl.set(m.url, m);
const matches = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));

// Per map: who led first (for the bet) and comeback roles (for the groups).
const events = []; // { day, t1, t2, maps: [{ blownBy, leaders, first: { leader, reversed, size } }] }
for (const m of matches) {
  const maps = [];
  for (const mp of m.map_result) {
    if (!mp.rounds.length) continue;
    const a = analyzeMap(mp.rounds);
    const states = mp.rounds.map(s => s.split('-').map(Number));
    const [f1, f2] = states[states.length - 1];
    let first = null;
    for (const [x, y] of states.slice(0, -1)) { // last state = final score, map over
      if (x + y >= MIN_TOTAL && Math.abs(x - y) >= MIN_DIFF) {
        const leader = x > y ? 1 : 2;
        first = { leader, reversed: leader !== (f1 > f2 ? 1 : 2), size: Math.abs(x - y), roundNo: x + y };
        break;
      }
    }
    maps.push({ leaders: a.leaders, blownBy: a.blownBy, first });
  }
  events.push({ day: m.day, t1: m.t1, t2: m.t2, maps });
}

function groupsFrom(list) {
  const s = {};
  const get = t => s[t] || (s[t] = { made: 0, blown: 0 });
  for (const e of list) {
    for (const mp of e.maps) {
      for (const [t, side] of [[e.t1, 1], [e.t2, 2]]) {
        const other = side === 1 ? 2 : 1;
        if (mp.leaders.has(side) && mp.blownBy === side) get(t).blown++;
        if (mp.leaders.has(other) && mp.blownBy === other) get(t).made++;
      }
    }
  }
  return t => {
    const x = s[t] || { made: 0, blown: 0 };
    const net = x.made - x.blown;
    if (net >= NET) return 'Mạnh';
    if (net <= -NET) return 'Yếu';
    return x.made + x.blown >= VOLATILE ? 'Không ổn định' : 'Trung bình';
  };
}

const test = events.filter(e => e.day >= from && e.day <= to);
const fixedGroup = fixed ? groupsFrom(test) : null;
const cache = new Map();
// Per team, its events newest first (for --last-matches).
const teamEvents = new Map();
for (const e of [...events].reverse()) {
  for (const t of [e.t1, e.t2]) (teamEvents.get(t) || teamEvents.set(t, []).get(t)).push(e);
}
const groupAt = day => {
  if (fixedGroup) return fixedGroup;
  if (lastMatches) {
    if (!cache.has(day)) {
      const memo = new Map();
      cache.set(day, t => {
        if (!memo.has(t)) {
          const own = (teamEvents.get(t) || []).filter(e => e.day < day).slice(0, lastMatches);
          memo.set(t, groupsFrom(own)(t));
        }
        return memo.get(t);
      });
    }
    return cache.get(day);
  }
  if (!cache.has(day)) {
    const start = seasonMode ? `${day.slice(0, 4)}-01-01` : new Date(Date.parse(day) - windowDays * 864e5).toISOString().slice(0, 10);
    cache.set(day, groupsFrom(events.filter(e => e.day >= start && e.day < day)));
  }
  return cache.get(day);
};

const acc = {};
const add = (k, b) => { const a = (acc[k] = acc[k] || { n: 0, l: 0 }); a.n++; a.l += b.reversed; };
const pairCount = {};
// Every bet in date order with the decisions of the compared strategies (for --ledger).
const ledger = [];
for (const e of test) {
  if (!partners.has(e.t1) || !partners.has(e.t2)) continue;
  if (betRegions && !(betRegions.includes(teamRegion[e.t1]) && betRegions.includes(teamRegion[e.t2]))) continue;
  const g = groupAt(e.day);
  const g1 = g(e.t1), g2 = g(e.t2);
  const keep = wanted.includes(g1) && wanted.includes(g2);
  for (const mp of e.maps) {
    if (!mp.first) continue;
    const b = mp.first;
    add('Cược tất cả', b);
    add(b.size === 3 ? 'Tất cả · dẫn 3' : 'Tất cả · dẫn ≥ 4', b);
    ledger.push({
      day: e.day, match: `${e.t1} vs ${e.t2}`, groups: `${g1} / ${g2}`, size: b.size, roundNo: b.roundNo, lost: b.reversed,
      all: true, groups_only: keep, groups_lead3: keep && b.size === 3, lead4: b.size >= 4, combined: b.size >= 4 || keep,
    });
    const pair = [g1, g2].sort().join(' vs ');
    (pairCount[pair] = pairCount[pair] || { n: 0, l: 0 }).n++;
    pairCount[pair].l += b.reversed;
    if (!keep) continue;
    add(`Chỉ ${wanted.join('/')} vs ${wanted.join('/')}`, b);
    add(`${wanted.join('/')} vs ${wanted.join('/')} · ${b.size === 3 ? 'dẫn 3' : 'dẫn ≥ 4'}`, b);
  }
}

const fmt = (k, a, all) => ({
  'quy tắc': k, 'số cược': a.n, 'thua': a.l, 'lật kèo': `${(100 * a.l / a.n).toFixed(1)}%`,
  'lãi (tr)': +((a.n - a.l) * (odds - 1) - a.l).toFixed(1), '%/cược': `${(100 * ((a.n - a.l) * (odds - 1) - a.l) / a.n).toFixed(1)}%`,
  'giữ lại': `${(100 * a.n / all).toFixed(0)}%`,
});
const all = acc['Cược tất cả'].n;
console.log(`Kèo ${from} → ${to}; nhóm ${fixed ? 'tính một lần trên chính giai đoạn này (nhìn lại)' : (lastMatches ? `tính lại mỗi ngày từ ${lastMatches} trận gần nhất của từng đội` : seasonMode ? 'tính lại mỗi ngày từ đầu mùa giải' : `tính lại mỗi ngày từ ${windowDays} ngày trước đó`)}; tỉ lệ ăn ${odds}\n`);
console.table(Object.entries(acc).map(([k, a]) => fmt(k, a, all)));
console.log('Theo cặp nhóm của hai đội:');
console.table(Object.entries(pairCount).sort((a, b) => b[1].n - a[1].n).map(([k, a]) => fmt(k, a, all)));

// --ledger: month-by-month profit (stake --stake, default 1,000,000) for the compared strategies,
// and every lost bet of the group rule.
if (argv.includes('--ledger')) {
  const stake = Number(opt('--stake', 1e6));
  const label = `Chỉ ${wanted.join('/')} vs ${wanted.join('/')}`;
  // Rules that keep only bigger leads are not priced at the same odds, so they are not compared here.
  const STRATS = { all: 'Cược tất cả', groups_only: label, groups_lead3: `${label} · chỉ dẫn đúng 3` };
  // --main lead3: show the month table for the lead-3 rule instead.
  const mainKey = opt('--main') === 'lead3' ? `${label} · chỉ dẫn đúng 3` : label;
  const money = x => `${x < 0 ? '−' : x > 0 ? '+' : ''}${(Math.abs(x) / 1e6).toFixed(1)} tr`;
  const pnl = b => (b.lost ? -stake : stake * (odds - 1));
  const summary = {};
  for (const [k, name] of Object.entries(STRATS)) {
    let bal = 0, peak = 0, dd = 0, n = 0, l = 0;
    const months = {};
    for (const b of ledger) {
      if (!b[k]) continue;
      n++; l += b.lost;
      bal += pnl(b);
      peak = Math.max(peak, bal);
      dd = Math.max(dd, peak - bal);
      const mo = b.day.slice(0, 7);
      const m = (months[mo] = months[mo] || { n: 0, l: 0, p: 0, end: 0 });
      m.n++; m.l += b.lost; m.p += pnl(b); m.end = bal;
    }
    summary[name] = { n, l, bal, dd, months };
  }
  const main = summary[mainKey];
  console.log(`\n=== ${mainKey}: lãi theo tháng (mỗi cược ${(stake / 1e6).toFixed(1)} tr, ăn ${odds})`);
  console.table(Object.entries(main.months).map(([mo, m]) => ({
    'tháng': mo, 'số cược': m.n, 'thua': m.l, 'lãi tháng': money(m.p), 'lũy kế': money(m.end),
    'cược tất cả (lũy kế)': money(summary['Cược tất cả'].months[mo]?.end ?? 0),
  })));
  console.log('So sánh:');
  console.table(Object.entries(summary).map(([name, s]) => ({
    'cách cược': name, 'số cược': s.n, 'thua': s.l, 'lật kèo': `${(100 * s.l / s.n).toFixed(1)}%`,
    'lãi': money(s.bal), '%/cược': `${(100 * s.bal / (s.n * stake)).toFixed(1)}%`, 'sụt giảm lớn nhất': money(-s.dd),
  })));
  console.log(`Các lần thua của "${label}":`);
  let bal = 0;
  for (const b of ledger) {
    if (!b.groups_only) continue;
    bal += pnl(b);
    if (b.lost) console.log(`  ${b.day}  ${b.match} (${b.groups}) · dẫn ${b.size} → lũy kế ${money(bal)}`);
  }
}

