#!/usr/bin/env node
// Grid search over M (last matches per team) × H (half-life in days) for the
// "independent" blacklist (each team scored on its own last M matches, top N per
// region taken at once, exclusion only applied to bets), with:
//   - cross-validation between two windows (pick the best on one, report it on the other)
//   - a selection-aware permutation test per window (best-of-grid on shuffled outcomes)
//
// Usage:
//   node analysis/grid_mh.js --data data-backtest --teams-dir crawler/teams
//     --window-a 2026-01-01,...,2026-07-15 --window-b 2026-07-15,...,2026-11-01 [--perms 500]

const { loadRegion, firstLeadOutcome } = require('./betting');
const { analyzeMap } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-backtest');
const teamsDir = opt('--teams-dir', 'crawler/teams');
const regionsArg = (opt('--regions', 'americas,china,pacific')).split(',');
const windows = { A: opt('--window-a').split(','), B: opt('--window-b').split(',') };
const perms = Number(opt('--perms', 500));
const odds = Number(opt('--odds', 1.1));
const TOP = Number(opt('--steps', 5));
const MS = [5, 10, 15, 20, 30, 40];
const HS = [null, 30, 60, 90, 180];

// ---- Load matches once, with per-map outcome ids ----
const dayNum = d => Date.parse(d) / 864e5;
const regionData = Object.fromEntries(regionsArg.map(r => [r, loadRegion(r, dataDir, { teamsDir })]));
const byUrl = new Map();
const outcomes = [];
for (const r of regionsArg) {
  for (const m of regionData[r].matches) {
    if (byUrl.has(m.url)) continue;
    const maps = [];
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const a = analyzeMap(mp.rounds);
      if (!a.leaders.size) continue;
      maps.push(outcomes.length);
      outcomes.push({ blown: !!a.blownBy, lost: !firstLeadOutcome(mp.rounds).won });
    }
    byUrl.set(m.url, { url: m.url, day: m.day, t: dayNum(m.day), t1: m.t1, t2: m.t2, maps });
  }
}
const regionMatches = Object.fromEntries(regionsArg.map(r => [r, regionData[r].matches.map(m => byUrl.get(m.url))]));
// Per team, its matches newest first (for "last M before a date").
const teamMatches = new Map();
for (const r of regionsArg) {
  for (const t of regionData[r].teams) {
    teamMatches.set(t, regionMatches[r].filter(m => m.t1 === t || m.t2 === t).sort((a, b) => b.t - a.t));
  }
}

function lists(start, M, H, out) {
  const s = dayNum(start);
  const ex = new Set();
  for (const r of regionsArg) {
    const scored = regionData[r].teams.map(t => {
      let cb = 0, lead = 0, n = 0;
      for (const m of teamMatches.get(t)) {
        if (m.t >= s) continue;
        if (n++ >= M) break;
        const w = H ? 0.5 ** ((s - m.t) / H) : 1;
        for (const id of m.maps) { lead += w; if (out[id].blown) cb += w; }
      }
      return { t, cb, rate: lead ? cb / lead : 0 };
    }).filter(x => x.cb > 0).sort((a, b) => b.cb - a.cb || b.rate - a.rate);
    scored.slice(0, TOP).forEach(x => ex.add(x.t));
  }
  return ex;
}

function run(marks, M, H, out) {
  let bets = 0, losses = 0;
  for (let i = 0; i < marks.length - 1; i++) {
    const [start, end] = [marks[i], marks[i + 1]];
    const ex = M ? lists(start, M, H, out) : new Set();
    const seen = new Set();
    for (const r of regionsArg) {
      for (const m of regionMatches[r]) {
        if (m.day < start || m.day >= end || seen.has(m.url) || ex.has(m.t1) || ex.has(m.t2)) continue;
        seen.add(m.url);
        for (const id of m.maps) { bets++; if (out[id].lost) losses++; }
      }
    }
  }
  return { bets, losses, profit: (bets - losses) * (odds - 1) - losses };
}

const grid = out => Object.fromEntries(Object.entries(windows).map(([w, marks]) => [w,
  MS.flatMap(M => HS.map(H => ({ M, H, ...run(marks, M, H, out) })))]));
const label = c => `M=${c.M}, ${c.H ? `H=${c.H}` : 'không TS'}`;

const real = grid(outcomes);
for (const [w, marks] of Object.entries(windows)) {
  const base = run(marks, null, null, outcomes);
  console.log(`\n=== Khoảng ${w}: ${marks[0]} → ${marks[marks.length - 1]} | Không lọc: ${base.bets} cược, lật ${(100 * base.losses / base.bets).toFixed(1)}%, lãi ${base.profit.toFixed(1)}`);
  const table = {};
  for (const c of real[w]) {
    table[`M=${c.M}`] = table[`M=${c.M}`] || {};
    table[`M=${c.M}`][c.H ? `H=${c.H}` : 'không TS'] = +c.profit.toFixed(1);
  }
  console.log('Lãi (unit) khi có lọc:');
  console.table(table);
}

// Cross-validation
console.log('\n=== Kiểm định chéo (chọn tốt nhất ở một khoảng, xem kết quả ở khoảng kia)');
for (const [from, to] of [['A', 'B'], ['B', 'A']]) {
  const best = [...real[from]].sort((a, b) => b.profit - a.profit)[0];
  const there = real[to].find(c => c.M === best.M && c.H === best.H);
  const baseTo = run(windows[to], null, null, outcomes);
  const rankTo = [...real[to]].sort((a, b) => b.profit - a.profit).findIndex(c => c.M === best.M && c.H === best.H) + 1;
  console.log(`  Tốt nhất ở ${from}: ${label(best)} (lãi ${best.profit.toFixed(1)}) → ở ${to}: lãi ${there.profit.toFixed(1)}, hạng ${rankTo}/${real[to].length}; không lọc ở ${to}: ${baseTo.profit.toFixed(1)}`);
}

// Permutation test of the best-of-grid in each window
if (perms > 0) {
  const ids = outcomes.map((_, i) => i);
  const maxes = { A: [], B: [] };
  for (let k = 0; k < perms; k++) {
    for (let j = ids.length - 1; j > 0; j--) {
      const x = Math.floor(Math.random() * (j + 1));
      [ids[j], ids[x]] = [ids[x], ids[j]];
    }
    const g = grid(ids.map(i => outcomes[i]));
    for (const w of ['A', 'B']) {
      // Compare filtered profit relative to the unfiltered profit of the same shuffle.
      const base = run(windows[w], null, null, ids.map(i => outcomes[i])).profit;
      maxes[w].push(Math.max(...g[w].map(c => c.profit)) - base);
    }
  }
  console.log(`\n=== Kiểm định xáo trộn (${perms} lần): "lọc tốt nhất − không lọc"`);
  for (const w of ['A', 'B']) {
    const base = run(windows[w], null, null, outcomes).profit;
    const realGain = Math.max(...real[w].map(c => c.profit)) - base;
    const arr = maxes[w].sort((a, b) => a - b);
    const p = arr.filter(x => x >= realGain).length / arr.length;
    console.log(`  Khoảng ${w}: thật ${realGain.toFixed(1)} unit; ngẫu nhiên trung vị ${arr[Math.floor(arr.length / 2)].toFixed(1)}, 95% ≤ ${arr[Math.floor(arr.length * 0.95)].toFixed(1)}; ${(100 * p).toFixed(1)}% số lần ngẫu nhiên bằng hoặc hơn`);
  }
}
