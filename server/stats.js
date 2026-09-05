'use strict';
const { getDb, transaction } = require('./db');
const { ACHIEVEMENTS, applyUnlocks, getProgressList } = require('./achievements');

// SQLite-backed persistence (see server/db.js's `stats` table and its own
// schema comment for why this file is kept as one JSON blob per profile
// rather than decomposed into further tables), keyed by the profile's
// stable id (see profiles.js — never the display name, so renaming a
// profile never has to touch this table at all; a stray guest name is never
// a valid key here either, since recordGameResult below only ever gets
// called with a real profile's id).
//
// _load()/_save() re-read/rewrite EVERY profile's record on every call,
// same as the JSON file this replaces — see getLeaderboard/
// getPeriodLeaderboard below, which both need every profile's row anyway to
// rank them, and recordGameResult, which only ever touches a handful of
// rows (this game's own seats) but historically saved the whole set back in
// one go. _save's INSERT...ON CONFLICT loop runs inside one transaction
// (see server/db.js's transaction()), so a multi-profile update from a
// single finished game either lands entirely or not at all — something a
// raw fs.writeFileSync of the old JSON file could never guarantee if the
// process died mid-write.
function _load() {
  const rows = getDb().prepare('SELECT profile_id, data FROM stats').all();
  const all = {};
  for (const row of rows) all[row.profile_id] = JSON.parse(row.data);
  return all;
}

function _save(all) {
  transaction(db => {
    const upsert = db.prepare(`
      INSERT INTO stats (profile_id, data) VALUES (?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET data = excluded.data
    `);
    for (const [id, rec] of Object.entries(all)) upsert.run(id, JSON.stringify(rec));
  });
}

// The full set of accumulable per-match-kind fields — shared shape for both
// the top-level (aggregate, both match kinds combined — what getLeaderboard
// reads) and each variant's byMatchKind.quick/.room sub-buckets (what the
// My Stats panel's quick/room tabs read — see renderStatsBlock in
// script.js). handsPlayed/huro/busts are the newer additions alongside
// dealIns' rate-stat siblings (hora%/tsumo%/huro%/riichi%/bust% — see
// getLeaderboard below).
function _emptyMatchKindStats() {
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
    handsPlayed: 0, // hands dealt, win/draw/abortive-draw all count — see room.js's g.handsPlayed
    huro: 0,        // hands where this player's own hand went open (pon/chi/open kan) at some point
    busts: 0,       // games ended by this player going bankrupt ("tobi")
    bestHan: 0,
    bestScore: 0,        // largest single-HAND payout (tsumo/ron), not a game's final score
    bestFinalScore: 0,   // largest GAME-ENDING score — see the 100k/105k point-milestone achievements
    doubleBustWins: 0,   // tsumo wins that bankrupted 2+ opponents at once (sanma-only achievement)
    quadKita: 0,         // banked all 4 of a round's kita tiles single-handedly (sanma-only achievement)
    yaku: {},
    // Rolling window of this bucket's most recent hands (see
    // ROUND_WINDOW_SIZE/_pushRound/recordGameResult below) — every OTHER
    // field above is a lifetime running total (used by achievements.js,
    // which needs numbers that never shrink) and is left completely alone
    // by the windowing logic; this is the only field it actually writes
    // to. getStats/getLeaderboard derive the numbers actually shown in
    // Rankings/My Stats from this array instead of the lifetime fields —
    // see _deriveWindowStats.
    recentRounds: [],
  };
}

// Sanma and yonma are scored on different scales (different starting
// points, different seat counts), so a single flat record mixing both
// together never produced meaningful Avg/Best Score comparisons — stats
// are kept in separate per-variant buckets instead. unlockedThemes/
// achievements stay top-level (not per-variant): they're account-wide
// unlocks, not tied to one game mode.
//
// Each variant also carries byMatchKind.quick/.room — the same shape again,
// split by whether the game was a quick_match (vs. bots) or a create_room/
// join_room match (see Room.matchKind in room.js). This split is ONLY
// surfaced in the My Stats panel (see the quick/room tabs in
// renderStatsBlock, script.js) — the Rankings leaderboard (getLeaderboard
// below) intentionally stays combined, reading the top-level aggregate.
function _emptyVariantStats() {
  return {
    ..._emptyMatchKindStats(),
    byMatchKind: { quick: _emptyMatchKindStats(), room: _emptyMatchKindStats() },
    // Weekly/Monthly Rankings — one DATED delta per game (see
    // recordGameResult's push below and getPeriodLeaderboard), separate
    // from recentRounds above: that one is a fixed-COUNT rolling window
    // (last 100 hands, whatever span of time that happens to cover), this
    // one needs every game inside a real calendar week/month however many
    // that is, so it has to be bounded by DATE instead (see
    // _prunePeriodGames) — a count-based cap could silently drop games
    // still inside the current period for an active player. Combined
    // only, same as the top-level fields above (not split per
    // byMatchKind) — Weekly/Monthly Rankings reads the same combined
    // aggregate All Time Rankings already does.
    periodGames: [],
  };
}

function _emptyStats() {
  return {
    yonma: _emptyVariantStats(),
    sanma: _emptyVariantStats(),
    unlockedThemes: ['Default'],
    unlockedTitles: ['Beginner'],
    // 'tea' (Table Tea, the original default in-game track) is always
    // available — everything else in public/script.js's gameTracks list is
    // earned via an achievement's `unlocksTrack` (see achievements.js).
    unlockedTracks: ['tea'],
    achievements: {},
    // Consecutive-hands-without-dealing-in streak — combined across both
    // variants (a deal-in in either resets it) since it's account-wide like
    // achievements/unlocks, not a per-variant stat — see the 'safe_player_*'
    // achievements in achievements.js, the only things that read these.
    // Not surfaced anywhere in the UI (My Stats/Rankings), purely bookkeeping
    // for those achievement checks. currentNoDealInStreak persists across
    // games (unlike everything windowed/derived elsewhere in this file);
    // bestNoDealInStreak is the lifetime high-water mark, same "never
    // shrinks" shape achievements.js's other lifetime counters rely on.
    currentNoDealInStreak: 0,
    bestNoDealInStreak: 0,
    // Consecutive 1st-place GAME finishes — same account-wide shape/
    // reasoning as currentNoDealInStreak/bestNoDealInStreak just above
    // (winning in yonma then switching to sanma still extends the streak),
    // but unlike that pair, THIS one IS surfaced in the UI: My Stats (see
    // renderStats in script.js), Rankings (bestWinStreak is one of
    // VALID_LEADERBOARD_SORTS in server/index.js), and the in-game
    // nameplate popover (currentWinStreak, via get_player_stats' `combined`
    // field). Updated once per GAME (on `place`), not per hand — see
    // recordGameResult below — unlike the no-deal-in streak, which is
    // walked per hand.
    currentWinStreak: 0,
    bestWinStreak: 0,
  };
}

// Fills in any field _emptyMatchKindStats() defines that this particular
// saved sub-record doesn't have yet (a byMatchKind.quick/.room bucket saved
// before a newer field like `busts` existed) — same field-by-field
// reasoning as _fillVariantDefaults below.
function _fillMatchKindDefaults(mk) {
  const empty = _emptyMatchKindStats();
  mk = mk || {};
  for (const key of Object.keys(empty)) {
    if (mk[key] === undefined) mk[key] = empty[key];
  }
  return mk;
}

// Fills in any field _emptyVariantStats() defines that this particular
// saved record doesn't have — e.g. a record saved back when
// _emptyVariantStats() didn't have `yaku`/`placements`/`handsWon` yet.
// Field-by-field rather than all-or-nothing so a record that already has
// SOME of these (just not the newest one) keeps its real data for
// everything else instead of getting reset to zero across the board.
function _fillVariantDefaults(v) {
  const empty = _emptyMatchKindStats();
  for (const key of Object.keys(empty)) {
    if (v[key] === undefined) v[key] = empty[key];
  }
  if (!v.byMatchKind) {
    // Predates the quick/room split entirely — there's no way to know
    // which of this profile's past games were quick_match vs. custom
    // rooms, so the whole existing aggregate is attributed to 'quick'
    // wholesale (the far more common mode — a room match needs a second
    // human to actually join) rather than discarded or guess-split.
    // 'room' starts fresh at zero.
    v.byMatchKind = {
      quick: {
        gamesPlayed: v.gamesPlayed, gamesWon: v.gamesWon,
        placements: [...v.placements], totalFinalScore: v.totalFinalScore,
        handsWon: v.handsWon, tsumoWon: v.tsumoWon, ronWon: v.ronWon,
        riichiDeclared: v.riichiDeclared, dealIns: v.dealIns,
        handsPlayed: v.handsPlayed, huro: v.huro, busts: v.busts,
        bestHan: v.bestHan, bestScore: v.bestScore,
        bestFinalScore: v.bestFinalScore, doubleBustWins: v.doubleBustWins,
        yaku: { ...v.yaku },
      },
      room: _emptyMatchKindStats(),
    };
  } else {
    v.byMatchKind.quick = _fillMatchKindDefaults(v.byMatchKind.quick);
    v.byMatchKind.room = _fillMatchKindDefaults(v.byMatchKind.room);
  }
  // Predates Weekly/Monthly Rankings — no games from before this shipped
  // have a date on them, so there's nothing to backfill; it just starts
  // empty and fills in from here on.
  if (!v.periodGames) v.periodGames = [];
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
  if (!s.unlockedTracks) s.unlockedTracks = ['tea'];
  if (!s.achievements) s.achievements = {};
  if (s.currentNoDealInStreak === undefined) s.currentNoDealInStreak = 0;
  if (s.bestNoDealInStreak === undefined) s.bestNoDealInStreak = 0;
  if (s.currentWinStreak === undefined) s.currentWinStreak = 0;
  if (s.bestWinStreak === undefined) s.bestWinStreak = 0;
  return s;
}

// How many of a profile's most recent HANDS (not games — see
// _extractSeatRound below) feed the windowed numbers Rankings/My Stats
// actually display. Deliberately short, unlike the lifetime totals
// achievements.js checks (see _emptyMatchKindStats' recentRounds comment)
// — this is meant to read as "how you're playing lately", not a career
// total.
const ROUND_WINDOW_SIZE = 100;

// Appends one round to a rolling window, trimming from the front once it's
// over ROUND_WINDOW_SIZE long — used for every recentRounds array
// (top-level per variant, and each of its byMatchKind buckets).
function _pushRound(arr, entry) {
  arr.push(entry);
  if (arr.length > ROUND_WINDOW_SIZE) arr.splice(0, arr.length - ROUND_WINDOW_SIZE);
}

// Drops periodGames entries too old for ANY currently-relevant Weekly/
// Monthly query to still need — keeps that array from growing forever
// without ever discarding something getPeriodLeaderboard might still read.
// A calendar week can span two different months (e.g. Aug 28 – Sep 3), so
// "the start of THIS month" alone isn't a safe cutoff for a 'week' query
// made right after a month boundary — going back to the start of the
// PREVIOUS calendar month is always safe for both 'week' and 'month'.
// Entries are always appended in chronological order (see
// recordGameResult), so trimming from the front is enough — no full-array
// re-scan needed.
function _prunePeriodGames(arr) {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  let i = 0;
  while (i < arr.length && arr[i].date < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

// One roundHistory entry (see room.js's _recordRoundHistory) reduced to
// just what ONE seat needs for its rolling window. Every field mirrors the
// exact same condition the lifetime accumulation in recordGameResult below
// (and room.js's own _recordHandWin/_initRound) uses for the equivalent
// lifetime counter, so windowed numbers agree with lifetime ones in shape,
// just over a shorter span. `gameFinal` is attached by the caller (only on
// each game's own last round) rather than here — this function only knows
// about one round, not the whole game's outcome.
// Known gap: extraWinners (multi-ron) never got their own yakuList
// broadcast (see room.js's roundEndPayload) — same gap the lifetime yaku
// tally already has, not new here.
function _extractSeatRound(round, seat) {
  const isPrimaryWinner = round.winner === seat && (round.reason === 'tsumo' || round.reason === 'ron');
  const extraWin = (round.extraWinners || []).find(r => r.winSeat === seat);
  return {
    win: isPrimaryWinner || !!extraWin,
    tsumo: round.reason === 'tsumo' && isPrimaryWinner,
    ron: round.reason === 'ron' && (isPrimaryWinner || !!extraWin),
    dealIn: round.reason === 'ron' && round.loser === seat,
    riichi: !!(round.riichiSeats && round.riichiSeats[seat]),
    huro: !!(round.openSeats && round.openSeats[seat]),
    han: isPrimaryWinner ? (round.han || 0) : (extraWin ? (extraWin.han || 0) : null),
    score: isPrimaryWinner ? (round.payment || 0) : (extraWin ? (extraWin.pay || 0) : null),
    yaku: isPrimaryWinner ? (round.yakuList || []) : [],
    gameFinal: null,
  };
}

// Folds a bucket's rolling window into the same shape _emptyMatchKindStats
// defines — this is what getStats/getLeaderboard actually hand back for
// gamesPlayed/handsWon/etc, computed fresh from the window on every read
// (nothing windowed is persisted) rather than kept in sync incrementally.
// doubleBustWins stays 0 — not derivable per-round (see room.js's
// _endRound; it's a computed side-effect at the moment of a tsumo, not
// part of the round payload itself) — harmless, since nothing in the UI
// displays it and achievements.js reads the real lifetime figure directly
// off the unwindowed record instead.
function _deriveWindowStats(entries) {
  const out = _emptyMatchKindStats();
  out.handsPlayed = entries.length;
  const games = new Map(); // gameId -> that game's own final outcome
  for (const e of entries) {
    if (e.win) out.handsWon++;
    if (e.tsumo) out.tsumoWon++;
    if (e.ron) out.ronWon++;
    if (e.riichi) out.riichiDeclared++;
    if (e.dealIn) out.dealIns++;
    if (e.huro) out.huro++;
    if (e.han != null) out.bestHan = Math.max(out.bestHan, e.han);
    if (e.score != null) out.bestScore = Math.max(out.bestScore, e.score);
    for (const y of e.yaku) out.yaku[y.name] = (out.yaku[y.name] || 0) + 1;
    if (e.gameFinal && !games.has(e.gameFinal.gameId)) games.set(e.gameFinal.gameId, e.gameFinal);
  }
  for (const gf of games.values()) {
    out.gamesPlayed++;
    if (gf.placement === 1) out.gamesWon++;
    if (gf.placement >= 1 && gf.placement <= 4) out.placements[gf.placement - 1]++;
    out.totalFinalScore += gf.finalScore;
    out.bestFinalScore = Math.max(out.bestFinalScore, gf.finalScore);
    if (gf.isBust) out.busts++;
  }
  return out;
}

// Lifetime view of one byMatchKind bucket, for the client — a plain clone
// (own copies of placements/yaku so a caller mutating the response can't
// corrupt the stored record) plus its own windowed rates (see
// _deriveWindowStats), MINUS the internal recentRounds log itself, which
// is bookkeeping only, never rendered.
function _matchKindView(mk) {
  // periodGames only ever exists on the top-level variant object (see
  // _emptyVariantStats — it's combined-only, not per-byMatchKind bucket),
  // so it's undefined/a no-op here when mk is actually a byMatchKind
  // sub-bucket; stripped either way since Weekly/Monthly Rankings reads it
  // straight off the stored record server-side (getPeriodLeaderboard), not
  // through this client-facing view.
  const { recentRounds, periodGames, ...rest } = mk;
  return { ...rest, placements: [...mk.placements], yaku: { ...mk.yaku }, windowed: _deriveWindowStats(recentRounds) };
}

// A variant's full client-facing view: every accumulating/"best ever"
// number (gamesPlayed, handsWon, bestHan, yaku counts, ...) stays the real
// lifetime total, unchanged and uncapped — those are meaningful as
// standing records, and achievements.js already depends on them never
// shrinking. `windowed` alongside carries the SAME shape recomputed from
// just the last 100 rounds (see _deriveWindowStats) — the client uses that
// one only for its rate/average rows (Hora/Tsumo/Huro/Riichi/Deal-In/
// Bankruptcy Rate, Avg Final Score, Avg Placement), where a whole-career
// average would barely move game to game and stop reflecting recent form.
function _variantView(v) {
  return {
    ..._matchKindView(v),
    byMatchKind: {
      quick: _matchKindView(v.byMatchKind.quick),
      room: _matchKindView(v.byMatchKind.room),
    },
  };
}

function getStats(id) {
  const all = _load();
  const s = _normalize(all[id] || _emptyStats());
  return {
    yonma: _variantView(s.yonma),
    sanma: _variantView(s.sanma),
    unlockedThemes: [...s.unlockedThemes],
    unlockedTitles: [...s.unlockedTitles],
    unlockedTracks: [...s.unlockedTracks],
    achievements: { ...s.achievements },
    // Account-wide, not per-variant — see the field's own comment on
    // _emptyStats for why. Surfaced in My Stats (renderStats, script.js).
    currentWinStreak: s.currentWinStreak,
    bestWinStreak: s.bestWinStreak,
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
function recordGameResult({ playerIds, isBot, isGuest = [], finalScores, placements, handStats, handsPlayed = 0, bustedSeat = -1, matchKind = 'room', rounds = [] }) {
  const variant = playerIds.length === 3 ? 'sanma' : 'yonma';
  const kind = matchKind === 'quick' ? 'quick' : 'room';
  const all = _load();
  const newlyUnlocked = new Array(playerIds.length).fill(null);
  // Shared across every seat's rolling-window entries below, purely so
  // _deriveWindowStats can tell "these entries came from the same game"
  // apart when counting windowed gamesPlayed/placements/etc — never
  // written anywhere, never compared against history.js's own per-game id
  // (that file generates its own, independently — see recordGame).
  const gameId = String(Date.now()) + Math.random().toString(36).slice(2, 8);
  for (let seat = 0; seat < playerIds.length; seat++) {
    if (isBot[seat] || isGuest[seat]) continue;
    const id = playerIds[seat];
    if (!id) continue;
    const rec = _normalize(all[id] || _emptyStats());
    const s = rec[variant];
    const place = placements[seat];
    const hs = handStats[seat] || {};
    // Win streak (see currentWinStreak/bestWinStreak on _emptyStats) —
    // once per GAME, unlike the no-deal-in streak's per-hand walk further
    // below, since a "win" here means the whole match, not a single hand.
    if (place === 1) {
      rec.currentWinStreak++;
      if (rec.currentWinStreak > rec.bestWinStreak) rec.bestWinStreak = rec.currentWinStreak;
    } else if (place >= 1 && place <= 4) {
      // Only a real, known placement (1-4) ends the streak — an aborted/
      // unscored game (place falling outside that range) shouldn't zero out
      // a streak the player didn't actually lose.
      rec.currentWinStreak = 0;
    }
    // Every counter below is accumulated twice — once into the top-level
    // aggregate (both match kinds combined, what getLeaderboard reads) and
    // once into this game's matching byMatchKind sub-bucket (what the My
    // Stats panel's quick/room tabs read) — see the two buckets' shared
    // shape in _emptyMatchKindStats.
    for (const bucket of [s, s.byMatchKind[kind]]) {
      bucket.gamesPlayed++;
      if (place >= 1 && place <= 4) bucket.placements[place - 1]++;
      if (place === 1) bucket.gamesWon++;
      bucket.totalFinalScore += finalScores[seat];
      bucket.handsWon += hs.wins || 0;
      bucket.tsumoWon += hs.tsumo || 0;
      bucket.ronWon += hs.ron || 0;
      bucket.riichiDeclared += hs.riichi || 0;
      bucket.dealIns += hs.dealIn || 0;
      bucket.handsPlayed += handsPlayed;
      bucket.huro += hs.huro || 0;
      if (seat === bustedSeat) bucket.busts++;
      bucket.doubleBustWins += hs.doubleBust || 0;
      bucket.quadKita += hs.quadKita || 0;
      bucket.bestHan = Math.max(bucket.bestHan, hs.bestHan || 0);
      bucket.bestScore = Math.max(bucket.bestScore, hs.bestScore || 0);
      bucket.bestFinalScore = Math.max(bucket.bestFinalScore, finalScores[seat]);
      for (const [k, v] of Object.entries(hs.yaku || {})) bucket.yaku[k] = (bucket.yaku[k] || 0) + v;
    }
    // Rolling "last 100 rounds" window (see recentRounds on
    // _emptyMatchKindStats, and _deriveWindowStats/getStats/getLeaderboard
    // below, which are the only things that ever read this) — one entry
    // per round this seat actually played this game, with the game's own
    // final outcome attached to the LAST one (see _extractSeatRound's
    // gameFinal field) so windowed gamesPlayed/placements/totalFinalScore
    // count this game exactly once, not once per round. Pushed into both
    // the top-level window and this game's matching byMatchKind window,
    // same dual-bucket shape the lifetime counters above use.
    const seatRounds = rounds.map(r => _extractSeatRound(r, seat));
    if (seatRounds.length) {
      seatRounds[seatRounds.length - 1].gameFinal = { placement: place, finalScore: finalScores[seat], isBust: seat === bustedSeat, gameId };
    }
    for (const entry of seatRounds) {
      _pushRound(s.recentRounds, entry);
      _pushRound(s.byMatchKind[kind].recentRounds, entry);
    }
    // Consecutive-hands-without-dealing-in streak (see currentNoDealInStreak/
    // bestNoDealInStreak on _emptyStats) — walked in the same chronological
    // order as the rolling-window push above, but onto `rec` (top-level,
    // combined across variants) rather than `s` (this variant only), so a
    // deal-in in yonma resets a streak built up in sanma and vice versa.
    for (const entry of seatRounds) {
      if (entry.dealIn) rec.currentNoDealInStreak = 0;
      else rec.currentNoDealInStreak++;
      if (rec.currentNoDealInStreak > rec.bestNoDealInStreak) rec.bestNoDealInStreak = rec.currentNoDealInStreak;
    }
    // Weekly/Monthly Rankings — this one game's own numbers (not a running
    // total, unlike the dual-bucket loop above; getPeriodLeaderboard sums
    // matching entries itself, filtered by date) tagged with a real
    // timestamp, combined only (no byMatchKind split — see periodGames'
    // own comment on _emptyVariantStats). Pruned by date after every
    // push, not by count, since a real calendar week/month needs every
    // game inside it regardless of how many that turns out to be.
    s.periodGames.push({
      date: new Date().toISOString(),
      gamesPlayed: 1,
      gamesWon: place === 1 ? 1 : 0,
      placements: [1, 2, 3, 4].map(p => (p === place ? 1 : 0)),
      totalFinalScore: finalScores[seat],
      handsWon: hs.wins || 0,
      tsumoWon: hs.tsumo || 0,
      ronWon: hs.ron || 0,
      riichiDeclared: hs.riichi || 0,
      dealIns: hs.dealIn || 0,
      handsPlayed,
      huro: hs.huro || 0,
      busts: seat === bustedSeat ? 1 : 0,
      bestHan: hs.bestHan || 0,
      bestScore: hs.bestScore || 0,
      bestFinalScore: finalScores[seat],
      doubleBustWins: hs.doubleBust || 0,
      quadKita: hs.quadKita || 0,
      yaku: { ...(hs.yaku || {}) },
    });
    _prunePeriodGames(s.periodGames);
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
  // Kazoe Yakuman — reaches yakuman-tier han (13+) by stacking regular yaku
  // + dora rather than any single named yakuman (see room.js's
  // _buildYakuList). Was missing here despite being in achievements.js's
  // own copy of this same name list, so a Kazoe Yakuman win correctly
  // unlocked the 'Counted Divinity' achievement but never counted toward
  // this leaderboard's Yakuman Count column.
  'Kazoe Yakuman',
]);

// Below this many games played, an average-placement ranking is more noise
// than signal — a single lucky 1st-place finish reads as a flawless 1.00
// average, indistinguishable from (and ranked above) a veteran with
// hundreds of consistently-strong-but-not-perfect games. Every OTHER sort
// field here is a cumulative count/sum, not a rate, so this guard is only
// applied for 'avgPlacement' — more games can only help a total, but an
// average needs enough of them to mean anything.
const MIN_GAMES_FOR_AVG_PLACEMENT = 5;

// Same noise-vs-signal reasoning as MIN_GAMES_FOR_AVG_PLACEMENT above, but
// keyed on hands (dealIns' own denominator) rather than games — a single
// hand played and dealt into reads as a flawless-looking (well, worst-
// looking) 100% rate, not a real trend.
const MIN_HANDS_FOR_DEAL_IN_RATE = 5;

// Shared row-shaping for both getLeaderboard (below) and
// getPeriodLeaderboard (further below) — `s` supplies every raw-count
// column (gamesPlayed, gamesWon, totalFinalScore, bestScore, bestHan,
// handsWon, yakumanCount), `w` supplies avgPlacement/dealInRate's inputs.
// The two callers pass different things for these: getLeaderboard passes
// lifetime totals for `s` and the last-100-rounds window for `w` (a
// lifetime average/rate barely moves and stops reflecting recent form);
// getPeriodLeaderboard passes the SAME summed period totals for both — a
// week/month ranking has no separate "lifetime" number to contrast against,
// the whole row already IS scoped to that period.
// bestWinStreak is passed in separately (not read off `s`/`w` like
// everything else here) — it's account-wide (see _emptyStats), not
// per-variant, so it doesn't live in either the variant bucket `s` reads
// from or the windowed/period stats `w` reads from. getLeaderboard passes
// the profile's real lifetime bestWinStreak; getPeriodLeaderboard computes
// a period-scoped one instead (see _periodBestWinStreak below) — a lifetime
// streak leaking into a week/month board would rank someone by a streak
// that mostly didn't happen within that period.
function _rankingRow(id, s, w, bestWinStreak = 0) {
  const yakumanCount = Object.entries(s.yaku)
    .reduce((n, [name, count]) => n + (YAKUMAN_NAMES.has(name) ? count : 0), 0);
  // Every game increments exactly one placements[] slot, so a genuine
  // record's four counts always sum to gamesPlayed exactly. A record that
  // predates placement tracking gets [0,0,0,0] from _fillVariantDefaults
  // (see _normalize) instead, which — left unchecked — computes as a
  // flawless 0.00 average (better than always finishing 1st!) rather than
  // "we don't actually know". This check tells the two apart: only trust
  // the average when the counts add up to a real game history.
  const hasRealPlacementData = w.placements.reduce((a, b) => a + b, 0) === w.gamesPlayed;
  const avgPlacement = w.gamesPlayed > 0 && hasRealPlacementData
    ? w.placements.reduce((sum, count, i) => sum + count * (i + 1), 0) / w.gamesPlayed
    : null;
  // Rate, not raw count — a raw dealIns count just tracks how much you've
  // played, same problem totalFinalScore already covers. The denominator
  // is "hands where you either won or dealt in" (matches the My Stats
  // panel's own dealInRate calc), not gamesPlayed — hands, not games, are
  // the unit a deal-in actually happens in.
  const dealInHands = w.handsWon + w.dealIns;
  const dealInRate = dealInHands > 0 ? (w.dealIns / dealInHands) * 100 : null;
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
    avgPlacementGames: w.gamesPlayed,
    dealInHands,
    dealInRate,
    bestWinStreak,
  };
}

// sortBy must be one of the fields _rankingRow returns; an unrecognized one
// sorts everyone as equal (falls through the final
// `(b[sortBy]||0)-(a[sortBy]||0)` — see index.js's whitelist, which is what
// actually keeps this to known values).
function _sortLeaderboardRows(rows, sortBy) {
  if (sortBy === 'avgPlacement') {
    // Lower is better here (1st place = 1) — the only sort field that
    // sorts ascending instead of descending, and the only one that filters
    // rows out entirely rather than just ranking them last (see the
    // MIN_GAMES_FOR_AVG_PLACEMENT comment above for why a low-sample
    // average shouldn't be shown as ranked at all, not even at the
    // bottom). Gated on avgPlacementGames (the count `w` was actually
    // computed from — the last-100-rounds window for getLeaderboard, or
    // the period itself for getPeriodLeaderboard), not the lifetime/period
    // gamesPlayed above — a veteran with thousands of lifetime games but
    // only 2 in the relevant window still has a 2-game-sample average, not
    // a trustworthy one.
    return rows
      .filter(r => r.avgPlacementGames >= MIN_GAMES_FOR_AVG_PLACEMENT && r.avgPlacement != null)
      .sort((a, b) => a.avgPlacement - b.avgPlacement);
  }
  if (sortBy === 'dealInRate') {
    // Highest first (worst deal-in discipline on top), per request — gated
    // the same way avgPlacement is above, see MIN_HANDS_FOR_DEAL_IN_RATE.
    return rows
      .filter(r => r.dealInHands >= MIN_HANDS_FOR_DEAL_IN_RATE && r.dealInRate != null)
      .sort((a, b) => b.dealInRate - a.dealInRate);
  }
  return rows.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
}

// No query engine needed at this scale — just load everything, derive
// whatever the requested sort needs, and sort in JS. Returns `id`, not a
// display name — this file has no notion of names at all anymore (see the
// top-of-file comment); index.js's 'get_leaderboard' handler joins each
// entry against profiles.getNameById before it ever reaches the client.
function getLeaderboard(sortBy = 'totalFinalScore', variant = 'yonma') {
  const all = _load();
  const key = variant === 'sanma' ? 'sanma' : 'yonma';
  const rows = Object.entries(all).map(([id, raw]) => {
    const rec = _normalize(raw);
    const s = rec[key];
    const w = _deriveWindowStats(s.recentRounds);
    return _rankingRow(id, s, w, rec.bestWinStreak);
  });
  return _sortLeaderboardRows(rows, sortBy);
}

// Folds an array of dated per-game deltas (see periodGames on
// _emptyVariantStats/recordGameResult) into one _emptyMatchKindStats-shaped
// total — same idea as _deriveWindowStats above, just summing whole-game
// entries instead of building them up hand-by-hand, since each periodGames
// entry already IS one complete game's numbers.
function _sumGameDeltas(entries) {
  const out = _emptyMatchKindStats();
  for (const e of entries) {
    out.gamesPlayed += e.gamesPlayed;
    out.gamesWon += e.gamesWon;
    for (let i = 0; i < 4; i++) out.placements[i] += e.placements[i];
    out.totalFinalScore += e.totalFinalScore;
    out.handsWon += e.handsWon;
    out.tsumoWon += e.tsumoWon;
    out.ronWon += e.ronWon;
    out.riichiDeclared += e.riichiDeclared;
    out.dealIns += e.dealIns;
    out.handsPlayed += e.handsPlayed;
    out.huro += e.huro;
    out.busts += e.busts;
    out.bestHan = Math.max(out.bestHan, e.bestHan);
    out.bestScore = Math.max(out.bestScore, e.bestScore);
    out.bestFinalScore = Math.max(out.bestFinalScore, e.bestFinalScore);
    out.doubleBustWins += e.doubleBustWins;
    for (const [k, v] of Object.entries(e.yaku)) out.yaku[k] = (out.yaku[k] || 0) + v;
  }
  return out;
}

// Longest run of consecutive 1st-place games WITHIN this filtered set —
// deliberately NOT the profile's lifetime bestWinStreak (that could easily
// have been built up mostly outside the period, or even entirely before it
// started). `entries` must already be in chronological order — true here
// since periodGames is only ever appended to and pruned from the front (see
// recordGameResult/_prunePeriodGames), and the date filter above preserves
// that order.
function _periodBestWinStreak(entries) {
  let best = 0, current = 0;
  for (const e of entries) {
    current = e.gamesWon ? current + 1 : 0;
    if (current > best) best = current;
  }
  return best;
}

// Calendar period boundaries, both computed in SERVER LOCAL TIME (plain
// Date getters) — good enough for a casual per-server leaderboard reset;
// not worth pulling in a timezone-aware library for this. Week starts
// Monday (ISO-style), not Sunday.
function _periodRange(period) {
  const now = new Date();
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const day = now.getDay(); // 0=Sun..6=Sat
  const sinceMonday = (day + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Weekly/Monthly Rankings — same sort options and row shape as
// getLeaderboard above, just scoped to periodGames entries whose date
// falls within the current calendar week/month (see _periodRange) instead
// of a player's whole history. Profiles with zero games in the period are
// dropped entirely rather than ranked at the bottom with all-zero stats.
function getPeriodLeaderboard(sortBy = 'totalFinalScore', variant = 'yonma', period = 'week') {
  const all = _load();
  const key = variant === 'sanma' ? 'sanma' : 'yonma';
  const { start, end } = _periodRange(period);
  const rows = Object.entries(all)
    .map(([id, raw]) => {
      const v = _normalize(raw)[key];
      const entries = (v.periodGames || []).filter(g => g.date >= start && g.date < end);
      const w = _sumGameDeltas(entries);
      return _rankingRow(id, w, w, _periodBestWinStreak(entries));
    })
    .filter(r => r.gamesPlayed > 0);
  return _sortLeaderboardRows(rows, sortBy);
}

// Called alongside profiles.deleteProfile (see index.js's delete_profile) —
// removes the stats/achievements record too, so a deleted profile doesn't
// linger on the leaderboard, and a later profile recreated under the same
// name starts fresh instead of inheriting the old one's unlocked themes
// (a fresh create_profile always gets a brand-new id, never the old one).
function deleteStats(id) {
  getDb().prepare('DELETE FROM stats WHERE profile_id = ?').run(id);
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

module.exports = { getStats, recordGameResult, getLeaderboard, getPeriodLeaderboard, deleteStats, recheckAchievements };
