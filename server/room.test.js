'use strict';
// Regression test suite for room.js's financial logic (payment formulas —
// tsumo/ron splits, honba, riichi sticks, nagashi mangan, tenpai payments).
// Drives the real Room class directly (not a mock) so these tests exercise
// the exact code path the live server runs. node:test +
// assert — run with: node --test server/room.test.js

const assert = require('assert');
const { test, mock } = require('node:test');
const { Room } = require('./room');

// Room schedules real setTimeouts (bot turns, round transitions, chankan
// windows). Every test here is synchronous and drives the Room's methods
// directly, so none of them should ever fire. Left real, they kept the
// process alive and played bot games for ~50s after the last assertion.
mock.timers.enable({ apis: ['setTimeout'] });
const { basePoints } = require('./mahjong');

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

test('Nagashi Mangan: round_end carries the pre-payment prevScores (results card gain/loss)', () => {
  const room = freshRoom(0);
  const sent = [];
  room._broadcastAll = msg => sent.push(msg);
  room._resolveNagashi([false, true, false, false]);
  const end = sent.find(msg => msg.type === 'round_end');
  assert.ok(end, 'round_end should be broadcast');
  assert.deepStrictEqual(end.prevScores, [25000, 25000, 25000, 25000]);
  assert.deepStrictEqual(end.scores.map((s, i) => s - end.prevScores[i]), [-4000, 8000, -2000, -2000]);
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

// The win cutscene marks the LAST tile of a winner's hand as the winning
// tile. Ron reports [...hand, ronTile], but a tsumo used to report the hand
// as stored — re-sorted on every draw — so the drawn tile sat wherever it
// sorted to and the cutscene highlighted the wrong tile.
test('Tsumo: round_end reports the drawn winning tile last, even when it sorts into the middle', () => {
  const room = freshRoom(0);
  const g = room.game;
  const sent = [];
  room._broadcastAll = msg => sent.push(msg);
  const [m1, m2, m3] = seq(1, 'm');
  g.drawTile = winTile(); // 6m — sorts between 3m and 7m
  g.hands[1] = [m1, m2, m3, g.drawTile, T(7, 'm'), T(8, 'm'), ...seq(4, 'p'), ...pairT(9, 'p'), ...seq(2, 's')];
  g.turn = 1;
  room._tsumo(1);
  const end = sent.find(msg => msg.type === 'round_end');
  assert.ok(end, 'round_end should be broadcast');
  const shown = end.winners[0].hand;
  assert.strictEqual(shown.length, 14);
  assert.strictEqual(shown.at(-1).id, g.drawTile.id, 'the drawn tile must be last');
  assert.deepStrictEqual(shown.slice(0, 3).map(t => t.id), [m1.id, m2.id, m3.id], 'the rest keeps its order');
});

// ══════════════════════════════════════════════════════════════════════════
// Furiten must never block tsumo — it's a ron-only restriction. _tsumo used
// to unconditionally bail out on _isFuriten(seat), silently no-opping a
// legitimate self-drawn win for any player in permanent OR temporary
// furiten (e.g. simply having passed a ron a turn earlier).
// ══════════════════════════════════════════════════════════════════════════

test('Tsumo: succeeds even while in permanent furiten', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.hands[1] = pinfuTenpai13();
  g.drawTile = winTile();
  g.hands[1].push(g.drawTile);
  g.turn = 1;
  g.furiten[1] = true;
  const prevScores = [...g.scores];
  room._tsumo(1);
  assert.ok(g.scores[1] > prevScores[1], 'permanent furiten must not block a tsumo win');
});

test('Tsumo: succeeds even while in temporary furiten (passed a ron this turn cycle)', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.hands[1] = pinfuTenpai13();
  g.drawTile = winTile();
  g.hands[1].push(g.drawTile);
  g.turn = 1;
  g.tempFuriten[1] = true;
  const prevScores = [...g.scores];
  room._tsumo(1);
  assert.ok(g.scores[1] > prevScores[1], 'temporary furiten must not block a tsumo win');
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

// Regression for a real reported stall: the round-ready gate (the
// round-result "waiting for everyone to hit Ready" screen) only ever
// re-checked itself from the round_ready action handler — a human
// disconnecting instead of clicking Ready never re-evaluated whether
// everyone REMAINING had already readied, stranding the results screen for
// the whole table indefinitely (there's no timeout on this screen at all).
test('Round-ready gate: a human disconnecting must re-check readiness, not strand the results screen forever', () => {
  const room = freshRoom(0);
  room.seats[0] = { id: 'h0', name: 'Human0', isBot: false };
  room.seats[1] = { id: 'h1', name: 'Human1', isBot: false };
  // seats 2/3 stay bots from freshRoom.

  let released = false;
  room.pendingNextRound = () => { released = true; };
  room.roundReady = new Set([0]); // seat 0 already readied; seat 1 has not

  room.removeHuman('h1'); // seat 1 disconnects before ever voting ready

  assert.strictEqual(released, true, 'the gate must release once every REMAINING human has readied — a disconnect should not leave it stuck forever');
  assert.strictEqual(room.pendingNextRound, null);
});

test('Round-ready gate: still waits on OTHER not-ready humans after one seat disconnects', () => {
  const room = freshRoom(0);
  room.seats[0] = { id: 'h0', name: 'Human0', isBot: false };
  room.seats[1] = { id: 'h1', name: 'Human1', isBot: false };
  room.seats[2] = { id: 'h2', name: 'Human2', isBot: false };

  let released = false;
  room.pendingNextRound = () => { released = true; };
  room.roundReady = new Set(); // nobody has readied yet

  room.removeHuman('h1'); // seat 1 disconnects; seats 0 and 2 remain human, neither has readied

  assert.strictEqual(released, false, 'must not release while other real humans still have not readied');
});

// Regression for a real reported stall: a discard can open a reaction
// window with BOTH a human and a bot reactor. _discard only schedules a
// BOT_DELAY timer for bot reactors when NO human is in the window (see its
// humanInReactions check) — with a human present, it expects that human's
// own response to eventually trigger _resolveReactions(). If that human
// disconnects before responding, the bot reactor sitting in the SAME window
// never got a timer either, so simply filling in the departing human's own
// seat (the old _resumeAfterBotSwap behaviour) still left the window
// permanently open — every(...) could never become true. This drove the
// whole table to a silent, permanent freeze with no error anywhere.
test('Reaction window stall: human disconnecting must not strand a bot reactor that was never given a timer', () => {
  const room = freshRoom(0);
  const g = room.game;
  room.seats[1] = { id: 'human1', name: 'Human', isBot: false, seat: 1 };
  // Seat 1 (human) can PON the discarded 5s.
  g.hands[1] = [T(5, 's'), T(5, 's'), ...seq(1, 'm'), ...seq(4, 'p'), T(2, 'm'), T(3, 'm')];
  // Seat 2 (bot) is tenpai, tanki-waiting to RON the same discarded 5s —
  // an all-simples shape (tanyao) so the ron actually carries a yaku and
  // isn't silently withheld as a no-yaku hand.
  g.hands[2] = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...tri(3, 'p'), T(5, 's')];
  // Seat 3 (bot) has no reaction available to this tile.
  g.hands[3] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), T(7, 'm'), T(8, 'm')];
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(2, 'm'), T(7, 'm'), T(5, 's')];
  g.turn = 0;

  const tileId = g.hands[0].find(t => t.v === 5 && t.s === 's').id;
  room._discard(0, tileId);

  assert.ok(g.pending, 'discard should open a reaction window');
  assert.ok(g.pending.seats.includes(1) && g.pending.seats.includes(2),
    'both the human (pon) and the bot (ron) should be reactors in the same window');
  assert.strictEqual(g.pending.responses[2], undefined,
    'the bot reactor should have no response yet — a human is in the window, so no BOT_DELAY timer was scheduled for it');

  // The human's connection drops before responding, mid-window.
  room.removeHuman('human1');

  assert.strictEqual(g.pending, null,
    'the window must resolve once every remaining reactor is a bot, not hang forever waiting on one that was never given a timer');
});

// Regression for a second, deeper bug in the same reported stall: _kakan's
// chankan (rob-the-kan) window is ron-only, same shape as a kita window —
// but _resolveReactions had no isChankan branch, so a human's 'pass'
// response (routed through _reactResponse's generic fallthrough) fell all
// the way through to _nextTurn(), silently dropping the kan entirely while
// turn moved on. Worse, _kakan's own 3s completion watchdog (g.pending.timer)
// was never cancelled by that path, so ~3s later it fired anyway and
// retroactively "completed" the kan against whatever the game had moved on
// to by then — this.game is the SAME object reused for every round of the
// match (see _initRound), so a leaked timer like this can corrupt a LATER
// round's state, not just the current one.
test('Chankan: a human passing on a valid rob-the-kan must complete the kan (not drop it via _nextTurn), and cancel the watchdog', () => {
  const room = freshRoom(0);
  const g = room.game;
  room.seats[1] = { id: 'h1', name: 'Human1', isBot: false, seat: 1 };

  // Seat 0 already has a pon of 5s and holds the 4th 5s to kakan.
  g.melds[0] = [{ type: 'pon', tiles: [T(5, 's'), T(5, 's'), T(5, 's')], calledTileId: null, fromSeat: 1, open: true }];
  const addTile = T(5, 's');
  g.hands[0] = [addTile, ...seq(1, 'm'), ...seq(4, 'p'), T(7, 'm'), T(8, 'm'), T(9, 'm'), T(2, 'm'), T(3, 'm')];
  // Seat 1 (human) genuinely wins on the robbed 5s — all-simples tanki wait.
  g.hands[1] = [...seq(2, 'm'), ...seq(4, 'p'), ...seq(6, 's'), ...tri(3, 'p'), T(5, 's')];
  // Seats 2/3 can't win on 5s — kept out of the window entirely.
  g.hands[2] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), T(7, 'm'), T(8, 'm')];
  g.hands[3] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), T(7, 'm'), T(8, 'm')];
  g.turn = 0;

  const kanCountBefore = g.kanCount;
  room._kakan(0, addTile.id);

  assert.ok(g.pending, 'kakan should open a chankan window (seat 1 can rob it)');
  assert.strictEqual(g.pending.isChankan, true);
  assert.ok(g.pending.seats.includes(1));
  assert.ok(g.pending.timer, 'the 3s completion watchdog should be armed');
  // The declarer's turn is intentionally left pointing at them through the
  // window (same as a discard's reaction window). action() gates every
  // own-turn move on `!g.pending`, so the client must too — it derives
  // `mine` as `turn===mySeat && !pending` and shows NO own-turn buttons
  // here. If g.turn stops being the declarer, that client check breaks and
  // the KAN button reappears mid-window, tappable but silently rejected.
  assert.strictEqual(g.turn, 0, 'the declarer stays on turn through the chankan window');

  const armedTimer = g.pending.timer;
  const realClearTimeout = global.clearTimeout;
  const clearedIds = [];
  global.clearTimeout = (id) => { clearedIds.push(id); return realClearTimeout(id); };
  try {
    room._reactResponse(1, { type: 'pass' }); // declines a valid ron
  } finally {
    global.clearTimeout = realClearTimeout;
  }

  assert.strictEqual(g.pending, null, 'the window should resolve');
  assert.ok(clearedIds.includes(armedTimer), 'the 3s watchdog must be cancelled here, not left to fire later against a since-moved-on game state');
  assert.strictEqual(g.melds[0][0].type, 'kan', 'the pon should have been upgraded to a kan, not silently dropped');
  assert.strictEqual(g.kanCount, kanCountBefore + 1);
  assert.ok(!g.hands[0].some(t => t.id === addTile.id), 'the added tile should have left seat 0\'s hand into the meld');
});

// ══════════════════════════════════════════════════════════════════════════
// Bot decision error handling — every bot AI call (botReact/bestDiscard, in
// bot.js) used to run either bare in a setTimeout or unwrapped inline, so
// an uncaught exception anywhere in that decision logic left a reaction
// window's response permanently unfilled, or a bot's own turn stuck on
// g.turn forever — a silent, permanent stall with nothing in the logs
// explaining why. _safeBotReact/_botDiscardTile (room.js) wrap every call
// site so a thrown exception always degrades to a safe, legal fallback
// instead of stranding the game.
// ══════════════════════════════════════════════════════════════════════════

test('_safeBotReact: an exception thrown by botReact is caught and falls back to pass, not propagated', () => {
  const room = freshRoom(0);
  // botReact's very first line is `options.some(...)` — passing null options
  // guarantees a real TypeError from inside bot.js itself, not a contrived
  // mock, regardless of hand/tile/difficulty.
  const result = room._safeBotReact(1, [T(1, 'm')], T(5, 's'), null, [], 'normal');
  assert.deepStrictEqual(result, { type: 'pass' });
});

test('_botDiscardTile: an exception thrown by bestDiscard does not propagate (empty hand — a real internal throw, not a mock)', () => {
  const room = freshRoom(0);
  const g = room.game;
  // bestDiscard('normal') → _smartDiscard, whose candidate list is empty for
  // an empty hand, so Math.min(...[]) / cands[0].id genuinely throws a
  // TypeError inside bot.js. This is a pathological state (a bot should
  // never legitimately hold zero tiles on its own turn) but it's exactly
  // the shape of bug this wrapper exists to survive without crashing.
  g.hands[0] = [];
  assert.doesNotThrow(() => room._botDiscardTile(0), 'must never let a bot-AI exception propagate uncaught');
});

test('_botDiscardTile: on a normal hand, returns a tileId actually in that hand', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.hands[0] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), T(7, 'm'), T(8, 'm'), T(9, 'm')];
  g.melds[0] = [];
  const id = room._botDiscardTile(0);
  assert.ok(g.hands[0].some(t => t.id === id), 'the returned tileId must be a real tile in this hand');
});

// Regression for a real reported stall: _reactResponse only checked that
// this seat was A reactor in the CURRENT window (g.pending.seats.includes),
// never that the declared response TYPE was actually offered to it. A stale
// response (e.g. a queued tap delivered late, after the window that
// offered it had already closed, landing in a later window that offers
// this seat something else) could declare a type that window never had —
// most dangerously 'kan', which clears g.pending before calling
// _daiminkan(), whose own early-return guards (kanCount>=4, <3 matching
// tiles) then left g.pending null, g.turn stuck on the original discarder,
// and nothing left to ever resume the table.
test('_reactResponse: a response type never offered to this seat in the CURRENT window is ignored, not trusted', () => {
  const room = freshRoom(0);
  const g = room.game;
  room.seats[1] = { id: 'h1', name: 'Human1', isBot: false, seat: 1 };
  // Seat 1 sits directly after seat 0 (numPlayers=4) and can CHI the
  // discarded 5p (holds 4p+6p) — no pon (no other 5p in hand) and can't
  // ron on it, so 'chi' is the ONLY option this window offers seat 1.
  g.hands[1] = [T(4, 'p'), T(6, 'p'), ...seq(1, 'm'), ...seq(2, 's'), ...seq(7, 'm'), T(9, 'z'), T(9, 'z')];
  g.hands[2] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), T(7, 'm'), T(8, 'm')];
  g.hands[3] = [...seq(1, 'm'), ...seq(4, 'p'), ...seq(2, 's'), T(7, 'm'), T(8, 'm')];
  g.hands[0] = [...seq(1, 'p'), ...seq(7, 's'), T(2, 'm'), T(3, 'm'), T(5, 'p')];
  g.turn = 0;

  const tileId = g.hands[0].find(t => t.v === 5 && t.s === 'p').id;
  room._discard(0, tileId);

  assert.ok(g.pending, 'discard should open a reaction window (seat 1 can chi)');
  const myOpts = g.pending.options.find(r => r.seat === 1)?.options || [];
  assert.ok(myOpts.some(o => o.type === 'chi'), 'seat 1 should be offered chi');
  assert.ok(!myOpts.some(o => o.type === 'kan'), 'seat 1 must NOT be offered kan in this window');

  const pendingBefore = g.pending;
  room._reactResponse(1, { type: 'kan' }); // stale/forged — never offered to this seat here

  assert.strictEqual(g.pending, pendingBefore, 'the window must be completely untouched by a response type this seat was never offered');
  assert.strictEqual(g.pending.responses[1], undefined, 'no response should have been recorded for the mismatched type');
  assert.strictEqual(g.turn, 0, 'turn must still be sitting on the original discarder, not corrupted');

  // The real chi still works normally afterward — the fix only rejects the
  // mismatched type, it doesn't break the legitimate response.
  const chiSeq = myOpts.find(o => o.type === 'chi').sequences[0];
  room._reactResponse(1, { type: 'chi', tileIds: chiSeq });
  assert.strictEqual(g.pending, null, 'a legitimate chi response should still resolve the window normally');
  assert.strictEqual(g.melds[1][0].type, 'chi');
});

// ══════════════════════════════════════════════════════════════════════════
// Reaction priority: a declared ron only waits on other seats that could
// also ron — a human still sitting on a pon/chi offer used to hold the win
// up until they answered. Kan used to skip priority entirely (executing on
// the spot over a pending ron), and a chi seat at a lower index than the
// pon seat used to win the tile.
// ══════════════════════════════════════════════════════════════════════════

// Seat 0 discards 6m. Seat 1 (pinfu tenpai on 6m/9m) can ron; seat 2 can
// pon (or kan with `kan`); seat 3 can't react.
function ronVsCallRoom({ seat1Bot = false, seat2Bot = false, kan = false } = {}) {
  const room = freshRoom(0);
  const g = room.game;
  if (!seat1Bot) room.seats[1] = { id: 'h1', name: 'Human1', isBot: false, seat: 1 };
  if (!seat2Bot) room.seats[2] = { id: 'h2', name: 'Human2', isBot: false, seat: 2 };
  g.hands[1] = pinfuTenpai13();
  g.hands[2] = kan
    ? [...tri(6, 'm'), ...seq(1, 'p'), ...seq(1, 's'), ...seq(4, 's'), T(2, 'z')]
    : [T(6, 'm'), T(6, 'm'), ...seq(1, 'p'), ...seq(1, 's'), ...seq(4, 's'), T(2, 'z'), T(3, 'z')];
  g.hands[3] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(1, 's'), ...seq(4, 's'), T(1, 'z')];
  g.hands[0] = [...seq(7, 'p'), ...seq(7, 's'), T(6, 'm')];
  g.turn = 0;
  room._discard(0, g.hands[0].find(t => t.v === 6 && t.s === 'm').id);
  return room;
}

test('Reactions: a human ron resolves at once, without waiting on another human\'s pon offer', () => {
  const room = ronVsCallRoom();
  const g = room.game;
  assert.deepStrictEqual(g.pending.seats, [1, 2]);
  room._reactResponse(1, { type: 'ron' });
  assert.strictEqual(g.pending, null, 'the ron must not wait for seat 2 to answer its pon offer');
  assert.ok(g.scores[1] > 25000, `seat 1 should have won, got ${g.scores[1]}`);
  assert.strictEqual(g.melds[2].length, 0);
});

test('Reactions: a human pon still waits on a human who could ron, and goes through if they pass', () => {
  const room = ronVsCallRoom();
  const g = room.game;
  room._reactResponse(2, { type: 'pon' });
  assert.ok(g.pending, 'pon must wait — seat 1 could still ron');
  room._reactResponse(1, { type: 'pass' });
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.melds[2][0]?.type, 'pon');
});

test('Reactions: a human ron still waits on another human who could also ron (double ron)', () => {
  const room = freshRoom(0);
  const g = room.game;
  room.seats[1] = { id: 'h1', name: 'Human1', isBot: false, seat: 1 };
  room.seats[2] = { id: 'h2', name: 'Human2', isBot: false, seat: 2 };
  g.hands[1] = pinfuTenpai13();
  g.hands[2] = pinfuTenpai13();
  g.hands[3] = [...seq(1, 'p'), ...seq(4, 'p'), ...seq(1, 's'), ...seq(4, 's'), T(1, 'z')];
  g.hands[0] = [...seq(7, 'p'), ...seq(7, 's'), T(6, 'm')];
  g.turn = 0;
  room._discard(0, g.hands[0].find(t => t.v === 6 && t.s === 'm').id);
  room._reactResponse(2, { type: 'ron' });
  assert.ok(g.pending, 'seat 1 could also ron — must be heard before scoring');
  room._reactResponse(1, { type: 'ron' });
  assert.strictEqual(g.pending, null);
  assert.ok(g.scores[1] > 25000 && g.scores[2] > 25000, 'both should be paid');
});

test('Reactions: a human daiminkan yields to a bot that can ron the same tile', () => {
  const room = ronVsCallRoom({ seat1Bot: true, kan: true });
  const g = room.game;
  room._reactResponse(2, { type: 'kan' });
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.melds[2].length, 0, 'the kan must not go through over a ron');
  assert.ok(g.scores[1] > 25000, `bot seat 1 should have ronned, got ${g.scores[1]}`);
});

test('Reactions: a human daiminkan with nobody able to ron still executes', () => {
  const room = ronVsCallRoom({ kan: true });
  const g = room.game;
  g.pending.options = g.pending.options.filter(r => r.seat !== 1); // seat 1 out of the picture
  g.pending.seats = [2];
  room._reactResponse(2, { type: 'kan' });
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.melds[2][0]?.kanType, 'daiminkan');
});

test('Reactions: pon beats chi even when the chi seat has the lower seat index', () => {
  const room = freshRoom(0);
  const g = room.game;
  room.seats[1] = { id: 'h1', name: 'Human1', isBot: false, seat: 1 };
  room.seats[2] = { id: 'h2', name: 'Human2', isBot: false, seat: 2 };
  g.hands[1] = [T(4, 'p'), T(6, 'p'), ...seq(1, 'm'), ...seq(2, 's'), ...seq(7, 'm'), T(1, 'z'), T(2, 'z')];
  g.hands[2] = [T(5, 'p'), T(5, 'p'), ...seq(1, 'm'), ...seq(2, 's'), ...seq(7, 's'), T(3, 'z'), T(4, 'z')];
  g.hands[3] = [...seq(1, 'm'), ...seq(4, 'm'), ...seq(1, 's'), ...seq(4, 's'), T(5, 'z')];
  g.hands[0] = [...seq(1, 'p'), ...seq(7, 's'), T(2, 'm'), T(3, 'm'), T(5, 'p')];
  g.turn = 0;
  room._discard(0, g.hands[0].find(t => t.v === 5 && t.s === 'p').id);
  const chiSeq = g.pending.options.find(r => r.seat === 1).options.find(o => o.type === 'chi').sequences[0];
  room._reactResponse(1, { type: 'chi', tileIds: chiSeq });
  room._reactResponse(2, { type: 'pon' });
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.melds[2][0]?.type, 'pon');
  assert.strictEqual(g.melds[1].length, 0);
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

test('double ron: every winner\'s yakuList itemizes its dora, and adds up to that winner\'s han', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.dora = [{ v: 8, s: 'p', id: -1 }]; // → 9p is dora; both hands hold the 9p pair
  g.hands[1] = pinfuTenpai13();
  g.hands[2] = pinfuTenpai13().map(t => ({ ...t, id: _id++ }));
  const sent = [];
  room._broadcastAll = msg => sent.push(msg);
  room._multiRon([1, 2], 0, winTile());
  const end = sent.find(msg => msg.type === 'round_end');
  assert.ok(end, 'round_end should be broadcast');
  assert.strictEqual(end.winners.length, 2);
  for (const w of end.winners) {
    const doraRow = w.yakuList.find(y => y.name === 'Dora');
    assert.ok(doraRow, `seat ${w.winSeat} should have a Dora row`);
    assert.strictEqual(doraRow.han, 2);
    assert.strictEqual(w.yakuList.reduce((n, y) => n + y.han, 0), w.han, `seat ${w.winSeat} rows should sum to its han`);
  }
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
// A North (4z) forming the hand's PAIR is part of the winning shape —
// banking it via kita after riichi silently breaks tenpai and turns the
// eventual win into a chonbo. _legalKitaIds must not offer it and _kita
// must reject it even when asked directly; three+ Norths (a spare beyond
// the pair) stay bankable, since removing one keeps the same wait.
// ══════════════════════════════════════════════════════════════════════════

test('Kita: a North that is the hand\'s pair cannot be banked after riichi (would break tenpai)', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  // Seat 0: riichi, tenpai on 1s/4s, with a North pair as the jantou.
  const locked = [...pairT(4, 'z'), ...seq(1, 'm'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's')];
  g.riichi[0] = true;
  g.drawTile = T(9, 'm'); // a blank, non-North draw
  g.hands[0] = [...locked, g.drawTile];
  g.turn = 0;

  const northId = g.hands[0].find(t => t.v === 4 && t.s === 'z').id;
  assert.deepStrictEqual(room._legalKitaIds(0), [], 'no legal kita — the only Norths form the pair');

  const kitaBefore = g.kita[0].length;
  const handBefore = g.hands[0].length;
  room._kita(0, northId);
  assert.strictEqual(g.kita[0].length, kitaBefore, 'kita on a pair North must be rejected server-side');
  assert.strictEqual(g.hands[0].length, handBefore, 'the North must stay in hand');
});

test('Kita: with three Norths in riichi, any one is still bankable (wait preserved)', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  const locked = [...pairT(4, 'z'), ...seq(1, 'm'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's')];
  g.riichi[0] = true;
  g.drawTile = T(4, 'z'); // drew the 3rd North
  g.hands[0] = [...locked, g.drawTile];
  g.turn = 0;

  assert.strictEqual(room._legalKitaIds(0).length, 3, 'all three Norths keep the 1s/4s wait when any one is removed');
});

test('Kita: outside riichi every North in hand is bankable (no wait-preservation gate)', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.riichi[0] = false;
  g.drawTile = T(9, 'm');
  g.hands[0] = [...pairT(4, 'z'), ...seq(1, 'm'), ...seq(4, 'p'), ...seq(7, 'p'), T(2, 's'), T(3, 's'), g.drawTile];
  g.turn = 0;
  assert.strictEqual(room._legalKitaIds(0).length, 2, 'both pair Norths are offered when not locked by riichi');
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

test('Dora: sanma 1m indicator points at 9m (not the non-existent 2m) — a 9m triplet scores 3 dora', () => {
  const room = freshSanmaRoom(0);
  const g = room.game;
  g.turn = 1;
  g.firstRound = false;
  g.dora = [T(1, 'm')]; // sanma: 2m-8m don't exist, so 1m indicator -> 9m dora
  // Toitoi shape with a 9m triplet, shanpon tenpai on 2s / 5z.
  g.hands[1] = [...tri(1, 'p'), ...tri(4, 'p'), ...tri(9, 'm'), ...pairT(2, 's'), ...pairT(5, 'z')];
  g.hands[0] = [...seq(1, 'p'), ...seq(4, 's'), ...seq(7, 's'), T(2, 'm'), T(9, 'm'), T(2, 's')];

  let logged;
  room._endRound = (reason, winner, loser, hand, yakuList) => { logged = yakuList; };
  room._multiRon([1], 0, T(2, 's'));
  const dora = logged.find(y => y.name === 'Dora');
  assert.ok(dora, `expected a Dora entry, got ${JSON.stringify(logged)}`);
  assert.strictEqual(dora.han, 3, 'all three 9m should count as dora under the sanma 1m<->9m cycle');
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
// exactly like a real yakuman AND still show its full itemized yaku/dora
// breakdown (not collapsed into one opaque line) AND be recorded under a
// 'Kazoe Yakuman' yaku name alongside that breakdown, since that name is
// what both achievements.js's YAKUMAN_NAMES/yakuman_hunter and stats.js's
// own copy key off — see room.js's _buildYakuList/_isKazoeYakuman.
// ══════════════════════════════════════════════════════════════════════════

test('_buildYakuList: always shows the full itemized breakdown, even when dora alone pushes han to 13+', () => {
  const room = freshRoom(0);
  const yl = room._buildYakuList(
    [{ name: 'Pinfu', jp: '平和', han: 1 }, { name: 'Menzen Tsumo', jp: '門前清自摸和', han: 1 }],
    13, 0, 0, 0, // dc, uraDora, akaDora, kitaCount
  );
  assert.deepStrictEqual(yl, [
    { name: 'Pinfu', jp: '平和', han: 1 },
    { name: 'Menzen Tsumo', jp: '門前清自摸和', han: 1 },
    { name: 'Dora', jp: 'ドラ', han: 13 },
  ]);
});

test('_buildYakuList: a TRUE yakuman hand still shows its own name + any incidental dora lines', () => {
  const room = freshRoom(0);
  const yl = room._buildYakuList(
    [{ name: 'Suu Ankou', jp: '四暗刻', han: 13 }],
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
    0, 0, 0, 0,
  );
  assert.deepStrictEqual(yl, [{ name: 'Riichi', jp: 'リーチ', han: 1 }]);
});

test('_isKazoeYakuman: true only when raw yaku han is under 13 but the dora-inclusive total reaches 13+', () => {
  const room = freshRoom(0);
  assert.strictEqual(room._isKazoeYakuman(2, 15), true);
  assert.strictEqual(room._isKazoeYakuman(13, 15), false, 'a true yakuman already hit 13+ on raw han alone');
  assert.strictEqual(room._isKazoeYakuman(8, 10), false, 'under 13 total han at all');
});

test('Tsumo: a hand that only reaches 13+ han via dora scores as yakuman, keeps its real yaku breakdown, AND records under "Kazoe Yakuman" too', () => {
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
  assert.strictEqual(g.stats[1].yaku['Kazoe Yakuman'], 1, 'recorded under the Kazoe Yakuman name too, for achievements/stats');
  assert.strictEqual(g.stats[1].yaku['Dora'], 1, 'the real itemized Dora line is still counted, not replaced');
});

test('A hand with 2 genuinely stacked yakuman (Suu Ankou + Chinroutou) is tagged "Yakuman Stack" and pays the double-yakuman base', () => {
  const room = freshRoom(0); // seat 0 dealer, seat 1 non-dealer wins below
  const g = room.game;
  g.firstRound = false; // see the Kazoe Yakuman test above for why
  // Shanpon tsumo: 1m/9m/1p closed triplets + 9p pair completed via tsumo
  // (closed) + 1s pair — 4 closed triplets, all terminals.
  g.hands[1] = [...tri(1, 'm'), ...tri(9, 'm'), ...tri(1, 'p'), ...pairT(9, 'p'), ...pairT(1, 's')];
  g.drawTile = T(9, 'p');
  g.hands[1].push(g.drawTile);
  g.turn = 1;
  const prevScores = [...g.scores];
  room._tsumo(1);
  const nonDealerPaid = prevScores[2] - g.scores[2];
  const dealerPaid = prevScores[0] - g.scores[0];
  // Double yakuman base = 16000: non-dealer payers pay 16000, dealer 32000.
  assert.strictEqual(nonDealerPaid, 16000, 'a genuine 26-han double yakuman pays the double-yakuman base, not the single (8000) one');
  assert.strictEqual(dealerPaid, 32000);
  assert.strictEqual(g.stats[1].yaku['Suu Ankou'], 1);
  assert.strictEqual(g.stats[1].yaku['Chinroutou'], 1);
  assert.strictEqual(g.stats[1].yaku['Yakuman Stack'], 1, 'tagged for achievements.js\'s yakuman_stack');
});

test('A single (non-stacked) yakuman win is NOT tagged "Yakuman Stack"', () => {
  const room = freshRoom(0);
  const g = room.game;
  g.firstRound = false;
  // Tanki tsumo on the pair: pre-hand holds only ONE 4z, the draw completes it.
  g.hands[1] = [...tri(1, 'z'), ...tri(2, 'z'), ...tri(3, 'z'), T(4, 'z'), ...seq(2, 'm')];
  g.drawTile = T(4, 'z');
  g.hands[1].push(g.drawTile);
  g.turn = 1;
  room._tsumo(1);
  assert.strictEqual(g.stats[1].yaku['Shousuushii'], 1);
  assert.strictEqual(g.stats[1].yaku['Yakuman Stack'], undefined);
});

// ══════════════════════════════════════════════════════════════════════════
// Play Again — must survive a host reconnecting mid-game. A dropped-and-
// resumed host arrives on a brand-new connection id; without hostId being
// carried over, hostStartPlayAgain's `playerId !== this.hostId` guard never
// matches again and the game-over "Start New Game" button silently does
// nothing.
// ══════════════════════════════════════════════════════════════════════════

test('Play Again works after the host reconnects mid-game', () => {
  const room = new Room('tonpuu');
  const host = { id: 'h-old', name: 'Host', isBot: false, ws: { readyState: 1, send() {} } };
  room.addHuman(host);
  room.hostId = host.id;
  room.fillBots();
  room.start();

  const seat = room.seats.findIndex(p => p && p.id === 'h-old');
  assert.notStrictEqual(seat, -1);
  assert.strictEqual(room.hostSeat, seat, 'start() pins the host\'s post-shuffle seat');

  // Drop + resume onto a fresh connection id (what reconnectNow/connect do).
  const token = room.resumeInfo.get(seat).token;
  const revived = { id: 'h-new', name: '', isBot: false, ws: { readyState: 1, send() {} } };
  assert.strictEqual(room.reclaimSeat(seat, revived, token), true);
  assert.strictEqual(room.hostId, 'h-new', 'reclaimSeat moves hostId onto the returning host');

  // Game ends; host votes then starts the rematch.
  room.phase = 'done';
  room.playAgain('h-new');
  assert.ok(room.playAgainVotes.has(seat), 'host\'s play-again vote registers');
  const booted = room.hostStartPlayAgain('h-new');
  assert.ok(Array.isArray(booted), 'hostStartPlayAgain fires for the reconnected host');
  assert.strictEqual(room.phase, 'playing', 'a fresh game actually started');
});
