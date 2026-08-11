'use strict';
// One-time migration: repairs game-history.json's per-round `honba` field,
// which used to be recorded as the NEXT round's honba (see room.js
// _recordRoundHistory's fix) instead of the honba that round was actually
// played at. A 3-hand repeat streak played at true honba 0/1/2 was stored
// as 1/2/0 — the last hand borrowing the "reset to 0" label meant for the
// FOLLOWING, different kyoku — so Play History showed "1本場, 2本場, 0本場"
// instead of "0本場, 1本場, 2本場".
//
// This does NOT trust the old (possibly wrong) honba values at all —
// `_recordRoundHistory` always pushed rounds in true chronological play
// order (game logic is inherently sequential; there's no way a later hand
// could get recorded before an earlier one), so the honba for each round
// is reconstructed purely from that reliable ordering: within a game's
// `rounds` array, consecutive entries sharing the same `round` number are
// exactly the repeats of that kyoku, and the Nth entry (0-indexed) in that
// run is honba N.
//
// Usage: node server/fix-history-honba.js [--dry-run]
//   Respects the same DATA_DIR env var as history.js/stats.js/profiles.js.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'game-history.json');
const dryRun = process.argv.includes('--dry-run');

function fixGame(game) {
  let changed = 0;
  let prevRound = null;
  let counter = 0;
  for (const r of game.rounds || []) {
    if (r.round !== prevRound) { counter = 0; prevRound = r.round; }
    if (r.honba !== counter) changed++;
    r.honba = counter;
    counter++;
  }
  return changed;
}

function main() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log(`No history file found at ${HISTORY_FILE} — nothing to do.`);
    return;
  }
  const all = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  let gamesTouched = 0, roundsFixed = 0, gamesTotal = 0;
  for (const pid of Object.keys(all)) {
    for (const game of all[pid]) {
      gamesTotal++;
      const changed = fixGame(game);
      if (changed > 0) { gamesTouched++; roundsFixed += changed; }
    }
  }
  console.log(`Scanned ${gamesTotal} game(s) across ${Object.keys(all).length} profile(s).`);
  console.log(`${gamesTouched} game(s) had mislabeled honba; ${roundsFixed} round(s) corrected.`);
  if (dryRun) {
    console.log('--dry-run: not writing changes.');
    return;
  }
  if (roundsFixed === 0) {
    console.log('No changes needed.');
    return;
  }
  const backupFile = HISTORY_FILE + `.bak-${Date.now()}`;
  fs.copyFileSync(HISTORY_FILE, backupFile);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(all, null, 2));
  console.log(`Backup written to ${backupFile}`);
  console.log(`Updated ${HISTORY_FILE}`);
}

main();
