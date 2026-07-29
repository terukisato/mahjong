'use strict';
const fs = require('fs');
const path = require('path');
const { ACHIEVEMENTS, applyUnlocks, getProgressList } = require('./achievements');

// Plain JSON-file persistence, keyed by free-typed player name (there's no
// account system anywhere in this app, so names are trivially spoofable/
// collidable across players — an accepted limitation, not a bug). Re-read
// from disk on every call rather than cached in memory — writes only
// happen once per finished game, so the extra read is free, and caching
// across the whole process lifetime actively loses data: if the server
// process is ever restarted (nodemon reload, crash, or a second instance
// briefly overlapping the old one) while a game is in progress, the new
// process's cache reflects an older snapshot, and its next save would
// overwrite the file with that stale snapshot, silently erasing whatever
// another process wrote in the meantime.
const DATA_DIR = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'player-stats.json');

function _load() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function _save(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(all, null, 2));
}

// Sanma and yonma are scored on different scales (different starting
// points, different seat counts), so a single flat record mixing both
// together never produced meaningful Avg/Best Score comparisons — stats
// are kept in separate per-variant buckets instead. unlockedThemes/
// achievements stay top-level (not per-variant): they're account-wide
// unlocks, not tied to one game mode.
function _emptyVariantStats() {
  return {
    gamesPlayed: 0,
    gamesWon: 0,       // 1st-place finishes
    placements: [0, 0, 0, 0], // count of 1st/2nd/3rd/4th (index 3 unused in sanma)
    totalFinalScore: 0,
    handsWon: 0,
    tsumoWon: 0,
    ronWon: 0,
    riichiDeclared: 0,
    dealIns: 0,
    bestHan: 0,
    bestScore: 0,
    yaku: {},
  };
}

function _emptyStats() {
  return {
    yonma: _emptyVariantStats(),
    sanma: _emptyVariantStats(),
    unlockedThemes: ['Default'],
    unlockedTitles: ['Beginner'],
    achievements: {},
  };
}

// Backfills unlockedThemes/unlockedTitles/achievements onto a record saved
// before those fields existed, AND migrates a pre-variant-split record
// (flat gamesPlayed/gamesWon/etc. at the top level, no .yonma/.sanma) into
// the new shape — the old combined totals become .yonma (the default/most
// common mode) rather than being discarded, and .sanma starts fresh at
// zero since there's no way to know how much of the old total was sanma.
function _normalize(s) {
  if (!s.yonma || !s.sanma) {
    const legacy = {
      gamesPlayed: s.gamesPlayed || 0,
      gamesWon: s.gamesWon || 0,
      placements: s.placements || [0, 0, 0, 0],
      totalFinalScore: s.totalFinalScore || 0,
      handsWon: s.handsWon || 0,
      tsumoWon: s.tsumoWon || 0,
      ronWon: s.ronWon || 0,
      riichiDeclared: s.riichiDeclared || 0,
      dealIns: s.dealIns || 0,
      bestHan: s.bestHan || 0,
      bestScore: s.bestScore || 0,
      yaku: s.yaku || {},
    };
    s.yonma = s.yonma || legacy;
    s.sanma = s.sanma || _emptyVariantStats();
    delete s.gamesPlayed; delete s.gamesWon; delete s.placements; delete s.totalFinalScore;
    delete s.handsWon; delete s.tsumoWon; delete s.ronWon; delete s.riichiDeclared;
    delete s.dealIns; delete s.bestHan; delete s.bestScore; delete s.yaku;
  }
  if (!s.unlockedThemes) s.unlockedThemes = ['Default'];
  if (!s.unlockedTitles) s.unlockedTitles = ['Beginner'];
  if (!s.achievements) s.achievements = {};
  return s;
}

function _cloneVariant(v) {
  return { ...v, placements: [...v.placements], yaku: { ...v.yaku } };
}

function getStats(name) {
  const all = _load();
  const s = _normalize(all[name] || _emptyStats());
  return {
    yonma: _cloneVariant(s.yonma),
    sanma: _cloneVariant(s.sanma),
    unlockedThemes: [...s.unlockedThemes],
    unlockedTitles: [...s.unlockedTitles],
    achievements: { ...s.achievements },
    // One row per achievement (label/reward/current progress/earned) —
    // powers the Achievements panel (see renderAchievements in
    // public/script.js). Computed fresh from this profile's own stats
    // record, not persisted anywhere itself.
    achievementsInfo: getProgressList(s),
  };
}

// playerNames/isBot/isGuest/finalScores/placements/handStats are all
// seat-indexed arrays of the same length (3 or 4, depending on game mode)
// — that length doubles as which variant bucket this game's stats belong
// in, no separate variant argument needed. Bots, empty seats, and guests
// are all skipped — only a real unlocked profile accumulates persistent
// stats. isGuest defaults to an all-false array so callers that predate
// guests (none left, but just in case) don't need to pass it.
//
// Returns a seat-indexed array (null for any seat that unlocked nothing
// this game) of newly-earned achievement info — see room.js's
// _finishGame, which sends each seat's own entry to that player as an
// 'achievements_unlocked' message so the notification only ever shows the
// achievements THEY just earned, not their opponents'.
function recordGameResult({ playerNames, isBot, isGuest = [], finalScores, placements, handStats }) {
  const variant = playerNames.length === 3 ? 'sanma' : 'yonma';
  const all = _load();
  const newlyUnlocked = new Array(playerNames.length).fill(null);
  for (let seat = 0; seat < playerNames.length; seat++) {
    if (isBot[seat] || isGuest[seat]) continue;
    const name = playerNames[seat];
    if (!name) continue;
    const rec = _normalize(all[name] || _emptyStats());
    const s = rec[variant];
    s.gamesPlayed++;
    const place = placements[seat];
    if (place >= 1 && place <= 4) s.placements[place - 1]++;
    if (place === 1) s.gamesWon++;
    s.totalFinalScore += finalScores[seat];
    const hs = handStats[seat] || {};
    s.handsWon += hs.wins || 0;
    s.tsumoWon += hs.tsumo || 0;
    s.ronWon += hs.ron || 0;
    s.riichiDeclared += hs.riichi || 0;
    s.dealIns += hs.dealIn || 0;
    s.bestHan = Math.max(s.bestHan, hs.bestHan || 0);
    s.bestScore = Math.max(s.bestScore, hs.bestScore || 0);
    for (const [k, v] of Object.entries(hs.yaku || {})) s.yaku[k] = (s.yaku[k] || 0) + v;
    // Achievement checks see the whole record (both variants) — a "first
    // win" achievement, for instance, should trigger from either mode.
    const before = new Set(Object.keys(rec.achievements));
    applyUnlocks(rec);
    const newIds = Object.keys(rec.achievements).filter(id => !before.has(id));
    if (newIds.length) {
      newlyUnlocked[seat] = newIds.map(id => {
        const a = ACHIEVEMENTS.find(x => x.id === id);
        return { id, label: a.label, unlocksTitle: a.unlocksTitle || null, unlocksTheme: a.unlocksTheme || null };
      });
    }
    all[name] = rec;
  }
  _save(all);
  return newlyUnlocked;
}

// No query engine needed at this scale — just load everything and sort in
// JS. sortBy must be a numeric field on a variant stats record (gamesWon,
// gamesPlayed, bestScore, etc.); unknown fields sort everyone as equal (0).
function getLeaderboard(sortBy = 'gamesWon', variant = 'yonma') {
  const all = _load();
  const key = variant === 'sanma' ? 'sanma' : 'yonma';
  return Object.entries(all)
    .map(([name, raw]) => {
      const s = _normalize(raw)[key];
      return {
        name,
        gamesPlayed: s.gamesPlayed,
        gamesWon: s.gamesWon,
        totalFinalScore: s.totalFinalScore,
        bestScore: s.bestScore,
        bestHan: s.bestHan,
      };
    })
    .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
}

// Called alongside profiles.deleteProfile (see index.js's delete_profile) —
// removes the stats/achievements record too, so a deleted name doesn't
// linger on the leaderboard, and a later profile recreated under the same
// name starts fresh instead of inheriting the old one's unlocked themes.
function deleteStats(name) {
  const all = _load();
  if (all[name]) {
    delete all[name];
    _save(all);
  }
}

// Called alongside profiles.renameProfile (see index.js's 'change_username')
// so a renamed profile keeps its accumulated stats attached to it instead of
// starting over under the new name. No-op if the old name never played a
// game (nothing in this file to move).
function renameStats(oldName, newName) {
  const all = _load();
  if (all[oldName] && oldName !== newName) {
    all[newName] = all[oldName];
    delete all[oldName];
    _save(all);
  }
}

module.exports = { getStats, recordGameResult, getLeaderboard, deleteStats, renameStats };
