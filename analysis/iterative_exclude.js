#!/usr/bin/env node
// Per region, repeatedly remove the top comeback team and recompute:
//   1. rank teams by number of comeback maps, then by comeback rate
//   2. remove the top team and every match it played in
//   3. recompute the table; repeat STEPS times
// Each region is filtered independently (only its own removed teams are excluded).
//
// Usage:
//   node analysis/iterative_exclude.js crawler/teams/americas.json [...] [--steps 5] [--data data]

const fs = require('fs');
const path = require('path');
const { MIN_TOTAL, MIN_DIFF, analyzeMatches, pct } = require('./comeback');

const argv = process.argv.slice(2);
const takeFlag = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
};
const dataDir = takeFlag('--data') || 'data';
const steps = Number(takeFlag('--steps') || 5);
if (!argv.length) {
  console.error('Usage: node analysis/iterative_exclude.js <teams.json> [...] [--steps 5] [--data dataDir]');
  process.exit(1);
}

// "MIBR.LOS (MIBR)" → "MIBR"
const normalize = name => (name.match(/\(([^)]+)\)$/) || [null, name])[1].trim();

function table(teams, excluded) {
  const keep = m => !excluded.has(normalize(m.team1)) && !excluded.has(normalize(m.team2));
  const regionMatches = new Map();
  const rows = [];
  for (const t of teams) {
    if (excluded.has(t.name)) continue;
    const matches = t.matches.filter(keep);
    for (const m of matches) regionMatches.set(m.url, m);
    const r = analyzeMatches(matches);
    rows.push({ team: t.name, matches: matches.length, maps: r.totalMaps, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: r.rate || 0 });
  }
  rows.sort((a, b) => b.comebacks - a.comebacks || b.rate - a.rate);
  return { rows, region: analyzeMatches([...regionMatches.values()]), matches: regionMatches.size };
}

const fmt = rows => rows.map(r => ({ ...r, rate: pct(r.comebacks, r.lead_maps) }));
const summary = [];

for (const teamsFile of argv) {
  const region = path.basename(teamsFile, '.json');
  const teams = JSON.parse(fs.readFileSync(teamsFile, 'utf8')).map(t => ({
    ...t, matches: JSON.parse(fs.readFileSync(path.join(dataDir, `${t.slug}.json`), 'utf8')).matches,
  }));
  const excluded = new Set();
  console.log(`\n======== ${region.toUpperCase()} ========`);
  for (let step = 0; step <= steps; step++) {
    const { rows, region: r, matches } = table(teams, excluded);
    const label = step === 0 ? 'Ban đầu' : `Sau lần loại ${step}`;
    console.log(`\n--- ${label}: khu vực ${r.comebacks}/${r.mapsWithLead} = ${pct(r.comebacks, r.mapsWithLead)} (${matches} trận)`);
    console.table(fmt(rows));
    summary.push({ region, step, removed: step === 0 ? '' : [...excluded].pop(), matches, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: pct(r.comebacks, r.mapsWithLead) });
    if (step === steps) break;
    const [top, next] = rows;
    if (next && next.comebacks === top.comebacks && next.rate === top.rate) {
      console.log(`!! Đồng hạng: ${top.team} và ${next.team} — loại ${top.team} (thứ tự trong bảng)`);
    }
    excluded.add(top.team);
    console.log(`>> Loại: ${top.team} (${top.comebacks} map lật kèo, ${pct(top.comebacks, top.lead_maps)})`);
  }
}

console.log(`\n======== TÓM TẮT (tổng round >= ${MIN_TOTAL}, chênh lệch >= ${MIN_DIFF}) ========`);
console.table(summary);
