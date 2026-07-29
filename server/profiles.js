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
const DATA_DIR = path.join(__dirname, 'data');
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
  'Yakuman Hunter', 'Flush Master', 'Riichi Machine', 'Renaissance Player',
  'Big Hand', 'High Roller', 'Safe Player', 'Sanma Specialist',
  'Tsumo Specialist', 'Ron Specialist', 'Hand Collector', 'Podium Regular',
  'Lightning Reflexes', 'Quick Draw', 'All Triplets', 'Three Colors',
  'Pure Runner', 'Dora Rich',
];

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

// scrypt with a random per-profile salt — Node's built-in crypto, no extra
// dependency (bcrypt et al.) needed for a handful of profiles.
function _hashCode(code, salt) {
  return crypto.scryptSync(String(code), salt, 64).toString('hex');
}

// name + icon only — never the salt/codeHash — safe to send to anyone,
// including before they've entered a code (see the profile-picker's
// icon+name cards in index.html, populated before unlock).
function listProfiles() {
  const all = _load();
  return Object.keys(all).sort((a, b) => a.localeCompare(b))
    .map(name => ({ name, icon: all[name].icon || 'default' }));
}

// Developer-only — index.js must verify the dev secret before calling
// this; this function itself doesn't know about auth. Returns {ok, error?}.
function createProfile(name, code) {
  name = String(name || '').trim().slice(0, 20);
  if (!name) return { ok: false, error: 'Name required' };
  if (!code || String(code).length < 4) return { ok: false, error: 'Code must be at least 4 characters' };
  const all = _load();
  if (all[name]) return { ok: false, error: 'A profile with that name already exists' };
  const salt = crypto.randomBytes(16).toString('hex');
  all[name] = { salt, codeHash: _hashCode(code, salt), icon: 'default', title: 'Beginner' };
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
  if (!all[name]) return;
  all[name].icon = String(icon || 'default').slice(0, 20);
  _save(all);
}

function getIcon(name) {
  const all = _load();
  return all[name]?.icon || 'default';
}

// Same pattern as setIcon/getIcon above — persisted on the profile itself,
// not just the browser, so it's what shows up on any device. Only checks
// the title is a recognized one at all (TITLES) — NOT that this specific
// profile has earned it; index.js's 'set_profile_title' handler does that
// check (against stats.getStats(name).unlockedTitles) before ever calling
// this, since per-profile unlock state lives in stats.js, not here.
function setTitle(name, title) {
  const all = _load();
  if (!all[name] || !TITLES.includes(title)) return;
  all[name].title = title;
  _save(all);
}

function getTitle(name) {
  const all = _load();
  return all[name]?.title || 'Beginner';
}

// Both hashes are fixed-length (128 hex chars, scrypt's 64-byte default
// output) so length always matches for a real profile — timingSafeEqual is
// still used rather than ===, so a wrong-length guess can't be timed either.
function verifyProfile(name, code) {
  const all = _load();
  const p = all[name];
  if (!p) return false;
  const candidate = Buffer.from(_hashCode(code, p.salt), 'hex');
  const actual = Buffer.from(p.codeHash, 'hex');
  if (candidate.length !== actual.length) return false;
  return crypto.timingSafeEqual(candidate, actual);
}

// Developer-only, same as createProfile — index.js verifies DEV_SECRET
// before calling this, not any profile's own code (a deleted profile's
// code is exactly the thing that would no longer work to authorize this).
function deleteProfile(name) {
  const all = _load();
  if (!all[name]) return { ok: false, error: 'No such profile' };
  delete all[name];
  _save(all);
  return { ok: true };
}

// Owner-only — index.js verifies the profile's OWN current code before
// calling this (see 'change_username'), unlike createProfile/deleteProfile's
// DEV_SECRET gate above. Keeps the same salt/codeHash/icon, just moves them
// under the new key. The stats record lives in its own file and is migrated
// separately (see stats.renameStats).
function renameProfile(oldName, newName) {
  newName = String(newName || '').trim().slice(0, 20);
  if (!newName) return { ok: false, error: 'Name required' };
  const all = _load();
  if (!all[oldName]) return { ok: false, error: 'No such profile' };
  if (newName === oldName) return { ok: true, name: newName };
  if (all[newName]) return { ok: false, error: 'A profile with that name already exists' };
  all[newName] = all[oldName];
  delete all[oldName];
  _save(all);
  return { ok: true, name: newName };
}

// Owner-only — same verify-then-mutate pattern as renameProfile (see
// 'change_code' in index.js). Fresh salt, same reasoning as createProfile:
// never reuse a salt for a new code.
function setCode(name, code) {
  if (!code || String(code).length < 4) return { ok: false, error: 'Code must be at least 4 characters' };
  const all = _load();
  if (!all[name]) return { ok: false, error: 'No such profile' };
  const salt = crypto.randomBytes(16).toString('hex');
  all[name].salt = salt;
  all[name].codeHash = _hashCode(code, salt);
  _save(all);
  return { ok: true };
}

module.exports = { listProfiles, createProfile, verifyProfile, deleteProfile, setIcon, getIcon, renameProfile, setCode, setTitle, getTitle, TITLES };
