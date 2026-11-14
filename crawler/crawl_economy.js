#!/usr/bin/env node
// Per-round economy of every map of a vlr.gg match (tab=economy): bank and loadout value of
// each team, buy type (pistol / eco / half / full), round winner and the side it won on.
//
// Usage:
//   node crawler/crawl_economy.js --urls urls.txt --out data-econ [--concurrency 4] [--delay 800]
//   node crawler/crawl_economy.js --url https://www.vlr.gg/754739/... --out data-econ
//
// Output: <out>/<match id>.json = { url, crawled_at, maps: [{ game_id, map, rounds: [
//   { bank: [t1, t2] (k$ at round start), load: [t1, t2] (k$), buy: ['full'|'half'|'eco'|'pistol' ×2],
//     win: 1|2, side1: 't'|'ct' }] }] }
// Matches whose economy tab is empty are written with maps: [] so they are not retried.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const outDir = opt('--out', 'data-econ');
const concurrency = Number(opt('--concurrency', 4));
const delay = Number(opt('--delay', 800));
const urls = opt('--url') ? [opt('--url')] : fs.readFileSync(opt('--urls'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idOf = url => (url.match(/vlr\.gg\/(\d+)\//) || [])[1];

const BUY = { 'mod-bp': 'pistol', 'mod-b1': 'eco', 'mod-b2': 'half', 'mod-b3': 'full' };
async function crawl(page, url) {
  const econUrl = url.replace(/\/?(\?.*)?$/, '') + '/?tab=economy';
  let html = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(econUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
      const ok = await page.$('.vm-stats-game');
      if (ok) { html = true; break; }
    } catch (e) { /* retry */ }
    await sleep(5000 * attempt);
  }
  if (!html) throw new Error('no stats on page');
  return page.evaluate((BUY) => {
    const names = {};
    document.querySelectorAll('.vm-stats-gamesnav-item[data-game-id]').forEach(e => { names[e.getAttribute('data-game-id')] = e.innerText.trim().replace(/^\d+\s*/, '').replace(/\s+/g, ' '); });
    const maps = [];
    for (const g of document.querySelectorAll('.vm-stats-game[data-game-id]')) {
      const gid = g.getAttribute('data-game-id');
      if (gid === 'all') continue;
      const rounds = [];
      for (const col of g.querySelectorAll('.vlr-rounds-row-col')) {
        if (col.classList.contains('mod-teams')) continue;
        const c1 = col.querySelector('.ecc-c.mod-t1'), c2 = col.querySelector('.ecc-c.mod-t2');
        if (!c1 || !c2) continue;
        const sq1 = c1.querySelector('.ecc-sq'), sq2 = c2.querySelector('.ecc-sq');
        if (!sq1 || !sq2) continue;
        const buy = el => { for (const k of Object.keys(BUY)) if (el.classList.contains(k)) return BUY[k]; return null; };
        const win = sq1.classList.contains('mod-win') ? 1 : sq2.classList.contains('mod-win') ? 2 : 0;
        if (!win) continue; // not played
        const winner = win === 1 ? sq1 : sq2;
        const winSide = winner.classList.contains('mod-t') ? 't' : winner.classList.contains('mod-ct') ? 'ct' : null;
        const side1 = winSide ? (win === 1 ? winSide : winSide === 't' ? 'ct' : 't') : null;
        const num = s => { const m = (s || '').match(/([\d.]+)k/); return m ? Number(m[1]) : null; };
        const b1 = col.querySelector('.ecr-bank.mod-t1'), b2 = col.querySelector('.ecr-bank.mod-t2');
        rounds.push({ bank: [num(b1 && b1.getAttribute('title')), num(b2 && b2.getAttribute('title'))], load: [num(c1.getAttribute('title')), num(c2.getAttribute('title'))], buy: [buy(sq1), buy(sq2)], win, side1 });
      }
      maps.push({ game_id: gid, map: names[gid] || null, rounds });
    }
    return maps;
  }, BUY);
}

(async () => {
  const todo = urls.filter(u => idOf(u) && !fs.existsSync(path.join(outDir, `${idOf(u)}.json`)));
  console.error(`${todo.length}/${urls.length} trận cần crawl`);
  const browser = await chromium.launch();
  let next = 0, done = 0, failed = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    const page = await browser.newPage();
    while (next < todo.length) {
      const url = todo[next++];
      try {
        const maps = await crawl(page, url);
        fs.writeFileSync(path.join(outDir, `${idOf(url)}.json`), JSON.stringify({ url, crawled_at: new Date().toISOString(), maps }));
        done++;
        if (done % 25 === 0) console.error(`${done}/${todo.length} xong, ${failed} lỗi`);
      } catch (e) { failed++; console.error(`FAILED ${url}: ${e.message}`); }
      await sleep(delay);
    }
    await page.close();
  }));
  await browser.close();
  console.error(`Xong: ${done} trận, ${failed} lỗi`);
})().catch(e => { console.error(e); process.exit(1); });
