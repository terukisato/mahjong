'use strict';
// Release notes helper for public/release-notes.js (the What's New list and
// the game's version — see the comment at the top of that file).
//
//   npm run release-notes -- draft [version]
//     Adds a draft entry at the top, with the commits since the last
//     published version as a starting point, sorted into new / improved /
//     fixed by their wording. Rewrite each line for players (and drop the
//     behind-the-scenes ones). Version defaults to the next minor version.
//     Uncommitted files are listed too, since they can be part of the release.
//
//   npm run release-notes -- publish
//     Publishes the draft: removes `draft`, sets today's date, points the
//     ?v= cache-busters in public/index.html at the new version, and updates
//     package.json. Then commit and deploy.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NOTES_PATH = path.join(ROOT, 'public', 'release-notes.js');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const PKG_PATH = path.join(ROOT, 'package.json');
const SECTIONS = ['new', 'improved', 'fixed'];
const MARKER = 'const RELEASE_NOTES=';

// The file is a plain browser script (`const RELEASE_NOTES=[...]`), so it is
// run in a sandbox rather than parsed as JSON.
function parseNotes(src) {
  const list = vm.runInNewContext(`${src}\n;RELEASE_NOTES`);
  if (!Array.isArray(list)) throw new Error('RELEASE_NOTES is not an array');
  return list;
}
function loadNotes() {
  const src = fs.readFileSync(NOTES_PATH, 'utf8');
  return { src, list: parseNotes(src) };
}
// The newest entry that isn't a draft — the game's version.
function currentVersion(list) {
  const e = list.find(x => !x.draft);
  return e ? e.version : null;
}

// Writes the list back in the file's one fixed shape, keeping the comment
// header above `const RELEASE_NOTES=`.
function serialize(header, list) {
  const q = JSON.stringify;
  const entries = list.map(e => {
    const lines = ['  {', `    version:${q(e.version)},`, `    date:${q(e.date)},`];
    if (e.draft) lines.push('    draft:true,');
    for (const k of SECTIONS) {
      if (!e[k] || !e[k].length) continue;
      lines.push(`    ${k}:[`, ...e[k].map(t => `      ${q(t)},`), '    ],');
    }
    lines.push('  },');
    return lines.join('\n');
  });
  return `${header}${MARKER}[\n${entries.join('\n')}\n];\n`;
}
function saveNotes(src, list) {
  const at = src.indexOf(MARKER);
  if (at < 0) throw new Error(`${MARKER} not found in ${NOTES_PATH}`);
  fs.writeFileSync(NOTES_PATH, serialize(src.slice(0, at), list));
}

function cmpVersion(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
function nextMinor(v) {
  const [maj, min] = v.split('.').map(Number);
  return `${maj}.${min + 1}.0`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Commit subjects that aren't player-facing (CI, tests, version bumps,
// merges) are dropped; the rest are sorted by their first word.
const SKIP_RE = /^(ci|tests?|chore|merge|version update|wip)\b/i;
function classify(subject) {
  if (/^(fix(es|ed)?|bug)\b/i.test(subject)) return 'fixed';
  if (/^(add(s|ed)?|new|implement(s|ed)?|introduce[sd]?)\b|\b(added|implemented)\b/i.test(subject)) return 'new';
  return 'improved';
}
function draftFromSubjects(subjects) {
  const out = { new: [], improved: [], fixed: [] };
  for (const raw of subjects) {
    const s = raw.trim();
    if (!s || SKIP_RE.test(s)) continue;
    out[classify(s)].push(s);
  }
  return out;
}

function git(args) {
  // trimEnd: `status --porcelain` lines start with a significant space.
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trimEnd();
}
// The commit that released `version`: the oldest one that added its entry
// to release-notes.js. Before that file existed, versions lived in the
// About title in index.html, so fall back to the last commit that changed it.
function releaseCommit(version) {
  const added = git(['log', '--format=%H', '-S', `version:${JSON.stringify(version)}`, '--', 'public/release-notes.js']);
  if (added) return { hash: added.split('\n').pop(), what: `v${version}` };
  const old = git(['log', '-1', '--format=%H', '-G', 'about-version">v', '--', 'public/index.html']);
  return old ? { hash: old, what: 'the last version change in index.html' } : null;
}

function draft(versionArg) {
  const { src, list } = loadNotes();
  if (list[0] && list[0].draft) {
    console.error(`v${list[0].version} is already a draft at the top of public/release-notes.js — edit it, or publish it first.`);
    process.exit(1);
  }
  const cur = currentVersion(list);
  const version = versionArg ? versionArg.replace(/^v/, '') : (cur ? nextMinor(cur) : '0.1.0');
  if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error(`Not a version: ${versionArg}`); process.exit(1); }
  if (cur && cmpVersion(version, cur) <= 0) { console.error(`v${version} isn't newer than v${cur}.`); process.exit(1); }

  const since = cur ? releaseCommit(cur) : null;
  const log = git(['log', '--no-merges', '--format=%s', since ? `${since.hash}..HEAD` : '-30']);
  const subjects = log ? log.split('\n') : [];
  const sections = draftFromSubjects(subjects);
  const entry = { version, date: today(), draft: true, ...sections };
  if (!SECTIONS.some(k => sections[k].length)) entry.new = ['Describe this release.'];
  saveNotes(src, [entry, ...list]);

  console.log(`Drafted v${version} in public/release-notes.js from ${subjects.length} commit${subjects.length === 1 ? '' : 's'}` +
    (since ? ` since ${since.hash.slice(0, 7)} (${since.what}).` : '.'));
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean)
    .map(l => l.slice(3)).filter(f => f !== 'public/release-notes.js');
  if (dirty.length) console.log(`Not committed yet, and maybe part of this release:\n  ${dirty.join('\n  ')}`);
  console.log('Rewrite the lines for players, then: npm run release-notes -- publish');
}

function publish() {
  const { src, list } = loadNotes();
  const e = list[0];
  if (!e || !e.draft) { console.error('No draft at the top of public/release-notes.js — start one with: npm run release-notes -- draft'); process.exit(1); }
  delete e.draft;
  e.date = today();
  saveNotes(src, list);

  // Browsers keep cached copies of these files; a new ?v= makes them fetch
  // this version's.
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const busted = html.replace(/(\/(?:script|style|release-notes)\.(?:js|css)\?v=)[\d.]+/g, `$1${e.version}`);
  if (busted !== html) fs.writeFileSync(HTML_PATH, busted);

  require('./sync-version.js').syncVersion();
  console.log(`Published v${e.version} (${e.date}). Commit and deploy to release it.`);
}

// Exported before the CLI runs: publish() requires sync-version.js, which
// requires this file back.
module.exports = { NOTES_PATH, SECTIONS, parseNotes, loadNotes, currentVersion, serialize, cmpVersion, nextMinor, classify, draftFromSubjects };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'draft') draft(arg);
  else if (cmd === 'publish') publish();
  else {
    console.log('Usage: npm run release-notes -- draft [version]\n       npm run release-notes -- publish');
    process.exit(cmd ? 1 : 0);
  }
}
