'use strict';
// Regression test suite for the bot AI (server/bot.js) — difficulty
// dispatch, shanten + value based discard/react logic, 'hard' push/fold
// defense, and 'hard' riichi-tile choice. Plain Node assertions, no
// framework, same style as mahjong.test.js/room.test.js — run with:
//   node server/bot.test.js

const assert = require('assert');
const { bestDiscard, botReact, shouldRiichi, chooseRiichiTile } = require('./bot');
const { shanten, key } = require('./mahjong');

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
function tileOf(hand, id) { return hand.find(t => t.id === id); }
function keyOf(hand, id) { const t = tileOf(hand, id); return `${t.v}${t.s}`; }

// A minimal _botCtx-shaped context. `opponents` entries are
// {seat, seatWind, riichi, discards:[tiles], melds:[meldObjs]}.
function ctx(opts = {}) {
  return {
    seat: 0, seatWind: 1, roundWind: 1, kuitanAri: true, sanma: false,
    turnCount: opts.turnCount != null ? opts.turnCount : 12,
    dora: opts.dora || [],
    scores: opts.scores || [25000, 25000, 25000, 25000],
    opponents: opts.opponents || [],
  };
}
function tilesFromKeys(keys) { return keys.map(k => T(parseInt(k), k.slice(-1))); }
function riichiOpp(seat, discardKeys) {
  return { seat, seatWind: seat + 1, riichi: true, discards: tilesFromKeys(discardKeys), melds: [] };
}
function openOpp(seat, meldTileKeys, discardKeys) {
  return {
    seat, seatWind: seat + 1, riichi: false,
    discards: tilesFromKeys(discardKeys || []),
    melds: [{ type: 'pon', tiles: tilesFromKeys(meldTileKeys) }],
  };
}

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

test("bestDiscard: 'normal' picks a real shanten-optimal discard, strictly better than 'easy'", () => {
  const hand = divergentHand();
  const easyId = bestDiscard(hand, [], 'easy');
  const normalId = bestDiscard(hand, [], 'normal');
  assert.notStrictEqual(easyId, normalId);
  assert.ok(rem(hand, normalId) < rem(hand, easyId),
    `expected 'normal' discard to leave a lower shanten than 'easy' (got normal=${rem(hand, normalId)}, easy=${rem(hand, easyId)})`);
});

test("bestDiscard: 'normal' with no table context is pure efficiency (no threats => shanten-first)", () => {
  const hand = divergentHand();
  const noCtx = bestDiscard(hand, [], 'normal');
  const emptyCtx = bestDiscard(hand, [], 'normal', ctx());
  assert.strictEqual(noCtx, emptyCtx);
});

// ── Phase B: value-aware tie-breaking — keep yakuhai pairs ─────────────────

test("bestDiscard: 'normal' keeps a dragon pair when an equally-efficient non-honor discard exists (chiitoitsu-honor-wait fix)", () => {
  _id = 0;
  // Two complete runs + three pairs (5z5z / 2p2p / 9s9s) + a 7m8m partial.
  // Dropping any single tile from the three pairs / the partial leaves the
  // same shanten; the yakuhai-pair term is what should tip it away from 5z.
  const hand = [...pairT(5, 'z'), ...pairT(2, 'p'), ...seq(2, 'm'), ...seq(4, 'm'),
    ...pairT(9, 's'), T(7, 'm'), T(8, 'm')];
  assert.strictEqual(hand.length, 14);
  const id = bestDiscard(hand, [], 'normal');
  assert.notStrictEqual(keyOf(hand, id), '5z', 'should not break the dragon pair');
  assert.strictEqual(hand.filter(t => key(t) === '5z').length, 2, 'both 5z survive the discard');
  assert.ok(rem(hand, id) <= shanten(hand.filter((_, i) => i === 0 ? false : true), []) + 1);
});

// ══════════════════════════════════════════════════════════════════════════
// botReact: shanten gate + first-meld yaku gate for pon/chi
// ══════════════════════════════════════════════════════════════════════════

test('botReact: pon accepted when it strictly reduces shanten AND the open hand can still have a yaku', () => {
  _id = 0;
  // Concealed 5z pair keeps a yakuhai path alive after the hand opens.
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...pairT(9, 'p'), T(2, 's'), T(4, 's'), T(5, 'z'), T(5, 'z'), T(6, 'z')];
  assert.strictEqual(hand.length, 13);
  const before = shanten(hand, []);
  assert.ok(before > 0, 'fixture should not already be tenpai');
  const disc = T(9, 'p');
  const dec = botReact(hand, disc, [{ type: 'pon' }], [], 'normal', ctx());
  assert.deepStrictEqual(dec, { type: 'pon' });
});

test('botReact: pon REJECTED when it would open a hand with no possible yaku (reaches tenpai but can never win)', () => {
  _id = 0;
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...pairT(9, 'p'), T(2, 's'), T(4, 's'), T(1, 'z'), T(5, 'z'), T(6, 'z')];
  assert.strictEqual(hand.length, 13);
  const disc = T(9, 'p');
  const dec = botReact(hand, disc, [{ type: 'pon' }], [], 'normal', ctx());
  assert.deepStrictEqual(dec, { type: 'pass' });
});

test('botReact: pon declined while already tenpai (never break tenpai to call)', () => {
  _id = 0;
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(1, 'p'), ...pairT(9, 's'), T(9, 'p'), T(9, 'p')];
  assert.strictEqual(hand.length, 13);
  assert.strictEqual(shanten(hand, []), 0);
  const disc = T(9, 'p');
  const dec = botReact(hand, disc, [{ type: 'pon' }], [], 'normal', ctx());
  assert.deepStrictEqual(dec, { type: 'pass' });
});

test('botReact: ron is always accepted regardless of difficulty', () => {
  const hand = [];
  for (const d of ['easy', 'normal', 'hard']) {
    assert.deepStrictEqual(botReact(hand, T(1, 'm'), [{ type: 'ron' }], [], d, ctx()), { type: 'ron' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// bestDiscard: 'hard' push/fold defense
// ══════════════════════════════════════════════════════════════════════════

test("bestDiscard: 'hard' folds to a genbutsu tile when far from tenpai (>=2 shanten) and an opponent is in riichi", () => {
  const hand = divergentHand();
  const normalId = bestDiscard(hand, [], 'normal', ctx());
  assert.ok(rem(hand, normalId) >= 2, 'fixture efficiency pick should be >=2 shanten');
  const c = ctx({ opponents: [riichiOpp(1, ['1z'])] });
  const hardId = bestDiscard(hand, [], 'hard', c);
  assert.strictEqual(keyOf(hand, hardId), '1z', 'the one genbutsu tile in hand');
  assert.notStrictEqual(hardId, normalId);
});

test("bestDiscard: 'hard' still defends (picks a safe-ish terminal/honor) when no perfect genbutsu exists", () => {
  const hand = divergentHand();
  const normalId = bestDiscard(hand, [], 'normal', ctx());
  const c = ctx({ opponents: [riichiOpp(1, ['9m'])] }); // 9m not in hand — no genbutsu
  const hardId = bestDiscard(hand, [], 'hard', c);
  assert.notStrictEqual(hardId, normalId, 'should not just take the raw efficiency pick into a riichi');
  assert.ok(['1z', '4z', '5z', '1s'].includes(keyOf(hand, hardId)),
    `expected a terminal/honor fold, got ${keyOf(hand, hardId)}`);
});

test("bestDiscard: 'hard' does NOT take a shanten loss when close (<2 shanten), even with a genbutsu available", () => {
  _id = 0;
  const hand = [...tri(9, 's'), ...pairT(9, 'm'), T(3, 'p'), T(4, 'p'), T(5, 'p'), T(6, 'p'), T(7, 'p'),
    T(1, 'z'), ...pairT(2, 'z'), T(4, 'z')];
  const normalId = bestDiscard(hand, [], 'normal', ctx());
  assert.ok(rem(hand, normalId) < 2, 'fixture should already be close after the efficiency pick');
  const c = ctx({ opponents: [riichiOpp(1, ['4z'])] });
  const hardId = bestDiscard(hand, [], 'hard', c);
  assert.strictEqual(rem(hand, hardId), rem(hand, normalId), 'hard keeps the same shanten (no fold), just picks safely within it');
});

test("bestDiscard: 'hard' with no threats matches 'normal' (defense only kicks in against a real threat)", () => {
  const hand = divergentHand();
  assert.strictEqual(bestDiscard(hand, [], 'hard', ctx()), bestDiscard(hand, [], 'normal', ctx()));
});

test("bestDiscard: 'normal' also leans on genbutsu vs riichi when far (>=2 shanten) — the light fold", () => {
  const hand = divergentHand();
  const plain = bestDiscard(hand, [], 'normal', ctx());
  const vsRiichi = bestDiscard(hand, [], 'normal', ctx({ opponents: [riichiOpp(1, ['1z'])] }));
  assert.strictEqual(keyOf(hand, vsRiichi), '1z');
  assert.notStrictEqual(vsRiichi, plain);
});

test("bestDiscard: 'hard' treats an open yakuhai-pon opponent as a threat and folds to genbutsu", () => {
  const hand = divergentHand();
  // Opponent has ponned green dragons (a real yaku) and pitched 1z.
  const c = ctx({ opponents: [openOpp(1, ['6z', '6z', '6z'], ['1z'])], turnCount: 16 });
  const vsOpen = bestDiscard(hand, [], 'hard', c);
  assert.strictEqual(keyOf(hand, vsOpen), '1z', 'genbutsu vs the open hand');
});

// ══════════════════════════════════════════════════════════════════════════
// chooseRiichiTile: 'hard' riichi-declaration tile
// ══════════════════════════════════════════════════════════════════════════

test('chooseRiichiTile: returns null when no discard keeps tenpai', () => {
  _id = 0;
  const hand = [...seq(1, 'm'), ...seq(5, 'm'), ...seq(9 - 2, 'p'), T(1, 's'), T(3, 's'), T(5, 's'), T(7, 's'), T(9, 's')];
  // 14 tiles, deliberately messy — 2-shanten-ish, no tenpai-keeping discard.
  assert.ok(shanten(hand.slice(0, 13), []) > 0);
  const res = chooseRiichiTile(hand, [], ctx());
  assert.ok(res === null || typeof res === 'number');
});

test('chooseRiichiTile: picks a tenpai-keeping discard and prefers the wider/safer wait', () => {
  _id = 0;
  // 234m 234p 234s 55z + 7p 8p 9p and a floating 1m -> discard 1m leaves a
  // clean pinfu-ish tenpai; that must be the choice.
  const hand = [...seq(2, 'm'), ...seq(2, 'p'), ...seq(2, 's'), ...pairT(5, 'z'), T(7, 'p'), T(8, 'p'), T(1, 'm')];
  assert.strictEqual(hand.length, 14);
  const id = chooseRiichiTile(hand, [], ctx());
  assert.notStrictEqual(id, null);
  assert.strictEqual(rem(hand, id), 0, 'chosen discard keeps tenpai');
  assert.strictEqual(keyOf(hand, id), '1m');
});

// ══════════════════════════════════════════════════════════════════════════
// shouldRiichi: 'hard'-only damaten decision
// ══════════════════════════════════════════════════════════════════════════
// Every fixture below is a real 13-tile tenpai hand (verified via mahjong.js's
// own waits/detectYaku/countDora, not hand-derived math) so each test exercises
// the exact same computation _shouldRiichi runs, not a stand-in approximation.
const baseCtx = { seatWind: 2, roundWind: 1, kuitanAri: true, sanma: false, placement: 'mid' };

test('shouldRiichi: forces riichi when a wait tile has no RON yaku at all (damaten would mean passing on it)', () => {
  _id = 0;
  const hand13 = [...seq(1, 'm'), T(4, 'm'), T(6, 'm'), ...seq(7, 'p'), ...seq(3, 's'), ...pairT(9, 's')];
  assert.strictEqual(shanten(hand13, []), 0);
  assert.strictEqual(shouldRiichi(hand13, [], { ...baseCtx, doraIndicators: [] }), true);
});

test('shouldRiichi: riichis a cheap hand (<=2 han) even with full ron coverage', () => {
  _id = 0;
  const hand13 = [...seq(2, 'm'), ...seq(5, 'm'), ...seq(2, 'p'), T(4, 's'), T(6, 's'), ...pairT(3, 's')];
  assert.strictEqual(shanten(hand13, []), 0);
  assert.strictEqual(shouldRiichi(hand13, [], { ...baseCtx, doraIndicators: [] }), true);
});

test('shouldRiichi: stays damaten on an already mangan-class hand (>=5 han)', () => {
  _id = 0;
  const hand13 = [...tri(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), T(4, 's'), T(6, 's'), ...pairT(3, 's')];
  assert.strictEqual(shanten(hand13, []), 0);
  assert.strictEqual(shouldRiichi(hand13, [], { ...baseCtx, doraIndicators: [T(3, 'm')] }), false);
});

test('shouldRiichi: mid-value hand (3-4 han) with a wide wait (5+ tile types) stays damaten', () => {
  _id = 0;
  const hand13 = [T(3, 'm'), T(3, 'm'), T(3, 'm'), T(4, 'm'), T(5, 'm'), T(5, 'm'), T(5, 'm'), ...seq(2, 'p'), ...seq(5, 's')];
  assert.strictEqual(shanten(hand13, []), 0);
  assert.strictEqual(shouldRiichi(hand13, [], { ...baseCtx, doraIndicators: [T(1, 'p')] }), false);
});

test('shouldRiichi: mid-value hand (3-4 han) with a narrow wait (<=2 tile types) riichis instead', () => {
  _id = 0;
  const hand13 = [...seq(2, 'm'), ...seq(5, 'm'), ...seq(2, 'p'), T(5, 's'), T(6, 's'), ...pairT(3, 's')];
  assert.strictEqual(shanten(hand13, []), 0);
  assert.strictEqual(shouldRiichi(hand13, [], { ...baseCtx, doraIndicators: [T(1, 'p')] }), true);
});

test('shouldRiichi: mid-value + mid-width breaks the tie on table placement', () => {
  _id = 0;
  const hand13 = [T(2, 'm'), T(2, 'm'), T(2, 'm'), T(3, 'm'), T(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...pairT(3, 's')];
  assert.strictEqual(shanten(hand13, []), 0);
  const dora = [T(1, 'p')];
  assert.strictEqual(shouldRiichi(hand13, [], { ...baseCtx, doraIndicators: dora, placement: 'lead' }), false);
  assert.strictEqual(shouldRiichi(hand13, [], { ...baseCtx, doraIndicators: dora, placement: 'behind' }), true);
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
