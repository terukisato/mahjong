'use strict';
// Regression test suite for yaku detection (server/mahjong.js).
// Plain Node assertions, no framework — run with: node server/mahjong.test.js

const assert = require('assert');
const { detectYaku, waitFu, isWin, countDora } = require('./mahjong');

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

// Default-args wrapper around detectYaku for readability.
function Y(hand14, melds = [], opts = {}) {
  const o = Object.assign({
    isTsumo: false, seatWind: 1, roundWind: 1, isRiichi: false, isIppatsu: false,
    isDoubleRiichi: false, isRinshan: false, isChankan: false, isHaitei: false,
    isHoutei: false, isTenhou: false, isChiihou: false, winTileKey: null,
  }, opts);
  return detectYaku(hand14, melds, o.isTsumo, o.seatWind, o.roundWind, o.isRiichi,
    o.isIppatsu, o.isDoubleRiichi, o.isRinshan, o.isChankan, o.isHaitei, o.isHoutei,
    o.isTenhou, o.isChiihou, o.winTileKey);
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
// Summary
// ══════════════════════════════════════════════════════════════════════════

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.error}`);
  process.exitCode = 1;
}
