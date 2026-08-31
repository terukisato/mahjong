'use strict';
// Regression tests for friends.js — the request/accept/decline/remove
// lifecycle, crossed-request auto-accept, unread notification counting, and
// purge-on-profile-delete cleanup. Same plain-assertion convention as
// stats.test.js/room.test.js/mahjong.test.js. Run with: node server/friends.test.js
//
// DATA_DIR is read once, at module load, by profiles.js/friends.js — set it
// to a fresh temp directory BEFORE requiring either so these tests never
// touch the real server/data/*.json.
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-friends-test-'));
const { createProfile, getId } = require('./profiles');
const F = require('./friends');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; failures.push({ name, error: e.message }); }
}

// Four real profiles to work with.
for (const n of ['Alice', 'Bob', 'Carol', 'Dave']) createProfile(n, 'code1234');
const A = getId('Alice'), B = getId('Bob'), C = getId('Carol'), D = getId('Dave');

test('send + accept makes a mutual friendship', () => {
  assert.deepStrictEqual(F.sendRequest(A, B), { ok: true });
  assert.deepStrictEqual(F.getData(A).outgoing, [B]);
  assert.deepStrictEqual(F.getData(B).incoming, [A]);
  assert.strictEqual(F.unreadCount(B), 1);
  assert.deepStrictEqual(F.accept(B, A), { ok: true });
  assert.deepStrictEqual(F.getData(A).friends, [B]);
  assert.deepStrictEqual(F.getData(B).friends, [A]);
  assert.deepStrictEqual(F.getData(A).outgoing, []);
  assert.deepStrictEqual(F.getData(B).incoming, []);
  // Alice gets an "accepted" notification.
  assert.strictEqual(F.unreadCount(A), 1);
  assert.strictEqual(F.notifications(A)[0].type, 'accepted');
});

test('self-request is rejected', () => {
  assert.strictEqual(F.sendRequest(A, A).ok, false);
});

test('unknown id is rejected', () => {
  assert.strictEqual(F.sendRequest(A, '9999999999999999').ok, false);
});

test('duplicate request is rejected', () => {
  F.sendRequest(C, D);
  assert.strictEqual(F.sendRequest(C, D).ok, false);
  // already-friends is also rejected
  assert.strictEqual(F.sendRequest(A, B).ok, false);
});

test('crossed requests auto-accept', () => {
  // Carol already has a pending request out to Dave (from the test above).
  const r = F.sendRequest(D, C);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.autoAccepted, true);
  assert.ok(F.getData(C).friends.includes(D));
  assert.ok(F.getData(D).friends.includes(C));
  assert.deepStrictEqual(F.getData(C).outgoing, []);
  assert.deepStrictEqual(F.getData(D).incoming, []);
});

test('decline clears the pending request without a friendship', () => {
  F.sendRequest(A, C);
  F.decline(C, A);
  assert.ok(!F.getData(C).friends.includes(A));
  assert.deepStrictEqual(F.getData(C).incoming.filter(x => x === A), []);
  assert.deepStrictEqual(F.getData(A).outgoing.filter(x => x === C), []);
});

test('remove unfriends both sides', () => {
  F.remove(A, B);
  assert.ok(!F.getData(A).friends.includes(B));
  assert.ok(!F.getData(B).friends.includes(A));
});

test('markRead zeroes the unread count', () => {
  assert.ok(F.unreadCount(A) > 0);
  F.markRead(A);
  assert.strictEqual(F.unreadCount(A), 0);
  // notifications themselves are retained
  assert.ok(F.notifications(A).length > 0);
});

test('purge removes the record and scrubs it from others', () => {
  F.sendRequest(A, B); F.accept(B, A);   // re-friend
  F.sendRequest(D, B);                   // Dave -> Bob pending
  F.purge(B);
  assert.deepStrictEqual(F.getData(B).friends, []);
  assert.ok(!F.getData(A).friends.includes(B));
  assert.ok(!F.getData(D).outgoing.includes(B));
});

test('list helpers hydrate name + icon', () => {
  F.sendRequest(A, C); F.accept(C, A);
  const list = F.listFriends(A);
  const carol = list.find(x => x.id === C);
  assert.ok(carol && carol.name === 'Carol' && typeof carol.icon === 'string');
});

console.log(`\nfriends.test.js: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.error}`);
  process.exit(1);
}
