#!/usr/bin/env node
// Per region, repeatedly remove the top comeback team and recompute:
//   1. rank teams by number of comeback maps, then by comeback rate
//   2. remove the top team and every match it played in
//   3. recompute the table; repeat STEPS times
// Each region is filtered independently (only its own removed teams are excluded).
//
// Usage:
//   node analysis/iterative_exclude.js crawler/teams/americas.json [...] [--steps 5] [--data data] [--json out.json]

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
const jsonOut = takeFlag('--json');
// Compare with removing the same number of random teams, N times.
const baselineRuns = Number(takeFlag('--baseline') || 0);
if (!argv.length) {
  console.error('Usage: node analysis/iterative_exclude.js <teams.json> [...] [--steps 5] [--data dataDir] [--json out.json]');
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
const report = { min_total: MIN_TOTAL, min_diff: MIN_DIFF, steps, regions: [] };

for (const teamsFile of argv) {
  const region = path.basename(teamsFile, '.json');
  const teams = JSON.parse(fs.readFileSync(teamsFile, 'utf8')).map(t => {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, `${t.slug}.json`), 'utf8'));
    // Crawl window for the report: earliest cutoff, latest crawl time.
    if (d.since && (!report.since || d.since < report.since)) report.since = d.since;
    if (!report.crawled_at || d.crawled_at > report.crawled_at) report.crawled_at = report.until = d.crawled_at;
    return { ...t, matches: d.matches };
  });
  const excluded = new Set();
  const regionReport = { region, steps: [] };
  report.regions.push(regionReport);
  console.log(`\n======== ${region.toUpperCase()} ========`);
  for (let step = 0; step <= steps; step++) {
    const { rows, region: r, matches } = table(teams, excluded);
    regionReport.steps.push({ step, matches, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: r.rate, table: rows, removed: null, tie_with: null });
    const label = step === 0 ? 'Ban đầu' : `Sau lần loại ${step}`;
    console.log(`\n--- ${label}: khu vực ${r.comebacks}/${r.mapsWithLead} = ${pct(r.comebacks, r.mapsWithLead)} (${matches} trận)`);
    console.table(fmt(rows));
    summary.push({ region, step, removed: step === 0 ? '' : [...excluded].pop(), matches, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: pct(r.comebacks, r.mapsWithLead) });
    if (step === steps) break;
    const [top, next] = rows;
    const current = regionReport.steps[regionReport.steps.length - 1];
    current.removed = top;
    if (next && next.comebacks === top.comebacks && next.rate === top.rate) {
      current.tie_with = next.team;
      console.log(`!! Đồng hạng: ${top.team} và ${next.team} — loại ${top.team} (thứ tự trong bảng)`);
    }
    excluded.add(top.team);
    console.log(`>> Loại: ${top.team} (${top.comebacks} map lật kèo, ${pct(top.comebacks, top.lead_maps)})`);
  }

  if (baselineRuns) {
    const finalRate = regionReport.steps[steps].rate;
    const rates = [];
    for (let i = 0; i < baselineRuns; i++) {
      const pick = teams.map(t => t.name).sort(() => Math.random() - 0.5).slice(0, steps);
      rates.push(table(teams, new Set(pick)).region.rate || 0);
    }
    rates.sort((a, b) => a - b);
    regionReport.baseline = {
      runs: baselineRuns,
      mean: rates.reduce((a, b) => a + b, 0) / rates.length,
      p05: rates[Math.floor(rates.length * 0.05)],
      p95: rates[Math.floor(rates.length * 0.95)],
      p_value: rates.filter(x => x <= finalRate).length / rates.length,
    };
    const b = regionReport.baseline;
    console.log(`\nSo với loại ngẫu nhiên ${steps} đội (${baselineRuns} lần): trung bình ${(100 * b.mean).toFixed(1)}%, khoảng 90% ${(100 * b.p05).toFixed(1)}–${(100 * b.p95).toFixed(1)}%, P(ngẫu nhiên ≤ kết quả) = ${b.p_value.toFixed(3)}`);
  }
}

console.log(`\n======== TÓM TẮT (tổng round >= ${MIN_TOTAL}, chênh lệch >= ${MIN_DIFF}) ========`);
console.table(summary);

if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nSaved to ${jsonOut}`);
}
