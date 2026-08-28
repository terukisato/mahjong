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

test('Yakuman Stack: unlocked by the "Yakuman Stack" pseudo-yaku tag (see room.js), independent of Yakuman Collector', () => {
  const s = mkStats({
    yonma: { yaku: { 'Suu Ankou': 1, 'Chinroutou': 1, 'Yakuman Stack': 1 } },
  });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['yakuman_stack'], true);

  // 2 SEPARATE yakuman-tier wins across different hands (no stacking tag)
  // must NOT satisfy yakuman_stack, even though it satisfies yakuman_hunter.
  const s2 = mkStats({
    yonma: { yaku: { 'Suu Ankou': 1, 'Chinroutou': 1 } },
  });
  applyUnlocks(s2);
  assert.strictEqual(s2.achievements['yakuman_stack'], undefined, 'two yakuman in DIFFERENT hands is not the same as stacking them in one');
  assert.strictEqual(s2.achievements['yakuman_hunter'], true);
});

test('Double Yakuman ladder: counts DISTINCT kinds, not total wins, and 2 single yakumans stacked never counts as one', () => {
  // 3 wins of the same double-yakuman kind, plus 2 SINGLE yakumans (which
  // must never count toward a double-yakuman achievement even combined).
  const s = mkStats({
    yonma: { yaku: { 'Kokushi Juusanmen': 3, 'Suu Ankou': 1, 'Chiihou': 1 } },
  });
  applyUnlocks(s);
  assert.strictEqual(s.achievements['double_yakuman_hunter'], true, '1 distinct kind is enough for the "any kind" tier');
  assert.strictEqual(s.achievements['double_yakuman_collector'], undefined, 'still only 1 distinct kind, not 2');
  assert.strictEqual(s.achievements['double_yakuman_legend'], undefined);

  const s2 = mkStats({
    yonma: { yaku: { 'Kokushi Juusanmen': 1, 'Daisuushii': 1 } },
  });
  applyUnlocks(s2);
  assert.strictEqual(s2.achievements['double_yakuman_collector'], true, '2 distinct kinds clears the collector tier');
  assert.strictEqual(s2.achievements['double_yakuman_legend'], undefined, 'only 2 of the 4 kinds, not all 4');

  const s3 = mkStats({
    yonma: { yaku: { 'Kokushi Juusanmen': 1, 'Daisuushii': 1, 'Suu Ankou Tanki': 1, 'Junsei Chuuren': 1 } },
  });
  applyUnlocks(s3);
  assert.strictEqual(s3.achievements['double_yakuman_legend'], true, 'all 4 distinct kinds unlocks the top tier');
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

// A title in TITLES but absent from the client's `titles` picker array can
// be earned and equipped server-side but never SHOWN in User Profile >
// Title (renderTitles only iterates that array), so the player sees nothing
// change — exactly the "Mighty Mouse not visible after 30 yaku" report.
// The reverse (a picker entry not in TITLES) is a title setTitle silently
// rejects, so the button does nothing. Both directions must stay in sync.
test('client titles picker (public/script.js) exactly matches profiles.js TITLES', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');
  const block = src.match(/const titles=\[([\s\S]*?)\n\];/);
  assert.ok(block, 'could not locate `const titles=[` array in public/script.js');
  const clientIds = [...block[1].matchAll(/\{id:\s*("[^"]+"|'[^']+')/g)].map(m => m[1].slice(1, -1));
  const clientSet = new Set(clientIds);
  const titleSet = new Set(TITLES);
  assert.deepStrictEqual(TITLES.filter(t => !clientSet.has(t)), [], 'TITLES missing from client picker');
  assert.deepStrictEqual(clientIds.filter(t => !titleSet.has(t)), [], 'client picker has titles not in TITLES');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n    ${f.error}`);
  process.exitCode = 1;
}
