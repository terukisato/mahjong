'use strict';
// Regression tests for history.js — focused on the "recently played with"
// graph recordGame builds (recent_opponents), since that's the non-trivial
// new logic: pairwise recording of real-profile seats only, newest-first
// ordering, the per-profile cap, and purge-on-delete cleanup. Same
// plain-assertion convention as friends.test.js/stats.test.js. Run with:
// node --test server/history.test.js
//
// DATA_DIR is read once, at module load, so set it to a fresh temp dir
// BEFORE requiring anything that opens the database.
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-history-test-'));
const { createProfile, getId } = require('./profiles');
const H = require('./history');

for (const n of ['Ann', 'Ben', 'Cy', 'Deb']) createProfile(n, 'code1234');
const A = getId('Ann'), B = getId('Ben'), C = getId('Cy'), D = getId('Deb');

// Minimal recordGame args — only the fields the recent_opponents path
// actually reads matter here; the rest just need to be JSON-serializable.
function game(seats, opts = {}) {
  H.recordGame({
    playerIds: seats.map(s => s.id),
    isBot: seats.map(s => !!s.bot),
    isGuest: seats.map(s => !!s.guest),
    variant: 'yonma', matchKind: 'room', gameMode: 'hanchan', numPlayers: seats.length,
    playerNames: seats.map((s, i) => s.name || `Seat ${i}`),
    finalScores: seats.map(() => 25000),
    placements: seats.map((_, i) => i + 1),
    rounds: [],
    ...opts,
  });
}

test('a game records every other real seat as a recent opponent', () => {
  game([{ id: A, name: 'Ann' }, { id: B, name: 'Ben' }, { id: C, name: 'Cy' }, { id: null, name: 'CPU', bot: true }]);
  assert.deepStrictEqual(H.getRecentOpponents(A).map(r => r.id).sort(), [B, C].sort());
  assert.deepStrictEqual(H.getRecentOpponents(B).map(r => r.id).sort(), [A, C].sort());
  // The bot seat has no id and is never recorded, in either direction.
  assert.strictEqual(H.getRecentOpponents(A).some(r => r.id == null), false);
});

test('bots and guests are never recorded as opponents', () => {
  game([{ id: D, name: 'Deb' }, { id: null, bot: true }, { id: C, name: 'Cy', guest: true }, { id: A, name: 'Ann' }]);
  // Deb only shared this table with one real, non-guest profile: Ann.
  assert.deepStrictEqual(H.getRecentOpponents(D).map(r => r.id), [A]);
});

test('replaying bumps last_played so the pair sorts to the front', async () => {
  const first = H.getRecentOpponents(A).find(r => r.id === C).lastPlayed;
  await new Promise(r => setTimeout(r, 5));
  game([{ id: A, name: 'Ann' }, { id: C, name: 'Cy' }, { id: null, bot: true }, { id: null, bot: true }]);
  const bumped = H.getRecentOpponents(A).find(r => r.id === C).lastPlayed;
  assert.ok(bumped > first, 'last_played should increase on replay');
  assert.strictEqual(H.getRecentOpponents(A)[0].id, C, 'most recent opponent is first');
});

test('a solo game against only bots records nothing', () => {
  const before = H.getRecentOpponents(B).length;
  game([{ id: B, name: 'Ben' }, { id: null, bot: true }, { id: null, bot: true }, { id: null, bot: true }]);
  assert.strictEqual(H.getRecentOpponents(B).length, before);
});

test('deleteHistory scrubs the id from both sides of the graph', () => {
  assert.ok(H.getRecentOpponents(A).some(r => r.id === B));
  H.deleteHistory(B);
  assert.strictEqual(H.getRecentOpponents(B).length, 0);
  assert.strictEqual(H.getRecentOpponents(A).some(r => r.id === B), false);
});

// Replays — stored once per game, readable only by a profile that played
// it, and pruned when the last history row referencing them is trimmed.
test('a recorded replay is readable by its players only, and flagged in the list', () => {
  const replay = { v: 1, rules: {}, rounds: [{ dealer: 0, hands: [], ev: [] }] };
  game([{ id: A, name: 'Ann' }, { id: C, name: 'Cy' }, { id: null, bot: true }, { id: null, bot: true }], { replay });
  const g = H.getHistory(A)[0];
  assert.strictEqual(g.hasReplay, true);
  assert.deepStrictEqual(H.getReplay(A, g.id).replay, replay);
  assert.strictEqual(H.getReplay(C, g.id).seat, 1);
  assert.strictEqual(H.getReplay(D, g.id), null, 'a profile that did not play it gets nothing');
  // A game recorded without a replay lists as such.
  game([{ id: A, name: 'Ann' }, { id: null, bot: true }, { id: null, bot: true }, { id: null, bot: true }]);
  const old = H.getHistory(A)[0];
  assert.strictEqual(old.hasReplay, false);
  assert.strictEqual(H.getReplay(A, old.id).replay, null);
});

test('analysis cache is keyed by seat and version', () => {
  const g = H.getHistory(C)[0];
  H.saveAnalysis(g.id, 1, 1, { ok: true });
  assert.deepStrictEqual(H.getCachedAnalysis(g.id, 1, 1), { ok: true });
  assert.strictEqual(H.getCachedAnalysis(g.id, 1, 2), null, 'an older version is stale');
  assert.strictEqual(H.getCachedAnalysis(g.id, 0, 1), null);
});

test('replays are pruned once no history row references them', () => {
  const g = H.getHistory(C).find(x => x.hasReplay);
  H.deleteHistory(A);
  assert.ok(H.getReplay(C, g.id).replay, 'still referenced by Cy');
  H.deleteHistory(C);
  const { getDb } = require('./db');
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) AS n FROM game_replays WHERE game_id = ?').get(g.id).n, 0);
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) AS n FROM game_analysis WHERE game_id = ?').get(g.id).n, 0);
});
