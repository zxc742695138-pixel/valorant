// Shared pieces for betting backtests.
//
// Bet: on every map where, at total rounds >= MIN_TOTAL, a team first leads by
// >= MIN_DIFF rounds, stake 1 unit on that leader at decimal odds `odds`
// (win → +odds-1, loss → -1). Maps involving an excluded team are skipped.

const fs = require('fs');
const path = require('path');
const { MIN_TOTAL, MIN_DIFF, analyzeMap } = require('./comeback');

const REGIONS = ['americas', 'emea', 'china', 'pacific'];

// "MIBR.LOS (MIBR)" → "MIBR"
const normalize = name => (name.match(/\(([^)]+)\)$/) || [null, name])[1].trim();

const teamList = region => JSON.parse(fs.readFileSync(`crawler/teams/${region}.json`, 'utf8'));
// The partner (franchise) teams of all regions.
const PARTNERS = new Set(REGIONS.flatMap(r => teamList(r).map(t => t.name)));

// A region's team names and its matches (de-duplicated by URL), with t1/t2 normalized.
// Only matches between two partner teams are kept unless `allOpponents` is set.
// `opponents` lists every team that appears in the kept matches.
function loadRegion(region, dataDir, { allOpponents = false } = {}) {
  const teams = teamList(region);
  const byUrl = new Map();
  for (const t of teams) {
    for (const m of JSON.parse(fs.readFileSync(path.join(dataDir, `${t.slug}.json`), 'utf8')).matches) {
      const row = { ...m, day: m.date.slice(0, 10), t1: normalize(m.team1), t2: normalize(m.team2) };
      if (allOpponents || (PARTNERS.has(row.t1) && PARTNERS.has(row.t2))) byUrl.set(m.url, row);
    }
  }
  const matches = [...byUrl.values()];
  const opponents = [...new Set(matches.flatMap(m => [m.t1, m.t2]))];
  return { teams: teams.map(t => t.name), opponents, matches };
}

// The leader at the first qualifying moment, and whether that leader won the map.
function firstLeadOutcome(rounds) {
  const states = rounds.map(s => s.split('-').map(Number));
  const [f1, f2] = states[states.length - 1];
  for (const [a, b] of states) {
    if (a + b >= MIN_TOTAL && Math.abs(a - b) >= MIN_DIFF) return { won: (a > b) === (f1 > f2) };
  }
  return null;
}

// Comeback maps and lead maps of a team, each map weighted by recency:
// w = 0.5 ^ (age in days / halfLife), age counted back from `asOf`.
// Without halfLife every map weighs 1 (plain counts).
function weightedCounts(matches, { halfLife, asOf } = {}) {
  let cb = 0, lead = 0;
  for (const m of matches) {
    const w = halfLife ? 0.5 ** ((Date.parse(asOf) - Date.parse(m.day)) / 864e5 / halfLife) : 1;
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const r = analyzeMap(mp.rounds);
      if (!r.leaders.size) continue;
      lead += w;
      if (r.blownBy) cb += w;
    }
  }
  return { cb, rate: lead ? cb / lead : 0 };
}

// Same greedy algorithm as iterative_exclude.js: remove the team with the most
// comeback maps (ties: higher rate), drop its matches, repeat `steps` times.
// With `weights.halfLife`, "most comeback maps" uses recency-weighted counts.
function blacklist(teams, matches, steps, weights = {}) {
  const excluded = new Set();
  for (let s = 0; s < steps; s++) {
    const keep = matches.filter(m => !excluded.has(m.t1) && !excluded.has(m.t2));
    const rows = teams.filter(t => !excluded.has(t)).map(t => {
      const r = weightedCounts(keep.filter(m => m.t1 === t || m.t2 === t), weights);
      return { t, cb: r.cb, rate: r.rate };
    }).sort((a, b) => b.cb - a.cb || b.rate - a.rate);
    if (!rows.length || !rows[0].cb) break; // nothing left to explain
    excluded.add(rows[0].t);
  }
  return excluded;
}

function settle(matches, excluded, odds) {
  const res = { bets: 0, wins: 0 };
  for (const m of matches) {
    if (excluded.has(m.t1) || excluded.has(m.t2)) continue;
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      const o = firstLeadOutcome(mp.rounds);
      if (!o) continue;
      res.bets++;
      res.wins += o.won;
    }
  }
  res.losses = res.bets - res.wins;
  res.profit = res.wins * (odds - 1) - res.losses;
  return res;
}

module.exports = { REGIONS, PARTNERS, normalize, loadRegion, firstLeadOutcome, blacklist, settle };
