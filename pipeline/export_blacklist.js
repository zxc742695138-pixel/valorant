#!/usr/bin/env node
// Turn reports/latest.json (one-sided whitelist) into the public release files:
//   reports/vlr-blacklist.json   { "Pacific": { "whitelist": [...] }, ... }
//   reports/release-notes.md     human-readable summary for the release page
// Whitelist = per region, the "Một chiều" teams: highest share of maps this season that
// ended with a gap of >= gap rounds. Use: bet only when BOTH teams are whitelisted.
//
// Usage:
//   node pipeline/export_blacklist.js [reports/latest.json]

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = path.resolve(process.argv[2] || path.join(ROOT, 'reports/latest.json'));
const report = JSON.parse(fs.readFileSync(src, 'utf8'));

const NAMES = { pacific: 'Pacific', americas: 'Americas', emea: 'EMEA', china: 'China' };
const ORDER = ['pacific', 'americas', 'emea', 'china'];
const regions = [...report.regions].sort((a, b) => ORDER.indexOf(a.region) - ORDER.indexOf(b.region));

const lists = Object.fromEntries(regions.map(r => [NAMES[r.region], { whitelist: r.whitelist }]));
fs.writeFileSync(path.join(ROOT, 'reports/vlr-blacklist.json'), JSON.stringify(lists, null, 2) + '\n');

const pct = t => `${Math.round(100 * t.share)}%`;
const am = regions.find(r => r.region === 'americas') || regions[0];
const [w1, w2] = am.whitelist;
const g1 = am.teams.find(t => t.group === 'Giằng co')?.team;
const lines = [
  '## Cách cược',
  '',
  '1. Chỉ xét map mà **cả hai đội đều nằm trong whitelist** (nhóm Một chiều) của khu vực mình — kể cả trận quốc tế giữa các khu vực.',
  '2. Chờ tới lúc **tổng round của hai đội ≥ 17** và có một đội **dẫn ≥ 3 round** → cược đội đang dẫn.',
  '3. Map có ít nhất một đội **không** nằm trong whitelist → bỏ.',
  '4. Chỉ cược khi **tỉ lệ ăn từ khoảng 1.12 trở lên** (ăn 1.10 chưa có lãi trong backtest).',
  '',
  ...(w1 && w2 && g1 ? [`Ví dụ (Americas): ${w1} vs ${w2} → được cược đội dẫn trước; ${w1} vs ${g1} → bỏ (${g1} thuộc nhóm Giằng co).`, ''] : []),
  '## Danh sách',
  '',
  `- Dữ liệu: vlr.gg, mùa ${report.to.slice(0, 4)} (${report.from} → ${report.to}), mọi giải, chỉ trận giữa hai đội nhượng quyền`,
  `- Chỉ số: % map của đội kết thúc **cách ≥ ${report.gap} round** (thắng đậm hoặc thua đậm)`,
  `- **Whitelist (Một chiều)** = ${report.top}/12 đội có tỉ lệ cao nhất mỗi khu vực; đội có dưới ${report.min_maps} map trong mùa chưa được xếp nhóm (không cược)`,
  '',
  '| Khu vực | Whitelist — Một chiều (% map đậm) | Giằng co | Thay đổi whitelist so với lần trước |',
  '|---|---|---|---|',
  ...regions.map(r => {
    const p = r.previous;
    const change = !p ? '—'
      : p.added.length || p.removed.length
        ? [p.added.length && `vào: ${p.added.join(', ')}`, p.removed.length && `ra: ${p.removed.join(', ')}`].filter(Boolean).join('; ')
        : 'không đổi';
    const by = g => r.teams.filter(t => t.group === g).map(t => `${t.team} ${pct(t)}`).join(', ') || '—';
    return `| ${NAMES[r.region]} | ${by('Một chiều')} | ${by('Giằng co')} | ${change} |`;
  }),
  '',
  ...(report.notes || []).map(n => `- ${n}`),
  ...((report.notes || []).length ? [''] : []),
  'File `report-details.json` chứa số map thắng đậm / thua đậm của từng đội.',
];
fs.writeFileSync(path.join(ROOT, 'reports/release-notes.md'), lines.join('\n') + '\n');

console.log(JSON.stringify(lists));
