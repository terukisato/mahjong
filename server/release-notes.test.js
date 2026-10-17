'use strict';
// Checks public/release-notes.js (the What's New list and the game's
// version) is well formed, and that scripts/release-notes.js can rewrite it
// without losing anything. Lives with the server suites so `npm test` and CI
// pick it up. Run with: node --test server/release-notes.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const RN = require('../scripts/release-notes.js');

const src = fs.readFileSync(RN.NOTES_PATH, 'utf8');
const list = RN.parseNotes(src);
const KEYS = new Set(['version', 'date', 'draft', ...RN.SECTIONS]);

test('release notes: every entry is well formed', () => {
  assert.ok(list.length > 0, 'at least one entry');
  for (const e of list) {
    const at = `v${e.version}`;
    assert.match(e.version, /^\d+\.\d+\.\d+$/, `${at}: version is x.y.z`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `${at}: date is YYYY-MM-DD`);
    assert.ok(!isNaN(new Date(e.date + 'T00:00:00')), `${at}: date is a real date`);
    for (const k of Object.keys(e)) assert.ok(KEYS.has(k), `${at}: unknown field "${k}"`);
    if ('draft' in e) assert.strictEqual(e.draft, true, `${at}: draft is true or absent`);
    let lines = 0;
    for (const k of RN.SECTIONS) {
      if (!(k in e)) continue;
      assert.ok(Array.isArray(e[k]), `${at}: ${k} is a list`);
      for (const t of e[k]) assert.ok(typeof t === 'string' && t.trim(), `${at}: ${k} lines are non-empty text`);
      lines += e[k].length;
    }
    assert.ok(lines > 0, `${at}: has at least one line`);
  }
});

test('release notes: newest first, a published version, a draft only on top', () => {
  for (let i = 1; i < list.length; i++) {
    assert.ok(RN.cmpVersion(list[i - 1].version, list[i].version) > 0,
      `v${list[i - 1].version} should be newer than the v${list[i].version} below it`);
  }
  assert.ok(RN.currentVersion(list), 'at least one entry is published');
  list.slice(1).forEach(e => assert.ok(!e.draft, `v${e.version}: only the top entry can be a draft`));
});

test('release notes: the script rewrites the file without changing it', () => {
  const header = src.slice(0, src.indexOf('const RELEASE_NOTES='));
  // Via JSON: each parse runs in its own vm context, so the arrays have
  // different prototypes and deepStrictEqual would never match them.
  const plain = x => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(plain(RN.parseNotes(RN.serialize(header, list))), plain(list));
  // Already in the script's shape, so a rewrite is a no-op.
  assert.strictEqual(RN.serialize(header, list), src.replace(/\r\n/g, '\n'));
});

test('release notes: drafting sorts commit subjects and skips internal ones', () => {
  const d = RN.draftFromSubjects([
    'Fixed scroll bar issue on the game screen.',
    'Contact form added. Players can now contact the team.',
    'Store implmented. Users can now buy cosmetics.',
    'Change table frame darkness.',
    'CI: bump checkout/setup-node to v7',
    'Version update: v0.16.0 → v0.16.1',
    'Merge branch win',
  ]);
  assert.deepStrictEqual(d.fixed, ['Fixed scroll bar issue on the game screen.']);
  assert.deepStrictEqual(d.new, ['Contact form added. Players can now contact the team.']);
  assert.deepStrictEqual(d.improved, ['Store implmented. Users can now buy cosmetics.', 'Change table frame darkness.']);
  assert.strictEqual(RN.nextMinor('0.18.3'), '0.19.0');
});
