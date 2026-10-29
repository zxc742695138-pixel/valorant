#!/usr/bin/env node
// Embed an iterative_exclude.js --json result into the HTML report template.
//
// Usage:
//   node reports/build.js reports/comeback-180d.json reports/comeback-180d.html --days 180

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const daysFlag = argv.indexOf('--days');
const days = daysFlag >= 0 ? Number(argv.splice(daysFlag, 2)[1]) : null;
const [jsonFile, outFile] = argv;
if (!jsonFile || !outFile) {
  console.error('Usage: node reports/build.js <result.json> <out.html> [--days N]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
data.days = days;
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
// Escape "</" so team names can never close the inline <script>.
const json = JSON.stringify(data).replace(/<\//g, '<\\/');
fs.writeFileSync(outFile, template.replace('/*DATA*/null', json));
console.log(`Saved to ${outFile}`);
