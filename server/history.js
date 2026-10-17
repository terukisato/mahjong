'use strict';
const { getDb } = require('./db');

// Per-profile play history — a separate table from stats.js's aggregate
// counters on purpose: stats.js answers "how has this player done overall"
// (running totals, never shrinking), while this table answers "what actually
// happened in each of their recent games" (a bounded, newest-first list of
// full game records, including every round's own result). Shares the same
// SQLite database as every other persistence module (see server/db.js) but
// only ever touches its own `game_history` table.
//
// How many past games are kept per profile — bounds the table's growth
// (unlike stats.js's running totals, a full game record with every round's
// hand/yaku/tile detail is not a handful of bytes) while still covering
// "what did I just play" far past what anyone realistically scrolls back
// through.
const MAX_GAMES_PER_PLAYER = 20;

// How many distinct "recently played with" opponents are kept per profile
// (see the recent_opponents table in db.js) — the Friends panel's Recently
// Played tab only ever shows the most recent handful, and an unbounded list
// of everyone a busy player has ever shared a table with is not worth
// keeping. Trimmed newest-first on write, same shape as MAX_GAMES_PER_PLAYER
// above.
const MAX_RECENT_OPPONENTS = 30;

// Called once per finished game (see room.js's _finishGame, right alongside
// its recordGameResult call) — same seat-indexed-array shape as that
// function's own args, plus `rounds`: the game's own list of round_end
// broadcasts (see room.js's roundHistory), unchanged from what players
// actually saw on the round-results screen, so the history detail view can
// just re-render them the exact same way.
// Bots/guests are skipped, same reasoning as stats.js's recordGameResult —
// only a real unlocked profile has anywhere to persist this.
//
// `replay` (optional) is room.js's move log for the whole game (see
// replay.js) — stored once in game_replays, not per profile row.
function recordGame({ playerIds, isBot, isGuest = [], variant, matchKind, gameMode, numPlayers, playerNames, finalScores, placements, rounds, replay = null }) {
  const db = getDb();
  const gameId = String(Date.now()) + Math.random().toString(36).slice(2, 8);
  const date = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO game_history
      (game_id, profile_id, date, variant, match_kind, game_mode, num_players, seat, player_names, final_scores, placements, rounds)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  // Trims THIS profile's rows down to the most recent MAX_GAMES_PER_PLAYER
  // by date — run right after each insert rather than as a separate sweep,
  // same "bounded per-player, checked on write" shape the old
  // list.length>MAX_GAMES_PER_PLAYER truncation had.
  const trim = db.prepare(`
    DELETE FROM game_history
    WHERE profile_id = ? AND game_id NOT IN (
      SELECT game_id FROM game_history WHERE profile_id = ? ORDER BY date DESC LIMIT ?
    )
  `);
  let stored = 0;
  for (let seat = 0; seat < playerIds.length; seat++) {
    if (isBot[seat] || isGuest[seat]) continue;
    const pid = playerIds[seat];
    if (!pid) continue;
    insert.run(gameId, pid, date, variant, matchKind, gameMode, numPlayers, seat,
      JSON.stringify(playerNames), JSON.stringify(finalScores), JSON.stringify(placements), JSON.stringify(rounds));
    trim.run(pid, pid, MAX_GAMES_PER_PLAYER);
    stored++;
  }
  // Only worth keeping if some profile can actually open it.
  if (replay && stored) {
    db.prepare('INSERT OR REPLACE INTO game_replays (game_id, data) VALUES (?,?)').run(gameId, JSON.stringify(replay));
  }
  if (stored) _pruneReplays(db);

  // "Recently played with" — every ordered pair of real-profile seats gets
  // an upsert bumping last_played, so the Recently Played tab can offer a
  // one-click friend request to anyone you just shared a table with. Only
  // real profiles (an id to key on, somewhere to persist it); bots/guests
  // skipped, same as the history rows above.
  const realIds = [];
  for (let seat = 0; seat < playerIds.length; seat++) {
    if (isBot[seat] || isGuest[seat] || !playerIds[seat]) continue;
    realIds.push(playerIds[seat]);
  }
  if (realIds.length > 1) {
    const now = Date.now();
    const bump = db.prepare(`
      INSERT INTO recent_opponents (profile_id, opponent_id, last_played) VALUES (?,?,?)
      ON CONFLICT(profile_id, opponent_id) DO UPDATE SET last_played = excluded.last_played
    `);
    const trimRecent = db.prepare(`
      DELETE FROM recent_opponents
      WHERE profile_id = ? AND opponent_id NOT IN (
        SELECT opponent_id FROM recent_opponents WHERE profile_id = ? ORDER BY last_played DESC LIMIT ?
      )
    `);
    for (const me of realIds) {
      for (const other of realIds) {
        if (me !== other) bump.run(me, other, now);
      }
      trimRecent.run(me, me, MAX_RECENT_OPPONENTS);
    }
  }
}

// [{id, lastPlayed}] newest-first — the ids a profile has most recently
// shared a table with. index.js hydrates each into name/icon/friend-status
// for the Friends panel's Recently Played tab.
function getRecentOpponents(id, limit = MAX_RECENT_OPPONENTS) {
  return getDb().prepare(`
    SELECT opponent_id, last_played FROM recent_opponents
    WHERE profile_id = ? ORDER BY last_played DESC LIMIT ?
  `).all(id, limit).map(r => ({ id: r.opponent_id, lastPlayed: r.last_played }));
}

// Summary rows only (no `rounds`) — powers the Play History list itself,
// which shows every past game's final score/placement without needing each
// one's full round-by-round detail up front. getGameDetail below fetches a
// single game's rounds on demand (the dropdown), so a client browsing the
// list never pays for data it isn't currently looking at.
function getHistory(id, limit = MAX_GAMES_PER_PLAYER) {
  const rows = getDb().prepare(`
    SELECT game_id, date, variant, match_kind, game_mode, num_players, seat, player_names, final_scores, placements,
      EXISTS (SELECT 1 FROM game_replays rp WHERE rp.game_id = game_history.game_id) AS has_replay
    FROM game_history WHERE profile_id = ? ORDER BY date DESC LIMIT ?
  `).all(id, limit);
  // hasReplay: false for games recorded before replays existed — the list
  // shows their Replay button disabled rather than opening an empty viewer.
  return rows.map(r => ({
    id: r.game_id, date: r.date, variant: r.variant, matchKind: r.match_kind, gameMode: r.game_mode,
    numPlayers: r.num_players, seat: r.seat,
    playerNames: JSON.parse(r.player_names), finalScores: JSON.parse(r.final_scores), placements: JSON.parse(r.placements),
    hasReplay: !!r.has_replay,
  }));
}

// Replays/reviews belong to a game, not a profile — once the per-profile
// trims above have dropped every game_history row for a game, nobody can
// open its replay any more, so it goes too.
function _pruneReplays(db) {
  db.prepare('DELETE FROM game_replays WHERE game_id NOT IN (SELECT game_id FROM game_history)').run();
  db.prepare('DELETE FROM game_analysis WHERE game_id NOT IN (SELECT game_id FROM game_history)').run();
}

// The replay viewer's payload for one game — the summary fields
// (names/scores/seat), each round's results card (`rounds`, shown at the
// end of each round in the viewer) and the move log, scoped to a profile that actually
// played it (same reasoning as getGameDetail below: a client can't open
// someone else's game by guessing its id). Returns {replay:null} for a game
// recorded before replays existed, and null when the profile has no such
// game at all.
function getReplay(profileId, gameId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT game_id, date, variant, match_kind, game_mode, num_players, seat, player_names, final_scores, placements, rounds
    FROM game_history WHERE profile_id = ? AND game_id = ?
  `).get(profileId, gameId);
  if (!row) return null;
  const rep = db.prepare('SELECT data FROM game_replays WHERE game_id = ?').get(gameId);
  return {
    id: row.game_id, date: row.date, variant: row.variant, matchKind: row.match_kind, gameMode: row.game_mode,
    numPlayers: row.num_players, seat: row.seat,
    playerNames: JSON.parse(row.player_names), finalScores: JSON.parse(row.final_scores),
    placements: JSON.parse(row.placements), rounds: JSON.parse(row.rounds),
    replay: rep ? JSON.parse(rep.data) : null,
  };
}

// Cached move review for one seat of one game (see game_analysis in db.js)
// — null when there's none yet, or it was made by an older analysis
// version than `version`.
function getCachedAnalysis(gameId, seat, version) {
  const row = getDb().prepare('SELECT version, data FROM game_analysis WHERE game_id = ? AND seat = ?').get(gameId, seat);
  if (!row || row.version !== version) return null;
  return JSON.parse(row.data);
}

function saveAnalysis(gameId, seat, version, data) {
  getDb().prepare('INSERT OR REPLACE INTO game_analysis (game_id, seat, version, data) VALUES (?,?,?,?)')
    .run(gameId, seat, version, JSON.stringify(data));
}

// One game's full round-by-round detail, looked up by the same `id`
// recordGame stamped on it — used by the Play History dropdown once a
// player expands a specific game, rather than shipping every game's rounds
// up front (see getHistory above).
function getGameDetail(profileId, gameId) {
  const row = getDb().prepare(`
    SELECT game_id, date, variant, match_kind, game_mode, num_players, seat, player_names, final_scores, placements, rounds
    FROM game_history WHERE profile_id = ? AND game_id = ?
  `).get(profileId, gameId);
  if (!row) return null;
  return {
    id: row.game_id, date: row.date, variant: row.variant, matchKind: row.match_kind, gameMode: row.game_mode,
    numPlayers: row.num_players, seat: row.seat,
    playerNames: JSON.parse(row.player_names), finalScores: JSON.parse(row.final_scores),
    placements: JSON.parse(row.placements), rounds: JSON.parse(row.rounds),
  };
}

// Companion to profiles.deleteProfile/stats.deleteStats (see index.js's
// 'delete_profile') — removes this profile's history too, so a deleted
// profile doesn't linger, and a later profile recreated under the same name
// (a brand-new id — see profiles.js) starts with none.
function deleteHistory(id) {
  const db = getDb();
  db.prepare('DELETE FROM game_history WHERE profile_id = ?').run(id);
  // Both directions — scrub this id out of everyone else's recent list too,
  // not just its own (same shared rows, not a per-side copy).
  db.prepare('DELETE FROM recent_opponents WHERE profile_id = ? OR opponent_id = ?').run(id, id);
  _pruneReplays(db);
}

// Developer-only, whole-table wipe — every profile's play history at once,
// not just one (see index.js's 'clear_all_history', gated by DEV_SECRET
// same as delete_profile). Profiles/stats/achievements are untouched; this
// only ever clears game_history.
function clearAllHistory() {
  const db = getDb();
  db.prepare('DELETE FROM game_history').run();
  db.prepare('DELETE FROM recent_opponents').run();
  db.prepare('DELETE FROM game_replays').run();
  db.prepare('DELETE FROM game_analysis').run();
}

module.exports = { recordGame, getHistory, getGameDetail, getReplay, getCachedAnalysis, saveAnalysis, getRecentOpponents, deleteHistory, clearAllHistory };
