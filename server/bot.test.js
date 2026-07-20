'use strict';
// Regression test suite for the bot AI (server/bot.js) — difficulty
// dispatch, shanten-based discard/react logic, and 'hard' defense. Plain
// Node assertions, no framework, same style as mahjong.test.js/room.test.js
// — run with: node server/bot.test.js

const assert = require('assert');
const { bestDiscard, botReact } = require('./bot');
const { shanten } = require('./mahjong');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
  }
}

// ── Tile helpers ─────────────────────────────────────────────────────────────
let _id = 0;
function T(v, s) { return { v, s, id: _id++ }; }
function seq(v, s) { return [T(v, s), T(v + 1, s), T(v + 2, s)]; }
function tri(v, s) { return [T(v, s), T(v, s), T(v, s)]; }
function pairT(v, s) { return [T(v, s), T(v, s)]; }
function rem(hand, id) { return shanten(hand.filter(t => t.id !== id), []); }

// ══════════════════════════════════════════════════════════════════════════
// bestDiscard: 'easy' regression + 'normal' efficiency
// ══════════════════════════════════════════════════════════════════════════

// Found by random search: a 14-tile hand where the legacy handScore
// heuristic and real shanten minimization disagree on the best discard, and
// the legacy pick is provably worse (leaves the hand a full shanten further
// from tenpai) — this is the concrete "meaningfully stronger" proof.
function divergentHand() {
  _id = 0;
  return [T(7, 's'), T(5, 'm'), T(3, 'p'), T(6, 'm'), T(7, 's'), T(5, 'z'), T(7, 'm'),
    T(5, 'm'), T(6, 's'), T(4, 'z'), T(1, 'z'), T(7, 's'), T(1, 's'), T(7, 's')];
}

test("bestDiscard: 'easy' stays byte-for-byte the old heuristic (regression)", () => {
  const hand = divergentHand();
  const id = bestDiscard(hand, [], 'easy');
  const tile = hand.find(t => t.id === id);
  assert.strictEqual(`${tile.v}${tile.s}`, '7s');
  assert.strictEqual(rem(hand, id), 4);
});

test("bestDiscard: 'normal' picks the real shanten-optimal discard, strictly better than 'easy'", () => {
  const hand = divergentHand();
  const easyId = bestDiscard(hand, [], 'easy');
  const normalId = bestDiscard(hand, [], 'normal');
  const tile = hand.find(t => t.id === normalId);
  assert.strictEqual(`${tile.v}${tile.s}`, '5m');
  assert.notStrictEqual(easyId, normalId);
  assert.ok(rem(hand, normalId) < rem(hand, easyId),
    `expected 'normal' discard to leave a lower shanten than 'easy' (got normal=${rem(hand, normalId)}, easy=${rem(hand, easyId)})`);
});

// ══════════════════════════════════════════════════════════════════════════
// botReact: shanten gate for pon/chi
// ══════════════════════════════════════════════════════════════════════════

test('botReact: pon accepted when it strictly reduces shanten', () => {
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...pairT(9, 'p'), T(2, 's'), T(4, 's'), T(1, 'z'), T(5, 'z'), T(6, 'z')];
  assert.strictEqual(hand.length, 13);
  const before = shanten(hand, []);
  assert.ok(before > 0, 'fixture should not already be tenpai');
  const disc = T(9, 'p');
  const dec = botReact(hand, disc, [{ type: 'pon' }], [], 'normal');
  assert.deepStrictEqual(dec, { type: 'pon' });
});

test('botReact: pon declined while already tenpai (matches legacy "never break tenpai" gate)', () => {
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(1, 'p'), ...pairT(9, 's'), T(9, 'p'), T(9, 'p')];
  assert.strictEqual(hand.length, 13);
  assert.strictEqual(shanten(hand, []), 0);
  const disc = T(9, 'p');
  const dec = botReact(hand, disc, [{ type: 'pon' }], [], 'normal');
  assert.deepStrictEqual(dec, { type: 'pass' });
});

test('botReact: ron is always accepted regardless of difficulty', () => {
  const hand = [];
  for (const d of ['easy', 'normal', 'hard']) {
    assert.deepStrictEqual(botReact(hand, T(1, 'm'), [{ type: 'ron' }], [], d), { type: 'ron' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// bestDiscard: 'hard' defense (genbutsu preference against riichi)
// ══════════════════════════════════════════════════════════════════════════

test("bestDiscard: 'hard' prefers a genbutsu tile over the efficiency pick when own shanten is far (>=2)", () => {
  const hand = divergentHand();
  const normalId = bestDiscard(hand, [], 'normal'); // 5m, leaves shanten 3 (>=2)
  const dangerSets = [['1z']]; // one riichi opponent's discard pile, contains a tile in hand
  const hardId = bestDiscard(hand, [], 'hard', dangerSets);
  const hardTile = hand.find(t => t.id === hardId);
  assert.strictEqual(`${hardTile.v}${hardTile.s}`, '1z');
  assert.notStrictEqual(hardId, normalId);
});

test("bestDiscard: 'hard' falls back to the efficiency pick when no genbutsu tile exists in hand", () => {
  const hand = divergentHand();
  const normalId = bestDiscard(hand, [], 'normal');
  const dangerSets = [['9m']]; // not present anywhere in this hand
  const hardId = bestDiscard(hand, [], 'hard', dangerSets);
  assert.strictEqual(hardId, normalId);
});

test("bestDiscard: 'hard' does NOT fold when own shanten is already close (<2), even with a genbutsu tile available", () => {
  const hand = [...tri(9, 's'), ...pairT(9, 'm'), T(3, 'p'), T(4, 'p'), T(5, 'p'), T(6, 'p'), T(7, 'p'),
    T(1, 'z'), ...pairT(2, 'z'), T(4, 'z')];
  const normalId = bestDiscard(hand, [], 'normal');
  assert.ok(rem(hand, normalId) < 2, 'fixture should already be close to tenpai after the efficiency pick');
  const dangerSets = [['4z']]; // present in hand, distinct from the efficiency pick
  const hardId = bestDiscard(hand, [], 'hard', dangerSets);
  assert.strictEqual(hardId, normalId);
});

// ══════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.error}`);
  process.exitCode = 1;
}
