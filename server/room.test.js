'use strict';
// Regression test suite for room.js's financial logic (payment formulas —
// tsumo/ron splits, honba, riichi sticks, nagashi mangan, tenpai payments).
// Drives the real Room class directly (not a mock) so these tests exercise
// the exact code path the live server runs. Plain Node assertions, no
// framework — run with: node server/room.test.js

const assert = require('assert');
const { Room } = require('./room');

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

let _id = 10000;
function T(v, s) { return { v, s, id: _id++ }; }
function seq(v, s) { return [T(v, s), T(v + 1, s), T(v + 2, s)]; }
function tri(v, s) { return [T(v, s), T(v, s), T(v, s)]; }
function pairT(v, s) { return [T(v, s), T(v, s)]; }

// Fresh Room with 4 bot seats and a controllable game state, ready to have
// individual _xxx methods called directly (bypassing the WebSocket layer,
// same as how we've verified fixes throughout this project's history).
function freshRoom(dealer = 0) {
  const room = new Room('tonpuu');
  room.seats = [0, 1, 2, 3].map(seat => ({ isBot: true, seat, name: `Seat${seat}` }));
  room.phase = 'playing';
  room.game = { scores: [25000, 25000, 25000, 25000], turn: dealer, dealer, round: 1, roundWind: 1, honba: 0, riichiSticks: 0 };
  room._initRound();
  // _initRound deals from a randomly shuffled wall, so g.dora would
  // otherwise be a random indicator that may or may not happen to match
  // tiles in a test hand — pin it to an honor tile so it can never match
  // the all-m/p/s hands these tests use, keeping payment amounts deterministic.
  room.game.dora = [{ v: 1, s: 'z', id: -1 }];
  return room;
}

// ══════════════════════════════════════════════════════════════════════════
// Nagashi Mangan — was paying out 4x the correct amount (8000 base instead
// of the correct 2000/mangan base)
// ══════════════════════════════════════════════════════════════════════════

test('Nagashi Mangan: dealer winner collects 4000 from each opponent (12000 total)', () => {
  const room = freshRoom(0);
  const g = room.game;
  room._resolveNagashi([true, false, false, false]);
  assert.deepStrictEqual(g.scores, [37000, 21000, 21000, 21000]);
});

test('Nagashi Mangan: non-dealer winner collects 4000 from dealer + 2000 from each other non-dealer (8000 total)', () => {
  const room = freshRoom(0);
  const g = room.game;
  room._resolveNagashi([false, true, false, false]);
  assert.deepStrictEqual(g.scores, [21000, 33000, 23000, 23000]);
});

// Pinfu-shaped 13-tile tenpai hand (4 sequences + non-yakuhai pair, ryanmen
// wait on 6m/9m) + its winning tile. Guaranteed >0 han (pinfu, +menzen tsumo
// when won by self-draw) without depending on riichi/yakuhai/dora, so these
// tests isolate the payment-split arithmetic from yaku scoring specifics
// (which mahjong.test.js already covers separately).
function pinfuTenpai13() {
  return [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(7, 'm'), T(8, 'm')];
}
function winTile() { return T(6, 'm'); }

// ══════════════════════════════════════════════════════════════════════════
// Tsumo payment split (dealer pays double when a non-dealer wins; everyone
// pays double when the dealer wins) — via a real yaku-scoring tsumo win.
// ══════════════════════════════════════════════════════════════════════════

test('Tsumo: non-dealer win — dealer pays double, other non-dealers pay single', () => {
  const room = freshRoom(0); // seat 0 is dealer
  const g = room.game;
  g.hands[1] = pinfuTenpai13();
  g.drawTile = winTile();
  g.hands[1].push(g.drawTile);
  g.turn = 1;
  const prevScores = [...g.scores];
  room._tsumo(1);
  const gained = g.scores[1] - prevScores[1];
  const dealerPaid = prevScores[0] - g.scores[0];
  const otherNonDealerPaid = prevScores[2] - g.scores[2];
  assert.ok(gained > 0, 'seat1 should have won something');
  assert.strictEqual(dealerPaid, otherNonDealerPaid * 2, 'dealer must pay exactly double a non-dealer payer');
  assert.strictEqual(gained, dealerPaid + otherNonDealerPaid + (prevScores[3] - g.scores[3]), 'winner gain must equal sum of all payments');
});

test('Tsumo: dealer win — every opponent pays the same (double) amount', () => {
  const room = freshRoom(0); // seat 0 is dealer
  const g = room.game;
  g.hands[0] = pinfuTenpai13();
  g.drawTile = winTile();
  g.hands[0].push(g.drawTile);
  g.turn = 0;
  const prevScores = [...g.scores];
  room._tsumo(0);
  const paid = [1, 2, 3].map(i => prevScores[i] - g.scores[i]);
  assert.strictEqual(paid[0], paid[1]);
  assert.strictEqual(paid[1], paid[2]);
  assert.ok(paid[0] > 0);
});

test('Tsumo: honba adds 100 per payer (300 total) per stick', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.honba = 2; // +200 per payer
  g.hands[1] = pinfuTenpai13();
  g.drawTile = winTile();
  g.hands[1].push(g.drawTile);
  g.turn = 1;
  // Compare against honba=0 to isolate the honba contribution.
  const room0 = freshRoom(0);
  const g0 = room0.game;
  g0.hands[1] = pinfuTenpai13();
  g0.drawTile = { ...g.drawTile };
  g0.hands[1].push(g0.drawTile);
  g0.turn = 1;
  const prev = [...g.scores], prev0 = [...g0.scores];
  room._tsumo(1);
  room0._tsumo(1);
  const dealerPaidDiff = (prev[0] - g.scores[0]) - (prev0[0] - g0.scores[0]);
  const otherPaidDiff = (prev[2] - g.scores[2]) - (prev0[2] - g0.scores[2]);
  assert.strictEqual(dealerPaidDiff, 200, '2 honba x 100 per payer');
  assert.strictEqual(otherPaidDiff, 200);
});

// ══════════════════════════════════════════════════════════════════════════
// Ron payment (dealer x6, non-dealer x4) + riichi stick handling via _multiRon
// ══════════════════════════════════════════════════════════════════════════

test('Ron: dealer win pays 6x base, non-dealer win pays 4x base (same hand shape)', () => {
  const roomD = freshRoom(0);
  const gD = roomD.game;
  gD.hands[0] = pinfuTenpai13();
  const prevD = [...gD.scores];
  roomD._multiRon([0], 1, winTile());
  const dealerRonPay = prevD[1] - gD.scores[1];

  const roomN = freshRoom(0);
  const gN = roomN.game;
  gN.hands[1] = pinfuTenpai13();
  const prevN = [...gN.scores];
  roomN._multiRon([1], 2, winTile());
  const nonDealerRonPay = prevN[2] - gN.scores[2];

  assert.ok(dealerRonPay > 0 && nonDealerRonPay > 0);
  assert.strictEqual(dealerRonPay, Math.round(nonDealerRonPay * 6 / 4), 'dealer ron (x6) should be exactly 1.5x a non-dealer ron (x4) of the same base');
});

test('Ron: riichi sticks on the table go entirely to the winner, not paid again by the loser', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.riichiSticks = 3; // 3000 points already sitting on the table
  g.hands[1] = pinfuTenpai13();
  const prev = [...g.scores];
  room._multiRon([1], 0, winTile());
  const totalGain = g.scores[1] - prev[1];
  const loserPaid = prev[0] - g.scores[0];
  assert.ok(totalGain > 3000, 'sanity: won something beyond just the riichi sticks');
  assert.strictEqual(totalGain, loserPaid + 3000, 'winner gains their ron payment plus all 3 riichi sticks');
  assert.strictEqual(prev[0] - g.scores[0], loserPaid, 'the loser only ever pays the ron amount, never the riichi sticks too');
});

// ══════════════════════════════════════════════════════════════════════════
// Tenpai payments at exhaustive draw (3000 total pot, split by tenpai count)
// ══════════════════════════════════════════════════════════════════════════

test('Tenpai payments: 1 tenpai player receives all 3000, each noten pays 1000', () => {
  const room = freshRoom(0);
  const g = room.game;
  // Seat 0 tenpai (tanki wait on 9p), seats 1-3 hopelessly not tenpai (scattered honors).
  g.hands[0] = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...seq(2, 's'), T(9, 'p')];
  g.hands[1] = [T(1, 'z'), T(2, 'z'), T(3, 'z'), T(4, 'z'), T(5, 'z'), T(6, 'z'), T(7, 'z'), T(1, 'm'), T(3, 'm'), T(5, 'm'), T(7, 'm'), T(9, 'm'), T(1, 'p')];
  g.hands[2] = g.hands[1].map(t => ({ ...t, id: _id++ }));
  g.hands[3] = g.hands[1].map(t => ({ ...t, id: _id++ }));
  const prev = [...g.scores];
  room._resolveTenpaiPayments();
  assert.strictEqual(g.scores[0] - prev[0], 3000);
  assert.strictEqual(prev[1] - g.scores[1], 1000);
  assert.strictEqual(prev[2] - g.scores[2], 1000);
  assert.strictEqual(prev[3] - g.scores[3], 1000);
});

test('Tenpai payments: 2 tenpai players each receive 1500, each noten pays 1500', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.hands[0] = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...seq(2, 's'), T(9, 'p')];
  g.hands[1] = [...seq(3, 'm'), ...seq(5, 'p'), ...seq(7, 'p'), ...seq(3, 's'), T(8, 'p')];
  g.hands[2] = [T(1, 'z'), T(2, 'z'), T(3, 'z'), T(4, 'z'), T(5, 'z'), T(6, 'z'), T(7, 'z'), T(1, 'm'), T(3, 'm'), T(5, 'm'), T(7, 'm'), T(9, 'm'), T(1, 'p')];
  g.hands[3] = g.hands[2].map(t => ({ ...t, id: _id++ }));
  const prev = [...g.scores];
  room._resolveTenpaiPayments();
  assert.strictEqual(g.scores[0] - prev[0], 1500);
  assert.strictEqual(g.scores[1] - prev[1], 1500);
  assert.strictEqual(prev[2] - g.scores[2], 1500);
  assert.strictEqual(prev[3] - g.scores[3], 1500);
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
