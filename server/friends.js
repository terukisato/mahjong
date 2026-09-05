'use strict';
const crypto = require('crypto');
const { getDb, transaction } = require('./db');
const { getNameById, getIconById } = require('./profiles');

// Friends store — the social graph that sits alongside profiles.js (who a
// player IS) and stats.js (how they've done), in the same shared SQLite
// database (see server/db.js). Normalized into three tables instead of the
// three parallel JSON arrays (friends/incoming/outgoing) the old
// friends.json record kept per id — see db.js's schema comment for why each
// table looks the way it does.
//
// Keyed throughout by profiles.js's stable 16-digit id (never the renameable
// display name), same as before.
//
// How many notifications are kept per profile — newest-first, oldest
// trimmed once a fresh one pushes the count over this (see _notify below).
const NOTIF_CAP = 50;

// Canonical (id1, id2) ordering for a mutual-friendship row — a plain string
// comparison sorts identically to numeric here since every id is a
// fixed-width 16-digit string — so "are A and B friends" is always exactly
// one row, regardless of which side is asking.
function _pair(a, b) { return a < b ? [a, b] : [b, a]; }

function _areFriends(db, a, b) {
  const [id1, id2] = _pair(a, b);
  return !!db.prepare('SELECT 1 FROM friend_edges WHERE id1 = ? AND id2 = ?').get(id1, id2);
}

function _hasRequest(db, fromId, toId) {
  return !!db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(fromId, toId);
}

// Drops any pending 'request' notification from `fromId` on `ownerId`'s
// list — called once that request has been resolved (accepted or declined)
// so the bell panel doesn't keep showing a dead Accept/Decline row for it.
function _dropRequestNotif(db, ownerId, fromId) {
  db.prepare("DELETE FROM friend_notifications WHERE owner_id = ? AND type = 'request' AND from_id = ?").run(ownerId, fromId);
}

function _notify(db, ownerId, type, fromId) {
  db.prepare('INSERT INTO friend_notifications (nid, owner_id, type, from_id, from_name, ts, read) VALUES (?,?,?,?,?,?,0)')
    .run(crypto.randomBytes(8).toString('hex'), ownerId, type, fromId, getNameById(fromId), Date.now());
  // Trim to the newest NOTIF_CAP for this owner — same "newest-first,
  // capped" shape the old notifications array kept. `rowid` (SQLite's
  // implicit row-order column) tie-breaks two notifications stamped in the
  // same millisecond, so the trim always agrees with insertion order.
  db.prepare(`
    DELETE FROM friend_notifications
    WHERE owner_id = ? AND nid NOT IN (
      SELECT nid FROM friend_notifications WHERE owner_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?
    )
  `).run(ownerId, ownerId, NOTIF_CAP);
}

// Real profile check — getNameById falls back to '(unknown)' for an id with
// no profile record (see profiles.js), which is exactly what a bad/guessed
// id looks like here.
function _isRealProfile(id) {
  return !!id && getNameById(id) !== '(unknown)';
}

// The normalized record for one profile — safe to call for any id, returns
// the empty shape for one that's never used the friends system.
function getData(id) {
  const db = getDb();
  const friends = db.prepare('SELECT CASE WHEN id1 = ? THEN id2 ELSE id1 END AS fid FROM friend_edges WHERE id1 = ? OR id2 = ?')
    .all(id, id, id).map(r => r.fid);
  const incoming = db.prepare('SELECT from_id FROM friend_requests WHERE to_id = ?').all(id).map(r => r.from_id);
  const outgoing = db.prepare('SELECT to_id FROM friend_requests WHERE from_id = ?').all(id).map(r => r.to_id);
  const notifications = db.prepare('SELECT nid, type, from_id, from_name, ts, read FROM friend_notifications WHERE owner_id = ? ORDER BY ts DESC, rowid DESC').all(id)
    .map(n => ({ nid: n.nid, type: n.type, fromId: n.from_id, fromName: n.from_name, ts: n.ts, read: !!n.read }));
  return { friends, incoming, outgoing, notifications };
}

// A -> B friend request. Auto-accepts when B has already sent A a request
// (the two crossed in the post) rather than leaving two mirrored pending
// requests sitting there. Returns {ok, error?, autoAccepted?}.
function sendRequest(fromId, toId) {
  if (!fromId || !toId) return { ok: false, error: 'Missing id' };
  if (fromId === toId) return { ok: false, error: "You can't add yourself" };
  if (!_isRealProfile(toId)) return { ok: false, error: 'No player with that ID' };
  return transaction(db => {
    if (_areFriends(db, fromId, toId)) return { ok: false, error: 'Already friends' };
    if (_hasRequest(db, fromId, toId)) return { ok: false, error: 'Request already sent' };
    // Crossed requests — toId already has a pending request out to fromId —
    // just accept instead of leaving two mirrored pending requests sitting
    // there.
    if (_hasRequest(db, toId, fromId)) {
      db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(toId, fromId);
      _dropRequestNotif(db, fromId, toId);
      const [id1, id2] = _pair(fromId, toId);
      db.prepare('INSERT OR IGNORE INTO friend_edges (id1, id2) VALUES (?,?)').run(id1, id2);
      _notify(db, toId, 'accepted', fromId);
      return { ok: true, autoAccepted: true };
    }
    db.prepare('INSERT INTO friend_requests (from_id, to_id) VALUES (?,?)').run(fromId, toId);
    _notify(db, toId, 'request', fromId);
    return { ok: true };
  });
}

// myId accepts a pending request from fromId.
function accept(myId, fromId) {
  return transaction(db => {
    if (!_hasRequest(db, fromId, myId)) return { ok: false, error: 'No such request' };
    db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(fromId, myId);
    _dropRequestNotif(db, myId, fromId);
    const [id1, id2] = _pair(myId, fromId);
    db.prepare('INSERT OR IGNORE INTO friend_edges (id1, id2) VALUES (?,?)').run(id1, id2);
    _notify(db, fromId, 'accepted', myId);
    return { ok: true };
  });
}

// myId declines / cancels a pending request from fromId. Silent — no
// notification either way.
function decline(myId, fromId) {
  return transaction(db => {
    db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(fromId, myId);
    _dropRequestNotif(db, myId, fromId);
    return { ok: true };
  });
}

// Mutual unfriend — also clears any stray pending request in either
// direction, so "remove then re-add" always starts from a clean slate.
function remove(myId, otherId) {
  return transaction(db => {
    const [id1, id2] = _pair(myId, otherId);
    db.prepare('DELETE FROM friend_edges WHERE id1 = ? AND id2 = ?').run(id1, id2);
    db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)')
      .run(myId, otherId, otherId, myId);
    return { ok: true };
  });
}

// {id,name,icon} rows for a list — the caller (index.js) tags on `online`
// from its own onlineProfiles/seatedProfiles maps.
function _hydrate(ids) {
  return ids
    .filter(_isRealProfile)
    .map(id => ({ id, name: getNameById(id), icon: getIconById(id) }));
}

function listFriends(id) { return _hydrate(getData(id).friends); }
function listIncoming(id) { return _hydrate(getData(id).incoming); }
function listOutgoing(id) { return _hydrate(getData(id).outgoing); }

function notifications(id) { return getData(id).notifications; }

function unreadCount(id) {
  return getData(id).notifications.filter(n => !n.read).length;
}

function markRead(id) {
  getDb().prepare('UPDATE friend_notifications SET read = 1 WHERE owner_id = ? AND read = 0').run(id);
}

// Called when a profile is deleted (see 'delete_profile' in index.js) —
// drops its own edges/requests/notifications, which also scrubs it out of
// everyone else's friends/incoming/outgoing (those are the same shared rows,
// not a separate copy per side). Leaves any notification on ANOTHER
// profile's list that merely mentions this id as `from_id` (e.g. a past
// "accepted" notification) untouched — same limitation the old JSON purge
// had, since it only ever deleted the purged id's OWN record.
function purge(id) {
  transaction(db => {
    db.prepare('DELETE FROM friend_edges WHERE id1 = ? OR id2 = ?').run(id, id);
    db.prepare('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?').run(id, id);
    db.prepare('DELETE FROM friend_notifications WHERE owner_id = ?').run(id);
  });
}

module.exports = {
  getData, sendRequest, accept, decline, remove,
  listFriends, listIncoming, listOutgoing,
  notifications, unreadCount, markRead, purge,
};
