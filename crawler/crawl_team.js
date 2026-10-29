#!/usr/bin/env node
// Crawl the N most recent completed matches of a team from vlr.gg,
// including round-by-round score progression for every map.
//
// Usage:
//   node crawler/crawl_team.js --team-id 624 [--limit 20] [--out data/paper-rex.json]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'https://www.vlr.gg';

function parseArgs(argv) {
  const args = { delay: 1000 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    args[key.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  if (!args.teamId) {
    console.error('Usage: node crawler/crawl_team.js --team-id <vlr team id> [--days 120 | --limit 20] [--out file.json]');
    process.exit(1);
  }
  // --days: every match in the last N days; --limit: the N most recent matches.
  // Both may be combined; with neither, default to the 20 most recent matches.
  args.limit = args.limit ? Number(args.limit) : (args.days ? Infinity : 20);
  args.since = args.days ? new Date(Date.now() - Number(args.days) * 86400000) : null;
  args.delay = Number(args.delay);
  return args;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gotoWithRetry(page, url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
      return;
    } catch (e) {
      if (i === tries) throw e;
      await sleep(2000 * i);
    }
  }
}

// Collect match URLs from the team's "completed" match list (newest first), following
// pagination until `limit` matches are found or matches get older than `since`.
async function getMatchLinks(page, teamId, limit, since) {
  const links = [];
  let reachedCutoff = false;
  for (let pageNo = 1; links.length < limit && !reachedCutoff; pageNo++) {
    await gotoWithRetry(page, `${BASE}/team/matches/${teamId}/?group=completed&page=${pageNo}`);
    const items = await page.$$eval('a.m-item', as => as.map(a => ({
      href: a.getAttribute('href'),
      date: (a.innerText.match(/\d{4}\/\d{2}\/\d{2}/) || [null])[0],
    })));
    if (items.length === 0) break;
    for (const { href, date } of items) {
      if (since && date && new Date(date.replace(/\//g, '-')) < since) {
        reachedCutoff = true;
        break;
      }
      if (!links.includes(href)) links.push(href);
    }
  }
  return links.slice(0, limit).map(h => BASE + h);
}

async function getMatch(page, url) {
  await gotoWithRetry(page, url);
  return page.evaluate(() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const teams = [...document.querySelectorAll('.match-header-link-name .wf-title-med')].map(e => clean(e.innerText));
    // Header text looks like "FINAL 2 : 1 BO3".
    const scoreMatch = clean(document.querySelector('.match-header-vs-score')?.innerText).match(/(\d+)\s*:\s*(\d+)/);
    const matchScore = scoreMatch ? scoreMatch[0] : null;
    const [s1, s2] = scoreMatch ? [Number(scoreMatch[1]), Number(scoreMatch[2])] : [NaN, NaN];

    const maps = [...document.querySelectorAll('.vm-stats-game')]
      .filter(g => g.getAttribute('data-game-id') !== 'all')
      .map(g => {
        const mapName = clean(g.querySelector('.map > div > span')?.childNodes[0]?.textContent)
          || clean(g.querySelector('.map')?.innerText).split(' ')[0];
        const scores = [...g.querySelectorAll('.vm-stats-game-header .score')].map(e => Number(clean(e.innerText)));
        // Each round column carries the cumulative score (team1-team2) in its title;
        // "Side swap" markers are skipped.
        const rounds = [...g.querySelectorAll('.vlr-rounds-row-col[title]')]
          .map(c => c.getAttribute('title'))
          .filter(t => /^\d+-\d+$/.test(t));
        return {
          map: mapName,
          score: scores.length === 2 ? `${scores[0]}-${scores[1]}` : null,
          rounds: rounds.length ? ['0-0', ...rounds] : [],
        };
      })
      .filter(m => m.map && m.map !== 'TBD');

    return {
      date: document.querySelector('.moment-tz-convert')?.getAttribute('data-utc-ts') || null,
      event: clean(document.querySelector('.match-header-event div > div')?.innerText),
      stage: clean(document.querySelector('.match-header-event-series')?.innerText),
      team1: teams[0],
      team2: teams[1],
      match_result: matchScore ? `${s1}-${s2}` : null,
      winner: isNaN(s1) || s1 === s2 ? null : (s1 > s2 ? teams[0] : teams[1]),
      map_result: maps,
    };
  });
}

(async () => {
  const args = parseArgs(process.argv);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const links = await getMatchLinks(page, args.teamId, args.limit, args.since);
    console.error(`Found ${links.length} matches`);
    const matches = [];
    for (const [i, url] of links.entries()) {
      await sleep(args.delay);
      try {
        const m = await getMatch(page, url);
        matches.push({ url, ...m });
        console.error(`[${i + 1}/${links.length}] ${m.team1} ${m.match_result} ${m.team2}`);
      } catch (e) {
        console.error(`[${i + 1}/${links.length}] FAILED ${url}: ${e.message}`);
      }
    }
    const out = JSON.stringify({
      team_id: args.teamId,
      crawled_at: new Date().toISOString(),
      since: args.since ? args.since.toISOString() : null,
      matches,
    }, null, 2);
    if (args.out) {
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, out);
      console.error(`Saved to ${args.out}`);
    } else {
      console.log(out);
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
