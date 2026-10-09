'use strict';
// Regression tests for stats.js — specifically the consecutive-hands-
// without-dealing-in streak (currentNoDealInStreak/bestNoDealInStreak on
// _emptyStats), added to back the 'safe_player_5/10/20/30' achievements
// (see achievements.js). Not exposed via getStats() itself (bookkeeping
// only, per design — see _emptyStats' own comment), so these tests verify
// it indirectly through which achievements actually unlock. Same plain-
// assertion convention as achievements.test.js/room.test.js/mahjong.test.js.
// Run with: node --test server/stats.test.js
//
// DATA_DIR is read once, at module load, by stats.js/profiles.js — set it
// to a fresh temp directory BEFORE requiring stats.js so these tests never
// read or write the real server/data/player-stats.json.
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-stats-test-'));
const { recordGameResult, getStats } = require('./stats');

let nextId = 0;
const freshId = () => `p${nextId++}`;

// Minimal round-history entries — only the fields _extractSeatRound (see
// stats.js) actually reads. Seat 0 is always the profile under test here;
// `dealInRound` marks it as the ron loser, `noDealInRound` is any hand it
// didn't deal into (someone else's tsumo, in these fixtures).
const dealInRound = () => ({ reason: 'ron', loser: 0, winner: 1 });
const noDealInRound = () => ({ reason: 'tsumo', winner: 1 });

// isBot/finalScores/placements/handStats all default to a bog-standard
// 4-seat game with seat 0 the only real (non-bot) profile — every test below
// only cares about seat 0's outcome, the other 3 seats are just padding.
function playGame(id, rounds, overrides = {}) {
  recordGameResult(Object.assign({
    playerIds: [id, null, null, null],
    isBot: [false, true, true, true],
    finalScores: [25000, 25000, 25000, 25000],
    placements: [1, 2, 3, 4],
    handStats: [{}, {}, {}, {}],
    handsPlayed: rounds.length,
    rounds,
  }, overrides));
}

test('streak achievements unlock at their exact thresholds within one game, not one hand short', () => {
  const id = freshId();
  // 4 clean hands — short of the 5-hand tier.
  playGame(id, [noDealInRound(), noDealInRound(), noDealInRound(), noDealInRound()]);
  let a = getStats(id).achievements;
  assert.strictEqual(a['safe_player_5'], undefined, '4 clean hands should not clear the 5-hand tier');

  // One more clean hand in a second game reaches 5 total, continuing the streak.
  playGame(id, [noDealInRound()]);
  a = getStats(id).achievements;
  assert.strictEqual(a['safe_player_5'], true, '5 clean hands across two games should clear the 5-hand tier');
  assert.strictEqual(a['safe_player_10'], undefined);
});

test('a deal-in resets the streak back to zero, even mid-game', () => {
  const id = freshId();
  playGame(id, [noDealInRound(), noDealInRound(), noDealInRound(), noDealInRound(), noDealInRound()]);
  assert.strictEqual(getStats(id).achievements['safe_player_5'], true, 'sanity check: 5-hand tier cleared first');

  // A deal-in, then only 3 more clean hands — nowhere near 5 again, but the
  // achievement, once earned, must stay earned (achievements never un-unlock).
  playGame(id, [dealInRound(), noDealInRound(), noDealInRound(), noDealInRound()]);
  const a = getStats(id).achievements;
  assert.strictEqual(a['safe_player_5'], true, 'already-earned achievement stays earned');
});

test('30 clean hands in one game unlocks every tier at once (no earn-in-order requirement)', () => {
  const id = freshId();
  const rounds = Array.from({ length: 30 }, noDealInRound);
  playGame(id, rounds);
  const a = getStats(id).achievements;
  assert.strictEqual(a['safe_player_5'], true);
  assert.strictEqual(a['safe_player_10'], true);
  assert.strictEqual(a['safe_player_20'], true);
  assert.strictEqual(a['safe_player_30'], true);
});

test('29 clean hands in one game unlocks the lower three tiers but not the 30-hand one', () => {
  const id = freshId();
  const rounds = Array.from({ length: 29 }, noDealInRound);
  playGame(id, rounds);
  const a = getStats(id).achievements;
  assert.strictEqual(a['safe_player_20'], true);
  assert.strictEqual(a['safe_player_30'], undefined, '29 hands is one short of the 30-hand tier');
});

test('the streak is combined across variants — a 3-seat (sanma) deal-in resets a streak built in a 4-seat (yonma) game', () => {
  const id = freshId();
  // 20 clean yonma hands...
  playGame(id, Array.from({ length: 20 }, noDealInRound));
  assert.strictEqual(getStats(id).achievements['safe_player_20'], true, 'sanity check: 20-hand tier cleared in yonma');

  // ...then a sanma game (3 seats) where seat 0 deals in immediately,
  // followed by 25 more clean hands — 25 < 30, so the 30-hand tier must
  // NOT unlock, since the sanma deal-in should have reset the combined
  // streak rather than being ignored as "a different variant".
  const sanmaDealIn = { reason: 'ron', loser: 0, winner: 1 };
  playGame(id, [sanmaDealIn, ...Array.from({ length: 25 }, noDealInRound)], {
    playerIds: [id, null, null],
    isBot: [false, true, true],
    finalScores: [35000, 35000, 35000],
    placements: [1, 2, 3],
    handStats: [{}, {}, {}],
  });
  const a = getStats(id).achievements;
  assert.strictEqual(a['safe_player_30'], undefined, 'the sanma deal-in should have reset the combined streak');
});
