'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Profile auth store — separate file from stats.js's player-stats.json on
// purpose: this is "who's allowed to play as this name" (a name + a hashed
// unlock code), a different concern from "how did they do" (game stats).
// Same plain-JSON-file approach as stats.js, for the same reasons (no real
// concurrency at this scale, no DB needed for a handful of profiles) — see
// stats.js's own comment for why it re-reads on every call instead of
// caching in memory.
// DATA_DIR env var lets a deployment point this at a mounted persistent
// volume (e.g. a Railway Volume) instead of the app's own directory, which
// on most hosts is ephemeral — rebuilt fresh on every deploy/restart, wiping
// anything written here. Falls back to ./data for local dev, where the repo
// checkout itself is already the persistent thing. Set this to wherever the
// volume is actually mounted rather than guessing the app's container path.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

// Titles a profile can display next to its name (see 'set_profile_title'
// in index.js). 'Beginner' is every profile's default and free to pick;
// everything else here is earned via an achievement (see
// server/achievements.js's `unlocksTitle`). This array is just the
// overall known set — setTitle below only checks membership in it, NOT
// whether this specific profile has actually earned the title; index.js's
// 'set_profile_title' handler is what cross-checks against this profile's
// own unlockedTitles (stats.js, a separate module from this one) before
// ever calling setTitle, since that per-profile unlock state lives there,
// not here.
const TITLES = [
  'Beginner', 'Regular', 'Veteran', 'Century Club', 'Ace',
  'Yakuman Hunter', 'Riichi Machine', 'Renaissance Player',
  'Big Hand', 'High Roller', 'Safe Player', 'Sanma Specialist',
  'Tsumo Specialist', 'Ron Specialist', 'Hand Collector', 'Podium Regular',
  'Lightning Reflexes', 'Quick Draw', 'All Triplets',
  'Pure Runner', 'Dora Rich', 'The Diamond',
  // Point milestones (see server/achievements.js's yonma/sanma_100k/105k)
  'Hoarder', 'Overlord', 'Plunderer', 'Conqueror',
  // Sanma double-bankruptcy (double_knockout)
  'Double Knockout',
  // Higher-tier "harder" achievements (see server/achievements.js's own
  // comment on this batch) — a second, tougher rung above several of the
  // titles above, plus new stricter/compound conditions.
  'Legend', 'Living Legend', 'Riichi Addict', 'Hand Hoarder', 'Tsumo Master',
  'Ron Master', 'Dora Addict', 'Podium Veteran', 'Sharpshooter', 'Untouchable',
  'Yakuman Collector', 'Yakuman Legend', 'Master of Forms', 'Survivor',
  'The Last Emperor', 'Mighty Mouse', 'The Eagle',
  // Per-yaku titles (see server/achievements.js's *_win achievements)
  'Robbing Kan', 'Dead Wall Diver', 'Last Tile Standing', "River's End",
  'Instant Riichi', 'Triple Threat', 'Triple Triplet', 'Rainbow Run',
  'Terminal Case', 'Straight Shooter', 'Edge Player', 'Dragon Tamer',
  'Kan Collector', 'Mono Color', 'Pure Edge', 'Double Twin', 'Clean Sweep',
  'One Suit Wonder',
  // Per-yakuman titles (see server/achievements.js's *_win yakuman achievements)
  "Heaven's Chosen", "Earth's Chosen", 'Orphan Collector', 'Thirteen-Sided Master',
  'Iron Wall', "Needle's Eye", 'Dragon Lord', 'Wind Whisperer', 'Wind Sovereign',
  'Honor Bound', 'Terminal Master', 'Emerald Hand', 'Nine Gates', 'True Nine Gates',
  'Kan Emperor', 'Counted Divinity',
];

// Keyed by a stable, never-reused `id` — a random 16-digit number (as a
// string; larger than Number.MAX_SAFE_INTEGER, so it's never handled as an
// actual number anywhere) assigned once at createProfile and never touched
// again — rather than by name, which is just a mutable field on the
// record. This is what makes renameProfile below a plain in-place field
// edit instead of a delete-old-key/insert-new-key move: nothing else that
// references a profile (most importantly stats.js's player-stats.json,
// keyed by this same id — see stats.migrateToIds) has to be touched, or
// even know a rename happened, when a player changes their display name.
const ID_RE = /^\d{16}$/;

function _load() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function _save(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(all, null, 2));
}

// Finds a record by its `name` field (case-sensitive, same as the old
// name-keyed lookups this replaces) — O(n) over "a handful of profiles",
// same performance tradeoff already accepted elsewhere in this file.
function _findByName(all, name) {
  const id = Object.keys(all).find(k => all[k].name === name);
  return id ? [id, all[id]] : [null, null];
}

// scrypt with a random per-profile salt — Node's built-in crypto, no extra
// dependency (bcrypt et al.) needed for a handful of profiles.
function _hashCode(code, salt) {
  return crypto.scryptSync(String(code), salt, 64).toString('hex');
}

// A random 16-digit id as a string (first digit never 0, so it always
// prints as a genuine 16-digit number) — not a secret like the remember
// token above, just an identifier, so crypto.randomInt (uniform, but not
// aiming for unguessability) is enough. `taken` is whatever ids are already
// in use, checked so two profiles can never collide.
function _generateId(taken) {
  let id;
  do {
    id = String(crypto.randomInt(1, 10));
    for (let i = 0; i < 15; i++) id += String(crypto.randomInt(0, 10));
  } while (taken.has(id));
  return id;
}

// One-time upgrade to the id-keyed shape above — covers both a legacy
// name-keyed file (no `id` field at all) AND a file already id-keyed with
// the older crypto.randomUUID() ids this format replaces. Safe to call on
// every boot — a no-op once every record already has a 16-digit id.
// Returns {oldKey: newId} for just the records that were actually
// migrated (oldKey is the old name for a never-migrated record, or the old
// UUID for one only migrated to the previous id format) — so index.js can
// hand that map to stats.migrateToIds and move each profile's stats record
// (still sitting under its old key in player-stats.json) over to the new
// id in the same pass, instead of it silently becoming orphaned.
function migrateLegacyIds() {
  const all = _load();
  const remap = {};
  let changed = false;
  const usedIds = new Set(Object.values(all).map(p => p.id).filter(id => ID_RE.test(id)));
  for (const key of Object.keys(all)) {
    const rec = all[key];
    if (!ID_RE.test(rec.id)) {
      const id = _generateId(usedIds);
      usedIds.add(id);
      rec.id = id;
      rec.name = rec.name || key;
      remap[key] = id;
      changed = true;
    }
  }
  if (changed) {
    const rekeyed = {};
    for (const key of Object.keys(all)) rekeyed[all[key].id] = all[key];
    _save(rekeyed);
  }
  return remap;
}

// name + icon only — never the salt/codeHash — safe to send to anyone,
// including before they've entered a code (see the profile-picker's
// icon+name cards in index.html, populated before unlock).
function listProfiles() {
  const all = _load();
  return Object.values(all)
    .map(p => ({ name: p.name, icon: p.icon || 'default' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The stable id behind a name, e.g. so index.js can attach it to a
// just-unlocked connection (see 'unlock_profile'/'unlock_profile_token')
// and hand it to stats.js instead of the (mutable) name. Null if no such
// profile.
function getId(name) {
  const [id] = _findByName(_load(), name);
  return id;
}

// Reverse of getId, for joining stats.js's id-keyed leaderboard entries
// back to a display name (see 'get_leaderboard' in index.js). Falls back
// to '(unknown)' rather than crashing if the id's profile was since
// deleted without its stats record following (shouldn't normally happen —
// deleteProfile/deleteStats are always called together — but a leaderboard
// row is not the place to fail loudly over it).
function getNameById(id) {
  return _load()[id]?.name || '(unknown)';
}

// Developer-only — index.js must verify the dev secret before calling
// this; this function itself doesn't know about auth. Returns {ok, error?}.
function createProfile(name, code) {
  name = String(name || '').trim().slice(0, 20);
  if (!name) return { ok: false, error: 'Name required' };
  if (!code || String(code).length < 4) return { ok: false, error: 'Code must be at least 4 characters' };
  const all = _load();
  if (_findByName(all, name)[0]) return { ok: false, error: 'A profile with that name already exists' };
  const salt = crypto.randomBytes(16).toString('hex');
  const id = _generateId(new Set(Object.keys(all)));
  all[id] = { id, name, salt, codeHash: _hashCode(code, salt), icon: 'default', title: 'Beginner' };
  _save(all);
  return { ok: true };
}

// Called whenever the owner changes their icon in the User Profile panel
// (see 'set_profile_icon' in index.js, which requires this connection to
// already be unlocked as `name`) — persisted on the profile itself rather
// than just the browser's localStorage, so it's what the picker's cards
// show for this name on any device, before anyone even enters a code.
function setIcon(name, icon) {
  const all = _load();
  const [, p] = _findByName(all, name);
  if (!p) return;
  p.icon = String(icon || 'default').slice(0, 20);
  _save(all);
}

function getIcon(name) {
  return _findByName(_load(), name)[1]?.icon || 'default';
}

// Same pattern as setIcon/getIcon above — persisted on the profile itself,
// not just the browser, so it's what shows up on any device. Only checks
// the title is a recognized one at all (TITLES) — NOT that this specific
// profile has earned it; index.js's 'set_profile_title' handler does that
// check (against stats.getStats(id).unlockedTitles) before ever calling
// this, since per-profile unlock state lives in stats.js, not here.
function setTitle(name, title) {
  const all = _load();
  const [, p] = _findByName(all, name);
  if (!p || !TITLES.includes(title)) return;
  p.title = title;
  _save(all);
}

function getTitle(name) {
  return _findByName(_load(), name)[1]?.title || 'Beginner';
}

// Both hashes are fixed-length (128 hex chars, scrypt's 64-byte default
// output) so length always matches for a real profile — timingSafeEqual is
// still used rather than ===, so a wrong-length guess can't be timed either.
function verifyProfile(name, code) {
  const p = _findByName(_load(), name)[1];
  if (!p) return false;
  const candidate = Buffer.from(_hashCode(code, p.salt), 'hex');
  const actual = Buffer.from(p.codeHash, 'hex');
  if (candidate.length !== actual.length) return false;
  return crypto.timingSafeEqual(candidate, actual);
}

// "Stay logged in" — a long-lived bearer token issued at unlock time when
// the player opts in (see 'unlock_profile's `remember` flag in index.js),
// stored client-side in localStorage instead of the actual code so the
// code itself never has to be persisted in the browser. Same
// salt+scryptSync+timingSafeEqual treatment as the code itself. Just one
// token per profile — issuing a new one (another device, or unlocking with
// "stay logged in" again) invalidates whatever was issued before, the same
// single-session tradeoff a typical "remember me" cookie makes.
function createRememberToken(name) {
  const all = _load();
  const [, p] = _findByName(all, name);
  if (!p) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  p.remember = { salt, tokenHash: _hashCode(token, salt) };
  _save(all);
  return token;
}

// Same shape as verifyProfile, against the remember token instead of the code.
function verifyRememberToken(name, token) {
  const p = _findByName(_load(), name)[1];
  if (!p || !p.remember || !token) return false;
  const candidate = Buffer.from(_hashCode(token, p.remember.salt), 'hex');
  const actual = Buffer.from(p.remember.tokenHash, 'hex');
  if (candidate.length !== actual.length) return false;
  return crypto.timingSafeEqual(candidate, actual);
}

// Called on logout / "forget this device" so a stale localStorage token
// left on a shared computer can't keep unlocking the profile afterward.
function forgetRememberToken(name) {
  const all = _load();
  const [, p] = _findByName(all, name);
  if (!p) return;
  delete p.remember;
  _save(all);
}

// Developer-only, same as createProfile — index.js verifies DEV_SECRET
// before calling this, not any profile's own code (a deleted profile's
// code is exactly the thing that would no longer work to authorize this).
// Returns the deleted profile's id too, so index.js can pass it to
// stats.deleteStats — the stats record lives under that id, not the name.
function deleteProfile(name) {
  const all = _load();
  const [id] = _findByName(all, name);
  if (!id) return { ok: false, error: 'No such profile' };
  delete all[id];
  _save(all);
  return { ok: true, id };
}

// Owner-only — index.js verifies the profile's OWN current code before
// calling this (see 'change_username'), unlike createProfile/deleteProfile's
// DEV_SECRET gate above. Just flips the `name` field on the record kept
// under the same id — unlike the old name-keyed scheme, this never has to
// move anything in player-stats.json (see stats.js, keyed by this same id),
// so a rename can no longer race a game finishing and lose/orphan a stats
// write.
function renameProfile(oldName, newName) {
  newName = String(newName || '').trim().slice(0, 20);
  if (!newName) return { ok: false, error: 'Name required' };
  const all = _load();
  const [, p] = _findByName(all, oldName);
  if (!p) return { ok: false, error: 'No such profile' };
  if (newName === oldName) return { ok: true, name: newName };
  if (_findByName(all, newName)[0]) return { ok: false, error: 'A profile with that name already exists' };
  p.name = newName;
  _save(all);
  return { ok: true, name: newName };
}

// Owner-only — same verify-then-mutate pattern as renameProfile (see
// 'change_code' in index.js). Fresh salt, same reasoning as createProfile:
// never reuse a salt for a new code.
function setCode(name, code) {
  if (!code || String(code).length < 4) return { ok: false, error: 'Code must be at least 4 characters' };
  const all = _load();
  const [, p] = _findByName(all, name);
  if (!p) return { ok: false, error: 'No such profile' };
  const salt = crypto.randomBytes(16).toString('hex');
  p.salt = salt;
  p.codeHash = _hashCode(code, salt);
  _save(all);
  return { ok: true };
}

module.exports = { listProfiles, createProfile, verifyProfile, deleteProfile, setIcon, getIcon, renameProfile, setCode, setTitle, getTitle, TITLES, createRememberToken, verifyRememberToken, forgetRememberToken, getId, getNameById, migrateLegacyIds };
