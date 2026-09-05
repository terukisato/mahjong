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
`;

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
