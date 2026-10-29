#!/usr/bin/env node
// Comeback ("lật kèo") analysis on crawled match data.
//
// A map is a comeback when, at some point where the total rounds played
// (team1 + team2) is >= MIN_TOTAL, one team leads by >= MIN_DIFF rounds,
// yet that team loses the map.
//
// Usage:
//   node analysis/comeback.js data/paper-rex.json "Paper Rex"

const fs = require('fs');

const MIN_TOTAL = 17;
const MIN_DIFF = 3;

function analyzeMap(rounds) {
  const states = rounds.map(s => s.split('-').map(Number));
  const [f1, f2] = states[states.length - 1];
  const finalWinner = f1 > f2 ? 1 : 2;
  // Teams (1 or 2) that held a qualifying lead at some point.
  const leaders = new Set();
  let leadAt = {};
  for (const [a, b] of states) {
    if (a + b < MIN_TOTAL || Math.abs(a - b) < MIN_DIFF) continue;
    const leader = a > b ? 1 : 2;
    if (!leaders.has(leader)) leadAt[leader] = `${a}-${b}`;
    leaders.add(leader);
  }
  const blownBy = [...leaders].find(t => t !== finalWinner) || null;
  return { finalWinner, leaders, blownBy, leadAt };
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

function main() {
  const [file, team] = process.argv.slice(2);
  if (!file || !team) {
    console.error('Usage: node analysis/comeback.js <data.json> "<Team name>"');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  let totalMaps = 0;
  let mapsWithLead = 0;      // any team had a qualifying lead
  let comebacks = 0;         // map was a comeback (either direction)
  const details = [];

  for (const m of data.matches) {
    for (const mp of m.map_result) {
      if (!mp.rounds.length) continue;
      totalMaps++;
      const r = analyzeMap(mp.rounds);
      if (r.leaders.size) mapsWithLead++;
      if (r.blownBy) {
        comebacks++;
        const blown = r.blownBy === 1 ? m.team1 : m.team2;
        const winner = r.finalWinner === 1 ? m.team1 : m.team2;
        details.push({
          date: m.date.slice(0, 10), match: `${m.team1} vs ${m.team2}`, map: mp.map, score: mp.score,
          lead: `${blown} dẫn ${r.leadAt[r.blownBy]}`, winner,
        });
      }
    }
  }

  console.log(`Đội: ${team} — ${data.matches.length} trận, ${totalMaps} map`);
  console.log(`Điều kiện: tổng round >= ${MIN_TOTAL}, chênh lệch >= ${MIN_DIFF}\n`);
  console.log(`Tỉ lệ lật kèo (map lật kèo / map có tình huống dẫn ≥${MIN_DIFF}): ${comebacks}/${mapsWithLead} = ${pct(comebacks, mapsWithLead)}`);
  console.log(`\nChi tiết map lật kèo`);
  console.table(details);
}

main();
