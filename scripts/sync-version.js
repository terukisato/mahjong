'use strict';
// Reads the version shown in the about modal (public/index.html) and writes
// it into package.json so the two never drift. Run automatically by the
// git pre-commit hook; safe to run manually too.

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const pkgPath = path.join(__dirname, '..', 'package.json');

const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/about-version">v?([\d.]+)</);
if (!match) {
  console.warn('[sync-version] Could not find a version in public/index.html — skipping.');
  process.exit(0);
}
const htmlVersion = match[1];

const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);

if (pkg.version === htmlVersion) {
  process.exit(0);
}

pkg.version = htmlVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[sync-version] package.json version updated to ${htmlVersion} (from index.html)`);
