'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Single shared SQLite database for every persistence module (profiles,
// economy, friends, history, stats) — one file instead of the five separate
// JSON files it replaces (profiles.json, coins.json, friends.json,
// game-history.json, player-stats.json — see server/migrate-json-to-sqlite.js
// for the one-time import of whatever's already in those). Built on Node's
// own node:sqlite (stable since Node 22.5, no flag needed from Node 23.4+ —
// see package.json's "engines") rather than an npm dependency like
// better-sqlite3, same "no extra dependency for something Node already
// ships" reasoning profiles.js gives for using crypto.scryptSync over
// bcrypt. Its API is synchronous, same as the fs.readFileSync/writeFileSync
// calls it replaces, so no module here has to change from sync to async.
//
// Same DATA_DIR env var as the JSON files it replaces (see profiles.js's own
// comment for why) — a deployment's persistent volume mount, ./data for
// local dev.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Lazy: nothing here touches disk until getDb() is actually called by one of
// the persistence modules' own functions — same as the old _load()/_save()
// only ever touching their JSON file inside a function body, never at
// require time. This matters for tests: achievements.test.js requires
// profiles.js only for its TITLES export and never sets DATA_DIR, so it must
// never end up creating/opening the real server/data/janshin.db as a side
// effect of that require — same reasoning room.test.js/bot.test.js get for
// free by requiring room.js, which pulls in stats.js/history.js/economy.js
// but never calls into them during those tests either.
let _db = null;

// Schema for every module's tables in one place — SQLite has no notion of
// "which file owns which table" the way five separate JSON files did, so the
// ownership comments live here instead: each block below is still exactly
// one module's own concern, just sharing one physical database file. No
// foreign keys between blocks — deliberately, so each module stays as
// independent of the others' schema as its JSON-file predecessor was (e.g.
// friends.js already only ever reads profiles.js through its public
// getNameById/getIconById functions, never its storage directly).
const SCHEMA = `
-- profiles.js — who's allowed to play as this name (salt + scrypt hash of
-- their unlock code; see that file's own comment for why). One row per
-- profile, keyed by the same stable 16-digit id every table below uses.
CREATE TABLE IF NOT EXISTS profiles (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  salt                TEXT NOT NULL,
  code_hash           TEXT NOT NULL,
  icon                TEXT NOT NULL DEFAULT 'default',
  title               TEXT NOT NULL DEFAULT 'Beginner',
  voice_theme         TEXT NOT NULL DEFAULT 'Default',
  nameplate_skin      TEXT NOT NULL DEFAULT 'default',
  call_style          TEXT NOT NULL DEFAULT 'default',
  remember_salt       TEXT,
  remember_token_hash TEXT
);

-- economy.js — the coin wallet. A clean flat-row fit, same fields the old
-- coins.json record kept per id.
CREATE TABLE IF NOT EXISTS coins (
  profile_id        TEXT PRIMARY KEY,
  balance           INTEGER NOT NULL DEFAULT 0,
  last_daily_bonus  TEXT NOT NULL DEFAULT '',
  earned_today      INTEGER NOT NULL DEFAULT 0,
  earned_today_date TEXT NOT NULL DEFAULT ''
);

-- friends.js — the social graph, normalized into three real tables instead
-- of three parallel JSON arrays (friends/incoming/outgoing) per profile.
-- Mutual edges are stored once per pair, canonically ordered id1<id2 (a
-- plain string comparison — ids are fixed-width 16-digit strings, so this
-- sorts identically to a numeric comparison) so "are A and B friends" is one
-- row regardless of which direction the friendship was viewed from.
CREATE TABLE IF NOT EXISTS friend_edges (
  id1 TEXT NOT NULL,
  id2 TEXT NOT NULL,
  PRIMARY KEY (id1, id2)
);
-- One row per pending request, direction preserved (from_id -> to_id) —
-- incoming for X is "WHERE to_id = X", outgoing is "WHERE from_id = X".
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id);
CREATE TABLE IF NOT EXISTS friend_notifications (
  nid       TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL,
  type      TEXT NOT NULL,
  from_id   TEXT NOT NULL,
  from_name TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  read      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_friend_notifications_owner ON friend_notifications(owner_id, ts DESC);

-- history.js — per-profile play history. Real columns for everything the
-- Play History list itself renders/sorts by; playerNames/finalScores/
-- placements/rounds stay JSON-encoded text columns since they're always
-- fetched and rendered whole, never queried field-by-field in SQL.
CREATE TABLE IF NOT EXISTS game_history (
  game_id      TEXT NOT NULL,
  profile_id   TEXT NOT NULL,
  date         TEXT NOT NULL,
  variant      TEXT NOT NULL,
  match_kind   TEXT NOT NULL,
  game_mode    TEXT NOT NULL,
  num_players  INTEGER NOT NULL,
  seat         INTEGER NOT NULL,
  player_names TEXT NOT NULL,
  final_scores TEXT NOT NULL,
  placements   TEXT NOT NULL,
  rounds       TEXT NOT NULL,
  PRIMARY KEY (game_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_game_history_profile ON game_history(profile_id, date DESC);

-- history.js — one move-by-move replay log per game (see replay.js for
-- the format), shared by every profile's game_history row for that game
-- rather than copied into each (it's the biggest thing stored per game,
-- and identical for every seat). Deleted once no game_history row
-- references its game_id any more (see history.js's _pruneReplays).
CREATE TABLE IF NOT EXISTS game_replays (
  game_id TEXT PRIMARY KEY,
  data    TEXT NOT NULL
);

-- history.js — the replay viewer's per-seat move review (analysis.js),
-- computed the first time a player opens a replay and cached here, since
-- it's the one expensive step (a full hand evaluation at every decision).
-- version is analysis.js's ANALYSIS_VERSION: bumping it there makes
-- every cached review stale, so improved analysis applies to old games too.
CREATE TABLE IF NOT EXISTS game_analysis (
  game_id TEXT NOT NULL,
  seat    INTEGER NOT NULL,
  version INTEGER NOT NULL,
  data    TEXT NOT NULL,
  PRIMARY KEY (game_id, seat)
);

-- history.js — "recently played with" graph, one row per (me, someone I
-- shared a table with), last_played bumped every time we play again. A
-- separate table from game_history on purpose: game_history stores only
-- player NAMES (renameable), while adding a friend from the Recently Played
-- tab needs the other player's stable id. Bounded per profile the same way
-- game_history is (see MAX_RECENT_OPPONENTS in history.js). Bots/guests are
-- never recorded — only real profiles have an id to key on.
CREATE TABLE IF NOT EXISTS recent_opponents (
  profile_id  TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  last_played INTEGER NOT NULL,
  PRIMARY KEY (profile_id, opponent_id)
);
CREATE INDEX IF NOT EXISTS idx_recent_opponents_profile ON recent_opponents(profile_id, last_played DESC);

-- stats.js — deliberately NOT decomposed into further tables. A profile's
-- stats record is a deeply nested, still-evolving shape (per-variant/per-
-- match-kind buckets, a rolling window of recent hands, dated period deltas,
-- dynamic per-yaku counts) that stats.js's own _normalize() already knows
-- how to backfill field-by-field as new fields get added over time.
-- Splitting that across a dozen normalized tables would mean re-deriving
-- _deriveWindowStats/getLeaderboard/achievements.js's own checks in SQL for
-- no real benefit — none of it is ever filtered or sorted by SQL today, only
-- ever loaded whole and computed over in JS (see stats.js's top-of-file
-- comment on why it re-reads everything on every call in the first place).
-- So: one row per profile, the exact same JSON shape _emptyStats() already
-- defines — same "load whole, mutate, save whole" pattern the JSON file it
-- replaces used, just inside a real database instead of a hand-rolled file,
-- which is what actually buys the transactional all-or-nothing write below
-- (see stats.js's _save) that a raw fs.writeFileSync could never guarantee.
CREATE TABLE IF NOT EXISTS stats (
  profile_id TEXT PRIMARY KEY,
  data       TEXT NOT NULL
);

-- cosmetics.js — which shop items a profile owns. Not folded into profiles
-- (which only ever holds the CURRENTLY EQUIPPED icon/title/voice_theme/
-- nameplate_skin, one value each) since ownership is a growing set, not a
-- single field — same "own table" reasoning as friend_edges above.
CREATE TABLE IF NOT EXISTS cosmetic_purchases (
  profile_id    TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  purchased_at  INTEGER NOT NULL,
  PRIMARY KEY (profile_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_cosmetic_purchases_profile ON cosmetic_purchases(profile_id);

-- feedback.js — player bug reports / contact messages from the About
-- panel's Contact form, read back in Developer Settings. profile_id is NULL
-- for a guest; name is a snapshot of the display name at send time so a
-- report stays readable after a rename.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  profile_id  TEXT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  version     TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT ''
);
`;

// A profiles table created while the email sign-up feature existed may
// still carry its extra columns (email, password_hash, verify_token_hash,
// etc.) and the idx_profiles_email unique index — nothing here drops them
// (SQLite ALTER TABLE DROP COLUMN is available but that's a one-way trip on
// whoever's real database happened to have email-registered accounts in
// it), they're just unused dead weight now that profiles.js no longer
// reads or writes any of them. A fresh install never creates them at all,
// since CREATE TABLE IF NOT EXISTS above only ever defines the plain
// name+code shape.
function getDb() {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new DatabaseSync(path.join(DATA_DIR, 'janshin.db'));
  // WAL: readers don't block the writer and vice versa — matters here
  // because a single Node process can have several in-flight requests
  // (different WebSocket connections) touching the database "concurrently"
  // (interleaved on the event loop) even though node:sqlite's own calls are
  // synchronous.
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec(SCHEMA);
  // CREATE TABLE IF NOT EXISTS above only shapes a FRESH profiles table —
  // an existing one (from before nameplate_skin/call_style existed) keeps whatever
  // columns it already had. ADD COLUMN is the one schema change that's safe
  // to apply after the fact (unlike dropping/renaming a column), so it's
  // done here unconditionally rather than versioning the schema — SQLite
  // has no ADD COLUMN IF NOT EXISTS, so a "duplicate column name" error
  // (meaning a previous boot already added it) is the expected steady state
  // and is swallowed; any other error still surfaces.
  for (const col of ["nameplate_skin TEXT NOT NULL DEFAULT 'default'", "call_style TEXT NOT NULL DEFAULT 'default'"]) {
    try {
      _db.exec('ALTER TABLE profiles ADD COLUMN ' + col);
    } catch (e) {
      if (!/duplicate column name/i.test(e.message || '')) throw e;
    }
  }
  return _db;
}

// Runs `fn(db)` inside a BEGIN/COMMIT, rolling back on any thrown error — so
// a multi-statement write (e.g. friends.js's sendRequest touching a request
// row, a notification row, and possibly a new friend edge all at once) can
// never land half-applied if the process crashes or a statement throws
// partway through. The old JSON-file modules had no equivalent: a crash
// mid-fs.writeFileSync could in principle truncate the file — see profiles.js
// and friends.js's own comments on that accepted (small-scale) risk.
function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { getDb, transaction, DATA_DIR };
