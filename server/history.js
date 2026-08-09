'use strict';
const fs = require('fs');
const path = require('path');

// Per-profile play history — a separate file from stats.js's aggregate
// counters on purpose: stats.js answers "how has this player done overall"
// (running totals, never shrinking), while this file answers "what actually
// happened in each of their recent games" (a bounded, newest-first list of
// full game records, including every round's own result). Same plain-JSON
// approach and same DATA_DIR env var as stats.js/profiles.js — see either
// file's own comment for why (no real concurrency at this scale, and
// DATA_DIR lets a deployment point this at a persistent volume).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'game-history.json');

// How many past games are kept per profile — bounds the file's growth
// (unlike stats.js's running totals, a full game record with every round's
// hand/yaku/tile detail is not a handful of bytes) while still covering
// "what did I just play" far past what anyone realistically scrolls back
// through.
const MAX_GAMES_PER_PLAYER = 50;

function _load() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function _save(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(all, null, 2));
}

// Called once per finished game (see room.js's _finishGame, right alongside
// its recordGameResult call) — same seat-indexed-array shape as that
// function's own args, plus `rounds`: the game's own list of round_end
// broadcasts (see room.js's roundHistory), unchanged from what players
// actually saw on the round-results screen, so the history detail view can
// just re-render them the exact same way.
// Bots/guests are skipped, same reasoning as stats.js's recordGameResult —
// only a real unlocked profile has anywhere to persist this.
function recordGame({ playerIds, isBot, isGuest = [], variant, matchKind, gameMode, numPlayers, playerNames, finalScores, placements, rounds }) {
  const all = _load();
  const id16 = String(Date.now()) + Math.random().toString(36).slice(2, 8);
  const date = new Date().toISOString();
  for (let seat = 0; seat < playerIds.length; seat++) {
    if (isBot[seat] || isGuest[seat]) continue;
    const pid = playerIds[seat];
    if (!pid) continue;
    const list = all[pid] || (all[pid] = []);
    list.unshift({
      id: id16,
      date,
      variant,
      matchKind,
      gameMode,
      numPlayers,
      seat,
      playerNames,
      finalScores,
      placements,
      rounds,
    });
    if (list.length > MAX_GAMES_PER_PLAYER) list.length = MAX_GAMES_PER_PLAYER;
  }
  _save(all);
}

// Summary rows only (no `rounds`) — powers the Play History list itself,
// which shows every past game's final score/placement without needing each
// one's full round-by-round detail up front. getGameDetail below fetches a
// single game's rounds on demand (the dropdown), so a client browsing the
// list never pays for data it isn't currently looking at.
function getHistory(id, limit = MAX_GAMES_PER_PLAYER) {
  const list = _load()[id] || [];
  return list.slice(0, limit).map(({ rounds, ...summary }) => summary);
}

// One game's full round-by-round detail, looked up by the same `id`
// recordGame stamped on it — used by the Play History dropdown once a
// player expands a specific game, rather than shipping every game's rounds
// up front (see getHistory above).
function getGameDetail(profileId, gameId) {
  const list = _load()[profileId] || [];
  return list.find(g => g.id === gameId) || null;
}

// Companion to profiles.deleteProfile/stats.deleteStats (see index.js's
// 'delete_profile') — removes this profile's history too, so a deleted
// profile doesn't linger, and a later profile recreated under the same name
// (a brand-new id — see profiles.js) starts with none.
function deleteHistory(id) {
  const all = _load();
  if (all[id]) {
    delete all[id];
    _save(all);
  }
}

module.exports = { recordGame, getHistory, getGameDetail, deleteHistory };
