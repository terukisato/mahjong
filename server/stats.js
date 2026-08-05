'use strict';
const fs = require('fs');
const path = require('path');
const { ACHIEVEMENTS, applyUnlocks, getProgressList } = require('./achievements');

// Plain JSON-file persistence, keyed by the profile's stable id (see
// profiles.js — never the display name, so renaming a profile never has to
// touch this file at all; a stray guest name is never a valid key here
// either, since recordGameResult below only ever gets called with a real
// profile's id). Re-read from disk on every call rather than cached in
// memory — writes only happen once per finished game, so the extra read is
// free, and caching across the whole process lifetime actively loses data:
// if the server process is ever restarted (nodemon reload, crash, or a
// second instance briefly overlapping the old one) while a game is in
// progress, the new process's cache reflects an older snapshot, and its
// next save would overwrite the file with that stale snapshot, silently
// erasing whatever another process wrote in the meantime.
// Same DATA_DIR env var as profiles.js — must resolve to the same directory
// as that file's, since both files need to sit together on whatever
// persistent volume a deployment mounts (see profiles.js's comment for why).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
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

// Companion to profiles.migrateLegacyIds() — this file used to be keyed by
// name too, moved in lockstep with a rename via the old renameStats(). Given
// the {oldName: newId} map profiles.js produced while upgrading itself,
// move any record still sitting under `oldName` here over to `newId`, once.
// A name with no matching entry here (never played a game) is just skipped.
function migrateToIds(nameToId) {
  const all = _load();
  let changed = false;
  for (const [name, id] of Object.entries(nameToId)) {
    if (all[name] && !all[id]) {
      all[id] = all[name];
      delete all[name];
      changed = true;
    }
  }
  if (changed) _save(all);
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

// Fills in any field _emptyVariantStats() defines that this particular
// saved record doesn't have — e.g. a record saved back when
// _emptyVariantStats() didn't have `yaku`/`placements`/`handsWon` yet.
// Field-by-field rather than all-or-nothing so a record that already has
// SOME of these (just not the newest one) keeps its real data for
// everything else instead of getting reset to zero across the board.
function _fillVariantDefaults(v) {
  const empty = _emptyVariantStats();
  for (const key of Object.keys(empty)) {
    if (v[key] === undefined) v[key] = empty[key];
  }
  return v;
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
  // Runs unconditionally, even when the branch above didn't (i.e. both
  // .yonma/.sanma already existed) — a record saved between the
  // variant-split landing and some LATER field (placements, yaku,
  // handsWon, ...) being added to _emptyVariantStats() would otherwise
  // keep missing that one field forever, since the migration branch above
  // only ever fires once per record (guarded on .yonma/.sanma existing at
  // all, not on having every current field). That gap is exactly what
  // made getLeaderboard's avgPlacement/yakumanCount blow up on
  // s.placements.reduce(...)/Object.entries(s.yaku) for older data —
  // silently failing the WHOLE leaderboard (every row is derived in one
  // pass — see getLeaderboard below), not just the one affected profile.
  s.yonma = _fillVariantDefaults(s.yonma);
  s.sanma = _fillVariantDefaults(s.sanma);
  if (!s.unlockedThemes) s.unlockedThemes = ['Default'];
  if (!s.unlockedTitles) s.unlockedTitles = ['Beginner'];
  if (!s.achievements) s.achievements = {};
  return s;
}

function _cloneVariant(v) {
  return { ...v, placements: [...v.placements], yaku: { ...v.yaku } };
}

function getStats(id) {
  const all = _load();
  const s = _normalize(all[id] || _emptyStats());
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

// playerIds/isBot/isGuest/finalScores/placements/handStats are all
// seat-indexed arrays of the same length (3 or 4, depending on game mode)
// — that length doubles as which variant bucket this game's stats belong
// in, no separate variant argument needed. Bots, empty seats, and guests
// are all skipped — only a real unlocked profile (a non-null id) accumulates
// persistent stats. isGuest defaults to an all-false array so callers that
// predate guests (none left, but just in case) don't need to pass it.
//
// Returns a seat-indexed array (null for any seat that unlocked nothing
// this game) of newly-earned achievement info — see room.js's
// _finishGame, which sends each seat's own entry to that player as an
// 'achievements_unlocked' message so the notification only ever shows the
// achievements THEY just earned, not their opponents'.
function recordGameResult({ playerIds, isBot, isGuest = [], finalScores, placements, handStats }) {
  const variant = playerIds.length === 3 ? 'sanma' : 'yonma';
  const all = _load();
  const newlyUnlocked = new Array(playerIds.length).fill(null);
  for (let seat = 0; seat < playerIds.length; seat++) {
    if (isBot[seat] || isGuest[seat]) continue;
    const id = playerIds[seat];
    if (!id) continue;
    const rec = _normalize(all[id] || _emptyStats());
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
    all[id] = rec;
  }
  _save(all);
  return newlyUnlocked;
}

// Every yaku name a completed hand can be scored under that's yakuman-tier
// (han 13 or 26 — see mahjong.js's ym() calls, the only place these exact
// names originate) — used below to derive a per-profile yakuman count out
// of the existing per-yaku tally (s.yaku), without needing a dedicated
// counter of its own. Single (13 han) and double (26 han) yakuman are
// combined into one count rather than split into two leaderboards — a
// double yakuman is still a yakuman, and the split would mostly just be
// two very short, mostly-empty lists given how rare either is.
const YAKUMAN_NAMES = new Set([
  'Tenhou', 'Chiihou', // dealer/non-dealer blessing-of-heaven/earth
  'Kokushi Musou', 'Kokushi Juusanmen', // thirteen orphans (+13-sided wait)
  'Ryuuiisou', 'Tsuuiisou', 'Chinroutou', // all green / all honors / all terminals
  'Chuuren Poutou', 'Junsei Chuuren', // nine gates (+pure/9-sided wait)
  'Suu Kantsu', // four kans
  'Suu Ankou', 'Suu Ankou Tanki', // four concealed triplets (+tanki wait)
  'Daisangen', // big three dragons
  'Shousuushii', 'Daisuushii', // small/big four winds
]);

// Below this many games played, an average-placement ranking is more noise
// than signal — a single lucky 1st-place finish reads as a flawless 1.00
// average, indistinguishable from (and ranked above) a veteran with
// hundreds of consistently-strong-but-not-perfect games. Every OTHER sort
// field here is a cumulative count/sum, not a rate, so this guard is only
// applied for 'avgPlacement' — more games can only help a total, but an
// average needs enough of them to mean anything.
const MIN_GAMES_FOR_AVG_PLACEMENT = 5;

// No query engine needed at this scale — just load everything, derive
// whatever the requested sort needs, and sort in JS. sortBy must be one of
// the fields on the mapped row below; an unrecognized one sorts everyone as
// equal (falls through the final `(b[sortBy]||0)-(a[sortBy]||0)` — see
// index.js's whitelist, which is what actually keeps this to known values).
// Returns `id`, not a display name — this file has no notion of names at
// all anymore (see the top-of-file comment); index.js's 'get_leaderboard'
// handler joins each entry against profiles.getNameById before it ever
// reaches the client.
function getLeaderboard(sortBy = 'totalFinalScore', variant = 'yonma') {
  const all = _load();
  const key = variant === 'sanma' ? 'sanma' : 'yonma';
  let rows = Object.entries(all)
    .map(([id, raw]) => {
      const s = _normalize(raw)[key];
      const yakumanCount = Object.entries(s.yaku)
        .reduce((n, [name, count]) => n + (YAKUMAN_NAMES.has(name) ? count : 0), 0);
      // Every game increments exactly one placements[] slot, so a genuine
      // record's four counts always sum to gamesPlayed exactly. A record
      // that predates placement tracking gets [0,0,0,0] from
      // _fillVariantDefaults (see _normalize) instead, which — left
      // unchecked — computes as a flawless 0.00 average (better than
      // always finishing 1st!) rather than "we don't actually know". This
      // check tells the two apart: only trust the average when the counts
      // add up to a real game history.
      const hasRealPlacementData = s.placements.reduce((a, b) => a + b, 0) === s.gamesPlayed;
      const avgPlacement = s.gamesPlayed > 0 && hasRealPlacementData
        ? s.placements.reduce((sum, count, i) => sum + count * (i + 1), 0) / s.gamesPlayed
        : null;
      return {
        id,
        gamesPlayed: s.gamesPlayed,
        gamesWon: s.gamesWon,
        totalFinalScore: s.totalFinalScore,
        bestScore: s.bestScore,
        bestHan: s.bestHan,
        handsWon: s.handsWon,
        yakumanCount,
        avgPlacement,
      };
    });
  if (sortBy === 'avgPlacement') {
    // Lower is better here (1st place = 1) — the only sort field that
    // sorts ascending instead of descending, and the only one that filters
    // rows out entirely rather than just ranking them last (see the
    // MIN_GAMES_FOR_AVG_PLACEMENT comment above for why a low-sample
    // average shouldn't be shown as ranked at all, not even at the bottom).
    return rows
      .filter(r => r.gamesPlayed >= MIN_GAMES_FOR_AVG_PLACEMENT && r.avgPlacement != null)
      .sort((a, b) => a.avgPlacement - b.avgPlacement);
  }
  return rows.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
}

// Called alongside profiles.deleteProfile (see index.js's delete_profile) —
// removes the stats/achievements record too, so a deleted profile doesn't
// linger on the leaderboard, and a later profile recreated under the same
// name starts fresh instead of inheriting the old one's unlocked themes
// (a fresh create_profile always gets a brand-new id, never the old one).
function deleteStats(id) {
  const all = _load();
  if (all[id]) {
    delete all[id];
    _save(all);
  }
}

// One-time maintenance helper (see scripts/backfill-achievements.js) —
// re-checks every existing profile's stored stats against the current
// achievement list and grants anything already satisfied by the numbers
// but never actually applied. This can happen because applyUnlocks only
// ever runs at the moment a game finishes (see recordGameResult above) —
// never independently re-evaluated otherwise — so a record whose numbers
// already qualify (e.g. imported/seeded data, or a game played before an
// achievement existed in the code) just sits there unrecognized until
// another game triggers a fresh check. Safe to run any number of times —
// applyUnlocks itself skips anything already granted. Returns
// {id: newlyGrantedAchievementIds[]} for just the records that changed.
function recheckAchievements() {
  const all = _load();
  const granted = {};
  let changed = false;
  for (const id of Object.keys(all)) {
    const rec = _normalize(all[id]);
    const before = new Set(Object.keys(rec.achievements));
    applyUnlocks(rec);
    const newIds = Object.keys(rec.achievements).filter(a => !before.has(a));
    if (newIds.length) {
      granted[id] = newIds;
      all[id] = rec;
      changed = true;
    }
  }
  if (changed) _save(all);
  return granted;
}

module.exports = { getStats, recordGameResult, getLeaderboard, deleteStats, migrateToIds, recheckAchievements };
