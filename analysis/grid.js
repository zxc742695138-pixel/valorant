#!/usr/bin/env node
// Grid search over half-life × bet regions for the rolling blacklist strategy,
// with a selection-aware permutation test.
//
// Same rules as backtest_rolling.js / pnl.js: per period, blacklists come from the
// `trainDays` days before the period (ranked by recency-weighted comeback maps),
// bets are 1 unit at `odds` on the first qualifying leader, maps involving any
// blacklisted team of the chosen regions are skipped.
//
// Permutation test: shuffle the comeback outcomes among all lead maps, rerun the
// whole grid, keep the BEST profit. Repeating this gives the profit a "best of the
// grid" reaches on pure noise; the real best should beat most of those.
//
// Usage:
//   node analysis/grid.js --marks 2026-07-15,...,2026-11-01 [--data data-history] [--perms 200]

const { REGIONS, loadRegion, firstLeadOutcome } = require('./betting');
const { analyzeMap } = require('./comeback');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataDir = opt('--data', 'data-history');
const marks = (opt('--marks') || '').split(',').filter(Boolean);
const perms = Number(opt('--perms', 200));
const odds = Number(opt('--odds', 1.1));
const steps = Number(opt('--steps', 5));
const trainDays = Number(opt('--train-days', 180));
const HALF_LIVES = [null, 30, 45, 60, 90, 120, 180, 240];
const NAMES = { americas: 'AME', emea: 'EMEA', china: 'CN', pacific: 'PAC' };

const minusDays = (day, n) => new Date(Date.parse(day) - n * 864e5).toISOString().slice(0, 10);
const dayNum = d => Date.parse(d) / 864e5;

// ---- Load: every match once, its lead maps with outcome ids ----
const regionData = Object.fromEntries(REGIONS.map(r => [r, loadRegion(r, dataDir)]));
const matchByUrl = new Map();
const outcomes = []; // per lead map: { blown, lost } (ranking uses blown, bets use lost)
for (const r of REGIONS) {
  for (const m of regionData[r].matches) {
    if (matchByUrl.has(m.url)) continue;
    const maps = [];
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const a = analyzeMap(mp.rounds);
      if (!a.leaders.size) continue;
      const o = firstLeadOutcome(mp.rounds);
      maps.push(outcomes.length);
      outcomes.push({ blown: !!a.blownBy, lost: !o.won });
    }
    matchByUrl.set(m.url, { url: m.url, day: m.day, t: dayNum(m.day), t1: m.t1, t2: m.t2, maps });
  }
}
const regionMatches = Object.fromEntries(REGIONS.map(r => [r, regionData[r].matches.map(m => matchByUrl.get(m.url))]));
const periods = marks.slice(0, -1).map((start, i) => ({ start, end: marks[i + 1], s: dayNum(start), from: minusDays(start, trainDays) }));

// ---- Core ----
function blacklist(region, period, halfLife, out) {
  const train = regionMatches[region].filter(m => m.day >= period.from && m.day < period.start);
  const teams = regionData[region].teams;
  const excluded = new Set();
  for (let s = 0; s < steps; s++) {
    let best = null;
    for (const t of teams) {
      if (excluded.has(t)) continue;
      let cb = 0, lead = 0;
      for (const m of train) {
        if ((m.t1 !== t && m.t2 !== t) || excluded.has(m.t1) || excluded.has(m.t2)) continue;
        const w = halfLife ? 0.5 ** ((period.s - m.t) / halfLife) : 1;
        for (const id of m.maps) { lead += w; if (out[id].blown) cb += w; }
      }
      const rate = lead ? cb / lead : 0;
      if (!best || cb > best.cb || (cb === best.cb && rate > best.rate)) best = { t, cb, rate };
    }
    if (!best || !best.cb) break;
    excluded.add(best.t);
  }
  return excluded;
}

const SUBSETS = [];
for (let mask = 1; mask < 1 << REGIONS.length; mask++) SUBSETS.push(REGIONS.filter((_, i) => mask & (1 << i)));

function runGrid(out) {
  const results = [];
  for (const h of HALF_LIVES) {
    // blacklists[period][region]
    const lists = periods.map(p => Object.fromEntries(REGIONS.map(r => [r, blacklist(r, p, h, out)])));
    for (const subset of SUBSETS) {
      let bets = 0, losses = 0;
      periods.forEach((p, i) => {
        const ex = new Set(subset.flatMap(r => [...lists[i][r]]));
        const seen = new Set();
        for (const r of subset) {
          for (const m of regionMatches[r]) {
            if (m.day < p.start || m.day >= p.end || seen.has(m.url) || ex.has(m.t1) || ex.has(m.t2)) continue;
            seen.add(m.url);
            for (const id of m.maps) { bets++; if (out[id].lost) losses++; }
          }
        }
      });
      results.push({ h, subset, bets, losses, profit: (bets - losses) * (odds - 1) - losses });
    }
  }
  return results;
}

const label = r => `${r.h ? `H=${r.h}` : 'không TS'} · ${r.subset.map(s => NAMES[s]).join('+')}`;
const fmt = r => ({ 'cấu hình': label(r), 'số cược': r.bets, 'lật kèo': `${(100 * r.losses / r.bets).toFixed(1)}%`, 'lãi (unit)': +r.profit.toFixed(1), '%/cược': `${(100 * r.profit / r.bets).toFixed(1)}%` });

const t0 = Date.now();
const real = runGrid(outcomes);
const sorted = [...real].sort((a, b) => b.profit - a.profit);
console.log(`${real.length} cấu hình (${HALF_LIVES.length} H × ${SUBSETS.length} tổ hợp khu vực), ${periods.length} khoảng, tỉ lệ ăn ${odds}. (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
console.log('Top 15 theo tổng lãi:');
console.table(sorted.slice(0, 15).map(fmt));

// Per region × H (single-region bets): profit, to see where the effect comes from.
console.log('Lãi (unit) theo từng khu vực riêng lẻ × H:');
const single = {};
for (const r of real.filter(r => r.subset.length === 1)) {
  single[NAMES[r.subset[0]]] = single[NAMES[r.subset[0]]] || {};
  single[NAMES[r.subset[0]]][r.h ? `H=${r.h}` : 'không TS'] = +r.profit.toFixed(1);
}
console.table(single);

// Unfiltered reference for each subset is not affected by H; show the 4-region one.
console.log('Toàn bộ 4 khu vực theo H:');
console.table(real.filter(r => r.subset.length === 4).map(fmt));

// ---- Permutation test of the best-of-grid ----
if (perms > 0) {
  const best = sorted[0].profit;
  const ids = outcomes.map((_, i) => i);
  const maxes = [];
  for (let k = 0; k < perms; k++) {
    for (let j = ids.length - 1; j > 0; j--) {
      const x = Math.floor(Math.random() * (j + 1));
      [ids[j], ids[x]] = [ids[x], ids[j]];
    }
    const shuffled = ids.map(i => outcomes[i]);
    maxes.push(Math.max(...runGrid(shuffled).map(r => r.profit)));
    if ((k + 1) % 25 === 0) console.error(`  permutation ${k + 1}/${perms}`);
  }
  maxes.sort((a, b) => a - b);
  const pAt = q => maxes[Math.min(maxes.length - 1, Math.floor(q * maxes.length))].toFixed(1);
  const pValue = maxes.filter(x => x >= best).length / maxes.length;
  console.log(`\nKiểm định chọn cấu hình (${perms} lần xáo trộn kết quả lật kèo, mỗi lần lấy cấu hình tốt nhất trong ${real.length}):`);
  console.log(`  Lãi tốt nhất trên dữ liệu ngẫu nhiên: trung vị ${pAt(0.5)}, 90% ≤ ${pAt(0.9)}, 95% ≤ ${pAt(0.95)} unit`);
  console.log(`  Lãi tốt nhất trên dữ liệu thật: ${best.toFixed(1)} unit (${label(sorted[0])})`);
  console.log(`  ${(100 * pValue).toFixed(1)}% số lần dữ liệu ngẫu nhiên cho cấu hình tốt nhất lãi bằng hoặc hơn.`);
}
