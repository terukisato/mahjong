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
