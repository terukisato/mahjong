'use strict';
// Reads the game's version — the newest published entry in
// public/release-notes.js — and writes it into package.json so the two never
// drift. Run automatically by the git pre-commit hook and by
// `npm run release-notes -- publish`; safe to run manually too.

const fs = require('fs');
const path = require('path');
const { loadNotes, currentVersion } = require('./release-notes.js');

const pkgPath = path.join(__dirname, '..', 'package.json');

function syncVersion() {
  let version;
  try { version = currentVersion(loadNotes().list); }
  catch (e) { console.warn(`[sync-version] Could not read public/release-notes.js (${e.message}) — skipping.`); return; }
  if (!version) {
    console.warn('[sync-version] No published version in public/release-notes.js — skipping.');
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.version === version) return;
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[sync-version] package.json version updated to ${version} (from release-notes.js)`);
}

if (require.main === module) syncVersion();

module.exports = { syncVersion };
