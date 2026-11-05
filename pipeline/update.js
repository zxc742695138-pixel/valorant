#!/usr/bin/env node
// One-shot refresh of the team whitelist/blacklist report:
//   1. (optional) rebuild team lists from the events in config.json
//   2. crawl every team's matches in the last `days` days
//   3. validate the data (maps without round data, score mismatches)
//   4. group every partner team from the last `groups.window_days` days (see
//      analysis/team_groups.js): whitelist = "Trung bình", blacklist = the rest
//   5. compare with the previous run, build reports/latest.html, archive the JSON
//
// Usage:
//   node pipeline/update.js [--refresh-teams] [--skip-crawl] [--days N]

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { computeGroups } = require('../analysis/team_groups');
const { MIN_TOTAL, MIN_DIFF } = require('../analysis/comeback');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const days = Number(opt('--days') || config.days);

const rel = p => path.join(ROOT, p);
const teamFile = region => rel(`crawler/teams/${region}.json`);
const regions = Object.keys(config.regions);
const log = msg => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function run(args, opts = {}) {
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0) throw new Error(`node ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

// Run crawl jobs with limited concurrency; each job resolves to its stderr log.
function crawlAll(teams) {
  return new Promise(resolve => {
    const results = {};
    let next = 0, running = 0, done = 0;
    const launch = () => {
      while (running < config.concurrency && next < teams.length) {
        const t = teams[next++];
        running++;
        let out = '';
        const child = spawn('node', ['crawler/crawl_team.js', '--team-id', t.id, '--days', String(days), '--out', `data/${t.slug}.json`], { cwd: ROOT });
        child.stderr.on('data', d => { out += d; });
        child.on('close', code => {
          running--; done++;
          results[t.slug] = { code, out };
          const failed = (out.match(/FAILED/g) || []).length;
          log(`  ${String(done).padStart(2)}/${teams.length} ${t.name}: ${(out.match(/Found \d+ matches/) || ['?'])[0]}${failed ? `, ${failed} trận lỗi` : ''}${code ? ' — LỖI' : ''}`);
          if (done === teams.length) resolve(results);
          else launch();
        });
      }
    };
    launch();
  });
}

(async () => {
  // 1. Team lists
  if (flag('--refresh-teams')) {
    log('Cập nhật danh sách đội từ các giải trong config.json');
    for (const region of regions) {
      run(['crawler/event_teams.js', '--event-url', config.regions[region], '--out', `crawler/teams/${region}.json`]);
    }
  }
  const allTeams = regions.flatMap(region => JSON.parse(fs.readFileSync(teamFile(region), 'utf8')));

  // 2. Crawl (one retry for teams with any failed match or a crashed crawl)
  if (!flag('--skip-crawl')) {
    log(`Crawl ${allTeams.length} đội, ${days} ngày gần nhất`);
    let results = await crawlAll(allTeams);
    let retry = allTeams.filter(t => results[t.slug].code || /FAILED/.test(results[t.slug].out));
    if (retry.length) {
      log(`Crawl lại ${retry.length} đội có lỗi`);
      results = await crawlAll(retry);
      retry = retry.filter(t => results[t.slug].code || /FAILED/.test(results[t.slug].out));
      if (retry.length) {
        // Stop here: continuing would publish a report built on stale or partial data.
        log(`!! Vẫn lỗi sau khi thử lại: ${retry.map(t => t.name).join(', ')}`);
        retry.forEach(t => console.error(`--- ${t.name}\n${results[t.slug].out.slice(-2000)}`));
        process.exit(1);
      }
    }
  }

  // 3. Validate
  log('Kiểm tra dữ liệu');
  const notes = [];
  const missingByEvent = {};
  const seen = new Set();
  let mismatches = 0;
  for (const region of regions) {
    for (const t of JSON.parse(fs.readFileSync(teamFile(region), 'utf8'))) {
      const d = JSON.parse(fs.readFileSync(rel(`data/${t.slug}.json`), 'utf8'));
      if (!d.matches.length) notes.push(`${t.name} không có trận nào trong ${days} ngày.`);
      for (const m of d.matches) {
        if (seen.has(m.url)) continue;
        seen.add(m.url);
        for (const mp of m.map_result) {
          if (!mp.rounds.length) {
            const e = (missingByEvent[m.event] = missingByEvent[m.event] || { maps: 0, from: m.date, to: m.date });
            e.maps++;
            if (m.date < e.from) e.from = m.date;
            if (m.date > e.to) e.to = m.date;
          } else if (mp.rounds[mp.rounds.length - 1] !== mp.score) {
            mismatches++;
          }
        }
      }
    }
  }
  const ddmm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  for (const [event, e] of Object.entries(missingByEvent)) {
    notes.push(`${e.maps} map của ${event} (${ddmm(e.from)}–${ddmm(e.to)}) không có dữ liệu từng round trên vlr.gg nên không được tính.`);
  }
  log(`  ${seen.size} trận; ${Object.values(missingByEvent).reduce((s, e) => s + e.maps, 0)} map thiếu dữ liệu round; ${mismatches} map tỉ số không khớp`);
  if (mismatches) notes.push(`${mismatches} map có round cuối không khớp tỉ số map; cần kiểm tra lại crawler.`);

  // 4. Team groups from the last `groups.window_days` days: whitelist = "Trung bình",
  //    blacklist = every other partner team.
  const latestJson = rel('reports/latest.json');
  const previous = fs.existsSync(latestJson) ? JSON.parse(fs.readFileSync(latestJson, 'utf8')) : null;
  const G = config.groups;
  let crawledAt = '';
  for (const t of allTeams) {
    const d = JSON.parse(fs.readFileSync(rel(`data/${t.slug}.json`), 'utf8'));
    if (d.crawled_at > crawledAt) crawledAt = d.crawled_at;
  }
  const to = crawledAt.slice(0, 10);
  const from = new Date(Date.parse(to) - G.window_days * 864e5).toISOString().slice(0, 10);
  log(`Xếp nhóm đội theo ${G.window_days} ngày gần nhất (${from} → ${to})`);
  const res = computeGroups({ dataDir: rel('data'), teamsDir: rel('crawler/teams'), from, to, net: G.net, volatile: G.volatile, minMaps: G.min_maps || 0 });
  const report = {
    kind: 'groups', crawled_at: crawledAt, from, to, last_match: res.lastDay,
    window_days: G.window_days, net: G.net, volatile: G.volatile, min_maps: G.min_maps || 0,
    min_total: MIN_TOTAL, min_diff: MIN_DIFF, notes,
    regions: regions.map(r => {
      const teams = res.regions[r];
      return {
        region: r, teams,
        whitelist: teams.filter(t => t.group === 'Trung bình').map(t => t.team),
        blacklist: teams.filter(t => t.group !== 'Trung bình').map(t => t.team),
      };
    }),
  };

  // 5. Compare with the previous run (whitelist changes)
  console.log('\n================ KẾT QUẢ ================');
  for (const r of report.regions) {
    const prev = previous?.kind === 'groups' ? previous.regions.find(p => p.region === r.region) : null;
    if (prev) {
      r.previous = {
        crawled_at: previous.crawled_at,
        added: r.whitelist.filter(t => !prev.whitelist.includes(t)),
        removed: prev.whitelist.filter(t => !r.whitelist.includes(t)),
      };
    }
    console.log(`\n${r.region.toUpperCase()}`);
    console.log(`  Whitelist: ${r.whitelist.join(', ') || '—'}`);
    console.log(`  Blacklist: ${r.teams.filter(t => t.group !== 'Trung bình').map(t => `${t.team} (${t.group})`).join(', ') || '—'}`);
    if (r.previous) {
      const p = r.previous;
      console.log(`  So với ${p.crawled_at.slice(0, 10)}: ${p.added.length || p.removed.length ? `vào whitelist: ${p.added.join(', ') || 'không'}; rời whitelist: ${p.removed.join(', ') || 'không'}` : 'whitelist không đổi'}`);
    }
  }
  fs.writeFileSync(latestJson, JSON.stringify(report, null, 2) + '\n');

  // Build the HTML report and archive this run's JSON.
  run(['reports/build.js', 'reports/latest.json', 'reports/latest.html']);
  const archive = rel(`reports/archive/${report.crawled_at.slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.copyFileSync(latestJson, archive);
  run(['pipeline/export_blacklist.js']);
  log(`Đã lưu reports/latest.html, reports/latest.json, reports/vlr-blacklist.json, ${path.relative(ROOT, archive)}`);
  if (notes.length) console.log(`\nGhi chú:\n${notes.map(n => `  - ${n}`).join('\n')}`);
})().catch(e => { console.error(e); process.exit(1); });
