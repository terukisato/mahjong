'use strict';
// Achievement definitions — each optionally grants a voice-theme unlock
// and/or a title unlock the first time its check passes against a
// player's accumulated stats (see stats.js's _emptyStats/recordGameResult).
// `unlocksTheme`, if set, must match a real folder under
// public/audio/Voice/ (see public/script.js's voiceThemes list) — there's
// no fallback for a missing theme folder, sound playback just 404s
// silently. `unlocksTitle`, if set, must be listed in server/profiles.js's
// TITLES — that's the set setTitle actually accepts, this is just where
// a title gets earned.
// `check` receives the whole stats record (see stats.js's _emptyStats —
// .yonma/.sanma are separate per-variant buckets), not one variant's
// numbers alone, so e.g. "first win" triggers regardless of which mode it
// happened in — every check below combines both variants the same way,
// EXCEPT sanma_specialist, which is deliberately sanma-only.
//
// `target`/`progress(s)` power the Achievements panel's progress bar (see
// getProgressList below, and renderAchievements in public/script.js) —
// progress is clamped to target, so it always reads as "how close" even
// once actually earned. For compound conditions (ace, safe_player) that
// don't reduce to one clean number, progress tracks the games/hands
// PREREQUISITE only (documented at each one) — `check` stays the sole
// source of truth for whether it's actually earned, the bar is just a
// rough "getting there" indicator, not a literal % of the real condition.
const gamesPlayed = s => s.yonma.gamesPlayed + s.sanma.gamesPlayed;
const gamesWon = s => s.yonma.gamesWon + s.sanma.gamesWon;
const riichiDeclared = s => s.yonma.riichiDeclared + s.sanma.riichiDeclared;
const bestHan = s => Math.max(s.yonma.bestHan, s.sanma.bestHan);
const bestScore = s => Math.max(s.yonma.bestScore, s.sanma.bestScore);
const yakuCount = (s, name) => (s.yonma.yaku[name] || 0) + (s.sanma.yaku[name] || 0);
const distinctYakuCount = s => new Set([...Object.keys(s.yonma.yaku), ...Object.keys(s.sanma.yaku)]).size;
const dealInHands = s => s.yonma.dealIns + s.sanma.dealIns + s.yonma.handsWon + s.sanma.handsWon;
const handsWon = s => s.yonma.handsWon + s.sanma.handsWon;
const tsumoWon = s => s.yonma.tsumoWon + s.sanma.tsumoWon;
const ronWon = s => s.yonma.ronWon + s.sanma.ronWon;
// Sum of 1st/2nd/3rd-place finishes (never-4th) across both variants —
// index 3 is always 0 in sanma anyway (see stats.js), so just summing 0-2
// naturally excludes last place in either mode without special-casing.
const podiumFinishes = s => [0, 1, 2].reduce((n, i) => n + s.yonma.placements[i] + s.sanma.placements[i], 0);

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
];
const yakumanProgress = s => YAKUMAN_NAMES.some(n => yakuCount(s, n) > 0) ? 1 : 0;
const flushProgress = s => (yakuCount(s, 'Chinitsu') > 0 || yakuCount(s, 'Honitsu') > 0) ? 1 : 0;
// Largest GAME-ENDING score, not the largest single-hand payout (that's
// bestScore/'High Roller' above) — see stats.js's bestFinalScore, which is
// tracked from finalScores[seat] at game end, not from any one hand's win.
const bestFinalScoreYonma = s => s.yonma.bestFinalScore;
const bestFinalScoreSanma = s => s.sanma.bestFinalScore;
// Sanma-only by design (see room.js's _endRound comment) — a tsumo is the
// only win type that pays from every opponent simultaneously, so it's the
// only way to bankrupt more than one at once from a single win.
const doubleBustWins = s => s.sanma.doubleBustWins;

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
  { id: 'flush_master', label: 'Achieve Chinitsu or Honitsu', unlocksTitle: 'Flush Master', target: 1, progress: flushProgress, check: s => flushProgress(s) >= 1 },
  { id: 'riichi_machine', label: 'Declare riichi 50 times', unlocksTitle: 'Riichi Machine', target: 50, progress: riichiDeclared, check: s => riichiDeclared(s) >= 50 },
  { id: 'renaissance', label: 'Achieve 10 different yaku', unlocksTitle: 'Renaissance Player', target: 10, progress: distinctYakuCount, check: s => distinctYakuCount(s) >= 10 },
  { id: 'big_hand', label: 'Win a hand worth 8+ han', unlocksTitle: 'Big Hand', target: 8, progress: bestHan, check: s => bestHan(s) >= 8 },
  { id: 'high_roller', label: 'Reach a final score of 50,000+', unlocksTitle: 'High Roller', target: 50000, progress: bestScore, check: s => bestScore(s) >= 50000 },
  // Progress tracks the 20-hand prerequisite only — the real gate also
  // needs a <10% deal-in rate, same reasoning as 'ace' above.
  {
    id: 'safe_player', label: 'Keep a deal-in rate under 10% over 20+ hands', unlocksTitle: 'Safe Player',
    target: 20, progress: s => Math.min(dealInHands(s), 20),
    check: s => {
      const dealIns = s.yonma.dealIns + s.sanma.dealIns;
      const hands = dealInHands(s);
      return hands >= 20 && (dealIns / hands) < 0.1;
    },
  },
  { id: 'sanma_specialist', label: 'Win your first sanma game', unlocksTitle: 'Sanma Specialist', target: 1, progress: s => Math.min(s.sanma.gamesWon, 1), check: s => s.sanma.gamesWon >= 1 },
  { id: 'tsumo_specialist', label: 'Win 30 hands by tsumo', unlocksTitle: 'Tsumo Specialist', target: 30, progress: tsumoWon, check: s => tsumoWon(s) >= 30 },
  { id: 'ron_specialist', label: 'Win 30 hands by ron', unlocksTitle: 'Ron Specialist', target: 30, progress: ronWon, check: s => ronWon(s) >= 30 },
  { id: 'hand_collector', label: 'Win 100 hands', unlocksTitle: 'Hand Collector', target: 100, progress: handsWon, check: s => handsWon(s) >= 100 },
  { id: 'podium_regular', label: 'Finish 1st, 2nd, or 3rd 20 times', unlocksTitle: 'Podium Regular', target: 20, progress: podiumFinishes, check: s => podiumFinishes(s) >= 20 },
  { id: 'lightning_reflexes', label: 'Achieve Ippatsu', unlocksTitle: 'Lightning Reflexes', target: 1, progress: s => Math.min(yakuCount(s, 'Ippatsu'), 1), check: s => yakuCount(s, 'Ippatsu') > 0 },
  { id: 'quick_draw', label: 'Achieve Double Riichi', unlocksTitle: 'Quick Draw', target: 1, progress: s => Math.min(yakuCount(s, 'Double Riichi'), 1), check: s => yakuCount(s, 'Double Riichi') > 0 },
  { id: 'all_triplets', label: 'Achieve Toitoi', unlocksTitle: 'All Triplets', target: 1, progress: s => Math.min(yakuCount(s, 'Toitoi'), 1), check: s => yakuCount(s, 'Toitoi') > 0 },
  {
    id: 'three_colors', label: 'Achieve Sanshoku Doujun or Doukou', unlocksTitle: 'Three Colors', target: 1,
    progress: s => Math.min(yakuCount(s, 'Sanshoku Doujun') + yakuCount(s, 'Sanshoku Doukou'), 1),
    check: s => yakuCount(s, 'Sanshoku Doujun') > 0 || yakuCount(s, 'Sanshoku Doukou') > 0,
  },
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
  // near-total domination; 105k in sanma is the literal entire pool).
  { id: 'yonma_100k', label: 'Reach a final score of 100,000+ in yonma', unlocksTitle: 'Hoarder', target: 100000, progress: bestFinalScoreYonma, check: s => bestFinalScoreYonma(s) >= 100000 },
  { id: 'yonma_105k', label: 'Reach a final score of 105,000+ in yonma', unlocksTitle: 'Overlord', target: 105000, progress: bestFinalScoreYonma, check: s => bestFinalScoreYonma(s) >= 105000 },
  { id: 'sanma_100k', label: 'Reach a final score of 100,000+ in sanma', unlocksTitle: 'Sanma Hoarder', target: 100000, progress: bestFinalScoreSanma, check: s => bestFinalScoreSanma(s) >= 100000 },
  { id: 'sanma_105k', label: 'Reach a final score of 105,000+ in sanma', unlocksTitle: 'Sanma Overlord', target: 105000, progress: bestFinalScoreSanma, check: s => bestFinalScoreSanma(s) >= 105000 },

  // ── Sanma double-bankruptcy — tsumo only, see doubleBustWins above.
  { id: 'double_knockout', label: 'Win a tsumo that bankrupts both opponents (sanma)', unlocksTitle: 'Double Knockout', target: 1, progress: s => Math.min(doubleBustWins(s), 1), check: s => doubleBustWins(s) >= 1 },

  // ── Per-yaku achievements — one title per specific yaku, independent of
  // any existing achievement that might already cover the same yaku (e.g.
  // 'quick_draw'/Double Riichi, 'pure_runner'/Ittsu, 'three_colors'/
  // Sanshoku, 'flush_master'/Chinitsu+Honitsu, 'yakuman_hunter' above) —
  // deliberately kept separate rather than reused, so this whole batch
  // reads as one consistent "one title per yaku" set.
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
    target: a.target,
    current: Math.min(a.progress(s), a.target),
    earned: !!s.achievements[a.id],
  }));
}

module.exports = { ACHIEVEMENTS, applyUnlocks, getProgressList };
