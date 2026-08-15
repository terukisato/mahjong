'use strict';
// Achievement definitions — each optionally grants a voice-theme unlock
// and/or a title unlock the first time its check passes against a
// player's accumulated stats (see stats.js's _emptyStats/recordGameResult).
// `unlocksTheme`, if set, must match a real folder under
// public/audio/Voice/ (see public/script.js's voiceThemes list) — there's
// no fallback for a missing theme folder, sound playback just 404s
// silently. `unlocksTitle`, if set, must be listed in server/profiles.js's
// TITLES — that's the set setTitle actually accepts, this is just where
// a title gets earned. `unlocksTrack`, if set, must match a real id in
// public/script.js's gameTracks list — same "just where it gets earned"
// role, the Game Music picker (renderGameMusicList) is what actually gates
// selecting it.
// `check` receives the whole stats record (see stats.js's _emptyStats —
// .yonma/.sanma are separate per-variant buckets), not one variant's
// numbers alone, so e.g. "first win" triggers regardless of which mode it
// happened in — every check below combines both variants the same way,
// EXCEPT sanma_specialist, which is deliberately sanma-only.
//
// `target`/`progress(s)` power the Achievements panel's progress bar (see
// getProgressList below, and renderAchievements in public/script.js) —
// progress is clamped to target, so it always reads as "how close" even
// once actually earned. For compound conditions (ace, undisputed) that
// don't reduce to one clean number, progress tracks the games/hands
// PREREQUISITE only (documented at each one) — `check` stays the sole
// source of truth for whether it's actually earned, the bar is just a
// rough "getting there" indicator, not a literal % of the real condition.
const gamesPlayed = s => s.yonma.gamesPlayed + s.sanma.gamesPlayed;
const gamesWon = s => s.yonma.gamesWon + s.sanma.gamesWon;
const riichiDeclared = s => s.yonma.riichiDeclared + s.sanma.riichiDeclared;
const bestHan = s => Math.max(s.yonma.bestHan, s.sanma.bestHan);
const yakuCount = (s, name) => (s.yonma.yaku[name] || 0) + (s.sanma.yaku[name] || 0);
const distinctYakuCount = s => new Set([...Object.keys(s.yonma.yaku), ...Object.keys(s.sanma.yaku)]).size;
const handsWon = s => s.yonma.handsWon + s.sanma.handsWon;
const tsumoWon = s => s.yonma.tsumoWon + s.sanma.tsumoWon;
const ronWon = s => s.yonma.ronWon + s.sanma.ronWon;
// Sum of 1st/2nd/3rd-place finishes (never-4th) across both variants —
// index 3 is always 0 in sanma anyway (see stats.js), so just summing 0-2
// naturally excludes last place in either mode without special-casing.
const podiumFinishes = s => [0, 1, 2].reduce((n, i) => n + s.yonma.placements[i] + s.sanma.placements[i], 0);
// Sanma-only, 1st/2nd finishes only (unlike podiumFinishes above, which
// combines both variants and includes 3rd) — used by 'flawless_record'
// below, deliberately restricted to sanma's tighter 3-player field.
const sanmaTop2Finishes = s => s.sanma.placements[0] + s.sanma.placements[1];

// Yakuman-tier yaku names (see server/mahjong.js's ym() calls) — used by
// 'yakuman_hunter' below. Duplicated here rather than imported since
// mahjong.js doesn't export a name list; keep in sync if a new yakuman is
// ever added there (same duplication/sync tradeoff public/script.js's own
// ALL_YAKU_NAMES already accepts, for the same reason — no shared module
// system between server and browser code).
const YAKUMAN_NAMES = [
  'Tenhou', 'Chiihou', 'Kokushi Musou', 'Kokushi Juusanmen', 'Suu Ankou',
  'Suu Ankou Tanki', 'Daisangen', 'Shousuushii', 'Daisuushii', 'Tsuuiisou',
  'Chinroutou', 'Ryuuiisou', 'Chuuren Poutou', 'Junsei Chuuren', 'Suu Kantsu',
  // Kazoe Yakuman — reaches yakuman-tier han (13+) by stacking regular
  // yaku + dora rather than any single named yakuman (see room.js's
  // _buildYakuList). Included here so 'yakuman_hunter' below recognizes it
  // too, same as every other entry in this list.
  'Kazoe Yakuman',
];
const yakumanProgress = s => YAKUMAN_NAMES.some(n => yakuCount(s, n) > 0) ? 1 : 0;
// Largest GAME-ENDING score, not the largest single-hand payout (that's
// stats.js's own separate bestScore field — see its comment there) — this
// is tracked from finalScores[seat] at game end instead, not from any one
// hand's win. 'high_roller' below used to (incorrectly) check bestScore
// despite its own "reach a final score of 50,000+" label — fixed to use
// this instead.
const bestFinalScoreYonma = s => s.yonma.bestFinalScore;
const bestFinalScoreSanma = s => s.sanma.bestFinalScore;
// Combined across both variants — 'high_roller' below is a single
// any-variant achievement (unlike yonma_100k/sanma_100k, which are
// deliberately split per-variant titles).
const bestFinalScore = s => Math.max(bestFinalScoreYonma(s), bestFinalScoreSanma(s));
// Sanma-only by design (see room.js's _endRound comment) — a tsumo is the
// only win type that pays from every opponent simultaneously, so it's the
// only way to bankrupt more than one at once from a single win.
const doubleBustWins = s => s.sanma.doubleBustWins;
// Total yakuman-tier WINS across every kind combined (unlike yakumanProgress
// above, which only checks "at least one, any kind" — see
// 'yakuman_collector'/'yakuman_legend' below), and total bankruptcies
// ("tobi" — see room.js's _finishGame) across both variants, used by
// 'survivor' below.
const totalYakumanCount = s => YAKUMAN_NAMES.reduce((n, name) => n + yakuCount(s, name), 0);
const totalBusts = s => s.yonma.busts + s.sanma.busts;
// The 4 yaku that score as a DOUBLE yakuman (han:26) in mahjong.js's ym()
// calls, as opposed to every other entry in YAKUMAN_NAMES above (single,
// han:13). detectYaku returns on the first matching yakuman condition and
// never sums two different yakuman together (confirmed directly in
// mahjong.js — every yakuman branch is an early `return`, and the
// decomposition loop `break`s the instant it finds one), so a hand that
// happens to qualify for two different SINGLE yakumans at once still only
// ever scores as one of them, never as a double — the only ways to
// actually reach 26 han are these 4 named hands, or a Kazoe Yakuman
// (stacking ordinary yaku + dora) that happens to cross 26 on its own,
// which isn't tracked separately from an under-26 Kazoe Yakuman and so
// isn't counted here.
const DOUBLE_YAKUMAN_NAMES = ['Kokushi Juusanmen', 'Daisuushii', 'Suu Ankou Tanki', 'Junsei Chuuren'];
const distinctDoubleYakumanCount = s => DOUBLE_YAKUMAN_NAMES.filter(n => yakuCount(s, n) > 0).length;
// Longest-ever run of consecutive hands without dealing in — top-level on
// the record (combined across both variants), not derived from yonma/sanma
// sub-objects like everything above; see currentNoDealInStreak/
// bestNoDealInStreak on stats.js's _emptyStats, updated incrementally in
// recordGameResult (the only writer — nothing here computes it).
const noDealInStreak = s => s.bestNoDealInStreak || 0;

const ACHIEVEMENTS = [
  { id: 'first_win', label: 'Win your first game', unlocksTheme: 'Natsu', target: 1, progress: s => Math.min(gamesWon(s), 1), check: s => gamesWon(s) >= 1 },
  { id: 'regular', label: 'Play 10 games', unlocksTitle: 'Regular', target: 10, progress: gamesPlayed, check: s => gamesPlayed(s) >= 10 },
  { id: 'veteran', label: 'Play 100 games', unlocksTitle: 'Veteran', target: 100, progress: gamesPlayed, check: s => gamesPlayed(s) >= 100 },
  { id: 'century_club', label: 'Win 100 games', unlocksTitle: 'Century Club', target: 100, progress: gamesWon, check: s => gamesWon(s) >= 100 },
  // Progress tracks the 20-game prerequisite only — the real gate also
  // needs a 50%+ win rate, which doesn't reduce to the same bar; check()
  // is what actually decides this one.
  { id: 'ace', label: 'Win 50%+ of at least 20 games', unlocksTitle: 'Ace', target: 20, progress: s => Math.min(gamesPlayed(s), 20), check: s => gamesPlayed(s) >= 20 && (gamesWon(s) / gamesPlayed(s)) >= 0.5 },
  { id: 'yakuman_hunter', label: 'Achieve a yakuman', unlocksTitle: 'Yakuman Hunter', target: 1, progress: yakumanProgress, check: s => yakumanProgress(s) >= 1 },
  { id: 'riichi_machine', label: 'Declare riichi 50 times', unlocksTitle: 'Riichi Machine', target: 50, progress: riichiDeclared, check: s => riichiDeclared(s) >= 50 },
  { id: 'renaissance', label: 'Achieve 10 different yaku', unlocksTitle: 'Renaissance Player', target: 10, progress: distinctYakuCount, check: s => distinctYakuCount(s) >= 10 },
  { id: 'big_hand', label: 'Win a hand worth 8+ han', unlocksTitle: 'Big Hand', target: 8, progress: bestHan, check: s => bestHan(s) >= 8 },
  { id: 'high_roller', label: 'Reach a final score of 50,000+', unlocksTitle: 'High Roller', target: 50000, progress: bestFinalScore, check: s => bestFinalScore(s) >= 50000 },
  // Safe Player ladder — consecutive hands without dealing in (see
  // noDealInStreak above), combined across both variants and persisted
  // across games. Each tier reuses the SAME lifetime high-water mark, not a
  // fresh count of its own — a player who jumps straight to a 30-hand
  // streak unlocks all four in the same game, same "no prerequisite order"
  // shape as the games-played/games-won ladders elsewhere in this file.
  // The first three tiers also unlock a Game Music track (see gameTracks
  // in public/script.js) — 30 doesn't, there are only 3 bonus tracks to
  // hand out.
  { id: 'safe_player_5', label: 'Go 5 hands in a row without dealing in', unlocksTitle: 'Safe Player', unlocksTrack: 'elegy', target: 5, progress: s => Math.min(noDealInStreak(s), 5), check: s => noDealInStreak(s) >= 5 },
  { id: 'safe_player_10', label: 'Go 10 hands in a row without dealing in', unlocksTitle: 'Disciplined Safe Player', unlocksTrack: 'city_lights', target: 10, progress: s => Math.min(noDealInStreak(s), 10), check: s => noDealInStreak(s) >= 10 },
  { id: 'safe_player_20', label: 'Go 20 hands in a row without dealing in', unlocksTitle: 'Elite Safe Player', unlocksTrack: 'groovy_tea', target: 20, progress: s => Math.min(noDealInStreak(s), 20), check: s => noDealInStreak(s) >= 20 },
  { id: 'safe_player_30', label: 'Go 30 hands in a row without dealing in', unlocksTitle: 'Legendary Safe Player', target: 30, progress: s => Math.min(noDealInStreak(s), 30), check: s => noDealInStreak(s) >= 30 },
  { id: 'sanma_specialist', label: 'Win your first sanma game', unlocksTitle: 'Sanma Specialist', target: 1, progress: s => Math.min(s.sanma.gamesWon, 1), check: s => s.sanma.gamesWon >= 1 },
  { id: 'tsumo_specialist', label: 'Win 30 hands by tsumo', unlocksTitle: 'Tsumo Specialist', target: 30, progress: tsumoWon, check: s => tsumoWon(s) >= 30 },
  { id: 'ron_specialist', label: 'Win 30 hands by ron', unlocksTitle: 'Ron Specialist', target: 30, progress: ronWon, check: s => ronWon(s) >= 30 },
  { id: 'hand_collector', label: 'Win 100 hands', unlocksTitle: 'Hand Collector', target: 100, progress: handsWon, check: s => handsWon(s) >= 100 },
  { id: 'podium_regular', label: 'Finish 1st, 2nd, or 3rd 20 times', unlocksTitle: 'Podium Regular', target: 20, progress: podiumFinishes, check: s => podiumFinishes(s) >= 20 },
  { id: 'lightning_reflexes', label: 'Achieve Ippatsu', unlocksTitle: 'Lightning Reflexes', target: 1, progress: s => Math.min(yakuCount(s, 'Ippatsu'), 1), check: s => yakuCount(s, 'Ippatsu') > 0 },
  { id: 'quick_draw', label: 'Achieve Double Riichi', unlocksTitle: 'Quick Draw', target: 1, progress: s => Math.min(yakuCount(s, 'Double Riichi'), 1), check: s => yakuCount(s, 'Double Riichi') > 0 },
  { id: 'all_triplets', label: 'Achieve Toitoi', unlocksTitle: 'All Triplets', target: 1, progress: s => Math.min(yakuCount(s, 'Toitoi'), 1), check: s => yakuCount(s, 'Toitoi') > 0 },
  { id: 'pure_runner', label: 'Achieve Ittsu', unlocksTitle: 'Pure Runner', target: 1, progress: s => Math.min(yakuCount(s, 'Ittsu'), 1), check: s => yakuCount(s, 'Ittsu') > 0 },
  { id: 'dora_rich', label: 'Win 30 hands with dora', unlocksTitle: 'Dora Rich', target: 30, progress: s => yakuCount(s, 'Dora'), check: s => yakuCount(s, 'Dora') >= 30 },
  // Top of the win-count ladder — pairs with the nameplate's Diamond tier
  // (200+ combined wins, see .tier-diamond in style.css/updateNameplateTier
  // in script.js), same threshold, so earning this title lines up with the
  // nameplate visibly changing too.
  { id: 'the_diamond', label: 'Win 200 games', unlocksTitle: 'The Diamond', target: 200, progress: gamesWon, check: s => gamesWon(s) >= 200 },

  // ── Point milestones — a single GAME's final score, not a cumulative
  // total (see bestFinalScoreYonma/Sanma above). Separate titles per
  // variant since yonma's 100,000-point pool and sanma's 105,000-point
  // pool make the same number a different feat in each (100k in yonma is
  // near-total domination; 105k in sanma is the literal entire pool) —
  // sanma's pair get their own names rather than just "Sanma "-prefixing
  // the yonma title, so the two variants' titles actually read as
  // distinct achievements instead of one being a lesser copy of the other.
  { id: 'yonma_100k', label: 'Reach a final score of 100,000+ in yonma', unlocksTitle: 'Hoarder', target: 100000, progress: bestFinalScoreYonma, check: s => bestFinalScoreYonma(s) >= 100000 },
  { id: 'yonma_105k', label: 'Reach a final score of 105,000+ in yonma', unlocksTitle: 'Overlord', target: 105000, progress: bestFinalScoreYonma, check: s => bestFinalScoreYonma(s) >= 105000 },
  { id: 'sanma_100k', label: 'Reach a final score of 100,000+ in sanma', unlocksTitle: 'Plunderer', target: 100000, progress: bestFinalScoreSanma, check: s => bestFinalScoreSanma(s) >= 100000 },
  { id: 'sanma_105k', label: 'Reach a final score of 105,000+ in sanma', unlocksTitle: 'Conqueror', target: 105000, progress: bestFinalScoreSanma, check: s => bestFinalScoreSanma(s) >= 105000 },

  // ── Sanma double-bankruptcy — tsumo only, see doubleBustWins above.
  { id: 'double_knockout', label: 'Win a tsumo that bankrupts both opponents (sanma)', unlocksTitle: 'Double Knockout', target: 1, progress: s => Math.min(doubleBustWins(s), 1), check: s => doubleBustWins(s) >= 1 },

  // ── Higher-tier "harder" achievements — a second, tougher rung above
  // several of the cumulative counters earlier in this file (games
  // played/won, riichi, hands won, tsumo/ron wins, dora, podium finishes),
  // plus a handful of new stricter/compound conditions. Each ladder entry
  // reuses that same counter function, just a bigger target — earning the
  // easier one first isn't required (check() doesn't reference the earlier
  // achievement's id), a player who jumps straight past 100 games played
  // and hits 500 unlocks both 'veteran' and 'legend' on the same game.
  { id: 'legend', label: 'Play 500 games', unlocksTitle: 'Legend', target: 500, progress: gamesPlayed, check: s => gamesPlayed(s) >= 500 },
  { id: 'living_legend', label: 'Win 500 games', unlocksTitle: 'Living Legend', target: 500, progress: gamesWon, check: s => gamesWon(s) >= 500 },
  { id: 'riichi_addict', label: 'Declare riichi 200 times', unlocksTitle: 'Riichi Addict', target: 200, progress: riichiDeclared, check: s => riichiDeclared(s) >= 200 },
  { id: 'hand_hoarder', label: 'Win 300 hands', unlocksTitle: 'Hand Hoarder', target: 300, progress: handsWon, check: s => handsWon(s) >= 300 },
  { id: 'tsumo_master', label: 'Win 100 hands by tsumo', unlocksTitle: 'Tsumo Master', target: 100, progress: tsumoWon, check: s => tsumoWon(s) >= 100 },
  { id: 'ron_master', label: 'Win 100 hands by ron', unlocksTitle: 'Ron Master', target: 100, progress: ronWon, check: s => ronWon(s) >= 100 },
  { id: 'dora_addict', label: 'Win 100 hands with dora', unlocksTitle: 'Dora Addict', target: 100, progress: s => yakuCount(s, 'Dora'), check: s => yakuCount(s, 'Dora') >= 100 },
  // Top of the win-rate ladder, above 'ace' — same "progress tracks the
  // game-count prerequisite only" caveat.
  { id: 'undisputed', label: 'Win 70%+ of at least 100 games', unlocksTitle: 'The Last Emperor', target: 100, progress: s => Math.min(gamesPlayed(s), 100), check: s => gamesPlayed(s) >= 100 && (gamesWon(s) / gamesPlayed(s)) >= 0.7 },
  // Above 'renaissance_plus' (20 different yaku).
  { id: 'yaku_grandmaster', label: 'Achieve 30 different yaku', unlocksTitle: 'Mighty Mouse', target: 30, progress: distinctYakuCount, check: s => distinctYakuCount(s) >= 30 },
  // Lifetime-cumulative like 'survivor' above — never once finishing 3rd
  // across 30+ sanma games permanently flips to unearnable the moment a
  // single non-top-2 finish is recorded, same "can't un-happen" shape.
  // Sanma-only by design (see sanmaTop2Finishes above) — not a yonma
  // equivalent of 'podium_regular'.
  { id: 'flawless_record', label: 'Finish 1st or 2nd in every one of at least 30 sanma games', unlocksTitle: 'The Eagle', target: 30, progress: s => sanmaTop2Finishes(s) === s.sanma.gamesPlayed ? Math.min(s.sanma.gamesPlayed, 30) : 0, check: s => s.sanma.gamesPlayed >= 30 && sanmaTop2Finishes(s) === s.sanma.gamesPlayed },
  // Any combination of yakuman-tier wins, not "at least one of a specific
  // kind" like 'yakuman_hunter' or the per-yakuman batch below — three
  // Suu Ankou wins counts same as one Suu Ankou + one Chiihou + one Kazoe
  // Yakuman.
  { id: 'yakuman_collector', label: 'Achieve 3 yakuman-tier hands (any combination)', unlocksTitle: 'Yakuman Collector', target: 3, progress: totalYakumanCount, check: s => totalYakumanCount(s) >= 3 },
  { id: 'yakuman_legend', label: 'Achieve 10 yakuman-tier hands (any combination)', unlocksTitle: 'Yakuman Legend', target: 10, progress: totalYakumanCount, check: s => totalYakumanCount(s) >= 10 },
  // 'Yakuman Stack' is a pseudo-yaku-name tagged server-side (see
  // room.js's _recordHandWin) whenever a SINGLE hand's yakuList genuinely
  // contains 2+ different yakuman-tier entries at once (e.g. Suu Ankou +
  // Chinroutou — four concealed triplets that all happen to be terminals;
  // see mahjong.js's detectYaku, which now collects every yakuman
  // condition a hand satisfies instead of stopping at the first). This is
  // NOT the same thing as 'yakuman_collector' above (3 yakuman-tier wins
  // total, across any number of separate hands) — this specifically
  // requires two different yakuman to coincide in ONE hand.
  { id: 'yakuman_stack', label: 'Achieve 2 different yakuman in the same hand', unlocksTitle: 'Twin Fortune', target: 1, progress: s => Math.min(yakuCount(s, 'Yakuman Stack'), 1), check: s => yakuCount(s, 'Yakuman Stack') > 0 },
  // Double-yakuman ladder (see DOUBLE_YAKUMAN_NAMES/distinctDoubleYakumanCount
  // above) — a harder aggregate tier on top of the 4 individual double-
  // yakuman achievements further down (kokushi_juusanmen_win/daisuushii_win/
  // suuankou_tanki_win/junsei_chuuren_win), same "earning the easier one
  // first isn't required" shape as every other ladder in this file: landing
  // all 4 different kinds in one game unlocks all three of these at once.
  // Counts DISTINCT kinds, not total wins — 3 Kokushi Juusanmen wins still
  // only counts as 1 toward double_yakuman_collector/_legend.
  { id: 'double_yakuman_hunter', label: 'Achieve a double yakuman (any kind)', unlocksTitle: 'Double Crown', target: 1, progress: s => Math.min(distinctDoubleYakumanCount(s), 1), check: s => distinctDoubleYakumanCount(s) >= 1 },
  { id: 'double_yakuman_collector', label: 'Achieve 2 different kinds of double yakuman', unlocksTitle: 'Twin Ascendant', target: 2, progress: s => Math.min(distinctDoubleYakumanCount(s), 2), check: s => distinctDoubleYakumanCount(s) >= 2 },
  { id: 'double_yakuman_legend', label: 'Achieve all 4 kinds of double yakuman', unlocksTitle: 'Grand Ascendant', target: 4, progress: s => Math.min(distinctDoubleYakumanCount(s), 4), check: s => distinctDoubleYakumanCount(s) >= 4 },
  { id: 'renaissance_plus', label: 'Achieve 20 different yaku', unlocksTitle: 'Master of Forms', target: 20, progress: distinctYakuCount, check: s => distinctYakuCount(s) >= 20 },
  // Lifetime-cumulative, not a "current streak" (this whole stats system
  // has no session/streak state — see stats.js's own top comment) — one
  // bust (tobi) at any point ever recorded makes this permanently
  // unearnable, same "check() can't flip back to true" shape every other
  // achievement here relies on, just harsher: it can also permanently
  // flip to "impossible" rather than merely "not yet".
  { id: 'survivor', label: 'Play 50 games without ever busting', unlocksTitle: 'Survivor', target: 50, progress: s => totalBusts(s) === 0 ? Math.min(gamesPlayed(s), 50) : 0, check: s => gamesPlayed(s) >= 50 && totalBusts(s) === 0 },

  // ── Per-yaku achievements — one title per specific yaku, independent of
  // any existing achievement that might already cover the same yaku (e.g.
  // 'quick_draw'/Double Riichi, 'pure_runner'/Ittsu, 'yakuman_hunter'
  // above) — deliberately kept separate rather than reused, so this whole
  // batch reads as one consistent "one title per yaku" set. Sanshoku and
  // the flush yaku have no combined equivalent here (unlike those) —
  // 'sanshoku_doukou_win'/'sanshoku_doujun_win' and 'chinitsu_win'/
  // 'honitsu_win' below are their only titles, replacing the old combined
  // 'three_colors' and 'flush_master' achievements that used to grant one
  // title for either yaku in each pair.
  { id: 'chankan_win', label: 'Win with Chankan', unlocksTitle: 'Robbing Kan', target: 1, progress: s => Math.min(yakuCount(s, 'Chankan'), 1), check: s => yakuCount(s, 'Chankan') > 0 },
  { id: 'rinshan_win', label: 'Win with Rinshan Kaihou', unlocksTitle: 'Dead Wall Diver', target: 1, progress: s => Math.min(yakuCount(s, 'Rinshan Kaihou'), 1), check: s => yakuCount(s, 'Rinshan Kaihou') > 0 },
  { id: 'haitei_win', label: 'Win with Haitei', unlocksTitle: 'Last Tile Standing', target: 1, progress: s => Math.min(yakuCount(s, 'Haitei'), 1), check: s => yakuCount(s, 'Haitei') > 0 },
  { id: 'houtei_win', label: 'Win with Houtei', unlocksTitle: "River's End", target: 1, progress: s => Math.min(yakuCount(s, 'Houtei'), 1), check: s => yakuCount(s, 'Houtei') > 0 },
  { id: 'double_riichi_win', label: 'Win with Double Riichi', unlocksTitle: 'Instant Riichi', target: 1, progress: s => Math.min(yakuCount(s, 'Double Riichi'), 1), check: s => yakuCount(s, 'Double Riichi') > 0 },
  { id: 'sanankou_win', label: 'Win with San Ankou', unlocksTitle: 'Triple Threat', target: 1, progress: s => Math.min(yakuCount(s, 'San Ankou'), 1), check: s => yakuCount(s, 'San Ankou') > 0 },
  { id: 'sanshoku_doukou_win', label: 'Win with Sanshoku Doukou', unlocksTitle: 'Triple Triplet', target: 1, progress: s => Math.min(yakuCount(s, 'Sanshoku Doukou'), 1), check: s => yakuCount(s, 'Sanshoku Doukou') > 0 },
  { id: 'sanshoku_doujun_win', label: 'Win with Sanshoku Doujun', unlocksTitle: 'Rainbow Run', target: 1, progress: s => Math.min(yakuCount(s, 'Sanshoku Doujun'), 1), check: s => yakuCount(s, 'Sanshoku Doujun') > 0 },
  { id: 'honroutou_win', label: 'Win with Honroutou', unlocksTitle: 'Terminal Case', target: 1, progress: s => Math.min(yakuCount(s, 'Honroutou'), 1), check: s => yakuCount(s, 'Honroutou') > 0 },
  { id: 'ittsu_win', label: 'Win with Ittsu', unlocksTitle: 'Straight Shooter', target: 1, progress: s => Math.min(yakuCount(s, 'Ittsu'), 1), check: s => yakuCount(s, 'Ittsu') > 0 },
  { id: 'chanta_win', label: 'Win with Chanta', unlocksTitle: 'Edge Player', target: 1, progress: s => Math.min(yakuCount(s, 'Chanta'), 1), check: s => yakuCount(s, 'Chanta') > 0 },
  { id: 'shousangen_win', label: 'Win with Shousangen', unlocksTitle: 'Dragon Tamer', target: 1, progress: s => Math.min(yakuCount(s, 'Shousangen'), 1), check: s => yakuCount(s, 'Shousangen') > 0 },
  { id: 'sankantsu_win', label: 'Win with San Kantsu', unlocksTitle: 'Kan Collector', target: 1, progress: s => Math.min(yakuCount(s, 'San Kantsu'), 1), check: s => yakuCount(s, 'San Kantsu') > 0 },
  { id: 'honitsu_win', label: 'Win with Honitsu', unlocksTitle: 'Mono Color', target: 1, progress: s => Math.min(yakuCount(s, 'Honitsu'), 1), check: s => yakuCount(s, 'Honitsu') > 0 },
  { id: 'junchan_win', label: 'Win with Junchan', unlocksTitle: 'Pure Edge', target: 1, progress: s => Math.min(yakuCount(s, 'Junchan'), 1), check: s => yakuCount(s, 'Junchan') > 0 },
  { id: 'ryanpeiko_win', label: 'Win with Ryanpeiko', unlocksTitle: 'Double Twin', target: 1, progress: s => Math.min(yakuCount(s, 'Ryanpeiko'), 1), check: s => yakuCount(s, 'Ryanpeiko') > 0 },
  { id: 'nagashi_mangan_win', label: 'Win with Nagashi Mangan', unlocksTitle: 'Clean Sweep', target: 1, progress: s => Math.min(yakuCount(s, 'Nagashi Mangan'), 1), check: s => yakuCount(s, 'Nagashi Mangan') > 0 },
  { id: 'chinitsu_win', label: 'Win with Chinitsu', unlocksTitle: 'One Suit Wonder', target: 1, progress: s => Math.min(yakuCount(s, 'Chinitsu'), 1), check: s => yakuCount(s, 'Chinitsu') > 0 },

  // ── One achievement/title per individual yakuman/double yakuman —
  // replaces the old single 'yakuman_master' catch-all (any yakuman at
  // all). Independent of 'yakuman_hunter' above (same "any yakuman"
  // catch-all, just an older one kept as-is) — this batch is deliberately
  // granular instead. Suu Ankou/Suu Ankou Tanki and Chuuren Poutou/Junsei
  // Chuuren are each other's single/double-yakuman variant of the same
  // hand shape, so they get separate titles too, not folded together.
  { id: 'tenhou_win', label: 'Achieve Tenhou', unlocksTitle: "Heaven's Chosen", target: 1, progress: s => Math.min(yakuCount(s, 'Tenhou'), 1), check: s => yakuCount(s, 'Tenhou') > 0 },
  { id: 'chiihou_win', label: 'Achieve Chiihou', unlocksTitle: "Earth's Chosen", target: 1, progress: s => Math.min(yakuCount(s, 'Chiihou'), 1), check: s => yakuCount(s, 'Chiihou') > 0 },
  { id: 'kokushi_musou_win', label: 'Achieve Kokushi Musou', unlocksTitle: 'Orphan Collector', target: 1, progress: s => Math.min(yakuCount(s, 'Kokushi Musou'), 1), check: s => yakuCount(s, 'Kokushi Musou') > 0 },
  { id: 'kokushi_juusanmen_win', label: 'Achieve Kokushi Juusanmen', unlocksTitle: 'Thirteen-Sided Master', target: 1, progress: s => Math.min(yakuCount(s, 'Kokushi Juusanmen'), 1), check: s => yakuCount(s, 'Kokushi Juusanmen') > 0 },
  { id: 'suuankou_win', label: 'Achieve Suu Ankou', unlocksTitle: 'Iron Wall', target: 1, progress: s => Math.min(yakuCount(s, 'Suu Ankou'), 1), check: s => yakuCount(s, 'Suu Ankou') > 0 },
  { id: 'suuankou_tanki_win', label: 'Achieve Suu Ankou Tanki', unlocksTitle: "Needle's Eye", target: 1, progress: s => Math.min(yakuCount(s, 'Suu Ankou Tanki'), 1), check: s => yakuCount(s, 'Suu Ankou Tanki') > 0 },
  { id: 'daisangen_win', label: 'Achieve Daisangen', unlocksTitle: 'Dragon Lord', target: 1, progress: s => Math.min(yakuCount(s, 'Daisangen'), 1), check: s => yakuCount(s, 'Daisangen') > 0 },
  { id: 'shousuushii_win', label: 'Achieve Shousuushii', unlocksTitle: 'Wind Whisperer', target: 1, progress: s => Math.min(yakuCount(s, 'Shousuushii'), 1), check: s => yakuCount(s, 'Shousuushii') > 0 },
  { id: 'daisuushii_win', label: 'Achieve Daisuushii', unlocksTitle: 'Wind Sovereign', target: 1, progress: s => Math.min(yakuCount(s, 'Daisuushii'), 1), check: s => yakuCount(s, 'Daisuushii') > 0 },
  { id: 'tsuuiisou_win', label: 'Achieve Tsuuiisou', unlocksTitle: 'Honor Bound', target: 1, progress: s => Math.min(yakuCount(s, 'Tsuuiisou'), 1), check: s => yakuCount(s, 'Tsuuiisou') > 0 },
  { id: 'chinroutou_win', label: 'Achieve Chinroutou', unlocksTitle: 'Terminal Master', target: 1, progress: s => Math.min(yakuCount(s, 'Chinroutou'), 1), check: s => yakuCount(s, 'Chinroutou') > 0 },
  { id: 'ryuuiisou_win', label: 'Achieve Ryuuiisou', unlocksTitle: 'Emerald Hand', target: 1, progress: s => Math.min(yakuCount(s, 'Ryuuiisou'), 1), check: s => yakuCount(s, 'Ryuuiisou') > 0 },
  { id: 'chuuren_poutou_win', label: 'Achieve Chuuren Poutou', unlocksTitle: 'Nine Gates', target: 1, progress: s => Math.min(yakuCount(s, 'Chuuren Poutou'), 1), check: s => yakuCount(s, 'Chuuren Poutou') > 0 },
  { id: 'junsei_chuuren_win', label: 'Achieve Junsei Chuuren', unlocksTitle: 'True Nine Gates', target: 1, progress: s => Math.min(yakuCount(s, 'Junsei Chuuren'), 1), check: s => yakuCount(s, 'Junsei Chuuren') > 0 },
  { id: 'suukantsu_win', label: 'Achieve Suu Kantsu', unlocksTitle: 'Kan Emperor', target: 1, progress: s => Math.min(yakuCount(s, 'Suu Kantsu'), 1), check: s => yakuCount(s, 'Suu Kantsu') > 0 },
  { id: 'kazoe_yakuman_win', label: 'Achieve Kazoe Yakuman', unlocksTitle: 'Counted Divinity', target: 1, progress: s => Math.min(yakuCount(s, 'Kazoe Yakuman'), 1), check: s => yakuCount(s, 'Kazoe Yakuman') > 0 },
];

// Mutates `s` in place: grants any newly-qualifying achievement/theme/
// title. Idempotent — already-granted achievements are skipped via
// s.achievements, so this is safe to call after every game regardless of
// what changed.
function applyUnlocks(s) {
  for (const a of ACHIEVEMENTS) {
    if (!s.achievements[a.id] && a.check(s)) {
      s.achievements[a.id] = true;
      if (a.unlocksTheme && !s.unlockedThemes.includes(a.unlocksTheme)) {
        s.unlockedThemes.push(a.unlocksTheme);
      }
      if (a.unlocksTitle && !s.unlockedTitles.includes(a.unlocksTitle)) {
        s.unlockedTitles.push(a.unlocksTitle);
      }
      if (a.unlocksTrack && !s.unlockedTracks.includes(a.unlocksTrack)) {
        s.unlockedTracks.push(a.unlocksTrack);
      }
    }
  }
}

// Powers the Achievements panel (see renderAchievements in
// public/script.js) — one row per achievement with its label, reward,
// earned state (from s.achievements, the persisted one-time grant flag —
// not a live re-check, though the two agree in practice since every
// condition here is monotonic and can't become false again), and a
// current/target progress pair for the bar.
function getProgressList(s) {
  return ACHIEVEMENTS.map(a => ({
    id: a.id,
    label: a.label,
    unlocksTitle: a.unlocksTitle || null,
    unlocksTheme: a.unlocksTheme || null,
    unlocksTrack: a.unlocksTrack || null,
    target: a.target,
    current: Math.min(a.progress(s), a.target),
    earned: !!s.achievements[a.id],
  }));
}

module.exports = { ACHIEVEMENTS, applyUnlocks, getProgressList };
