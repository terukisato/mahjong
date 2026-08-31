'use strict';
// Regression tests for economy.js — the daily login bonus, placement payout
// math (base + performance bonus, quick-match multiplier), the daily earn
// cap, spend, and purge. Same plain-assertion convention as
// friends.test.js / stats.test.js. Run with: node server/economy.test.js
//
// DATA_DIR is read once, at module load — set it to a fresh temp directory
// BEFORE requiring economy.js so these tests never touch server/data.
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-economy-test-'));
const E = require('./economy');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; failures.push({ name, error: e.message }); }
}
let n = 0;
const freshId = () => `p${n++}`;

test('new wallet starts at 0', () => {
  assert.strictEqual(E.getBalance(freshId()), 0);
});

test('daily bonus grants once per day, then no-ops', () => {
  const id = freshId();
  const a = E.claimDailyBonus(id);
  assert.deepStrictEqual([a.granted, a.amount, a.balance], [true, 100, 100]);
  const b = E.claimDailyBonus(id);
  assert.deepStrictEqual([b.granted, b.amount, b.balance], [false, 0, 100]);
});

test('room tonpuu yonma: base by placement, no bonus at start stock', () => {
  const at = pl => E.awardGameCoins(freshId(), { variant: 'yonma', mode: 'tonpuu', matchKind: 'room', placement: pl, finalScore: 25000 });
  assert.strictEqual(at(1).delta, 50);
  assert.strictEqual(at(2).delta, 25);
  assert.strictEqual(at(3).delta, 10);
  assert.strictEqual(at(4).delta, 5);
});

test('room hanchan yonma pays the hanchan table', () => {
  const r = E.awardGameCoins(freshId(), { variant: 'yonma', mode: 'hanchan', matchKind: 'room', placement: 1, finalScore: 25000 });
  assert.strictEqual(r.base, 75);
  assert.strictEqual(r.delta, 75);
});

test('sanma tables + start stock 35000', () => {
  const r = E.awardGameCoins(freshId(), { variant: 'sanma', mode: 'tonpuu', matchKind: 'room', placement: 1, finalScore: 35000 });
  assert.strictEqual(r.base, 45);
  assert.strictEqual(r.bonus, 0);
});

test('performance bonus: +1 per 2000 above start, floored at 0, capped at 25', () => {
  const b = fs => E.awardGameCoins(freshId(), { variant: 'yonma', mode: 'tonpuu', matchKind: 'room', placement: 1, finalScore: fs }).bonus;
  assert.strictEqual(b(25000), 0);
  assert.strictEqual(b(31000), 3);          // floor(6000/2000)
  assert.strictEqual(b(10000), 0);          // below start -> not negative
  assert.strictEqual(b(999999), 25);        // capped
});

test('quick match applies the 0.6 multiplier (rounded) to base+bonus', () => {
  const r = E.awardGameCoins(freshId(), { variant: 'yonma', mode: 'tonpuu', matchKind: 'quick', placement: 1, finalScore: 30000 });
  // base 50 + bonus floor(5000/2000)=2 => 52; 52 * 0.6 = 31.2 -> 31
  assert.strictEqual(r.gross, 31);
  assert.strictEqual(r.delta, 31);
});

test('daily earn cap clips a payout and flags it; bonus still adds on top', () => {
  const id = freshId();
  // 8 x 75 = 600 > 500 cap
  let last;
  for (let i = 0; i < 8; i++) {
    last = E.awardGameCoins(id, { variant: 'yonma', mode: 'hanchan', matchKind: 'room', placement: 1, finalScore: 25000 });
  }
  assert.ok(last.capped, 'final payout should be capped');
  assert.strictEqual(E.getBalance(id), 500);
  // login bonus is separate from the game cap
  assert.strictEqual(E.claimDailyBonus(id).balance, 600);
  // and once capped, further games add nothing
  const after = E.awardGameCoins(id, { variant: 'yonma', mode: 'hanchan', matchKind: 'room', placement: 1, finalScore: 25000 });
  assert.strictEqual(after.delta, 0);
});

test('unknown variant/mode or bad placement pays nothing', () => {
  assert.strictEqual(E.awardGameCoins(freshId(), { variant: 'gomma', mode: 'tonpuu', matchKind: 'room', placement: 1, finalScore: 25000 }).delta, 0);
  assert.strictEqual(E.awardGameCoins(freshId(), { variant: 'yonma', mode: 'tonpuu', matchKind: 'room', placement: 9, finalScore: 25000 }).delta, 0);
});

test('spend rejects overdraw, deducts otherwise', () => {
  const id = freshId();
  E.claimDailyBonus(id); // 100
  assert.strictEqual(E.spend(id, 150).ok, false);
  const r = E.spend(id, 40);
  assert.deepStrictEqual([r.ok, r.balance], [true, 60]);
});

test('purge removes the wallet', () => {
  const id = freshId();
  E.claimDailyBonus(id);
  assert.strictEqual(E.getBalance(id), 100);
  E.purge(id);
  assert.strictEqual(E.getBalance(id), 0);
});

console.log(`\neconomy.test.js: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.error}`);
  process.exit(1);
}
