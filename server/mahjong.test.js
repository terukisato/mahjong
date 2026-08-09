'use strict';
// Regression test suite for yaku detection (server/mahjong.js).
// Plain Node assertions, no framework — run with: node server/mahjong.test.js

const assert = require('assert');
const { detectYaku, waitFu, isWin, countDora, calcFu, isMenzen, basePoints, waits, shanten, buildWall } = require('./mahjong');

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
function meld(type, tiles, extra = {}) { return { type, tiles, ...extra }; }

// Default-args wrapper around detectYaku for readability. Also asserts the
// hand+melds combo is a structurally valid win via isWin() — detectYaku
// itself doesn't check total tile-count structure, so a miscounted test
// hand can silently "pass" while testing a shape the real game could never
// actually reach (room.js always checks isWin before calling detectYaku).
function Y(hand14, melds = [], opts = {}) {
  const o = Object.assign({
    isTsumo: false, seatWind: 1, roundWind: 1, isRiichi: false, isIppatsu: false,
    isDoubleRiichi: false, isRinshan: false, isChankan: false, isHaitei: false,
    isHoutei: false, isTenhou: false, isChiihou: false, winTileKey: null, rules: {},
  }, opts);
  assert.ok(isWin(hand14, melds),
    `Y(): hand+melds is not a structurally valid win (hand=${hand14.length} tiles, ` +
    `melds=${JSON.stringify(melds.map(m => ({ type: m.type, kanType: m.kanType, n: m.tiles.length })))})`);
  return detectYaku(hand14, melds, o.isTsumo, o.seatWind, o.roundWind, o.isRiichi,
    o.isIppatsu, o.isDoubleRiichi, o.isRinshan, o.isChankan, o.isHaitei, o.isHoutei,
    o.isTenhou, o.isChiihou, o.winTileKey, o.rules);
}

function hasYaku(result, name) { return result.yakuList.some(y => y.name === name); }
function assertHas(result, name, msg) {
  assert.ok(hasYaku(result, name), (msg || '') + ` expected '${name}' in ${JSON.stringify(result.yakuList)}`);
}
function assertNotHas(result, name, msg) {
  assert.ok(!hasYaku(result, name), (msg || '') + ` did not expect '${name}' in ${JSON.stringify(result.yakuList)}`);
}

// ══════════════════════════════════════════════════════════════════════════
// Positive cases: each yaku fires when it legitimately should
// ══════════════════════════════════════════════════════════════════════════

test('Riichi', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isRiichi: true, winTileKey: '6m' });
  assertHas(r, 'Riichi');
});

test('Double Riichi (and Riichi not double-counted)', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isRiichi: true, isDoubleRiichi: true, winTileKey: '6m' });
  assertHas(r, 'Double Riichi');
  assertNotHas(r, 'Riichi', 'Double Riichi should replace plain Riichi, not stack with it');
});

test('Ippatsu (with riichi)', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isRiichi: true, isIppatsu: true, winTileKey: '6m' });
  assertHas(r, 'Ippatsu');
});

test('Ippatsu without riichi does NOT fire', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isRiichi: false, isIppatsu: true, winTileKey: '6m' });
  assertNotHas(r, 'Ippatsu', 'Ippatsu requires an active riichi');
});

test('Menzen Tsumo', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isTsumo: true, winTileKey: '6m' });
  assertHas(r, 'Menzen Tsumo');
});

test('Menzen Tsumo does NOT fire on open hand', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const melds = [meld('pon', tri(5, 'z'), { open: true })];
  const r = Y(hand, melds, { isTsumo: true, winTileKey: '6m' });
  assertNotHas(r, 'Menzen Tsumo', 'Menzen Tsumo requires a closed hand');
});

test('Rinshan Kaihou', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isTsumo: true, isRinshan: true, winTileKey: '6m' });
  assertHas(r, 'Rinshan Kaihou');
  assertNotHas(r, 'Menzen Tsumo', 'Rinshan replaces tsumo, per implementation choice');
});

test('Chankan', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isChankan: true, winTileKey: '6m' });
  assertHas(r, 'Chankan');
});

test('Haitei (tsumo on last tile)', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isTsumo: true, isHaitei: true, winTileKey: '6m' });
  assertHas(r, 'Haitei');
});

test('Houtei (ron on last discard)', () => {
  const hand = [...seq(4, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isTsumo: false, isHoutei: true, winTileKey: '6m' });
  assertHas(r, 'Houtei');
});

test('Tanyao (all simples)', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...tri(3, 's'), ...pairT(5, 'm')];
  const r = Y(hand, [], { winTileKey: '5m' });
  assertHas(r, 'Tanyao');
});

test('Tanyao does NOT fire with a terminal present', () => {
  const hand = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...tri(3, 's'), ...pairT(5, 'm')];
  const r = Y(hand, [], { winTileKey: '5m' });
  assertNotHas(r, 'Tanyao');
});

test('Pinfu (true ryanmen wait)', () => {
  // 4-5m waiting on 3/6, won on 6m
  const hand = [T(4, 'm'), T(5, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(6, 'm')];
  const r = Y(hand, [], { winTileKey: '6m' });
  assertHas(r, 'Pinfu');
});

test('Pinfu does NOT fire on kanchan (closed middle) wait', () => {
  const hand = [T(4, 'm'), T(6, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(5, 'm')];
  const r = Y(hand, [], { winTileKey: '5m' });
  assertNotHas(r, 'Pinfu');
});

test('Pinfu does NOT fire on penchan (1-2 waiting on 3) wait', () => {
  const hand = [T(1, 'm'), T(2, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(3, 'm')];
  const r = Y(hand, [], { winTileKey: '3m' });
  assertNotHas(r, 'Pinfu');
});

test('Pinfu does NOT fire on penchan (8-9 waiting on 7) wait', () => {
  const hand = [T(8, 'm'), T(9, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(7, 'm')];
  const r = Y(hand, [], { winTileKey: '7m' });
  assertNotHas(r, 'Pinfu');
});

test('Pinfu DOES fire on 2-3 waiting-on-1 (a true ryanmen, not penchan)', () => {
  const hand = [T(2, 'm'), T(3, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(1, 'm')];
  const r = Y(hand, [], { winTileKey: '1m' });
  assertHas(r, 'Pinfu');
});

test('Pinfu DOES fire on 7-8 waiting-on-9 (a true ryanmen, not penchan)', () => {
  const hand = [T(7, 'm'), T(8, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(9, 'm')];
  const r = Y(hand, [], { winTileKey: '9m' });
  assertHas(r, 'Pinfu');
});

test('Pinfu does NOT fire on tanki (pair) wait', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...seq(2, 's'), T(9, 'p'), T(9, 'p')];
  const r = Y(hand, [], { winTileKey: '9p' });
  assertNotHas(r, 'Pinfu');
});

test('Pinfu does NOT fire when pair is yakuhai (dragon)', () => {
  const hand = [T(4, 'm'), T(5, 'm'), ...seq(2, 'p'), ...seq(5, 'p'), ...seq(2, 's'), ...pairT(5, 'z'), T(6, 'm')];
  const r = Y(hand, [], { winTileKey: '6m' });
  assertNotHas(r, 'Pinfu');
});

test('Pinfu does NOT fire on open hand', () => {
  const hand = [T(4, 'm'), T(5, 'm'), ...seq(2, 'p'), ...seq(2, 's'), ...pairT(9, 'p'), T(6, 'm')];
  const melds = [meld('chi', seq(5, 'p'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '6m' });
  assertNotHas(r, 'Pinfu');
});

test('Iipeiko (two identical sequences)', () => {
  const hand = [...seq(2, 'm'), ...seq(2, 'm'), ...seq(5, 'p'), ...seq(7, 's'), ...pairT(5, 'm')];
  const r = Y(hand, [], { winTileKey: '9s' });
  assertHas(r, 'Iipeiko');
});

test('Ryanpeiko (two pairs of identical sequences) replaces Iipeiko', () => {
  const hand = [...seq(2, 'm'), ...seq(2, 'm'), ...seq(5, 'p'), ...seq(5, 'p'), ...pairT(9, 's')];
  const r = Y(hand, [], { winTileKey: '4m' });
  assertHas(r, 'Ryanpeiko');
  assertNotHas(r, 'Iipeiko', 'Ryanpeiko should replace Iipeiko, not stack with it');
});

test('Yakuhai: Haku', () => {
  const hand = [...tri(5, 'z'), ...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const r = Y(hand, [], { winTileKey: '8p' });
  assertHas(r, 'Haku');
});

test('Yakuhai: Hatsu', () => {
  const hand = [...tri(6, 'z'), ...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const r = Y(hand, [], { winTileKey: '8p' });
  assertHas(r, 'Hatsu');
});

test('Yakuhai: Chun', () => {
  const hand = [...tri(7, 'z'), ...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const r = Y(hand, [], { winTileKey: '8p' });
  assertHas(r, 'Chun');
});

test('Yakuhai: Seat Wind only (non-dealer, different round wind)', () => {
  const hand = [...tri(2, 'z'), ...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const r = Y(hand, [], { seatWind: 2, roundWind: 1, winTileKey: '8p' });
  assertHas(r, 'Seat Wind');
  assertNotHas(r, 'Round Wind');
});

test('Yakuhai: Round Wind only (non-dealer holding round-wind triplet)', () => {
  const hand = [...tri(1, 'z'), ...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const r = Y(hand, [], { seatWind: 2, roundWind: 1, winTileKey: '8p' });
  assertHas(r, 'Round Wind');
  assertNotHas(r, 'Seat Wind');
});

test('Yakuhai: dealer double wind (Seat Wind + Round Wind both fire, 2 han)', () => {
  const hand = [...tri(1, 'z'), ...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const r = Y(hand, [], { seatWind: 1, roundWind: 1, winTileKey: '8p' });
  assertHas(r, 'Seat Wind');
  assertHas(r, 'Round Wind');
  assert.strictEqual(r.han, 2, `dealer's own-wind triplet should be worth 2 han, got ${r.han}`);
});

test('Shousangen (2 dragon triplets + dragon pair)', () => {
  const hand = [...tri(5, 'z'), ...tri(6, 'z'), ...pairT(7, 'z'), ...seq(2, 'm'), ...seq(4, 'p')];
  const r = Y(hand, [], { winTileKey: '7z' });
  assertHas(r, 'Shousangen');
});

test('Daisangen (3 dragon triplets, yakuman)', () => {
  const hand = [...tri(5, 'z'), ...tri(6, 'z'), ...tri(7, 'z'), ...seq(2, 'm'), ...pairT(8, 'p')];
  const r = Y(hand, [], { winTileKey: '8p' });
  assertHas(r, 'Daisangen');
  assert.strictEqual(r.han, 13);
});

test('Sanshoku Doujun (same sequence, 3 suits)', () => {
  const hand = [...seq(3, 'm'), ...seq(3, 'p'), ...seq(3, 's'), ...tri(9, 'p'), ...pairT(2, 'z')];
  const r = Y(hand, [], { winTileKey: '2z' });
  assertHas(r, 'Sanshoku Doujun');
});

test('Sanshoku Doukou (same triplet, 3 suits)', () => {
  const hand = [...tri(3, 'm'), ...tri(3, 'p'), ...tri(3, 's'), ...seq(5, 'p'), ...pairT(2, 'z')];
  const r = Y(hand, [], { winTileKey: '2z' });
  assertHas(r, 'Sanshoku Doukou');
});

test('Ittsu (1-9 straight, same suit)', () => {
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(7, 'm'), ...seq(3, 'p'), ...pairT(8, 's')];
  const r = Y(hand, [], { winTileKey: '8s' });
  assertHas(r, 'Ittsu');
});

test('Chanta (every group has a terminal/honor, includes a sequence)', () => {
  const hand = [...seq(1, 'm'), ...tri(9, 'p'), ...tri(1, 'z'), ...seq(7, 's'), ...pairT(9, 's')];
  const r = Y(hand, [], { winTileKey: '9s' });
  assertHas(r, 'Chanta');
});

test('Junchan (like Chanta but no honors) replaces Chanta', () => {
  const hand = [...seq(1, 'm'), ...tri(9, 'p'), ...tri(1, 'p'), ...seq(7, 's'), ...pairT(9, 's')];
  const r = Y(hand, [], { winTileKey: '9s' });
  assertHas(r, 'Junchan');
  assertNotHas(r, 'Chanta', 'Junchan should replace Chanta, not stack with it');
});

test('Toitoi (4 triplets, open hand so it is not also Suu Ankou)', () => {
  const hand = [...tri(3, 'm'), ...pairT(9, 'p')];
  const melds = [
    meld('pon', tri(4, 'z'), { open: true }),
    meld('pon', tri(2, 's'), { open: true }),
    meld('pon', tri(6, 'p'), { open: true }),
  ];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertHas(r, 'Toitoi');
});

test('Toitoi fires when a kan meld is among the melds (regression: kan mislabeled as seq)', () => {
  const hand = [T(9, 'p'), T(9, 'p')];
  const melds = [
    meld('kan', [T(5, 'm'), T(5, 'm'), T(5, 'm'), T(5, 'm')], { open: true }),
    meld('pon', tri(2, 'p'), { open: true }),
    meld('pon', tri(3, 'z'), { open: true }),
    meld('pon', tri(3, 'm'), { open: true }),
  ];
  const r = Y(hand, melds, { seatWind: 3, winTileKey: '9p' });
  assertHas(r, 'Toitoi');
});

test('San Ankou (3 closed triplets)', () => {
  const hand = [...tri(3, 'm'), ...tri(7, 'p'), ...tri(9, 's'), ...seq(4, 'p'), ...pairT(2, 'z')];
  const r = Y(hand, [], { winTileKey: '2z' });
  assertHas(r, 'San Ankou');
});

test('San Ankou does NOT count a ron-completed shanpon triplet as concealed', () => {
  const pre = [...tri(3, 'm'), ...tri(7, 'p'), ...seq(4, 's'), ...pairT(9, 's'), ...pairT(2, 'z')];
  const r = Y([...pre, T(9, 's')], [], { isTsumo: false, winTileKey: '9s' });
  assertNotHas(r, 'San Ankou', 'the 3rd "triplet" was completed by ron and should be minkou, not ankou');
});

test('San Ankou DOES count the equivalent shanpon completed by tsumo', () => {
  const pre = [...tri(3, 'm'), ...tri(7, 'p'), ...seq(4, 's'), ...pairT(9, 's'), ...pairT(2, 'z')];
  const r = Y([...pre, T(9, 's')], [], { isTsumo: true, winTileKey: '9s' });
  assertHas(r, 'San Ankou');
});

test('Honitsu (one suit + honors)', () => {
  const hand = [...seq(2, 'p'), ...seq(4, 'p'), ...tri(1, 'z'), ...pairT(5, 'z'), ...seq(6, 'p')];
  const r = Y(hand, [], { winTileKey: '8p' });
  assertHas(r, 'Honitsu');
});

test('Chinitsu (one suit, no honors)', () => {
  const hand = [...seq(2, 'p'), ...seq(4, 'p'), ...seq(6, 'p'), ...tri(1, 'p'), ...pairT(9, 'p')];
  const r = Y(hand, [], { winTileKey: '9p' });
  assertHas(r, 'Chinitsu');
});

test('Chiitoitsu (7 pairs)', () => {
  const hand = [...pairT(1, 'm'), ...pairT(3, 'm'), ...pairT(5, 'p'), ...pairT(7, 'p'),
    ...pairT(2, 's'), ...pairT(4, 's'), ...pairT(6, 'z')];
  const r = Y(hand, [], { winTileKey: '6z' });
  assertHas(r, 'Chiitoitsu');
});

// Composition-only yaku (Tanyao/Honroutou/Honitsu/Chinitsu) used to be
// silently dropped on a Chiitoitsu win — the chiitoitsu branch in
// detectYaku built its own yaku list from scratch (Chiitoitsu + riichi-
// family + haitei/houtei only) instead of also checking these, unlike
// every regular (non-chiitoitsu) decomp which computes them from the
// hand's tile composition regardless of grouping shape. Each hand below
// uses a non-sequential value spread specifically so no REGULAR decomp
// exists to compete with (and potentially mask the bug by winning on han
// count instead) — chiitoitsu must be the only legal interpretation.
test('Chiitoitsu + Honitsu (one suit + honors) both apply', () => {
  const hand = [...pairT(1, 'm'), ...pairT(3, 'm'), ...pairT(5, 'm'), ...pairT(7, 'm'),
    ...pairT(9, 'm'), ...pairT(1, 'z'), ...pairT(2, 'z')];
  const r = Y(hand, [], { winTileKey: '2z' });
  assertHas(r, 'Chiitoitsu');
  assertHas(r, 'Honitsu');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Honitsu').han, 3, 'Honitsu is always full (3 han) here — chiitoitsu is inherently closed');
  assert.strictEqual(r.han, 5, 'Chiitoitsu(2) + Honitsu(3)');
});

test('Chiitoitsu + Chinitsu (one suit, no honors) both apply', () => {
  const hand = [...pairT(1, 'm'), ...pairT(2, 'm'), ...pairT(4, 'm'), ...pairT(6, 'm'),
    ...pairT(7, 'm'), ...pairT(8, 'm'), ...pairT(9, 'm')];
  const r = Y(hand, [], { winTileKey: '9m' });
  assertHas(r, 'Chiitoitsu');
  assertHas(r, 'Chinitsu');
  assert.strictEqual(r.han, 8, 'Chiitoitsu(2) + Chinitsu(6)');
});

test('Chiitoitsu + Tanyao (all simples, multi-suit — no flush) both apply', () => {
  const hand = [...pairT(2, 'm'), ...pairT(3, 'm'), ...pairT(4, 'p'), ...pairT(5, 'p'),
    ...pairT(6, 's'), ...pairT(7, 's'), ...pairT(8, 'm')];
  const r = Y(hand, [], { winTileKey: '8m' });
  assertHas(r, 'Chiitoitsu');
  assertHas(r, 'Tanyao');
  assertNotHas(r, 'Honitsu');
  assertNotHas(r, 'Chinitsu');
  assert.strictEqual(r.han, 3, 'Chiitoitsu(2) + Tanyao(1)');
});

test('Chiitoitsu + Honroutou (mix of terminals and honors, no simples) both apply', () => {
  const hand = [...pairT(1, 'm'), ...pairT(9, 'm'), ...pairT(1, 'p'), ...pairT(9, 's'),
    ...pairT(1, 'z'), ...pairT(2, 'z'), ...pairT(3, 'z')];
  const r = Y(hand, [], { winTileKey: '3z' });
  assertHas(r, 'Chiitoitsu');
  assertHas(r, 'Honroutou');
  assert.strictEqual(r.han, 4, 'Chiitoitsu(2) + Honroutou(2)');
});

test('Chiitoitsu alone (mixed suits, mixed simples/terminals/honors) gets no bonus yaku', () => {
  const hand = [...pairT(1, 'm'), ...pairT(9, 'p'), ...pairT(5, 's'), ...pairT(3, 'm'),
    ...pairT(7, 'p'), ...pairT(2, 's'), ...pairT(1, 'z')];
  const r = Y(hand, [], { winTileKey: '1z' });
  assertHas(r, 'Chiitoitsu');
  assertNotHas(r, 'Tanyao');
  assertNotHas(r, 'Honroutou');
  assertNotHas(r, 'Honitsu');
  assertNotHas(r, 'Chinitsu');
  assert.strictEqual(r.han, 2, 'Chiitoitsu alone');
});

test('Kokushi Musou (single-tile wait: one type pre-paired, one type missing)', () => {
  // Pre-win 13: 1z is already paired, 7z is the sole missing type -> single wait on 7z.
  const hand = [T(1, 'm'), T(9, 'm'), T(1, 'p'), T(9, 'p'), T(1, 's'), T(9, 's'),
    T(1, 'z'), T(1, 'z'), T(2, 'z'), T(3, 'z'), T(4, 'z'), T(5, 'z'), T(6, 'z'), T(7, 'z')];
  const r = Y(hand, [], { winTileKey: '7z' });
  assertHas(r, 'Kokushi Musou');
  assertNotHas(r, 'Kokushi Juusanmen');
});

test('Kokushi Juusanmen (13-sided wait variant)', () => {
  const hand = [T(1, 'm'), T(9, 'm'), T(1, 'p'), T(9, 'p'), T(1, 's'), T(9, 's'),
    T(1, 'z'), T(2, 'z'), T(3, 'z'), T(4, 'z'), T(5, 'z'), T(6, 'z'), T(7, 'z'), T(7, 'z')];
  const r = Y(hand, [], { winTileKey: '7z' });
  assertHas(r, 'Kokushi Juusanmen');
});

test('Chuuren Poutou', () => {
  const hand = [T(1, 'p'), T(1, 'p'), T(1, 'p'), T(2, 'p'), T(3, 'p'), T(4, 'p'), T(5, 'p'),
    T(6, 'p'), T(7, 'p'), T(8, 'p'), T(9, 'p'), T(9, 'p'), T(9, 'p'), T(5, 'p')];
  const r = Y(hand, [], { winTileKey: '5p' });
  assertHas(r, 'Junsei Chuuren', 'winning on the exact 9-sided tile should be the pure/double variant');
});

test('Tenhou (dealer, no other player has acted)', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isTsumo: true, isTenhou: true, winTileKey: null });
  assertHas(r, 'Tenhou');
});

test('Chiihou', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { isTsumo: true, isChiihou: true, winTileKey: null });
  assertHas(r, 'Chiihou');
});

test('Ryuuiisou (all green)', () => {
  const hand = [...seq(2, 's'), ...tri(6, 's'), ...tri(6, 'z'), ...seq(2, 's').map(t => ({ ...t, id: _id++ })), ...pairT(4, 's')];
  const r = Y(hand, [], { winTileKey: '4s' });
  assertHas(r, 'Ryuuiisou');
});

test('Tsuuiisou (all honors)', () => {
  const hand = [...tri(1, 'z'), ...tri(2, 'z'), ...tri(5, 'z'), ...tri(6, 'z'), ...pairT(7, 'z')];
  const r = Y(hand, [], { winTileKey: '7z' });
  assertHas(r, 'Tsuuiisou');
});

test('Chinroutou (all terminals)', () => {
  const hand = [...tri(1, 'm'), ...tri(9, 'm'), ...tri(1, 'p'), ...tri(9, 's'), ...pairT(9, 'p')];
  const r = Y(hand, [], { winTileKey: '9p' });
  assertHas(r, 'Chinroutou');
});

test('Chinroutou does NOT fire when melds contain non-terminal tiles (regression)', () => {
  const hand = [T(9, 'p'), T(9, 'p')];
  const melds = [
    meld('kan', [T(5, 'm'), T(5, 'm'), T(5, 'm'), T(5, 'm')], { open: true }),
    meld('pon', tri(2, 'p'), { open: true }),
    meld('pon', tri(3, 'z'), { open: true }),
    meld('pon', tri(3, 'm'), { open: true }),
  ];
  const r = Y(hand, melds, { seatWind: 3, winTileKey: '9p' });
  assertNotHas(r, 'Chinroutou');
  assertHas(r, 'Toitoi');
});

test('Suu Kantsu (4 kans, yakuman)', () => {
  const hand = [T(9, 'p'), T(9, 'p')];
  const melds = [
    meld('kan', [T(1, 'm'), T(1, 'm'), T(1, 'm'), T(1, 'm')]),
    meld('kan', [T(2, 'm'), T(2, 'm'), T(2, 'm'), T(2, 'm')]),
    meld('kan', [T(3, 'm'), T(3, 'm'), T(3, 'm'), T(3, 'm')]),
    meld('kan', [T(4, 'm'), T(4, 'm'), T(4, 'm'), T(4, 'm')]),
  ];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertHas(r, 'Suu Kantsu');
});

test('San Kantsu (3 kans)', () => {
  const hand = [...tri(9, 'p'), ...pairT(5, 'm')];
  const melds = [
    meld('kan', [T(1, 'z'), T(1, 'z'), T(1, 'z'), T(1, 'z')]),
    meld('kan', [T(2, 'z'), T(2, 'z'), T(2, 'z'), T(2, 'z')]),
    meld('kan', [T(3, 'z'), T(3, 'z'), T(3, 'z'), T(3, 'z')]),
  ];
  const r = Y(hand, melds, { seatWind: 4, winTileKey: '5m' });
  assertHas(r, 'San Kantsu');
});

test('San Kantsu does NOT fire on 4 kans (that is Suu Kantsu, checked first and returns early)', () => {
  const hand = [T(9, 'p'), T(9, 'p')];
  const melds = [
    meld('kan', [T(1, 'm'), T(1, 'm'), T(1, 'm'), T(1, 'm')]),
    meld('kan', [T(2, 'm'), T(2, 'm'), T(2, 'm'), T(2, 'm')]),
    meld('kan', [T(3, 'm'), T(3, 'm'), T(3, 'm'), T(3, 'm')]),
    meld('kan', [T(4, 'm'), T(4, 'm'), T(4, 'm'), T(4, 'm')]),
  ];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertNotHas(r, 'San Kantsu');
  assertHas(r, 'Suu Kantsu');
});

test('Honroutou (terminals + honours mix)', () => {
  const hand = [...tri(1, 'm'), ...tri(9, 'p'), ...pairT(9, 's')];
  const melds = [
    meld('pon', tri(1, 'p'), { open: true }),
    meld('pon', tri(3, 'z'), { open: true }),
  ];
  const r = Y(hand, melds, { seatWind: 4, winTileKey: '9s' });
  assertHas(r, 'Honroutou');
  assertHas(r, 'Toitoi');
});

test('Honroutou does NOT fire when a simple (non-terminal, non-honour) tile is present (regression)', () => {
  const hand = [...tri(1, 'm'), ...tri(5, 'p'), ...pairT(9, 's')];
  const melds = [
    meld('pon', tri(1, 'p'), { open: true }),
    meld('pon', tri(3, 'z'), { open: true }),
  ];
  const r = Y(hand, melds, { seatWind: 4, winTileKey: '9s' });
  assertNotHas(r, 'Honroutou');
});

test('Honroutou does NOT fire on all-honours (that is Tsuuiisou, a yakuman, checked before Honroutou is reachable)', () => {
  const hand = [...tri(1, 'z'), ...tri(2, 'z'), ...pairT(3, 'z')];
  const melds = [
    meld('pon', tri(5, 'z'), { open: true }),
    meld('pon', tri(6, 'z'), { open: true }),
  ];
  const r = Y(hand, melds, { seatWind: 4, winTileKey: '3z' });
  assertNotHas(r, 'Honroutou');
  assertHas(r, 'Tsuuiisou');
});

test('Suu Ankou (4 closed triplets, tsumo)', () => {
  const pre = [...tri(3, 'm'), ...tri(7, 'p'), ...tri(9, 's'), ...pairT(2, 'z'), ...pairT(6, 'z')];
  const r = Y([...pre, T(6, 'z')], [], { isTsumo: true, winTileKey: '6z' });
  assertHas(r, 'Suu Ankou');
});

test('Suu Ankou does NOT fire on a ron-completed shanpon (regression: real rule is Sanankou only)', () => {
  const pre = [...tri(3, 'm'), ...tri(7, 'p'), ...tri(9, 's'), ...pairT(2, 'z'), ...pairT(6, 'z')];
  const r = Y([...pre, T(6, 'z')], [], { isTsumo: false, winTileKey: '6z' });
  assertNotHas(r, 'Suu Ankou');
  assertHas(r, 'San Ankou');
});

test('Suu Ankou Tanki (ron on the pair, still all 4 triplets concealed)', () => {
  const pre = [...tri(3, 'm'), ...tri(7, 'p'), ...tri(9, 's'), ...tri(5, 'z'), T(6, 'z')];
  const r = Y([...pre, T(6, 'z')], [], { isTsumo: false, winTileKey: '6z' });
  assertHas(r, 'Suu Ankou Tanki');
});

test('Shousuushii (3 wind triplets + wind pair)', () => {
  const hand = [...tri(1, 'z'), ...tri(2, 'z'), ...tri(3, 'z'), ...pairT(4, 'z'), ...seq(2, 'm')];
  const r = Y(hand, [], { winTileKey: '4z' });
  assertHas(r, 'Shousuushii');
});

test('Daisuushii (4 wind triplets, double yakuman)', () => {
  const hand = [...tri(1, 'z'), ...tri(2, 'z'), ...tri(3, 'z'), ...tri(4, 'z'), ...pairT(5, 'p')];
  const r = Y(hand, [], { winTileKey: '5p' });
  assertHas(r, 'Daisuushii');
  assert.strictEqual(r.han, 26);
});

// ══════════════════════════════════════════════════════════════════════════
// Melded (open) hand yaku — the user specifically flagged that yaku have
// triggered incorrectly with melded tiles before, so this section exercises
// every yaku that can legally apply to an open hand, plus meld-specific
// edge cases (wrong suit/terminal in a meld, chi vs pon vs kan, ankan vs
// daiminkan vs kakan concealment, etc).
// ══════════════════════════════════════════════════════════════════════════

test('Sanshoku Doujun with an open chi meld (reduced to 1 han)', () => {
  const hand = [...seq(3, 'p'), ...seq(3, 's'), ...seq(7, 'p'), ...pairT(2, 'z')];
  const melds = [meld('chi', seq(3, 'm'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '5s' });
  assertHas(r, 'Sanshoku Doujun');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Sanshoku Doujun').han, 1, 'open sanshoku should be 1 han, not 2');
});

test('Ittsu spanning an open chi meld + concealed sequences (reduced to 1 han)', () => {
  const hand = [...seq(4, 'p'), ...seq(7, 'p'), ...tri(3, 's'), ...pairT(6, 'm')];
  const melds = [meld('chi', seq(1, 'p'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertHas(r, 'Ittsu');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Ittsu').han, 1);
});

test('Chanta with an open meld (reduced to 1 han)', () => {
  const hand = [...seq(1, 'm'), ...tri(9, 's'), ...tri(1, 'p'), ...pairT(1, 'z')];
  const melds = [meld('chi', seq(7, 'p'), { open: true })]; // 789p contains terminal 9p
  const r = Y(hand, melds, { winTileKey: '1p' });
  assertHas(r, 'Chanta');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Chanta').han, 1);
});

test('Chanta does NOT fire if the open meld lacks a terminal/honor', () => {
  const hand = [...seq(1, 'm'), ...tri(9, 's'), ...tri(1, 'p'), ...pairT(1, 'z')];
  const melds = [meld('chi', seq(4, 'p'), { open: true })]; // 456p - no terminal/honor
  const r = Y(hand, melds, { winTileKey: '1p' });
  assertNotHas(r, 'Chanta');
  assertNotHas(r, 'Junchan');
});

test('Junchan with an open meld (reduced to 2 han, no honors anywhere)', () => {
  const hand = [...seq(1, 'm'), ...tri(9, 's'), ...tri(1, 'p'), ...pairT(9, 'm')];
  const melds = [meld('chi', seq(7, 'p'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '1p' });
  assertHas(r, 'Junchan');
  assertNotHas(r, 'Chanta');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Junchan').han, 2);
});

test('Honitsu with an open meld of the matching suit (reduced to 2 han)', () => {
  const hand = [...seq(2, 'p'), ...seq(4, 'p'), ...tri(1, 'z'), ...pairT(5, 'z')];
  const melds = [meld('pon', tri(6, 'p'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '6p' });
  assertHas(r, 'Honitsu');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Honitsu').han, 2);
});

test('Honitsu does NOT fire if the open meld is a different suit', () => {
  const hand = [...seq(2, 'p'), ...seq(4, 'p'), ...tri(1, 'z'), ...pairT(5, 'z')];
  const melds = [meld('pon', tri(6, 's'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '6s' });
  assertNotHas(r, 'Honitsu');
});

test('Chinitsu with an open meld of the matching suit (reduced to 5 han)', () => {
  const hand = [...seq(2, 'p'), ...seq(4, 'p'), ...seq(6, 'p'), ...pairT(9, 'p')];
  const melds = [meld('pon', tri(1, 'p'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '1p' });
  assertHas(r, 'Chinitsu');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Chinitsu').han, 5);
});

test('Chinitsu does NOT fire (falls back to Honitsu) if the open meld is an honor triplet', () => {
  const hand = [...seq(2, 'p'), ...seq(4, 'p'), ...seq(6, 'p'), ...pairT(9, 'p')];
  const melds = [meld('pon', tri(3, 'z'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertNotHas(r, 'Chinitsu');
  assertHas(r, 'Honitsu');
});

test('Tanyao does NOT fire if the open meld contains a terminal', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...pairT(5, 's')];
  const melds = [meld('pon', tri(9, 'p'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '6p' });
  assertNotHas(r, 'Tanyao');
});

test('Tanyao DOES fire when the open meld is all simples', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 'p'), ...pairT(5, 's')];
  const melds = [meld('pon', tri(3, 'p'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '6p' });
  assertHas(r, 'Tanyao');
});

test('Yakuhai fires from an open pon meld', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const melds = [meld('pon', tri(6, 'z'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '8p' });
  assertHas(r, 'Hatsu');
});

test('Yakuhai fires from an open daiminkan meld', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const melds = [meld('kan', [T(7, 'z'), T(7, 'z'), T(7, 'z'), T(7, 'z')], { kanType: 'daiminkan', open: true })];
  const r = Y(hand, melds, { winTileKey: '8p' });
  assertHas(r, 'Chun');
});

test('Yakuhai fires from a concealed ankan meld', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(8, 'p')];
  const melds = [meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'ankan', open: false })];
  const r = Y(hand, melds, { winTileKey: '8p' });
  assertHas(r, 'Haku');
});

test('Toitoi does NOT fire if one of the "melds" is actually a chi (sequence)', () => {
  const hand = [...tri(3, 'm'), ...pairT(9, 'p')];
  const melds = [
    meld('pon', tri(4, 'z'), { open: true }),
    meld('pon', tri(2, 's'), { open: true }),
    meld('chi', seq(4, 'p'), { open: true }),
  ];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertNotHas(r, 'Toitoi');
});

test('San Ankou counts a concealed ankan as one of the 3 concealed triplets', () => {
  const hand = [...tri(3, 'm'), ...tri(7, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const melds = [meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'ankan', open: false })];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertHas(r, 'San Ankou', 'a concealed ankan should count toward the concealed-triplet total');
});

test('San Ankou does NOT count an open daiminkan toward the concealed-triplet total', () => {
  const hand = [...tri(3, 'm'), ...tri(7, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const melds = [meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'daiminkan', open: true, fromSeat: 1 })];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertNotHas(r, 'San Ankou');
});

test('San Ankou does NOT count a kakan (upgraded pon, still open) toward the concealed-triplet total', () => {
  const hand = [...tri(3, 'm'), ...tri(7, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  // Real kakan melds never get an explicit `open` field set (see room.js _completeChankan) —
  // deliberately omitted here too, to make sure the check relies on kanType, not `.open`.
  const melds = [meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'kakan', fromSeat: 1 })];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertNotHas(r, 'San Ankou');
});

test('Suu Ankou fires from 2 concealed hand triplets + 2 ankans (still all concealed)', () => {
  const hand = [...tri(3, 'm'), ...tri(7, 'p'), ...pairT(9, 'p')];
  const melds = [
    meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'ankan', open: false }),
    meld('kan', [T(6, 'z'), T(6, 'z'), T(6, 'z'), T(6, 'z')], { kanType: 'ankan', open: false }),
  ];
  const r = Y(hand, melds, { isTsumo: true, winTileKey: '9p' });
  assertHas(r, 'Suu Ankou Tanki', 'won on the pair via tsumo with all 4 triplets concealed (2 in hand + 2 ankan)');
});

// ── menzen/closed-hand status: ankan must NOT break it (regression) ────────
// detectYaku used to compute `open` as simply melds.length>0, which wrongly
// treated ANY meld — including a fully concealed ankan — as opening the
// hand. That silently killed Riichi/Ippatsu/Menzen-Tsumo/Pinfu/Iipeiko/
// Ryanpeiko/Suu-Ankou and served the wrong (reduced) han for Sanshoku/
// Ittsu/Chanta/Honitsu/Chinitsu on any hand that included a self-declared
// ankan, even though real rules say ankan never breaks a closed hand.

test('Riichi still fires on a hand with only an ankan meld (ankan does not break menzen)', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(9, 'p')];
  const melds = [meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'ankan', open: false })];
  const r = Y(hand, melds, { isRiichi: true, winTileKey: '9p' });
  assertHas(r, 'Riichi');
});

test('Riichi does NOT fire on a genuinely open hand (real pon)', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(9, 'p')];
  const melds = [meld('pon', tri(5, 'z'), { open: true })];
  const r = Y(hand, melds, { isRiichi: true, winTileKey: '9p' });
  assertNotHas(r, 'Riichi');
});

test('Menzen Tsumo still fires on a hand with only an ankan meld', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...pairT(9, 'p')];
  const melds = [meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'ankan', open: false })];
  const r = Y(hand, melds, { isTsumo: true, winTileKey: '9p' });
  assertHas(r, 'Menzen Tsumo');
});

test('Honitsu is still full (non-reduced, 3 han) on a hand with only an ankan meld', () => {
  const hand = [...seq(2, 'p'), ...seq(5, 'p'), ...tri(9, 'p'), ...pairT(3, 'z')];
  const melds = [meld('kan', [T(1, 'z'), T(1, 'z'), T(1, 'z'), T(1, 'z')], { kanType: 'ankan', open: false })];
  const r = Y(hand, melds, { winTileKey: '3z' });
  assertHas(r, 'Honitsu');
  assert.strictEqual(r.yakuList.find(y => y.name === 'Honitsu').han, 3, 'ankan-only hand is still closed, should get the full 3 han, not the open 2 han');
});

test('Daisangen fires with an open pon among the dragon triplets', () => {
  const hand = [...tri(6, 'z'), ...tri(7, 'z'), ...seq(2, 'm'), ...pairT(8, 'p')];
  const melds = [meld('pon', tri(5, 'z'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '8p' });
  assertHas(r, 'Daisangen');
  assert.strictEqual(r.han, 13);
});

test('Shousuushii fires with an open kan among the wind triplets', () => {
  const hand = [...tri(1, 'z'), ...tri(2, 'z'), ...pairT(4, 'z'), ...seq(2, 'm')];
  const melds = [meld('kan', [T(3, 'z'), T(3, 'z'), T(3, 'z'), T(3, 'z')], { kanType: 'daiminkan', open: true })];
  const r = Y(hand, melds, { winTileKey: '4z' });
  assertHas(r, 'Shousuushii');
});

test('Daisuushii fires with an open pon among the 4 wind triplets', () => {
  const hand = [...tri(1, 'z'), ...tri(2, 'z'), ...tri(3, 'z'), ...pairT(5, 'p')];
  const melds = [meld('pon', tri(4, 'z'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '5p' });
  assertHas(r, 'Daisuushii');
  assert.strictEqual(r.han, 26);
});

test('Tsuuiisou fires with melded honor triplets (pon + kan)', () => {
  const hand = [...tri(3, 'z'), ...pairT(7, 'z')];
  const melds = [
    meld('pon', tri(1, 'z'), { open: true }),
    meld('pon', tri(2, 'z'), { open: true }),
    meld('kan', [T(5, 'z'), T(5, 'z'), T(5, 'z'), T(5, 'z')], { kanType: 'daiminkan', open: true }),
  ];
  const r = Y(hand, melds, { winTileKey: '7z' });
  assertHas(r, 'Tsuuiisou');
});

test('Ryuuiisou fires with melded green triplets', () => {
  const hand = [...seq(2, 's'), ...tri(8, 's'), ...pairT(4, 's')];
  const melds = [
    meld('pon', tri(6, 's'), { open: true }),
    meld('pon', tri(6, 'z'), { open: true }),
  ];
  const r = Y(hand, melds, { winTileKey: '4s' });
  assertHas(r, 'Ryuuiisou');
});

test('Chinroutou fires when every meld (including a kan) is all-terminal', () => {
  const hand = [...tri(1, 's'), ...pairT(9, 'p')];
  const melds = [
    meld('kan', [T(1, 'm'), T(1, 'm'), T(1, 'm'), T(1, 'm')], { kanType: 'daiminkan', open: true }),
    meld('pon', tri(9, 'm'), { open: true }),
    meld('pon', tri(1, 'p'), { open: true }),
  ];
  const r = Y(hand, melds, { winTileKey: '9p' });
  assertHas(r, 'Chinroutou');
});

test('Iipeiko does NOT fire on an open hand', () => {
  const hand = [...seq(2, 'm'), ...seq(2, 'm'), ...seq(5, 'p'), ...pairT(5, 'm')];
  const melds = [meld('pon', tri(7, 's'), { open: true })];
  const r = Y(hand, melds, { winTileKey: '7p' });
  assertNotHas(r, 'Iipeiko');
});

test('Riichi/Ippatsu/Menzen-family yaku cannot fire on an open hand even if flagged true', () => {
  // Defensive check: these flags should never be true for an open hand in
  // real play (riichi requires a closed hand to declare), but detectYaku
  // itself should still refuse to award them if somehow passed in anyway.
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...pairT(9, 'p')];
  const melds = [meld('pon', tri(6, 'z'), { open: true })];
  const r = Y(hand, melds, { isRiichi: true, isIppatsu: true, isDoubleRiichi: true, isTsumo: true, winTileKey: '6p' });
  assertNotHas(r, 'Riichi');
  assertNotHas(r, 'Double Riichi');
  assertNotHas(r, 'Ippatsu');
  assertNotHas(r, 'Menzen Tsumo');
});

// ══════════════════════════════════════════════════════════════════════════
// isMenzen — shared closed-hand check (ankan must not count as opening)
// ══════════════════════════════════════════════════════════════════════════

test('isMenzen: true for no melds at all', () => {
  assert.strictEqual(isMenzen([]), true);
});

test('isMenzen: true for ankan-only melds', () => {
  assert.strictEqual(isMenzen([{ type: 'kan', kanType: 'ankan', tiles: tri(5, 'z') }]), true);
});

test('isMenzen: false for any pon/chi/daiminkan/kakan', () => {
  assert.strictEqual(isMenzen([{ type: 'pon', tiles: tri(5, 'z') }]), false);
  assert.strictEqual(isMenzen([{ type: 'chi', tiles: seq(3, 'm') }]), false);
  assert.strictEqual(isMenzen([{ type: 'kan', kanType: 'daiminkan', tiles: tri(5, 'z') }]), false);
  assert.strictEqual(isMenzen([{ type: 'kan', kanType: 'kakan', tiles: tri(5, 'z') }]), false);
});

test('isMenzen: false if even one non-ankan meld is mixed in with ankans', () => {
  assert.strictEqual(isMenzen([
    { type: 'kan', kanType: 'ankan', tiles: tri(5, 'z') },
    { type: 'pon', tiles: tri(6, 'z') },
  ]), false);
});

// ══════════════════════════════════════════════════════════════════════════
// Fu calculation (server/mahjong.js calcFu) — open-hand ron base fu bug
// ══════════════════════════════════════════════════════════════════════════
// calcFu used to start every ron (open or closed) at a 30 base, when only
// CLOSED (menzen) ron gets that +10 bonus over the standard 20 base — open
// ron should start at 20, same as tsumo, and only pick up bonuses from
// triplets/wait shape/etc from there. This over-scored essentially every
// open-hand ron by a full fu tier after rounding.

test('calcFu: open-hand ron with a simple open triplet is 30 fu, not 40', () => {
  // 20 base + 2 (open pon of simples) + 0 (ryanmen wait) = 22 -> rounds to 30
  const groups = [
    { t: 'tri', k: ['3p', '3p', '3p'], open: true },
    { t: 'seq', k: ['4m', '5m', '6m'] },
    { t: 'seq', k: ['2s', '3s', '4s'] },
    { t: 'seq', k: ['5p', '6p', '7p'] },
    { t: 'pair', k: ['9m', '9m'] },
  ];
  assert.strictEqual(calcFu(groups, false, false, '6m', false), 30);
});

test('calcFu: closed-hand (menzen) ron with no bonuses still floors at 30', () => {
  // 20 base -> menzen-ron floor bumps it to 30 (no triplets/wait bonus here)
  const groups = [
    { t: 'seq', k: ['4m', '5m', '6m'] },
    { t: 'seq', k: ['2s', '3s', '4s'] },
    { t: 'seq', k: ['5p', '6p', '7p'] },
    { t: 'seq', k: ['3p', '4p', '5p'] },
    { t: 'pair', k: ['9m', '9m'] },
  ];
  assert.strictEqual(calcFu(groups, false, true, '6m', false), 30);
});

test('calcFu: open-hand ron with genuinely nothing extra can land below 30 before rounding (still rounds to 30, but via 20+2, not 30+2)', () => {
  // Open pon of a simple tile is the smallest possible non-zero bonus (2 fu):
  // 20 + 2 = 22 -> 30. If the old bug were present this would start at 32 -> 40.
  const groups = [
    { t: 'tri', k: ['4p', '4p', '4p'], open: true },
    { t: 'seq', k: ['4m', '5m', '6m'] },
    { t: 'seq', k: ['2s', '3s', '4s'] },
    { t: 'seq', k: ['5p', '6p', '7p'] },
    { t: 'pair', k: ['9m', '9m'] },
  ];
  assert.strictEqual(calcFu(groups, false, false, '6m', false), 30, 'must not be 40 — that was the pre-fix bug');
});

// ══════════════════════════════════════════════════════════════════════════
// detectYaku's `groups`/`isChiitoitsu` result fields — callers (room.js)
// used to independently recompute decompose(hand) and grab decomps[0] for
// fu purposes, which is NOT guaranteed to be the same decomposition
// detectYaku itself picked when deciding which yaku apply. Fixed by having
// detectYaku hand back the actual winning decomposition (`groups`) instead,
// shaped for calcFu specifically — including meld tiles (which decompose()
// never saw at all, since it only ever ran on the concealed hand) with
// kans correctly distinguished from plain triplets.
// ══════════════════════════════════════════════════════════════════════════

test('detectYaku: a Pinfu-shaped decomp\'s groups always produce the fixed 30 fu, even when the SAME tiles also admit a non-pinfu (triplet) reading', () => {
  // 1111m 2222m 3333m 44s: also readable as (111m)(222m)(333m tri) + a
  // leftover 1m/2m/3m forming... — the point isn't the alternate reading's
  // validity, it's that decompose(hand) returns MULTIPLE decomps for this
  // shape and detectYaku must hand back groups consistent with whichever
  // one it actually used to grant Pinfu, not just "some" decomp of the hand.
  const hand = [
    T(1, 'm'), T(1, 'm'), T(1, 'm'), T(1, 'm'),
    T(2, 'm'), T(2, 'm'), T(2, 'm'), T(2, 'm'),
    T(3, 'm'), T(3, 'm'), T(3, 'm'), T(3, 'm'),
    T(4, 's'), T(4, 's'),
  ];
  const r = Y(hand, [], { winTileKey: '1m' });
  assertHas(r, 'Pinfu');
  const hasPinfu = true;
  const fu = calcFu(r.groups, false, true, '1m', hasPinfu);
  assert.strictEqual(fu, 30, 'Pinfu-ron is always exactly 30 fu, regardless of which alternate reading the same tiles admit');
});

test('detectYaku: a Chiitoitsu win is flagged isChiitoitsu and carries no `groups` (fu is a fixed 25, not derived from any set breakdown)', () => {
  const hand = [...pairT(1, 'm'), ...pairT(3, 'm'), ...pairT(5, 'p'), ...pairT(7, 'p'),
    ...pairT(2, 's'), ...pairT(4, 's'), T(6, 'z'), T(6, 'z')];
  const r = Y(hand, [], { winTileKey: '6z' });
  assertHas(r, 'Chiitoitsu');
  assert.strictEqual(r.isChiitoitsu, true);
  assert.strictEqual(r.groups, undefined);
});

test('detectYaku: an open meld is included in `groups` with the correct openness and kan-vs-triplet type, for calcFu to see', () => {
  const melds = [meld('pon', [T(5, 's'), T(5, 's'), T(5, 's')])];
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...pairT(4, 's'), T(7, 'm'), T(8, 'm'), T(6, 'm')];
  const r = Y(hand, melds, { winTileKey: '6m' });
  assertHas(r, 'Tanyao');
  const openTri = r.groups.find(g => g.t === 'tri' && g.k[0] === '5s');
  assert.ok(openTri, 'the pon shows up in groups as a triplet');
  assert.strictEqual(openTri.open, true);
  // Old bug: decompose(hand) only ever saw the concealed hand, so this
  // meld's fu (2, for an open simple triplet) was silently dropped —
  // fu would have landed at 20, not 30.
  assert.strictEqual(calcFu(r.groups, false, isMenzen(melds), '6m', false), 30);
});

test('detectYaku: a concealed ankan is included in `groups` as a KAN (not a plain triplet) and marked closed', () => {
  const melds = [meld('kan', [T(3, 's'), T(3, 's'), T(3, 's'), T(3, 's')], { kanType: 'ankan' })];
  const hand = [...seq(2, 'm'), ...seq(4, 'p'), ...pairT(4, 'm'), T(7, 'm'), T(8, 'm'), T(6, 'm')];
  const r = Y(hand, melds, { winTileKey: '6m' });
  const kanGroup = r.groups.find(g => g.t === 'kan');
  assert.ok(kanGroup, 'the ankan shows up in groups typed as a kan, not a triplet');
  assert.strictEqual(kanGroup.open, false, 'an ankan is concealed even though it lives in melds, not groups');
});

// ══════════════════════════════════════════════════════════════════════════
// basePoints (server/mahjong.js) — yakuman/double-yakuman were paying out
// exactly 2x the correct amount (8000->16000, 16000->32000 base). Pinned
// here against the universally-referenced standard payout table so a
// regression is caught immediately, not just "looks plausible".
// ══════════════════════════════════════════════════════════════════════════

function ronPay(han, fu, isDealer) {
  return Math.ceil(basePoints(han, fu) * (isDealer ? 6 : 4) / 100) * 100;
}

test('basePoints: mangan/haneman/baiman/sanbaiman ron payouts match the standard table', () => {
  assert.strictEqual(ronPay(5, 30, false), 8000);   // mangan
  assert.strictEqual(ronPay(5, 30, true), 12000);
  assert.strictEqual(ronPay(6, 30, false), 12000);  // haneman
  assert.strictEqual(ronPay(6, 30, true), 18000);
  assert.strictEqual(ronPay(8, 30, false), 16000);  // baiman
  assert.strictEqual(ronPay(8, 30, true), 24000);
  assert.strictEqual(ronPay(11, 30, false), 24000); // sanbaiman
  assert.strictEqual(ronPay(11, 30, true), 36000);
});

test('basePoints: yakuman ron payout is 32000/48000, not double', () => {
  assert.strictEqual(ronPay(13, 0, false), 32000);
  assert.strictEqual(ronPay(13, 0, true), 48000);
});

test('basePoints: double yakuman ron payout is 64000/96000, not double', () => {
  assert.strictEqual(ronPay(26, 0, false), 64000);
  assert.strictEqual(ronPay(26, 0, true), 96000);
});

// ══════════════════════════════════════════════════════════════════════════
// Dora indicator wraparound (winds and dragons are separate cycles)
// ══════════════════════════════════════════════════════════════════════════

test('dora: simple suit tile wraps 9 -> 1', () => {
  assert.strictEqual(countDora([T(1, 'm')], [T(9, 'm')]), 1);
});

test('dora: wind indicator wraps within winds only (North -> East, not White Dragon)', () => {
  assert.strictEqual(countDora([T(1, 'z')], [T(4, 'z')]), 1);
  assert.strictEqual(countDora([T(5, 'z')], [T(4, 'z')]), 0);
});

test('dora: dragon indicator wraps within dragons only (Chun -> Haku, not East)', () => {
  assert.strictEqual(countDora([T(5, 'z')], [T(7, 'z')]), 1);
  assert.strictEqual(countDora([T(1, 'z')], [T(7, 'z')]), 0);
});

// ══════════════════════════════════════════════════════════════════════════
// Shanten (tiles-away-from-tenpai)
// ══════════════════════════════════════════════════════════════════════════

test('shanten: complete 14-tile hand is -1', () => {
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(1, 'p'), ...tri(5, 's'), ...pairT(1, 'z')];
  assert.strictEqual(shanten(hand, []), -1);
});

test('shanten: tenpai (tanki wait) 13-tile hand is 0, matches waits()', () => {
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(1, 'p'), ...tri(5, 's'), T(1, 'z')];
  assert.strictEqual(shanten(hand, []), 0);
  assert.ok(waits(hand, []).includes('1z'));
});

test('shanten: 1-shanten hand (3 sets + 1 partial run + 2 isolated honors)', () => {
  const hand = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(1, 'p'), T(5, 's'), T(6, 's'), T(7, 'z'), T(1, 'z')];
  assert.strictEqual(hand.length, 13);
  assert.strictEqual(shanten(hand, []), 1);
});

test('shanten: fully scattered 13-tile hand falls back to chiitoitsu shanten (6)', () => {
  const hand = [
    T(1, 'm'), T(4, 'm'), T(7, 'm'), T(1, 'p'), T(4, 'p'), T(7, 'p'),
    T(1, 's'), T(4, 's'), T(7, 's'), T(1, 'z'), T(2, 'z'), T(3, 'z'), T(4, 'z'),
  ];
  assert.strictEqual(hand.length, 13);
  // No pairs, no adjacent/near tiles anywhere -> standard-form shanten (8) is
  // worse than chiitoitsu-form shanten (6-0 pairs+max(0,7-13 kinds)=6), so
  // shanten() must pick the chiitoitsu path.
  assert.strictEqual(shanten(hand, []), 6);
});

test('shanten: open hand (1 pon meld) tenpai on a tanki wait', () => {
  const melds = [meld('pon', tri(5, 'p'))];
  const concealed = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(1, 'p'), T(7, 'z')];
  assert.strictEqual(concealed.length, 10); // base13 for 1 pon meld: 13-3+0
  assert.strictEqual(shanten(concealed, melds), 0);
  assert.ok(waits(concealed, melds).includes('7z'));
});

// ══════════════════════════════════════════════════════════════════════════
// Rule variants: aka dora on/off, kuitan ari/nashi
// ══════════════════════════════════════════════════════════════════════════

test('buildWall(false): no tile is marked as aka dora', () => {
  const wall = buildWall(false);
  assert.strictEqual(wall.filter(t => t.red).length, 0);
});

test('buildWall()/buildWall(true): exactly 3 tiles (one per suit) are aka dora', () => {
  assert.strictEqual(buildWall().filter(t => t.red).length, 3);
  assert.strictEqual(buildWall(true).filter(t => t.red).length, 3);
});

test('kuitanAri=false: Tanyao is disallowed on an OPEN all-simples hand', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 's'), ...tri(6, 'p'), ...pairT(8, 'p')];
  const melds = [meld('pon', tri(4, 'p'))];
  assertHas(Y(hand, melds, { rules: { kuitanAri: true } }), 'Tanyao');
  assertNotHas(Y(hand, melds, { rules: { kuitanAri: false } }), 'Tanyao');
});

test('kuitanAri=false: Tanyao still scores on a CLOSED all-simples hand (menzen exemption)', () => {
  const hand = [...seq(2, 'm'), ...seq(4, 'm'), ...seq(2, 's'), ...tri(6, 'p'), ...pairT(8, 'p')];
  assertHas(Y(hand, [], { rules: { kuitanAri: false } }), 'Tanyao');
});

// ══════════════════════════════════════════════════════════════════════════
// Sanma (3-player): sanma wall drops 2m-8m; waits() must never report a
// wait on a tile that can't exist in that wall.
// ══════════════════════════════════════════════════════════════════════════

test('buildWall(true, true): 108 tiles, no 2m-8m present', () => {
  const wall = buildWall(true, true);
  assert.strictEqual(wall.length, 108);
  assert.strictEqual(wall.filter(t => t.s === 'm' && t.v >= 2 && t.v <= 8).length, 0);
  assert.strictEqual(wall.filter(t => t.s === 'm' && (t.v === 1 || t.v === 9)).length, 8); // 4 copies each of 1m/9m
});

test('buildWall(true, false) (default): still 136 tiles, unaffected by the sanma param existing', () => {
  assert.strictEqual(buildWall().length, 136);
  assert.strictEqual(buildWall(true, false).length, 136);
});

test('waits(..., sanma=true): never reports a wait on 2m-8m', () => {
  // Tenpai shape whose only "wait" region touches man numbers: 2m3m waiting
  // on 1m/4m (a normal ryanmen) plus a filled-out rest of hand — swap in a
  // shape that would, if evaluated in yonma, also produce a plausible
  // 2-8m wait so the sanma gate is actually being exercised.
  const hand = [...seq(2, 'p'), ...seq(4, 'p'), ...seq(2, 's'), ...pairT(9, 's'), T(2, 'm'), T(3, 'm')];
  const yonmaWaits = waits(hand, []);
  assert.ok(yonmaWaits.includes('1m') && yonmaWaits.includes('4m'));
  const sanmaWaits = waits(hand, [], true);
  assert.ok(!sanmaWaits.includes('4m'), 'sanma waits must never include a dropped tile like 4m');
  assert.ok(!sanmaWaits.some(w => w.endsWith('m') && w !== '1m' && w !== '9m'));
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
