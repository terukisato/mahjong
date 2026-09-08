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
function recordGame({ playerIds, isBot, isGuest = [], variant, matchKind, gameMode, numPlayers, playerNames, finalScores, placements, rounds }) {
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
  for (let seat = 0; seat < playerIds.length; seat++) {
    if (isBot[seat] || isGuest[seat]) continue;
    const pid = playerIds[seat];
    if (!pid) continue;
    insert.run(gameId, pid, date, variant, matchKind, gameMode, numPlayers, seat,
      JSON.stringify(playerNames), JSON.stringify(finalScores), JSON.stringify(placements), JSON.stringify(rounds));
    trim.run(pid, pid, MAX_GAMES_PER_PLAYER);
  }

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
    SELECT game_id, date, variant, match_kind, game_mode, num_players, seat, player_names, final_scores, placements
    FROM game_history WHERE profile_id = ? ORDER BY date DESC LIMIT ?
  `).all(id, limit);
  return rows.map(r => ({
    id: r.game_id, date: r.date, variant: r.variant, matchKind: r.match_kind, gameMode: r.game_mode,
    numPlayers: r.num_players, seat: r.seat,
    playerNames: JSON.parse(r.player_names), finalScores: JSON.parse(r.final_scores), placements: JSON.parse(r.placements),
  }));
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
}

// Developer-only, whole-table wipe — every profile's play history at once,
// not just one (see index.js's 'clear_all_history', gated by DEV_SECRET
// same as delete_profile). Profiles/stats/achievements are untouched; this
// only ever clears game_history.
function clearAllHistory() {
  const db = getDb();
  db.prepare('DELETE FROM game_history').run();
  db.prepare('DELETE FROM recent_opponents').run();
}

module.exports = { recordGame, getHistory, getGameDetail, getRecentOpponents, deleteHistory, clearAllHistory };
