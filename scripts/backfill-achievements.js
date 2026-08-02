'use strict';
// One-time maintenance script — re-checks every existing profile's stored
// stats against the current achievement list and grants anything already
// satisfied in the numbers but never actually applied (see stats.js's
// recheckAchievements for why this can happen: applyUnlocks only ever runs
// at the moment a game finishes, so a record whose stats already qualify —
// e.g. seeded/imported data, or a game played before an achievement existed
// in the code — with no game played since, never gets re-evaluated on its
// own). Safe to run any number of times.
//
// Respects DATA_DIR the same way the server does, so it can be pointed at a
// deployed Volume too: DATA_DIR=/path/to/volume node scripts/backfill-achievements.js
const { recheckAchievements } = require('../server/stats');
const { getNameById } = require('../server/profiles');

const granted = recheckAchievements();
const ids = Object.keys(granted);
if (!ids.length) {
  console.log('[backfill-achievements] Nothing to backfill — every profile already matches its own stats.');
} else {
  for (const id of ids) {
    console.log(`[backfill-achievements] ${getNameById(id)}: ${granted[id].join(', ')}`);
  }
}
