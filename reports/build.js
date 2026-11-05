#!/usr/bin/env node
// Embed reports/latest.json (team groups) into the HTML report template.
//
// Usage:
//   node reports/build.js reports/latest.json reports/latest.html

const fs = require('fs');
const path = require('path');

const [jsonFile, outFile] = process.argv.slice(2);
if (!jsonFile || !outFile) {
  console.error('Usage: node reports/build.js <latest.json> <out.html>');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
// Escape "</" so team names can never close the inline <script>.
const json = JSON.stringify(data).replace(/<\//g, '<\\/');
fs.writeFileSync(outFile, template.replace('/*DATA*/null', json));
console.log(`Saved to ${outFile}`);
