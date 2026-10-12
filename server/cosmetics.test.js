'use strict';
// Regression tests for cosmetics.js — focused on the win/riichi call styles
// (CATALOG.callstyle): the free default, buying, the owned list, the equip
// gate, and that the equipped style persists on the profile. Same
// plain-assertion convention as economy.test.js.
// Run with: node --test server/cosmetics.test.js
//
// DATA_DIR is read once, at module load — set it to a fresh temp directory
// BEFORE requiring anything that opens the database.
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-cosmetics-test-'));
const { getDb } = require('./db');
const P = require('./profiles');
const C = require('./cosmetics');

let n = 0;
// A real profile (equip writes onto the profiles row) with `coins` in its wallet.
function freshProfile(coins = 0) {
  const name = `Tester${n++}`;
  assert.ok(P.createProfile(name, 'code1234').ok);
  const id = P.getId(name);
  getDb().prepare('INSERT INTO coins (profile_id, balance) VALUES (?, ?)').run(id, coins);
  return { id, name };
}

test('everyone owns the default call style, including signed-out players', () => {
  assert.deepStrictEqual(C.getOwned(null).callStyles, ['default']);
  const { id } = freshProfile();
  assert.deepStrictEqual(C.getOwned(id).callStyles, ['default']);
});

test('a new profile starts on the default call style', () => {
  const { name } = freshProfile();
  assert.strictEqual(P.getCallStyle(name), 'default');
});

test('buying a call style charges the catalog price and adds it to callStyles', () => {
  const { id } = freshProfile(5000);
  const price = C.CATALOG.callstyle.sensu.price;
  const r = C.purchase(id, 'sensu');
  assert.deepStrictEqual([r.ok, r.balance], [true, 5000 - price]);
  const owned = C.getOwned(id);
  assert.ok(owned.callStyles.includes('sensu'));
  assert.ok(!owned.nameplates.includes('sensu'), 'a call style must not land in nameplates');
});

test('a call style can only be bought once', () => {
  const { id } = freshProfile(5000);
  assert.ok(C.purchase(id, 'noren').ok);
  const again = C.purchase(id, 'noren');
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.error, 'Already owned');
});

test('buying is refused without enough coins, and nothing is recorded', () => {
  const { id } = freshProfile(100);
  const r = C.purchase(id, 'hanabi');
  assert.strictEqual(r.ok, false);
  assert.ok(!C.getOwned(id).callStyles.includes('hanabi'));
});

test('equipping needs ownership; the default is always equippable', () => {
  const { id, name } = freshProfile(5000);
  assert.strictEqual(C.setEquippedCallStyle(id, name, 'kaminari').ok, false);
  assert.strictEqual(P.getCallStyle(name), 'default');
  assert.ok(C.purchase(id, 'kaminari').ok);
  assert.ok(C.setEquippedCallStyle(id, name, 'kaminari').ok);
  assert.strictEqual(P.getCallStyle(name), 'kaminari');
  assert.ok(C.setEquippedCallStyle(id, name, 'default').ok);
  assert.strictEqual(P.getCallStyle(name), 'default');
});

test('every call style in the catalog has a price and a known tier', () => {
  const tiers = new Set(['common', 'uncommon', 'rare', 'legendary']);
  for (const [id, item] of Object.entries(C.CATALOG.callstyle)) {
    assert.ok(item.price > 0, `${id} needs a price`);
    assert.ok(tiers.has(item.tier), `${id} has unknown tier ${item.tier}`);
  }
});
