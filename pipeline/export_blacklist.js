#!/usr/bin/env node
// Turn reports/latest.json into the public release files:
//   reports/vlr-blacklist.json   { "Pacific": [...5 teams], "Americas": [...], "EMEA": [...], "China": [...] }
//   reports/release-notes.md     human-readable summary for the release page
// Teams are listed in removal order (most influential first).
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
const top5 = r => r.steps.slice(0, report.steps).map(s => s.removed.team);

const blacklist = Object.fromEntries(regions.map(r => [NAMES[r.region] || r.region, top5(r)]));
fs.writeFileSync(path.join(ROOT, 'reports/vlr-blacklist.json'), JSON.stringify(blacklist, null, 2) + '\n');

const pct = x => `${(100 * x).toFixed(1)}%`;
const day = iso => iso.slice(0, 10);
const lines = [
  `Top ${report.steps} đội mỗi khu vực gây lật kèo nhiều nhất, theo thứ tự loại.`,
  '',
  `- Dữ liệu: vlr.gg, ${day(report.since)} → ${day(report.crawled_at)}`,
  `- Map lật kèo: có thời điểm tổng round ≥ ${report.min_total} mà một đội dẫn ≥ ${report.min_diff} round, nhưng đội đó thua map`,
  `- Thuật toán: loại đội có nhiều map lật kèo nhất (bằng nhau thì xét tỉ lệ), bỏ các map có đội đó, tính lại; lặp ${report.steps} lần`,
  '',
  '| Khu vực | Top 5 | Tỉ lệ lật kèo ban đầu → sau khi loại | Thay đổi so với lần trước |',
  '|---|---|---|---|',
  ...regions.map(r => {
    const a = r.steps[0], z = r.steps[report.steps], p = r.previous;
    const change = !p ? '—'
      : p.added.length || p.dropped.length
        ? [p.added.length && `vào: ${p.added.join(', ')}`, p.dropped.length && `rời: ${p.dropped.join(', ')}`].filter(Boolean).join('; ')
        : 'không đổi';
    return `| ${NAMES[r.region]} | ${top5(r).join(', ')} | ${pct(a.rate)} → ${pct(z.rate)} | ${change} |`;
  }),
];
const ties = regions.flatMap(r => r.steps.filter(s => s.tie_with).map(s =>
  `- ${NAMES[r.region]}, lần loại ${s.step + 1}: ${s.removed.team} đồng hạng với ${s.tie_with}`
  + (s.tie_alt_rate != null ? ` (loại ${s.tie_with} thay thế: ${pct(s.tie_alt_rate)})` : '')));
if (ties.length) lines.push('', '**Đồng hạng**', ...ties);
lines.push('', 'File `report-details.json` chứa bảng đầy đủ sau từng lần loại.');
fs.writeFileSync(path.join(ROOT, 'reports/release-notes.md'), lines.join('\n') + '\n');

console.log(JSON.stringify(blacklist));
