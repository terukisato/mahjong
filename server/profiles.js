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

// Called whenever the owner changes their icon in the User Profile panel
// (see 'set_profile_icon' in index.js, which requires this connection to
// already be unlocked as `name`) — persisted on the profile itself rather
// than just the browser's localStorage, so it's what the picker's cards
// show for this name on any device, before anyone even enters a code.
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

// ── Email sign-up ── a second way to create/unlock a profile, alongside the
// name+code path above. See server/db.js's PROFILE_EMAIL_COLUMNS comment for
// the columns this uses. A profile made this way still gets a real
// salt/code_hash (a random, never-shown 32-byte code — see _hashCode above),
// purely so it satisfies the same NOT NULL columns every other profile row
// does; nobody ever knows that code, so in practice this profile just has no
// working name+code login, only email+password.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SHA-256 of the raw token, not scrypt — unlike a password/code (low
// entropy, needs a slow hash to resist guessing), this token is 32 random
// bytes the caller already can't guess; a fast hash is enough to avoid ever
// storing it in the clear, and cheap to look up by.
function _hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Returns {ok:true,id,name,verifyToken} on success — verifyToken is the
// RAW token (only ever stored here as its hash); index.js is responsible for
// emailing it (or, in dev mode with no mail provider configured, just
// logging it — see server/mailer.js) and must never forward it to the
// browser in the signup_result/profile_unlocked response.
function signUpWithEmail(name, email, password, acceptedTerms) {
  name = String(name || '').trim().slice(0, 20);
  email = String(email || '').trim().toLowerCase().slice(0, 200);
  if (!name) return { ok: false, error: 'Name required' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address' };
  if (!password || String(password).length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
  if (!acceptedTerms) return { ok: false, error: 'You must agree to the Terms of Service and Privacy Policy' };
  const db = getDb();
  if (db.prepare('SELECT 1 FROM profiles WHERE name = ?').get(name)) {
    return { ok: false, error: 'A profile with that name already exists' };
  }
  if (db.prepare('SELECT 1 FROM profiles WHERE email = ?').get(email)) {
    return { ok: false, error: 'An account with that email already exists' };
  }
  const id = _generateId(db);
  const codeSalt = crypto.randomBytes(16).toString('hex');
  const unusedCode = crypto.randomBytes(32).toString('hex');
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyExpires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO profiles (
      id, name, salt, code_hash, icon, title, voice_theme,
      email, password_salt, password_hash, email_verified,
      verify_token_hash, verify_token_expires, terms_accepted_at
    ) VALUES (?,?,?,?,'default','Beginner','Default', ?,?,?,0, ?,?,?)
  `).run(
    id, name, codeSalt, _hashCode(unusedCode, codeSalt),
    email, passwordSalt, _hashCode(password, passwordSalt),
    _hashToken(verifyToken), verifyExpires, new Date().toISOString()
  );
  return { ok: true, id, name, verifyToken };
}

// Same shape as verifyProfile, but by email+password — returns the unlocked
// profile's {id,name,icon,title,voiceTheme,emailVerified} or null. Doesn't
// gate on emailVerified: with no real mail provider wired up yet (see
// server/mailer.js), refusing login until verified would lock a player out
// permanently, since they'd have no way to ever receive the link. index.js
// surfaces emailVerified to the client instead so the UI can nudge toward
// verifying without blocking play.
function verifyEmailLogin(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !password) return null;
  const row = getDb().prepare(
    'SELECT id, name, icon, title, voice_theme, password_salt, password_hash, email_verified FROM profiles WHERE email = ?'
  ).get(email);
  if (!row || !row.password_hash) return null;
  const candidate = Buffer.from(_hashCode(password, row.password_salt), 'hex');
  const actual = Buffer.from(row.password_hash, 'hex');
  if (candidate.length !== actual.length || !crypto.timingSafeEqual(candidate, actual)) return null;
  return { id: row.id, name: row.name, icon: row.icon || 'default', title: row.title, voiceTheme: row.voice_theme, emailVerified: !!row.email_verified };
}

// Checks a NAME + password against password_hash — mirrors verifyEmailLogin
// above, just keyed by name instead of email. Needed because an
// email-registered profile still HAS a display name, and login() below has
// to accept that name as the identifier too, not only its email.
function _verifyPasswordByName(name, password) {
  const row = getDb().prepare('SELECT password_salt, password_hash FROM profiles WHERE name = ?').get(name);
  if (!row || !row.password_hash) return false;
  const candidate = Buffer.from(_hashCode(password, row.password_salt), 'hex');
  const actual = Buffer.from(row.password_hash, 'hex');
  return candidate.length === actual.length && crypto.timingSafeEqual(candidate, actual);
}

// The single entry point the Log In form actually calls (see 'login' in
// server/index.js) — one "username or email" field plus one "password"
// field has to work for a name+code profile (the code IS the password, in
// that box), an email+password one addressed by its EMAIL, and an
// email+password one addressed by its NAME, without the player ever saying
// up front which kind of account or which identifier they're using. Tries
// whichever lookup the identifier looks more like first (an '@' means try
// email first), then falls back to the other — so a name that happens to
// contain '@' (unusual, but not disallowed by createProfile) still isn't
// permanently unreachable, it just costs one extra failed lookup. Returns
// the same {id,name,icon,title,voiceTheme,emailVerified} shape as
// verifyEmailLogin either way.
function login(identifier, secret) {
  identifier = String(identifier || '').trim();
  if (!identifier || !secret) return null;
  const byName = () => {
    const row = getDb().prepare('SELECT id, name, icon, title, voice_theme, email_verified FROM profiles WHERE name = ?').get(identifier);
    if (!row) return null;
    if (!verifyProfile(identifier, secret) && !_verifyPasswordByName(identifier, secret)) return null;
    return { id: row.id, name: row.name, icon: row.icon || 'default', title: row.title, voiceTheme: row.voice_theme, emailVerified: !!row.email_verified };
  };
  const byEmail = () => verifyEmailLogin(identifier, secret);
  return identifier.includes('@') ? (byEmail() || byName()) : (byName() || byEmail());
}

// Called from the /verify-email link (see server/index.js) — looks the
// profile up BY TOKEN (hashed), not by name/email, since that link carries
// nothing else identifying which account it's for. Expired or unknown tokens
// get the same generic error, same "don't help an attacker distinguish
// cases" reasoning as resendVerification below.
function verifyEmailToken(token) {
  if (!token) return { ok: false, error: 'Invalid or expired verification link' };
  const db = getDb();
  const row = db.prepare(
    'SELECT id, name, verify_token_expires FROM profiles WHERE verify_token_hash = ?'
  ).get(_hashToken(token));
  if (!row || !row.verify_token_expires || new Date(row.verify_token_expires) < new Date()) {
    return { ok: false, error: 'Invalid or expired verification link' };
  }
  db.prepare('UPDATE profiles SET email_verified = 1, verify_token_hash = NULL, verify_token_expires = NULL WHERE id = ?').run(row.id);
  return { ok: true, name: row.name };
}

// Re-issues a fresh verify token for an unverified email — always returns
// {ok:true} regardless of whether the email is registered/already verified,
// so this can't be used to probe which emails have accounts (an attacker
// watching responses learns nothing; index.js only actually emails/logs a
// link when there was something to send). Returns the raw token the same
// way signUpWithEmail does, for index.js to send — null when nothing was
// (re)generated.
function resendVerification(email) {
  email = String(email || '').trim().toLowerCase();
  const db = getDb();
  const row = db.prepare('SELECT id, email_verified FROM profiles WHERE email = ?').get(email);
  if (!row || row.email_verified) return { ok: true, verifyToken: null };
  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyExpires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE profiles SET verify_token_hash = ?, verify_token_expires = ? WHERE id = ?')
    .run(_hashToken(verifyToken), verifyExpires, row.id);
  return { ok: true, verifyToken };
}

// ── Forgot password ── same shape/reasoning as resendVerification above:
// always {ok:true}, so watching responses can't reveal which emails have
// accounts — index.js only actually emails a link when resetToken is
// non-null. A name+code-only profile (email IS NULL) can never match here,
// which is correct: there's no password to reset for one.
function requestPasswordReset(email) {
  email = String(email || '').trim().toLowerCase();
  const db = getDb();
  const row = db.prepare('SELECT id FROM profiles WHERE email = ?').get(email);
  if (!row) return { ok: true, resetToken: null };
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE profiles SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?')
    .run(_hashToken(resetToken), resetExpires, row.id);
  return { ok: true, resetToken };
}

// Called from the /reset-password form's POST (see server/index.js) — same
// look-up-BY-TOKEN pattern as verifyEmailToken, since that's all the
// request carries. On success, also drops any "stay logged in" token (same
// reasoning as setCode above: a token issued under the old password
// shouldn't keep working after this) and clears the reset token so the
// link can't be replayed.
function resetPassword(token, newPassword) {
  if (!token) return { ok: false, error: 'Invalid or expired reset link' };
  if (!newPassword || String(newPassword).length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
  const db = getDb();
  const row = db.prepare(
    'SELECT id, name, reset_token_expires FROM profiles WHERE reset_token_hash = ?'
  ).get(_hashToken(token));
  if (!row || !row.reset_token_expires || new Date(row.reset_token_expires) < new Date()) {
    return { ok: false, error: 'Invalid or expired reset link' };
  }
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  db.prepare(
    'UPDATE profiles SET password_salt = ?, password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL, remember_salt = NULL, remember_token_hash = NULL WHERE id = ?'
  ).run(passwordSalt, _hashCode(newPassword, passwordSalt), row.id);
  return { ok: true, name: row.name };
}

module.exports = { listProfiles, createProfile, verifyProfile, deleteProfile, setIcon, getIcon, getIconById, renameProfile, setCode, setTitle, getTitle, TITLES, setVoiceTheme, getVoiceTheme, VOICE_THEMES, createRememberToken, verifyRememberToken, forgetRememberToken, getId, getNameById, signUpWithEmail, verifyEmailLogin, verifyEmailToken, resendVerification, login, requestPasswordReset, resetPassword };
