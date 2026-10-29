#!/usr/bin/env node
// Compare the comeback rate across teams, and across regions.
// The region name is the team list's file name (e.g. teams/pacific.json → pacific).
//
// --exclude drops every match involving one of the listed teams (comma-separated
// names), and the listed teams themselves.
//
// Usage:
//   node analysis/compare.js crawler/teams/pacific.json [crawler/teams/emea.json ...] [--data data] [--exclude "T1,NRG"]

const fs = require('fs');
const path = require('path');
const { MIN_TOTAL, MIN_DIFF, analyzeMatches, pct } = require('./comeback');

const argv = process.argv.slice(2);
const takeFlag = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
};
const dataDir = takeFlag('--data') || 'data';
const excluded = new Set((takeFlag('--exclude') || '').split(',').map(s => s.trim()).filter(Boolean));
const teamFiles = argv;
if (!teamFiles.length) {
  console.error('Usage: node analysis/compare.js <teams.json> [more teams.json ...] [--data dataDir] [--exclude "Team A,Team B"]');
  process.exit(1);
}

// "MIBR.LOS (MIBR)" → "MIBR"
const normalize = name => (name.match(/\(([^)]+)\)$/) || [null, name])[1].trim();
const keep = m => !excluded.has(normalize(m.team1)) && !excluded.has(normalize(m.team2));

const rows = [];
const regions = [];
for (const teamsFile of teamFiles) {
  const region = path.basename(teamsFile, '.json');
  // Matches between two teams of the same region appear in both files; count them once.
  const regionMatches = new Map();
  for (const t of JSON.parse(fs.readFileSync(teamsFile, 'utf8'))) {
    if (excluded.has(t.name)) continue;
    const file = path.join(dataDir, `${t.slug}.json`);
    if (!fs.existsSync(file)) {
      console.error(`Missing ${file}, skipped`);
      continue;
    }
    const matches = JSON.parse(fs.readFileSync(file, 'utf8')).matches.filter(keep);
    for (const m of matches) regionMatches.set(m.url, m);
    const r = analyzeMatches(matches);
    rows.push({ region, team: t.name, matches: matches.length, maps: r.totalMaps, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: r.rate });
  }
  const r = analyzeMatches([...regionMatches.values()]);
  regions.push({ region, matches: regionMatches.size, maps: r.totalMaps, lead_maps: r.mapsWithLead, comebacks: r.comebacks, rate: r.rate });
}

const fmt = list => list.sort((a, b) => b.rate - a.rate).map(r => ({ ...r, rate: pct(r.comebacks, r.lead_maps) }));

console.log(`Tỉ lệ lật kèo (tổng round >= ${MIN_TOTAL}, chênh lệch >= ${MIN_DIFF})`);
if (excluded.size) console.log(`Loại các trận có: ${[...excluded].join(', ')}`);
console.log();
console.table(fmt(rows));
if (regions.length > 1) {
  console.log('\nTheo khu vực (mỗi trận chỉ tính một lần)');
  console.table(fmt(regions));
}
