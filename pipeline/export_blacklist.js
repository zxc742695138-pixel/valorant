#!/usr/bin/env node
// Turn reports/latest.json (team groups) into the public release files:
//   reports/vlr-blacklist.json   { "Pacific": { "whitelist": [...], "blacklist": [...] }, ... }
//   reports/release-notes.md     human-readable summary for the release page
// Whitelist = teams in the "Trung bình" group; blacklist = every other partner team.
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

const lists = Object.fromEntries(regions.map(r => [NAMES[r.region], { whitelist: r.whitelist, blacklist: r.blacklist }]));
fs.writeFileSync(path.join(ROOT, 'reports/vlr-blacklist.json'), JSON.stringify(lists, null, 2) + '\n');

const lines = [
  '**Cách dùng:** chỉ cược map khi **cả hai đội đều nằm trong whitelist** (kể cả trận quốc tế giữa các khu vực). Cược đội đang dẫn ≥ 3 round khi tổng round ≥ 17.',
  '',
  `- Dữ liệu: vlr.gg, ${report.window_days} ngày gần nhất (${report.from} → ${report.to}), chỉ trận giữa hai đội nhượng quyền`,
  `- Lật được: bị dẫn ≥ ${report.min_diff} round khi tổng round ≥ ${report.min_total} nhưng thắng map. Bị lật: dẫn như vậy nhưng thua map`,
  `- **Whitelist** = nhóm Trung bình: |lật được − bị lật| < ${report.net} và lật được + bị lật < ${report.volatile}`,
  `- **Blacklist** = các đội còn lại: Mạnh (lật được − bị lật ≥ +${report.net}), Yếu (≤ −${report.net}), Không ổn định (lật được + bị lật ≥ ${report.volatile})`,
  ...(report.min_maps ? [`- Đội có dưới ${report.min_maps} map có tình huống dẫn ≥ ${report.min_diff} trong kỳ: Chưa đủ dữ liệu (blacklist)`] : []),
  '',
  '| Khu vực | Whitelist | Blacklist | Thay đổi whitelist so với lần trước |',
  '|---|---|---|---|',
  ...regions.map(r => {
    const p = r.previous;
    const change = !p ? '—'
      : p.added.length || p.removed.length
        ? [p.added.length && `vào: ${p.added.join(', ')}`, p.removed.length && `rời: ${p.removed.join(', ')}`].filter(Boolean).join('; ')
        : 'không đổi';
    const black = r.teams.filter(t => t.group !== 'Trung bình').map(t => `${t.team} (${t.group})`).join(', ');
    return `| ${NAMES[r.region]} | ${r.whitelist.join(', ') || '—'} | ${black || '—'} | ${change} |`;
  }),
  '',
  'File `report-details.json` chứa số lần lật được / bị lật của từng đội.',
];
fs.writeFileSync(path.join(ROOT, 'reports/release-notes.md'), lines.join('\n') + '\n');

console.log(JSON.stringify(lists));
