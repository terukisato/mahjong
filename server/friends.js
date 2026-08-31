'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getNameById, getIconById } = require('./profiles');

// Friends store — the social graph that sits alongside profiles.js (who a
// player IS) and stats.js (how they've done). Same plain-JSON-file approach
// and reasoning as those two: no real concurrency at this scale, re-read on
// every call rather than cached in memory (a restart mid-write would
// otherwise let a stale cache clobber the file — see stats.js's own comment).
// Same DATA_DIR env var, so this file sits next to profiles.json /
// player-stats.json on whatever persistent volume a deployment mounts.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');

// Keyed by profiles.js's stable 16-digit id (never the renameable display
// name), same as player-stats.json. Every record has this exact shape;
// _record() below fills in the defaults for a profile that's never touched
// the friends system, so callers never have to null-check the arrays.
//   friends  — mutual, both sides carry each other's id
//   incoming — pending requests others have sent me (their id)
//   outgoing — pending requests I've sent (their id)
//   notifications — newest-first, capped; type 'request' | 'accepted'
const NOTIF_CAP = 50;

function _load() {
  try {
    return JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function _save(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FRIENDS_FILE, JSON.stringify(all, null, 2));
}

function _record(all, id) {
  const r = all[id] || {};
  r.friends = Array.isArray(r.friends) ? r.friends : [];
  r.incoming = Array.isArray(r.incoming) ? r.incoming : [];
  r.outgoing = Array.isArray(r.outgoing) ? r.outgoing : [];
  r.notifications = Array.isArray(r.notifications) ? r.notifications : [];
  all[id] = r;
  return r;
}

function _pull(arr, val) {
  const i = arr.indexOf(val);
  if (i >= 0) arr.splice(i, 1);
}

// Drop any pending 'request' notification from `fromId` in this record —
// called once that request has been resolved (accepted or declined) so the
// bell panel doesn't keep showing a dead Accept/Decline row for it.
function _dropRequestNotif(rec, fromId) {
  rec.notifications = rec.notifications.filter(n => !(n.type === 'request' && n.fromId === fromId));
}

function _notify(rec, type, fromId) {
  rec.notifications.unshift({
    nid: crypto.randomBytes(8).toString('hex'),
    type,
    fromId,
    fromName: getNameById(fromId),
    ts: Date.now(),
    read: false,
  });
  if (rec.notifications.length > NOTIF_CAP) rec.notifications.length = NOTIF_CAP;
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
  return _record(_load(), id);
}

// A -> B friend request. Auto-accepts when B has already sent A a request
// (the two crossed in the post) rather than leaving two mirrored pending
// requests sitting there. Returns {ok, error?, autoAccepted?}.
function sendRequest(fromId, toId) {
  if (!fromId || !toId) return { ok: false, error: 'Missing id' };
  if (fromId === toId) return { ok: false, error: "You can't add yourself" };
  if (!_isRealProfile(toId)) return { ok: false, error: 'No player with that ID' };
  const all = _load();
  const me = _record(all, fromId);
  if (me.friends.includes(toId)) return { ok: false, error: 'Already friends' };
  if (me.outgoing.includes(toId)) return { ok: false, error: 'Request already sent' };
  // Crossed requests — just accept.
  if (me.incoming.includes(toId)) {
    _pull(me.incoming, toId);
    _dropRequestNotif(me, toId);
    const other = _record(all, toId);
    _pull(other.outgoing, fromId);
    me.friends.push(toId);
    other.friends.push(fromId);
    _notify(other, 'accepted', fromId);
    _save(all);
    return { ok: true, autoAccepted: true };
  }
  me.outgoing.push(toId);
  const other = _record(all, toId);
  if (!other.incoming.includes(fromId)) other.incoming.push(fromId);
  _notify(other, 'request', fromId);
  _save(all);
  return { ok: true };
}

// myId accepts a pending request from fromId.
function accept(myId, fromId) {
  const all = _load();
  const me = _record(all, myId);
  if (!me.incoming.includes(fromId)) return { ok: false, error: 'No such request' };
  _pull(me.incoming, fromId);
  _dropRequestNotif(me, fromId);
  const other = _record(all, fromId);
  _pull(other.outgoing, myId);
  if (!me.friends.includes(fromId)) me.friends.push(fromId);
  if (!other.friends.includes(myId)) other.friends.push(myId);
  _notify(other, 'accepted', myId);
  _save(all);
  return { ok: true };
}

// myId declines / cancels a pending request from fromId. Silent — no
// notification either way.
function decline(myId, fromId) {
  const all = _load();
  const me = _record(all, myId);
  const other = _record(all, fromId);
  _pull(me.incoming, fromId);
  _dropRequestNotif(me, fromId);
  _pull(other.outgoing, myId);
  _save(all);
  return { ok: true };
}

// Mutual unfriend — also clears any stray pending request in either
// direction, so "remove then re-add" always starts from a clean slate.
function remove(myId, otherId) {
  const all = _load();
  const me = _record(all, myId);
  const other = _record(all, otherId);
  _pull(me.friends, otherId);
  _pull(other.friends, myId);
  _pull(me.incoming, otherId);
  _pull(me.outgoing, otherId);
  _pull(other.incoming, myId);
  _pull(other.outgoing, myId);
  _save(all);
  return { ok: true };
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
  const all = _load();
  const me = _record(all, id);
  let changed = false;
  for (const n of me.notifications) if (!n.read) { n.read = true; changed = true; }
  if (changed) _save(all);
}

// Called when a profile is deleted (see 'delete_profile' in index.js) —
// drop its own record AND scrub its id out of everyone else's lists, so no
// friend list is left pointing at a profile that no longer exists.
function purge(id) {
  const all = _load();
  delete all[id];
  for (const rec of Object.values(all)) {
    if (!rec || typeof rec !== 'object') continue;
    if (Array.isArray(rec.friends)) _pull(rec.friends, id);
    if (Array.isArray(rec.incoming)) _pull(rec.incoming, id);
    if (Array.isArray(rec.outgoing)) _pull(rec.outgoing, id);
  }
  _save(all);
}

module.exports = {
  getData, sendRequest, accept, decline, remove,
  listFriends, listIncoming, listOutgoing,
  notifications, unreadCount, markRead, purge,
};
