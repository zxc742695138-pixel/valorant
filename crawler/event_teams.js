#!/usr/bin/env node
// Build a team list (id, slug, name) from a vlr.gg event's group stage page.
//
// Usage:
//   node crawler/event_teams.js --event-url https://www.vlr.gg/event/2977/vct-2026-americas-stage-2 --out crawler/teams/americas.json

const fs = require('fs');
const { chromium } = require('playwright');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    args[argv[i].replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  if (!args.eventUrl) {
    console.error('Usage: node crawler/event_teams.js --event-url <vlr event url> [--out teams.json]');
    process.exit(1);
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // Playoffs only show the qualified teams; the group stage lists the whole league.
    const base = args.eventUrl.replace(/\/$/, '');
    await page.goto(`${base}/group-stage`, { timeout: 60000, waitUntil: 'domcontentloaded' });
    const teams = await page.$$eval('a[href^="/team/"]', as => {
      const seen = new Map();
      for (const a of as) {
        const [, id, slug] = a.getAttribute('href').match(/^\/team\/(\d+)\/([^/?#]+)/) || [];
        if (id && !seen.has(id)) seen.set(id, { id, slug, name: a.innerText.trim().split('\n')[0].trim() }); // 2nd line is the country
      }
      return [...seen.values()];
    });
    const out = JSON.stringify(teams, null, 2) + '\n';
    if (args.out) fs.writeFileSync(args.out, out);
    else process.stdout.write(out);
    console.error(`${teams.length} teams${args.out ? ` saved to ${args.out}` : ''}`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
