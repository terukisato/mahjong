'use strict';
// Regression test suite for room.js's financial logic (payment formulas —
// tsumo/ron splits, honba, riichi sticks, nagashi mangan, tenpai payments).
// Drives the real Room class directly (not a mock) so these tests exercise
// the exact code path the live server runs. Plain Node assertions, no
// framework — run with: node server/room.test.js

const assert = require('assert');
const { Room } = require('./room');
const { basePoints } = require('./mahjong');

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
  room.game = { scores: [25000, 25000, 25000, 25000], turn: dealer, dealer, round: 1, roundWind: 1, honba: 0, riichiSticks: 0,
    stats: [0, 1, 2, 3].map(() => ({ riichi: 0, wins: 0, tsumo: 0, ron: 0, dealIn: 0, bestHan: 0, bestScore: 0, yaku: {} })) };
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
// _recordRoundHistory used to tag each recorded round with `payload.honba`
// verbatim — but that field is the NEXT round's honba ("carrying forward",
// see roundEndPayload's own comment in room.js), not the honba this round
// was actually played at. A dealer win at honba 0 broadcasts honba:1 (for
// the repeat that's about to start), so Play History showed every dealer's
// very first (0-honba) win mislabelled as "1本場" — the true 0-honba hand
// never appeared. Fixed by overriding honba with the pre-advance g.honba,
// same as round/roundWind/dealer already were.
// ══════════════════════════════════════════════════════════════════════════

test('Play History: a dealer win at honba 0 is recorded as honba 0, not the next round\'s honba 1', () => {
  const room = freshRoom(0); // seat 0 is dealer
  const g = room.game;
  g.honba = 0;
  g.hands[0] = pinfuTenpai13();
  g.drawTile = winTile();
  g.hands[0].push(g.drawTile);
  g.turn = 0;
  room._tsumo(0);
  assert.strictEqual(g.roundHistory.length, 1);
  assert.strictEqual(g.roundHistory[0].honba, 0, 'this round was played at 0 honba, not the 1 honba the dealer-repeat broadcasts for next round');
});

test('Play History: an abortive draw at honba 0 is recorded as honba 0, not the repeat\'s honba 1', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.honba = 0;
  room._endRound('kyuushu', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [...g.scores], undefined);
  assert.strictEqual(g.roundHistory.length, 1);
  assert.strictEqual(g.roundHistory[0].honba, 0);
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
// Fu correctness end-to-end via _multiRon — room.js used to independently
// recompute decompose(hand) and grab decomps[0] for fu, instead of the
// SAME decomposition detectYaku itself used to decide the win's yaku (see
// mahjong.js's detectYaku `groups`/`isChiitoitsu` return, room.js's
// _computeFu). Three symptoms, all from the same root cause: Pinfu-ron
// could get inflated fu on hands with more than one valid decomposition,
// Chiitoitsu always got the generic 30-fu fallback instead of its real
// fixed 25, and open melds (pon/chi/open kan) never contributed fu at all
// since decompose(hand) only ever saw the concealed hand.
// ══════════════════════════════════════════════════════════════════════════

test('Ron: a Pinfu-shaped hand whose tiles ALSO admit an all-triplets reading still scores the fixed 30 fu, not the triplet reading\'s higher fu', () => {
  const room = freshRoom(0);
  const g = room.game;
  // 111222333m + 44s (13 tiles) + ron on 1m: also fully readable as three
  // closed triplets (111m)(222m)(333m) + pair(44s) — an alternate valid
  // decomposition of the exact same tiles that decompose(hand)[0] could
  // easily have returned instead of the Pinfu one.
  g.hands[1] = [T(1, 'm'), T(1, 'm'), T(1, 'm'), T(2, 'm'), T(2, 'm'), T(2, 'm'), T(2, 'm'),
    T(3, 'm'), T(3, 'm'), T(3, 'm'), T(3, 'm'), T(4, 's'), T(4, 's')];
  const prev = [...g.scores];
  room._multiRon([1], 2, T(1, 'm'));
  const loserPaid = prev[2] - g.scores[2];
  // han=2 (Pinfu + Iipeiko), fu=30 (fixed) -> base=min(30*2^4,2000)=480 -> pay x4=1920 -> round up 2000
  assert.strictEqual(loserPaid, 2000);
});

test('Ron: Chiitoitsu is scored at its real fixed 25 fu, not the generic 30-fu fallback', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.hands[1] = [...pairT(1, 'm'), ...pairT(3, 'm'), ...pairT(5, 'p'), ...pairT(7, 'p'),
    ...pairT(2, 's'), ...pairT(4, 's'), T(6, 'z')];
  const prev = [...g.scores];
  room._multiRon([1], 2, T(6, 'z'));
  const loserPaid = prev[2] - g.scores[2];
  // han=2 (Chiitoitsu), fu=25 -> base=min(25*2^4,2000)=400 -> pay x4=1600
  assert.strictEqual(loserPaid, 1600);
});

test('Ron: an open pon correctly contributes its triplet fu (previously silently dropped to zero)', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.melds[1] = [{ type: 'pon', tiles: [T(5, 's'), T(5, 's'), T(5, 's')], calledTileId: 1, fromSeat: 2 }];
  g.hands[1] = [...seq(2, 'm'), ...seq(4, 'p'), ...pairT(4, 's'), T(7, 'm'), T(8, 'm')];
  const prev = [...g.scores];
  room._multiRon([1], 0, T(6, 'm'));
  const loserPaid = prev[0] - g.scores[0];
  // han=1 (Tanyao), fu=20 base + 2 (open simple pon) = 22 -> rounds to 30
  // -> base=min(30*2^3,2000)=240 -> pay x4=960 -> round up 1000
  assert.strictEqual(loserPaid, 1000);
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
// Always-full-table seating: addHuman/removeHuman + per-bot difficulty
// ══════════════════════════════════════════════════════════════════════════

test('addHuman: evicts the lowest-indexed bot seat when no null seat remains', () => {
  const room = freshRoom(0); // all 4 seats are bots, none null
  const human = { id: 'human1', name: 'Human', isBot: false };
  const ok = room.addHuman(human);
  assert.strictEqual(ok, true);
  assert.strictEqual(human.seat, 0, 'should land in the lowest-indexed seat');
  assert.strictEqual(room.seats[0], human, 'seat 0 now holds the human, not the old bot');
  assert.strictEqual(room.seats[0].isBot, false);
  for (const i of [1, 2, 3]) assert.strictEqual(room.seats[i].isBot, true, `seat ${i} should still be a bot`);
});

test('addHuman: fills a genuinely empty (null) seat before evicting any bot', () => {
  const room = freshRoom(0);
  room.seats[2] = null;
  const human = { id: 'human1', name: 'Human', isBot: false };
  room.addHuman(human);
  assert.strictEqual(human.seat, 2, 'the null seat should be preferred over evicting a bot');
});

test('removeHuman: vacated seat is refilled with a fresh bot, not left null', () => {
  const room = freshRoom(0);
  room.seats[1] = { id: 'human1', name: 'Human', isBot: false };
  room.removeHuman('human1');
  assert.notStrictEqual(room.seats[1], null);
  assert.strictEqual(room.seats[1].isBot, true);
});

function waitingRoomWithHuman() {
  const room = freshRoom(0);
  room.phase = 'waiting';
  room.seats[3] = { id: 'human1', name: 'Human', isBot: false };
  return room;
}

test('setBotDifficulty: a seated human can set a bot seat\'s difficulty', () => {
  const room = waitingRoomWithHuman();
  room.setBotDifficulty('human1', 0, 'hard');
  assert.strictEqual(room.seats[0].difficulty, 'hard');
});

test('setBotDifficulty: rejected when the caller is not a seated human', () => {
  const room = waitingRoomWithHuman();
  room.setBotDifficulty('nobody', 0, 'hard');
  assert.strictEqual(room.seats[0].difficulty, undefined);
});

test('setBotDifficulty: rejected outside the waiting phase', () => {
  const room = waitingRoomWithHuman();
  room.phase = 'playing';
  room.setBotDifficulty('human1', 0, 'hard');
  assert.strictEqual(room.seats[0].difficulty, undefined);
});

test('setBotDifficulty: rejected for an out-of-range seat', () => {
  const room = waitingRoomWithHuman();
  assert.doesNotThrow(() => room.setBotDifficulty('human1', 5, 'hard'));
  for (const s of room.seats) if (s) assert.strictEqual(s.difficulty, undefined);
});

test('setBotDifficulty: rejected for an invalid difficulty value', () => {
  const room = waitingRoomWithHuman();
  room.setBotDifficulty('human1', 0, 'godlike');
  assert.strictEqual(room.seats[0].difficulty, undefined);
});

test('setBotDifficulty: rejected when the target seat holds a human, not a bot', () => {
  const room = waitingRoomWithHuman();
  room.setBotDifficulty('human1', 3, 'hard'); // seat 3 is the human itself
  assert.strictEqual(room.seats[3].difficulty, undefined);
});

// ══════════════════════════════════════════════════════════════════════════
// Rule variants: atama-hane vs double ron, nagashi mangan on/off
// ══════════════════════════════════════════════════════════════════════════

test('doubleRon=false (atama-hane): only the winner closest to the discarder is paid on simultaneous ron', () => {
  const room = freshRoom(0); // seat 0 is dealer/discarder
  room.rules.doubleRon = false;
  const g = room.game;
  g.hands[1] = pinfuTenpai13();
  g.hands[2] = pinfuTenpai13().map(t => ({ ...t, id: _id++ }));
  const tile = winTile();
  const prev = [...g.scores];
  room._multiRon([1, 2], 0, tile); // seat1 (dist 1) is closer to seat0 than seat2 (dist 2)
  assert.ok(g.scores[1] > prev[1], 'closest winner (seat1) should be paid');
  assert.strictEqual(g.scores[2], prev[2], 'seat2 should receive nothing under atama-hane');
});

test('doubleRon=true (default): both simultaneous ron winners are paid', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.hands[1] = pinfuTenpai13();
  g.hands[2] = pinfuTenpai13().map(t => ({ ...t, id: _id++ }));
  const tile = winTile();
  const prev = [...g.scores];
  room._multiRon([1, 2], 0, tile);
  assert.ok(g.scores[1] > prev[1]);
  assert.ok(g.scores[2] > prev[2]);
});

test('nagashiMangan=false: exhaustive draw never calls _resolveNagashi', () => {
  const room = freshRoom(0);
  room.rules.nagashiMangan = false;
  let called = false;
  room._resolveNagashi = () => { called = true; };
  const g = room.game;
  room._endRound('draw', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [...g.scores], undefined);
  assert.strictEqual(called, false);
});

test('nagashiMangan=true (default): a genuinely nagashi-eligible exhaustive draw calls _resolveNagashi', () => {
  const room = freshRoom(0);
  let called = false;
  room._resolveNagashi = () => { called = true; };
  const g = room.game;
  room._endRound('draw', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [...g.scores], undefined);
  assert.strictEqual(called, true);
});

// ══════════════════════════════════════════════════════════════════════════
// Kita ron + the double-discard/double-action guard
// ══════════════════════════════════════════════════════════════════════════

// Seat 0 is a real (non-bot) player with id 'p0' — action() only resolves a
// seat via `this.seats.findIndex(p=>p&&!p.isBot&&p.id===playerId)`, so any
// test driving room.action() (as opposed to calling _discard/_kita
// directly) needs a genuinely non-bot seat to route through.
function freshSanmaRoom(dealer = 0) {
  const room = new Room('tonpuu', 'normal', {}, 3);
  room.seats = [0, 1, 2].map(seat => seat === 0
    ? { isBot: false, id: 'p0', seat, name: 'Seat0' }
    : { isBot: true, seat, name: `Seat${seat}` });
  room.phase = 'playing';
  room.game = {
    scores: [35000, 35000, 35000], turn: dealer, dealer, round: 1, roundWind: 1, honba: 0, riichiSticks: 0,
    stats: [0, 1, 2].map(() => ({ riichi: 0, wins: 0, tsumo: 0, ron: 0, dealIn: 0, huro: 0, doubleBust: 0, bestHan: 0, bestScore: 0, yaku: {} })),
  };
  room._initRound();
  room.game.dora = [{ v: 1, s: 's', id: -1 }]; // won't match any test hand below
  return room;
}

test('Kita: a North tile declared via kita CAN be ronned by a waiting opponent', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  // Seat 1 tenpai, tanki-waiting on North (4z) to pair — Haku triplet gives
  // a real yaku (Yakuhai) so the ron is legitimately valid, not just
  // structurally complete.
  g.hands[1] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...tri(5, 'z'), T(4, 'z')];
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(2, 'm'), T(7, 'm'), T(4, 'z')];
  g.hands[2] = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(2, 'p'), T(9, 's'), T(9, 's')];
  g.wall = [T(1, 's')];
  g.turn = 0;

  const kitaTileId = g.hands[0].find(t => t.v === 4 && t.s === 'z').id;
  room._kita(0, kitaTileId);

  assert.ok(g.pending, 'kita should open a reaction window, not resolve silently');
  assert.strictEqual(g.pending.tile.v, 4);
  assert.strictEqual(g.pending.tile.s, 'z');
  assert.deepStrictEqual(g.pending.seats, [1], 'only seat 1 is actually waiting on this tile');
  assert.ok(g.pending.options[0].options.every(o => o.type === 'ron'), 'kita reactions must be ron-only, never pon/kan/chi');

  room._reactResponse(1, { type: 'ron' });

  // A ron ends the ROUND, not necessarily the whole game (tonpuu has more
  // rounds left) — phase legitimately stays 'playing' here; what matters
  // is that the ron was actually scored (before this fix, _kita never
  // opened a reaction window at all, so this ron could never happen).
  assert.strictEqual(g.pending, null, 'the reaction window should have resolved');
  assert.ok(g.scores[1] > 35000, `seat 1 should have gained points from the ron, got ${g.scores[1]}`);
  assert.ok(g.scores[0] < 35000, `seat 0 (discarder) should have paid, got ${g.scores[0]}`);
});

// ══════════════════════════════════════════════════════════════════════════
// Double Riichi's "no interruption yet" gate checked g.melds only — a sanma
// Kita never touches g.melds (it banks into g.kita[seat] instead, see
// _kita's own comment), so a player could kita on their own turn and still
// declare double riichi on their next discard as if nothing had happened.
// Standard sanma ruling treats kita as an interruption same as any call.
// ══════════════════════════════════════════════════════════════════════════

test('Double Riichi: a Kita banked earlier this hand blocks double riichi on the seat\'s own first discard', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.turn = 1;
  g.firstRound = true;
  g.kita[1] = [T(4, 'z')]; // this seat already banked a kita tile earlier in the same hand
  g.hands[1] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), ...pairT(9, 'm')];
  g.drawTile = T(4, 's');
  g.hands[1].push(g.drawTile);
  room._riichi(1, g.drawTile.id);
  assert.strictEqual(g.riichi[1], true);
  assert.strictEqual(g.doubleRiichi[1], false, 'a kita earlier this hand should block double riichi, same as a call would');
});

test('Double Riichi: still granted on a genuinely undisturbed first discard (no kita, no calls)', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.turn = 1;
  g.firstRound = true;
  g.hands[1] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), ...pairT(9, 'm')];
  g.drawTile = T(4, 's');
  g.hands[1].push(g.drawTile);
  room._riichi(1, g.drawTile.id);
  assert.strictEqual(g.doubleRiichi[1], true, 'sanity check: without any kita/calls this should still be double riichi');
});

// Tenhou's own gate (g.turnCount===0) can't rule out a call either (none is
// possible before any discard exists), but same as double riichi/Chiihou,
// it couldn't rule out the DEALER having kita'd their own original hand
// before winning off the rinshan replacement, since kita never touches
// g.turnCount or g.melds.
test('Tenhou: a Kita banked before the win (still turn 0) blocks Tenhou', () => {
  const room = freshSanmaRoom(0); // seat 0 is dealer
  const g = room.game;
  g.turn = 0;
  g.kita[0] = [T(4, 'z')]; // dealer already banked a kita tile before completing this hand
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), ...pairT(9, 'm')];
  g.drawTile = T(4, 's');
  g.hands[0].push(g.drawTile);

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._tsumo(0);
  assert.ok(!logged.some(y => y.name === 'Tenhou'), `expected no Tenhou entry, got ${JSON.stringify(logged)}`);
});

test('Tenhou: still granted on a genuinely undisturbed dealer first-draw win (no kita)', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.turn = 0;
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), ...pairT(9, 'm')];
  g.drawTile = T(4, 's');
  g.hands[0].push(g.drawTile);

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._tsumo(0);
  assert.ok(logged.some(y => y.name === 'Tenhou'), `sanity check: expected a Tenhou entry, got ${JSON.stringify(logged)}`);
});

test('Kita: uncontested (nobody waiting on North) still banks the tile and draws a replacement, same as before', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.hands[1] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...tri(5, 'z'), T(9, 'p')]; // NOT waiting on North
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(2, 'm'), T(7, 'm'), T(4, 'z')];
  g.hands[2] = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(2, 'p'), T(9, 's'), T(9, 's')];
  g.wall = [T(1, 's')];
  g.turn = 0;

  const kitaTileId = g.hands[0].find(t => t.v === 4 && t.s === 'z').id;
  const handSizeBefore = g.hands[0].length;
  room._kita(0, kitaTileId);

  assert.strictEqual(g.pending, null, 'no reaction window when nobody is waiting on the tile');
  assert.strictEqual(g.kita[0].length, 1, 'the North tile should be banked');
  assert.strictEqual(g.hands[0].length, handSizeBefore, 'hand size unchanged: -1 for kita, +1 replacement draw');
  assert.strictEqual(room.phase, 'playing', 'the game should still be going');
});

// ══════════════════════════════════════════════════════════════════════════
// Banked kita tiles used to be entirely invisible to dora counting — once
// _kita/_completeKita moves a North tile out of g.hands[seat] into its own
// g.kita[seat] array, countDora(hand, ...) never sees it again, even when
// this round's dora indicator points straight at North (West indicator ->
// North is dora). Fixed via _doraPool, which folds g.kita[seat] back in
// for both regular and ura dora purposes only (never aka dora — kita is
// always a 4z tile, never a red 5).
// ══════════════════════════════════════════════════════════════════════════

test('Dora: banked kita tiles count as regular dora when the indicator points to North', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.turn = 1;
  g.firstRound = false; // avoid an incidental Chiihou (seat!==dealer, first uninterrupted draw) muddying the yakuList
  g.dora = [T(3, 'z')]; // indicator West -> dora is North (4z)
  g.kita[1] = [T(4, 'z'), T(4, 'z')]; // 2 banked North tiles this hand
  g.hands[1] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), ...pairT(9, 'm')];
  g.drawTile = T(4, 's');
  g.hands[1].push(g.drawTile);

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._tsumo(1);
  const dora = logged.find(y => y.name === 'Dora');
  assert.ok(dora, `expected a Dora entry, got ${JSON.stringify(logged)}`);
  assert.strictEqual(dora.han, 2, 'both banked North tiles should count');
});

test('Dora: banked kita tiles do NOT count when the indicator does not point to North', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.turn = 1;
  g.firstRound = false;
  g.dora = [T(5, 's')]; // indicator 5s -> dora is 6s, which appears nowhere in this hand
  g.kita[1] = [T(4, 'z')];
  g.hands[1] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), ...pairT(9, 'm')];
  g.drawTile = T(4, 's');
  g.hands[1].push(g.drawTile);

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._tsumo(1);
  assert.ok(!logged.some(y => y.name === 'Dora'), `expected no Dora entry, got ${JSON.stringify(logged)}`);
});

test('Ura Dora: a banked kita tile counts as ura dora when the ura indicator points to North', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.turn = 1;
  g.firstRound = false;
  g.dora = [T(1, 'z')]; // omote indicator East -> irrelevant to this hand
  g.deadWall[9] = T(3, 'z'); // ura indicator West -> ura dora is North
  g.riichi[1] = true;
  g.kita[1] = [T(4, 'z')];
  g.hands[1] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), ...pairT(9, 'm')];

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._multiRon([1], 0, T(4, 's'));
  const uraDora = logged.find(y => y.name === 'Ura Dora');
  assert.ok(uraDora, `expected an Ura Dora entry, got ${JSON.stringify(logged)}`);
  assert.strictEqual(uraDora.han, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// Called-meld tiles (pon/chi/kan) used to be entirely invisible to dora/aka
// dora too, same root cause as the kita bug above: _pon/_chi/_daiminkan/
// _ankan all strip their tiles OUT of g.hands[seat] into g.melds[seat], and
// _doraPool only ever folded g.kita[seat] back in — never g.melds[seat] — so
// a called triplet/sequence that happened to match the dora indicator (or
// contained a called red 5) silently scored 0 extra han for it.
// ══════════════════════════════════════════════════════════════════════════

test('Dora: an open pon meld counts as regular dora when the indicator matches it', () => {
  const room = freshRoom(1); // seat 1 wins
  const g = room.game;
  g.turn = 1;
  g.firstRound = false;
  g.dora = [T(5, 'z')]; // indicator Haku (White) -> dora is Hatsu (Green, 6z)
  g.melds[1] = [{ type: 'pon', tiles: tri(6, 'z'), calledTileId: -1, fromSeat: 0 }]; // called Hatsu triplet
  g.hands[1] = [...seq(1, 'p'), ...seq(4, 'p'), T(7, 'p'), T(8, 'p'), ...pairT(9, 'm')];
  g.drawTile = T(9, 'p');
  g.hands[1].push(g.drawTile);

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._tsumo(1);
  const dora = logged.find(y => y.name === 'Dora');
  assert.ok(dora, `expected a Dora entry, got ${JSON.stringify(logged)}`);
  assert.strictEqual(dora.han, 3, 'all 3 tiles of the called Hatsu meld should count as dora');
});

test('Aka Dora: a red 5 called into a chi meld still counts as aka dora', () => {
  const room = freshRoom(1);
  const g = room.game;
  g.turn = 1;
  g.firstRound = false;
  g.dora = [T(1, 'z')]; // irrelevant to this hand
  const chiTiles = [{ v: 3, s: 's', id: 9001 }, { v: 4, s: 's', id: 9002 }, { v: 5, s: 's', id: 9003, red: true }];
  g.melds[1] = [{ type: 'chi', tiles: chiTiles, calledTileId: 9003, fromSeat: 0 }]; // called red-5s into 3-4-5s
  g.hands[1] = [...seq(1, 'p'), ...seq(4, 'p'), T(7, 'p'), T(8, 'p'), ...pairT(9, 'm')];
  g.drawTile = T(9, 'p');
  g.hands[1].push(g.drawTile);

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._tsumo(1);
  const aka = logged.find(y => y.name === 'Aka Dora');
  assert.ok(aka, `expected an Aka Dora entry, got ${JSON.stringify(logged)}`);
  assert.strictEqual(aka.han, 1);
});

test('Double-discard guard: a second discard action while a reaction window is open is ignored', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  // Seat 1 tenpai on 9s so seat 0's first discard opens a real reaction window.
  g.hands[1] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...tri(5, 'z'), T(9, 's')];
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(2, 'm'), T(7, 'm'), T(9, 's')];
  g.hands[2] = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(2, 'p'), T(8, 's'), T(8, 's')];
  g.turn = 0;

  const firstTileId = g.hands[0].find(t => t.v === 9 && t.s === 's').id;
  const secondTileId = g.hands[0][0].id;
  const handSizeBeforeAnyDiscard = g.hands[0].length;

  room.action('p0', { type: 'discard', tileId: firstTileId });
  assert.ok(g.pending, 'first discard should have opened a reaction window (seat 1 can ron 9s)');
  const handSizeAfterFirst = g.hands[0].length;

  // Attempt a second discard from the SAME seat while that window is open —
  // this is exactly the scenario room.js's own myTurnOpen comment describes.
  room.action('p0', { type: 'discard', tileId: secondTileId });

  assert.strictEqual(g.hands[0].length, handSizeAfterFirst, 'a second discard while g.pending is set must be a no-op');
  assert.strictEqual(handSizeBeforeAnyDiscard - handSizeAfterFirst, 1, 'exactly one tile should have left the hand total');
});

test('Double-discard guard: also holds during a kita reaction window (new pending state)', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.hands[1] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...tri(5, 'z'), T(4, 'z')];
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(2, 'm'), T(7, 'm'), T(4, 'z')];
  g.hands[2] = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(2, 'p'), T(9, 's'), T(9, 's')];
  g.wall = [T(1, 's')];
  g.turn = 0;

  const kitaTileId = g.hands[0].find(t => t.v === 4 && t.s === 'z').id;
  room.action('p0', { type: 'kita', tileId: kitaTileId });
  assert.ok(g.pending, 'kita should have opened a reaction window');
  const handSizeAfterKita = g.hands[0].length;

  // Try to discard while the kita-ron window is still open.
  room.action('p0', { type: 'discard', tileId: g.hands[0][0].id });
  assert.strictEqual(g.hands[0].length, handSizeAfterKita, 'discard while a kita reaction window is open must be a no-op');
});

// ══════════════════════════════════════════════════════════════════════════
// Kita draws from its own rinshan pool (Rinshan Kaihou eligibility)
// ══════════════════════════════════════════════════════════════════════════

test('Dead wall is 18 tiles in sanma (14 + kita\'s own 4-slot pool), still 14 in yonma', () => {
  const sanmaRoom = freshSanmaRoom(0);
  assert.strictEqual(sanmaRoom.game.deadWall.length, 18);
  const yonmaRoom = freshRoom(0);
  assert.strictEqual(yonmaRoom.game.deadWall.length, 14);
});

test('Kita draws from the dead wall\'s kita pool, not the live wall — live wall length is unchanged', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(2, 'm'), T(7, 'm'), T(4, 'z')];
  g.hands[1] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...tri(5, 'z'), T(9, 'p')]; // not waiting on North
  g.deadWall[14] = T(2, 'p'); // force a known, unmistakable tile into the first kita slot
  const wallLenBefore = g.wall.length;
  const kitaCountBefore = g.kitaCount;
  const kitaTileId = g.hands[0].find(t => t.v === 4 && t.s === 'z').id;
  room._kita(0, kitaTileId);
  assert.strictEqual(g.pending, null, 'uncontested kita (nobody waiting on North)');
  assert.strictEqual(g.wall.length, wallLenBefore, 'the live wall must not shrink from a kita draw');
  assert.strictEqual(g.kitaCount, kitaCountBefore + 1);
  assert.strictEqual(g.drawTile.v, 2, 'must have drawn deadWall[14], not some other tile');
  assert.strictEqual(g.drawTile.s, 'p');
  assert.strictEqual(g.isRinshan, true, 'a kita replacement draw must now be marked as a rinshan draw');
});

test('Winning by tsumo on a kita replacement draw grants Rinshan Kaihou', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  // 13-tile tenpai shape (tanki wait on 9s, Haku triplet for a real yaku)
  // PLUS one spare North tile — the North is what gets banked via kita;
  // the tanki wait is unrelated to it. Forcing the dead wall's kita slot
  // to be the exact 9s this hand is waiting on makes the win deterministic
  // regardless of shuffle.
  g.hands[0] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), ...tri(5, 'z'), T(9, 's'), T(4, 'z')];
  g.deadWall[14] = T(9, 's'); // what _completeKita will hand back as the kita replacement
  g.turn = 0;
  // Without this, seat 0 (the dealer) winning on turn 0 with zero prior
  // discards also satisfies Tenhou — a yakuman that early-returns out of
  // detectYaku before the Rinshan Kaihou check ever runs, masking exactly
  // the thing this test wants to isolate. Bumping turnCount simulates
  // enough of the game having already happened that only Rinshan Kaihou
  // applies.
  g.turnCount = 4;

  const kitaTileId = g.hands[0].find(t => t.v === 4 && t.s === 'z').id;
  room._kita(0, kitaTileId);
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.drawTile.v, 9);
  assert.strictEqual(g.drawTile.s, 's');
  assert.strictEqual(g.isRinshan, true);

  room._tsumo(0);
  assert.ok(g.stats[0].yaku['Rinshan Kaihou'] > 0, 'a win on the kita replacement tile must record Rinshan Kaihou');
});

test('Kita is capped at 4 (the pool\'s actual size) as a defensive bound', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.kitaCount = 4;
  const before = { wall: g.wall.length, kitaCount: g.kitaCount };
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(2, 'm'), T(7, 'm'), T(4, 'z')];
  const kitaTileId = g.hands[0].find(t => t.v === 4 && t.s === 'z').id;
  room._kita(0, kitaTileId);
  assert.strictEqual(g.kitaCount, before.kitaCount, 'kita must no-op once the pool is exhausted');
  assert.strictEqual(g.wall.length, before.wall, 'no side effects from a rejected kita attempt');
});

test('Dora/ura-dora indicator indices are unaffected by the larger sanma dead wall', () => {
  // freshSanmaRoom pins g.dora to a fixed indicator AFTER _initRound() (for
  // deterministic payment amounts in every other test in this file), so
  // this checks _initRound's own linkage directly instead of going through
  // that helper — a fresh, un-pinned Room is what actually exercises the
  // deadWall[4] indexing this test cares about.
  const room = new Room('tonpuu', 'normal', {}, 3);
  room.seats = [0, 1, 2].map(seat => ({ isBot: true, seat, name: `Seat${seat}` }));
  room.phase = 'playing';
  room.game = {
    scores: [35000, 35000, 35000], turn: 0, dealer: 0, round: 1, roundWind: 1, honba: 0, riichiSticks: 0,
    stats: [0, 1, 2].map(() => ({ riichi: 0, wins: 0, tsumo: 0, ron: 0, dealIn: 0, huro: 0, doubleBust: 0, bestHan: 0, bestScore: 0, yaku: {} })),
  };
  room._initRound();
  const g = room.game;
  assert.strictEqual(g.dora[0], g.deadWall[4], 'initial dora indicator is still deadWall[4]');
});

// ══════════════════════════════════════════════════════════════════════════
// Kazoe Yakuman — a hand that only reaches yakuman-tier han (13+) once dora
// is folded in, with no single yaku itself flagged yakuman. Should score
// exactly like a real yakuman AND be recorded under a 'Kazoe Yakuman' yaku
// name (not left as a raw stack of Dora/Ura Dora/etc lines), since that
// name is what both the round-end panel and achievements.js's
// YAKUMAN_NAMES/yakuman_hunter key off — see room.js's _buildYakuList.
// ══════════════════════════════════════════════════════════════════════════

test('_buildYakuList: collapses to a single Kazoe Yakuman entry when only dora pushes han to 13+', () => {
  const room = freshRoom(0);
  const yl = room._buildYakuList(
    [{ name: 'Pinfu', jp: '平和', han: 1 }, { name: 'Menzen Tsumo', jp: '門前清自摸和', han: 1 }],
    2,  // raw yaku han (no single yaku here is itself yakuman)
    15, // totalHan (2 + 13 dora)
    13, 0, 0, 0, // dc, uraDora, akaDora, kitaCount
  );
  assert.deepStrictEqual(yl, [{ name: 'Kazoe Yakuman', jp: '数え役満', han: 15 }]);
});

test('_buildYakuList: leaves a TRUE yakuman hand alone (still shows its own name + any incidental dora lines)', () => {
  const room = freshRoom(0);
  const yl = room._buildYakuList(
    [{ name: 'Suu Ankou', jp: '四暗刻', han: 13 }],
    13, // raw han already >=13 on its own — a real yakuman, not kazoe
    15, // totalHan (13 + 2 incidental dora)
    2, 0, 0, 0,
  );
  assert.deepStrictEqual(yl, [
    { name: 'Suu Ankou', jp: '四暗刻', han: 13 },
    { name: 'Dora', jp: 'ドラ', han: 2 },
  ]);
});

test('_buildYakuList: ordinary sub-yakuman hand is untouched (no dora line when dc is 0)', () => {
  const room = freshRoom(0);
  const yl = room._buildYakuList(
    [{ name: 'Riichi', jp: 'リーチ', han: 1 }],
    1, 1, 0, 0, 0, 0,
  );
  assert.deepStrictEqual(yl, [{ name: 'Riichi', jp: 'リーチ', han: 1 }]);
});

test('Tsumo: a hand that only reaches 13+ han via dora scores as yakuman AND records under "Kazoe Yakuman"', () => {
  const room = freshRoom(0); // seat 0 is dealer
  const g = room.game;
  g.hands[1] = pinfuTenpai13();
  g.drawTile = winTile();
  g.hands[1].push(g.drawTile);
  g.turn = 1;
  // _initRound() leaves g.firstRound true (only cleared once actual turns
  // happen), which — combined with a fresh room's empty melds and a
  // 14-tile hand — makes _tsumo's own isChiihou check fire for any
  // non-dealer seat, turning this into a REAL yakuman before dora is even
  // considered. Clear it so this test hand is scored on its own (regular)
  // merits, same as it would be for a tsumo anywhere but literally the
  // very first uninterrupted draw of the game.
  g.firstRound = false;
  // pinfuTenpai13's pair is 9p x2 — repeating the same dora indicator
  // (8p → dora 9p) 7 times racks up 14 dora (2 matches x 7), pushing
  // total han (2 raw + 14 dora = 16) well past the 13-han yakuman line
  // without any single yaku here being a true yakuman.
  g.dora = new Array(7).fill({ v: 8, s: 'p' });
  const prevScores = [...g.scores];
  room._tsumo(1);
  const nonDealerPaid = prevScores[2] - g.scores[2];
  const dealerPaid = prevScores[0] - g.scores[0];
  // Yakuman base = 8000: non-dealer tsumo payers pay 8000, dealer pays 16000.
  assert.strictEqual(nonDealerPaid, 8000, 'non-dealer payers pay the flat yakuman base');
  assert.strictEqual(dealerPaid, 16000, 'dealer pays double the yakuman base');
  assert.strictEqual(g.stats[1].yaku['Kazoe Yakuman'], 1, 'recorded under the Kazoe Yakuman name for achievements/stats');
  assert.strictEqual(g.stats[1].yaku['Dora'], undefined, 'the raw Dora breakdown line is replaced, not just supplemented');
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
