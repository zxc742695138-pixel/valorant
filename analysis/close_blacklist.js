// Close-finish blacklist: for every partner team, the share of its maps that finished 13-11
// (either way) or went to overtime — over its last `lastMatches` matches up to `to` (every map
// of those matches), or, without lastMatches, over the last `windowDays` days.
// Events matching `exclude` (e.g. EWC, Champions) are left out of the statistics.
// In each region the `top` teams with the highest share form the blacklist.
//
// Used by pipeline/update.js; can also be run directly:
//   node analysis/close_blacklist.js [--data data] [--to 2026-11-08] [--last-matches 5 | --window 90] [--top 4]

const fs = require('fs');
const path = require('path');
const { REGIONS, loadRegion } = require('./betting');

function computeCloseBlacklist({ dataDir, teamsDir, to, windowDays = 90, lastMatches = null, top = 4, exclude = null, minMaps = 0, regions = REGIONS }) {
  const from = new Date(Date.parse(to) - windowDays * 864e5).toISOString().slice(0, 10);
  const re = exclude ? new RegExp(exclude) : null;
  const byUrl = new Map();
  for (const r of REGIONS) for (const m of loadRegion(r, dataDir, { teamsDir }).matches) byUrl.set(m.url, m);

  // One entry per match: its maps and how many finished close.
  const perTeam = new Map();
  let lastDay = '';
  for (const m of byUrl.values()) {
    if (m.day > to || (!lastMatches && m.day <= from) || (re && re.test(m.event))) continue;
    let n = 0, c1311 = 0, ot = 0;
    for (const mp of m.map_result) {
      const fin = mp.rounds.length ? mp.rounds[mp.rounds.length - 1] : mp.score;
      if (!fin) continue;
      const [f1, f2] = fin.split('-').map(Number);
      if (!(f1 + f2)) continue;
      n++; c1311 += Math.max(f1, f2) === 13 && Math.min(f1, f2) === 11; ot += f1 + f2 > 24;
    }
    if (!n) continue;
    for (const t of [m.t1, m.t2]) (perTeam.get(t) || perTeam.set(t, []).get(t)).push({ day: m.date || m.day, n, c1311, ot });
  }
  const stats = {};
  for (const [t, list] of perTeam) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    const used = lastMatches ? list.slice(-lastMatches) : list;
    stats[t] = used.reduce((x, e) => ({ maps: x.maps + e.n, c1311: x.c1311 + e.c1311, ot: x.ot + e.ot, matches: x.matches + 1, since: x.since || e.day.slice(0, 10) }), { maps: 0, c1311: 0, ot: 0, matches: 0, since: '' });
    const d = used.length ? used[used.length - 1].day.slice(0, 10) : '';
    if (d > lastDay) lastDay = d;
  }

  const out = {};
  for (const r of regions) {
    const names = JSON.parse(fs.readFileSync(path.join(teamsDir, `${r}.json`), 'utf8')).map(t => t.name);
    const teams = names.map(team => {
      const x = stats[team] || { maps: 0, c1311: 0, ot: 0, matches: 0, since: '' };
      const close = x.c1311 + x.ot;
      return { team, matches: x.matches, since: x.since, maps: x.maps, c1311: x.c1311, ot: x.ot, close, rate: x.maps ? close / x.maps : 0, enough: x.maps >= minMaps && x.maps > 0 };
    }).sort((a, b) => b.rate - a.rate || b.maps - a.maps || a.team.localeCompare(b.team));
    const ranked = teams.filter(t => t.enough);
    const blacklist = ranked.slice(0, top).map(t => t.team);
    // Teams tied with the last blacklisted one (same share) are reported, not added.
    const cut = ranked[top - 1];
    const tied = cut ? ranked.slice(top).filter(t => t.rate === cut.rate).map(t => t.team) : [];
    out[r] = { teams: teams.map(t => ({ ...t, blacklisted: blacklist.includes(t.team) })), blacklist, tied };
  }
  return { from: lastMatches ? null : from, to, lastDay, lastMatches, regions: out };
}

module.exports = { computeCloseBlacklist };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const res = computeCloseBlacklist({
    dataDir: opt('--data', 'data'), teamsDir: opt('--teams', 'crawler/teams'),
    to: opt('--to', new Date().toISOString().slice(0, 10)), windowDays: Number(opt('--window', 90)),
    lastMatches: opt('--last-matches') ? Number(opt('--last-matches')) : null,
    top: Number(opt('--top', 4)), exclude: opt('--exclude', 'Esports World Cup|Champions'),
    regions: opt('--regions', 'pacific,americas,china').split(','),
  });
  console.log(`${res.lastMatches ? `${res.lastMatches} trận gần nhất mỗi đội` : `${res.from} →`} ${res.to} (trận cuối ${res.lastDay})`);
  for (const [r, v] of Object.entries(res.regions)) {
    console.log(`\n${r}: blacklist ${v.blacklist.join(', ')}${v.tied.length ? ` (bằng điểm đội thứ 4: ${v.tied.join(', ')})` : ''}`);
    console.table(v.teams.map(t => ({ 'đội': t.team, 'trận': t.matches, 'từ': t.since, map: t.maps, '13-11': t.c1311, OT: t.ot, '%': `${(100 * t.rate).toFixed(1)}%`, blacklist: t.blacklisted ? '✗' : '' })));
  }
}
