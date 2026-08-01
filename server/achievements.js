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
