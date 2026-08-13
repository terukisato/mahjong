'use strict';
// Regression test suite for achievements.js — plain Node assertions, no
// framework, same convention as room.test.js/mahjong.test.js/bot.test.js.
// Run with: node server/achievements.test.js

const assert = require('assert');
const { ACHIEVEMENTS, applyUnlocks } = require('./achievements');
const { TITLES } = require('./profiles');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
  }
}

function mkVariant(overrides = {}) {
  return Object.assign({
    gamesPlayed: 0, gamesWon: 0, riichiDeclared: 0, bestHan: 0, bestScore: 0,
    yaku: {}, dealIns: 0, handsWon: 0, tsumoWon: 0, ronWon: 0,
    placements: [0, 0, 0, 0], bestFinalScore: 0, busts: 0,
  }, overrides);
}
function mkStats({ yonma = {}, sanma = {}, bestNoDealInStreak = 0 } = {}) {
  return { achievements: {}, unlockedThemes: [], unlockedTitles: [], unlockedTracks: [], bestNoDealInStreak, yonma: mkVariant(yonma), sanma: mkVariant(sanma) };
}

// ══════════════════════════════════════════════════════════════════════════
// High Roller — was checking bestScore (largest single-HAND payout, see
// stats.js) despite its own label reading "Reach a final score of
// 50,000+", which is what bestFinalScore (game-ending total) actually
// tracks. A single big mangan/haneman win could previously unlock this
// even if the player's game ended with a modest final score, and a real
// 50,000+ final score with only small individual hand wins never unlocked
// it at all.
// ══════════════════════════════════════════════════════════════════════════

test('High Roller: a single huge hand payout with a modest final score does NOT unlock it', () => {
  const s = mkStats({ yonma: { bestScore: 64000, bestFinalScore: 27000 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['high_roller'], undefined);
});

test('High Roller: a 50,000+ GAME-ENDING score unlocks it even with only small individual hand wins', () => {
  const s = mkStats({ yonma: { bestScore: 2000, bestFinalScore: 51000 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['high_roller'], true);
  assert.ok(s.unlockedTitles.includes('High Roller'));
});

test('High Roller: checks both variants (sanma final score alone can trigger it)', () => {
  const s = mkStats({ yonma: { bestFinalScore: 10000 }, sanma: { bestFinalScore: 52000 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['high_roller'], true);
});

test('High Roller: exactly at the 50,000 threshold unlocks it', () => {
  const s = mkStats({ yonma: { bestFinalScore: 50000 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['high_roller'], true);
});

test('High Roller: just under the threshold does not unlock it', () => {
  const s = mkStats({ yonma: { bestFinalScore: 49999 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['high_roller'], undefined);
});

// ══════════════════════════════════════════════════════════════════════════
// Higher-tier "harder" achievements — ladder extensions (bigger target,
// same underlying counter as an existing achievement) and new stricter/
// compound conditions.
// ══════════════════════════════════════════════════════════════════════════

test('Legend/Living Legend: ladder extensions above Veteran/The Diamond fire independently of the easier tier', () => {
  const s = mkStats({ yonma: { gamesPlayed: 500, gamesWon: 500 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['veteran'], true, 'easier tier (100 played) also earned along the way');
  assert.strictEqual(s.achievements['legend'], true, '500 played');
  assert.strictEqual(s.achievements['the_diamond'], true, 'easier tier (200 won) also earned along the way');
  assert.strictEqual(s.achievements['living_legend'], true, '500 won');
});

test('Legend: just under 500 games played does not unlock it', () => {
  const s = mkStats({ yonma: { gamesPlayed: 499 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['legend'], undefined);
});

test('Safe Player ladder: the 5/10/20-hand tiers each unlock their Game Music track, 30 does not (only 3 bonus tracks exist)', () => {
  const s = mkStats({ bestNoDealInStreak: 15 });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['safe_player_5'], true);
  assert.strictEqual(s.achievements['safe_player_10'], true);
  assert.strictEqual(s.achievements['safe_player_20'], undefined);
  assert.deepStrictEqual(s.unlockedTracks, ['elegy', 'city_lights']);

  const s2 = mkStats({ bestNoDealInStreak: 30 });
  applyUnlocks(s2);
  assert.deepStrictEqual(s2.unlockedTracks, ['elegy', 'city_lights', 'groovy_tea'], 'safe_player_30 grants a title but no track');
});

test('Yakuman Collector/Legend: sums ANY combination of yakuman-tier wins, not one specific kind', () => {
  const s = mkStats({
    yonma: { yaku: { 'Suu Ankou': 1, 'Chiihou': 1 } },
    sanma: { yaku: { 'Kazoe Yakuman': 1 } },
  });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['yakuman_collector'], true, '3 total across different kinds/variants');
  assert.strictEqual(s.achievements['yakuman_legend'], undefined, 'only 3, not yet 10');
  assert.strictEqual(s.achievements['yakuman_hunter'], true, 'the "any yakuman at all" tier is also satisfied');
});

test('Master of Forms: 20 distinct yaku required, not just 20 total wins of the same yaku', () => {
  const yaku = {};
  for (let i = 0; i < 20; i++) yaku['Yaku' + i] = 1; // 20 distinct names, 1 win each
  const s = mkStats({ yonma: { yaku } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['renaissance_plus'], true);

  const sameYakuOver20Times = mkStats({ yonma: { yaku: { 'Riichi': 20 } } }); // 1 distinct name
  applyUnlocks(sameYakuOver20Times);
  assert.strictEqual(sameYakuOver20Times.achievements['renaissance_plus'], undefined);
});

test('Survivor: 50+ games with zero busts unlocks it', () => {
  const s = mkStats({ yonma: { gamesPlayed: 50, busts: 0 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['survivor'], true);
});

test('Survivor: a single bust anywhere in the record permanently blocks it, even with 50+ games played', () => {
  const s = mkStats({ yonma: { gamesPlayed: 60, busts: 1 } });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['survivor'], undefined);
});

// ══════════════════════════════════════════════════════════════════════════
// Sanity: every achievement id is unique, and every unlocksTitle is unique
// (two different achievements silently sharing a title would make one of
// them permanently unreachable-looking in the UI).
// ══════════════════════════════════════════════════════════════════════════

test('every achievement id is unique', () => {
  const ids = ACHIEVEMENTS.map(a => a.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('every unlocksTitle is unique across achievements', () => {
  const titles = ACHIEVEMENTS.map(a => a.unlocksTitle).filter(Boolean);
  assert.strictEqual(new Set(titles).size, titles.length);
});

// Would have caught the earlier "High Roller"/"Three Colors"/"Flush
// Master" cleanups leaving profiles.js's TITLES out of sync — setTitle
// silently no-ops for any title not listed there (see its own comment),
// so an achievement whose unlocksTitle isn't in TITLES grants a title the
// player can never actually equip.
test('every unlocksTitle is listed in profiles.js\'s TITLES (setTitle would otherwise silently reject it)', () => {
  const missing = ACHIEVEMENTS.map(a => a.unlocksTitle).filter(Boolean).filter(t => !TITLES.includes(t));
  assert.deepStrictEqual(missing, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.error}`);
  process.exitCode = 1;
}
