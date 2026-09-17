'use strict';
const crypto = require('crypto');
const { getDb } = require('./db');

// Profile auth store — separate table from stats.js/economy.js/friends.js/
// history.js on purpose: this is "who's allowed to play as this name" (a
// name + a hashed unlock code), a different concern from any of those (see
// server/db.js's schema comment for the full table list, and each of those
// files' own comments for their own reasoning). All five share one SQLite
// database now instead of five separate JSON files, but this file still owns
// only its own `profiles` table — nothing here reaches into another
// module's rows.
// DATA_DIR env var lets a deployment point the database file at a mounted
// persistent volume (e.g. a Railway Volume) instead of the app's own
// directory, which on most hosts is ephemeral — rebuilt fresh on every
// deploy/restart, wiping anything written here. Falls back to ./data for
// local dev. See server/db.js.

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
  'Big Hand', 'High Roller',
  // Safe Player ladder (see server/achievements.js's safe_player_5/10/20/30)
  'Safe Player', 'Disciplined Safe Player', 'Elite Safe Player', 'Legendary Safe Player',
  'Sanma Specialist',
  'Tsumo Specialist', 'Ron Specialist', 'Hand Collector', 'Podium Regular',
  'Lightning Reflexes', 'Quick Draw', 'All Triplets',
  'Pure Runner', 'Dora Rich', 'The Diamond',
  // Point milestones (see server/achievements.js's yonma/sanma_100k/105k)
  'Hoarder', 'Overlord', 'Plunderer', 'Conqueror',
  // Sanma double-bankruptcy (double_knockout)
  'Double Knockout',
  // Banking all 4 of a round's kita tiles single-handedly (quad_kita)
  'The South Pole',
  // Higher-tier "harder" achievements (see server/achievements.js's own
  // comment on this batch) — a second, tougher rung above several of the
  // titles above, plus new stricter/compound conditions.
  'Legend', 'Living Legend', 'Riichi Addict', 'Hand Hoarder', 'Tsumo Master',
  'Ron Master', 'Dora Addict',
  'Yakuman Collector', 'Yakuman Legend', 'Master of Forms',
  // 2-different-yakuman-in-one-hand (see server/achievements.js's yakuman_stack)
  'Twin Fortune',
  // Double-yakuman ladder (see server/achievements.js's double_yakuman_*)
  'Double Crown', 'Twin Ascendant', 'Grand Ascendant',
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

// scrypt with a random per-profile salt — Node's built-in crypto, no extra
// dependency (bcrypt et al.) needed for a handful of profiles.
function _hashCode(code, salt) {
  return crypto.scryptSync(String(code), salt, 64).toString('hex');
}

// A random 16-digit id as a string (first digit never 0, so it always
// prints as a genuine 16-digit number) — not a secret like the remember
// token below, just an identifier, so crypto.randomInt (uniform, but not
// aiming for unguessability) is enough. Checked against the table so two
// profiles can never collide (vanishingly unlikely at this id space, but
// free to guard against via the PRIMARY KEY lookup anyway).
function _generateId(db) {
  const exists = db.prepare('SELECT 1 FROM profiles WHERE id = ?');
  let id;
  do {
    id = String(crypto.randomInt(1, 10));
    for (let i = 0; i < 15; i++) id += String(crypto.randomInt(0, 10));
  } while (exists.get(id));
  return id;
}

// name + icon only — never the salt/codeHash — safe to send to anyone,
// including before they've entered a code (see the profile-picker's
// icon+name cards in index.html, populated before unlock).
function listProfiles() {
  const rows = getDb().prepare('SELECT name, icon FROM profiles').all();
  return rows
    .map(p => ({ name: p.name, icon: p.icon || 'default' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The stable id behind a name, e.g. so index.js can attach it to a
// just-unlocked connection (see 'unlock_profile'/'unlock_profile_token')
// and hand it to stats.js instead of the (mutable) name. Null if no such
// profile.
function getId(name) {
  const row = getDb().prepare('SELECT id FROM profiles WHERE name = ?').get(name);
  return row ? row.id : null;
}

// Reverse of getId, for joining stats.js's id-keyed leaderboard entries
// back to a display name (see 'get_leaderboard' in index.js). Falls back
// to '(unknown)' rather than crashing if the id's profile was since
// deleted without its stats record following (shouldn't normally happen —
// deleteProfile/deleteStats are always called together — but a leaderboard
// row is not the place to fail loudly over it).
function getNameById(id) {
  const row = getDb().prepare('SELECT name FROM profiles WHERE id = ?').get(id);
  return row ? row.name : '(unknown)';
}

// Developer-only — index.js must verify the dev secret before calling
// this; this function itself doesn't know about auth. Returns {ok, error?}.
function createProfile(name, code) {
  name = String(name || '').trim().slice(0, 20);
  if (!name) return { ok: false, error: 'Name required' };
  if (!code || String(code).length < 4) return { ok: false, error: 'Code must be at least 4 characters' };
  const db = getDb();
  if (db.prepare('SELECT 1 FROM profiles WHERE name = ?').get(name)) {
    return { ok: false, error: 'A profile with that name already exists' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const id = _generateId(db);
  db.prepare(`
    INSERT INTO profiles (id, name, salt, code_hash, icon, title, voice_theme)
    VALUES (?,?,?,?,'default','Beginner','Default')
  `).run(id, name, salt, _hashCode(code, salt));
  return { ok: true };
}

// Called whenever the owner changes their icon in the User Profile panel or
// Shop (see 'equip_icon' in index.js, which requires this connection to
// already be unlocked as `name` and checks ownership via cosmetics.js
// before ever calling this) — persisted on the profile itself rather than
// just the browser's localStorage, so it's what the picker's cards show for
// this name on any device, before anyone even enters a code.
function setIcon(name, icon) {
  getDb().prepare('UPDATE profiles SET icon = ? WHERE name = ?')
    .run(String(icon || 'default').slice(0, 20), name);
}

function getIcon(name) {
  const row = getDb().prepare('SELECT icon FROM profiles WHERE name = ?').get(name);
  return row ? (row.icon || 'default') : 'default';
}

// Same as getIcon but keyed by the stable id (see friends.js, which joins
// its id-keyed lists back to a display icon the same way getNameById gives
// it a display name) — 'default' for an id with no profile record.
function getIconById(id) {
  const row = getDb().prepare('SELECT icon FROM profiles WHERE id = ?').get(id);
  return row ? (row.icon || 'default') : 'default';
}

// Same pattern as setIcon/getIcon/getIconById above — the equipped nameplate
// skin, persisted on the profile itself. Ownership (which skins this profile
// is even allowed to equip) lives in cosmetics.js, not here — same division
// of labor as setTitle/setVoiceTheme below, which only validate "is this a
// recognized value at all", not "has this profile earned/bought it".
function setNameplateSkin(name, skin) {
  getDb().prepare('UPDATE profiles SET nameplate_skin = ? WHERE name = ?')
    .run(String(skin || 'default').slice(0, 20), name);
}

function getNameplateSkin(name) {
  const row = getDb().prepare('SELECT nameplate_skin FROM profiles WHERE name = ?').get(name);
  return row ? (row.nameplate_skin || 'default') : 'default';
}

function getNameplateSkinById(id) {
  const row = getDb().prepare('SELECT nameplate_skin FROM profiles WHERE id = ?').get(id);
  return row ? (row.nameplate_skin || 'default') : 'default';
}

// Same pattern as setIcon/getIcon above — persisted on the profile itself,
// not just the browser, so it's what shows up on any device. Only checks
// the title is a recognized one at all (TITLES) — NOT that this specific
// profile has earned it; index.js's 'set_profile_title' handler does that
// check (against stats.getStats(id).unlockedTitles) before ever calling
// this, since per-profile unlock state lives in stats.js, not here.
function setTitle(name, title) {
  if (!TITLES.includes(title)) return;
  getDb().prepare('UPDATE profiles SET title = ? WHERE name = ?').run(title, name);
}

function getTitle(name) {
  const row = getDb().prepare('SELECT title FROM profiles WHERE name = ?').get(name);
  return row ? row.title : 'Beginner';
}

// Voice-line theme (see 'set_profile_voice_theme' in index.js) — same
// persist-on-the-profile pattern as setIcon/setTitle above, so the choice
// follows the account across devices/browsers instead of living only in
// one browser's localStorage. This only knows the overall recognized set
// (VOICE_THEMES); index.js's handler cross-checks the profile's own earned
// unlockedThemes (stats.js) before calling this, exactly like setTitle.
const VOICE_THEMES = ['Default', 'Natsu'];
function setVoiceTheme(name, theme) {
  if (!VOICE_THEMES.includes(theme)) return;
  getDb().prepare('UPDATE profiles SET voice_theme = ? WHERE name = ?').run(theme, name);
}

function getVoiceTheme(name) {
  const row = getDb().prepare('SELECT voice_theme FROM profiles WHERE name = ?').get(name);
  return row ? row.voice_theme : 'Default';
}

// Both hashes are fixed-length (128 hex chars, scrypt's 64-byte default
// output) so length always matches for a real profile — timingSafeEqual is
// still used rather than ===, so a wrong-length guess can't be timed either.
function verifyProfile(name, code) {
  const row = getDb().prepare('SELECT salt, code_hash FROM profiles WHERE name = ?').get(name);
  if (!row) return false;
  const candidate = Buffer.from(_hashCode(code, row.salt), 'hex');
  const actual = Buffer.from(row.code_hash, 'hex');
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
  const db = getDb();
  const row = db.prepare('SELECT id FROM profiles WHERE name = ?').get(name);
  if (!row) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE profiles SET remember_salt = ?, remember_token_hash = ? WHERE name = ?')
    .run(salt, _hashCode(token, salt), name);
  return token;
}

// Same shape as verifyProfile, against the remember token instead of the code.
function verifyRememberToken(name, token) {
  if (!token) return false;
  const row = getDb().prepare('SELECT remember_salt, remember_token_hash FROM profiles WHERE name = ?').get(name);
  if (!row || !row.remember_salt || !row.remember_token_hash) return false;
  const candidate = Buffer.from(_hashCode(token, row.remember_salt), 'hex');
  const actual = Buffer.from(row.remember_token_hash, 'hex');
  if (candidate.length !== actual.length) return false;
  return crypto.timingSafeEqual(candidate, actual);
}

// Called on logout / "forget this device" so a stale localStorage token
// left on a shared computer can't keep unlocking the profile afterward.
function forgetRememberToken(name) {
  getDb().prepare('UPDATE profiles SET remember_salt = NULL, remember_token_hash = NULL WHERE name = ?').run(name);
}

// Developer-only, same as createProfile — index.js verifies DEV_SECRET
// before calling this, not any profile's own code (a deleted profile's
// code is exactly the thing that would no longer work to authorize this).
// Returns the deleted profile's id too, so index.js can pass it to
// stats.deleteStats — the stats record lives under that id, not the name.
function deleteProfile(name) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM profiles WHERE name = ?').get(name);
  if (!row) return { ok: false, error: 'No such profile' };
  db.prepare('DELETE FROM profiles WHERE name = ?').run(name);
  return { ok: true, id: row.id };
}

// Owner-only — index.js verifies the profile's OWN current code before
// calling this (see 'change_username'), unlike createProfile/deleteProfile's
// DEV_SECRET gate above. Just flips the `name` column on the row kept under
// the same id — a rename never has to move anything in player-stats/coins/
// friends/game-history, all keyed by that same unchanging id.
function renameProfile(oldName, newName) {
  newName = String(newName || '').trim().slice(0, 20);
  if (!newName) return { ok: false, error: 'Name required' };
  const db = getDb();
  const row = db.prepare('SELECT id FROM profiles WHERE name = ?').get(oldName);
  if (!row) return { ok: false, error: 'No such profile' };
  if (newName === oldName) return { ok: true, name: newName };
  if (db.prepare('SELECT 1 FROM profiles WHERE name = ?').get(newName)) {
    return { ok: false, error: 'A profile with that name already exists' };
  }
  db.prepare('UPDATE profiles SET name = ? WHERE name = ?').run(newName, oldName);
  return { ok: true, name: newName };
}

// Owner-only — same verify-then-mutate pattern as renameProfile (see
// 'change_code' in index.js). Fresh salt, same reasoning as createProfile:
// never reuse a salt for a new code.
function setCode(name, code) {
  if (!code || String(code).length < 4) return { ok: false, error: 'Code must be at least 4 characters' };
  const db = getDb();
  const row = db.prepare('SELECT id FROM profiles WHERE name = ?').get(name);
  if (!row) return { ok: false, error: 'No such profile' };
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE profiles SET salt = ?, code_hash = ? WHERE name = ?').run(salt, _hashCode(code, salt), name);
  return { ok: true };
}


module.exports = { listProfiles, createProfile, verifyProfile, deleteProfile, setIcon, getIcon, getIconById, setNameplateSkin, getNameplateSkin, getNameplateSkinById, renameProfile, setCode, setTitle, getTitle, TITLES, setVoiceTheme, getVoiceTheme, VOICE_THEMES, createRememberToken, verifyRememberToken, forgetRememberToken, getId, getNameById };
