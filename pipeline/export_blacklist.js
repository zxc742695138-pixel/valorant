#!/usr/bin/env node
// Turn reports/latest.json (close-finish blacklist) into the public release files:
//   reports/vlr-blacklist.json   { "Pacific": { "blacklist": [...] }, ... }
//   reports/release-notes.md     human-readable summary for the release page
// Blacklist = per region, the teams with the highest share of maps finishing 13-11 or in
// overtime over each team's last matches. Use: skip a bet when the leading team is blacklisted.
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

const lists = Object.fromEntries(regions.map(r => [NAMES[r.region], { blacklist: r.blacklist }]));
fs.writeFileSync(path.join(ROOT, 'reports/vlr-blacklist.json'), JSON.stringify(lists, null, 2) + '\n');

const pct = t => `${Math.round(100 * t.rate)}% (${t.close}/${t.maps})`;
const lines = [
  '## Cách cược',
  '',
  '1. Chờ tới lúc **tổng round của hai đội ≥ 17** và có một đội **dẫn ≥ 3 round**.',
  '2. Xem **đội đang dẫn** có trong blacklist của khu vực nó không:',
  '   - **Có** → bỏ, không cược map này.',
  '   - **Không** → cược đội đang dẫn, **kể cả khi đội bị dẫn nằm trong blacklist**.',
  '3. **Không cược** các giải EWC, vòng loại EWC và Champions.',
  '4. Chỉ cược khi **tỉ lệ ăn từ khoảng 1.12 trở lên** (ăn 1.10 là lỗ trong backtest).',
  '',
  `Ví dụ (Americas: ${(regions.find(r => r.region === 'americas') || regions[0]).blacklist.join(', ')}): ${(() => { const r = regions.find(x => x.region === 'americas') || regions[0]; const b = r.blacklist[0]; const o = r.teams.find(t => !t.blacklisted)?.team; return b && o ? `${b} dẫn ${o} 10-7 → không cược; ${o} dẫn ${b} 10-7 → cược ${o}.` : ''; })()}`,
  '',
  '## Danh sách',
  '',
  `- Dữ liệu: vlr.gg, ${report.last_matches ? `${report.last_matches} trận gần nhất của mỗi đội (mỗi trận gồm mọi map), tính đến ${report.to}` : `${report.window_days} ngày gần nhất (${report.from} → ${report.to})`}, chỉ trận giữa hai đội nhượng quyền${report.exclude_events ? `; không tính giải khớp \`${report.exclude_events}\`` : ''}`,
  `- Chỉ số: % map của đội kết thúc **13-11** (thắng hoặc thua) hoặc phải đá **hiệp phụ**`,
  `- **Blacklist** = ${report.top} đội có tỉ lệ cao nhất mỗi khu vực (bằng tỉ lệ: đội đá nhiều map hơn xếp trên)`,
  '',
  '| Khu vực | Blacklist (tỉ lệ 13-11/OT, số map) | Thay đổi so với lần trước |',
  '|---|---|---|',
  ...regions.map(r => {
    const p = r.previous;
    const change = !p ? '—'
      : p.added.length || p.removed.length
        ? [p.added.length && `vào: ${p.added.join(', ')}`, p.removed.length && `ra: ${p.removed.join(', ')}`].filter(Boolean).join('; ')
        : 'không đổi';
    const black = r.teams.filter(t => t.blacklisted).map(t => `${t.team} ${pct(t)}`).join(', ');
    return `| ${NAMES[r.region]} | ${black || '—'} | ${change} |`;
  }),
  '',
  ...(report.notes || []).map(n => `- ${n}`),
  ...((report.notes || []).length ? [''] : []),
  'File `report-details.json` chứa tỉ lệ của cả 12 đội mỗi khu vực.',
];
fs.writeFileSync(path.join(ROOT, 'reports/release-notes.md'), lines.join('\n') + '\n');

console.log(JSON.stringify(lists));
