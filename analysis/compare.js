#!/usr/bin/env node
// Compare the comeback rate across teams, and across regions.
// The region name is the team list's file name (e.g. teams/pacific.json → pacific).
//
// Usage:
//   node analysis/compare.js crawler/teams/pacific.json [crawler/teams/emea.json ...] [--data data]

const fs = require('fs');
const path = require('path');
const { MIN_TOTAL, MIN_DIFF, analyzeMatches, pct } = require('./comeback');

const argv = process.argv.slice(2);
const dataFlag = argv.indexOf('--data');
const dataDir = dataFlag >= 0 ? argv.splice(dataFlag, 2)[1] : 'data';
const teamFiles = argv;
if (!teamFiles.length) {
  console.error('Usage: node analysis/compare.js <teams.json> [more teams.json ...] [--data dataDir]');
  process.exit(1);
}

const rows = [];
const regions = [];
for (const teamsFile of teamFiles) {
  const region = path.basename(teamsFile, '.json');
  // Matches between two teams of the same region appear in both files; count them once.
  const regionMatches = new Map();
  for (const t of JSON.parse(fs.readFileSync(teamsFile, 'utf8'))) {
    const file = path.join(dataDir, `${t.slug}.json`);
    if (!fs.existsSync(file)) {
      console.error(`Missing ${file}, skipped`);
      continue;
    }
    const { matches } = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const m of matches) regionMatches.set(m.url, m);
    const r = analyzeMatches(matches);
    rows.push({ region, team: t.name, matches: matches.length, maps: r.totalMaps, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: r.rate });
  }
  const r = analyzeMatches([...regionMatches.values()]);
  regions.push({ region, matches: regionMatches.size, maps: r.totalMaps, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: r.rate });
}

const fmt = list => list.sort((a, b) => b.rate - a.rate).map(r => ({ ...r, rate: pct(r.comebacks, r.lead_maps) }));

console.log(`Tỉ lệ lật kèo (tổng round >= ${MIN_TOTAL}, chênh lệch >= ${MIN_DIFF})\n`);
console.table(fmt(rows));
if (regions.length > 1) {
  console.log('\nTheo khu vực (mỗi trận chỉ tính một lần)');
  console.table(fmt(regions));
}
