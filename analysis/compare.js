#!/usr/bin/env node
// Compare the comeback rate across a list of teams.
//
// Usage:
//   node analysis/compare.js crawler/teams/pacific.json [data]

const fs = require('fs');
const path = require('path');
const { MIN_TOTAL, MIN_DIFF, analyzeMatches, pct } = require('./comeback');

const [teamsFile, dataDir = 'data'] = process.argv.slice(2);
if (!teamsFile) {
  console.error('Usage: node analysis/compare.js <teams.json> [dataDir]');
  process.exit(1);
}

const rows = [];
for (const t of JSON.parse(fs.readFileSync(teamsFile, 'utf8'))) {
  const file = path.join(dataDir, `${t.slug}.json`);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}, skipped`);
    continue;
  }
  const { matches } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = analyzeMatches(matches);
  rows.push({ team: t.name, matches: matches.length, maps: r.totalMaps, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: r.rate });
}

rows.sort((a, b) => b.rate - a.rate);
console.log(`Tỉ lệ lật kèo (tổng round >= ${MIN_TOTAL}, chênh lệch >= ${MIN_DIFF})\n`);
console.table(rows.map(r => ({ ...r, rate: pct(r.comebacks, r.lead_maps) })));
