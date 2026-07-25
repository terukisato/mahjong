'use strict';
const fs = require('fs');
const path = require('path');

// Plain JSON-file persistence, keyed by free-typed player name (there's no
// account system anywhere in this app, so names are trivially spoofable/
// collidable across players — an accepted limitation, not a bug). Loaded
// once into an in-memory cache and rewritten in full after each update;
// writes only happen once per finished game, so there's no meaningful
// concurrency to worry about in this single-threaded server.
const DATA_DIR = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'player-stats.json');

let cache = null;

function _load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (e) {
    cache = {};
  }
  return cache;
}

function _save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(cache, null, 2));
}

function _emptyStats() {
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

function getStats(name) {
  const all = _load();
  return all[name] ? { ...all[name], placements: [...all[name].placements], yaku: { ...all[name].yaku } } : _emptyStats();
}

// playerNames/isBot/finalScores/placements/handStats are all seat-indexed
// arrays of the same length (3 or 4, depending on game mode). Bots and
// empty seats are skipped — only human players accumulate persistent stats.
function recordGameResult({ playerNames, isBot, finalScores, placements, handStats }) {
  const all = _load();
  for (let seat = 0; seat < playerNames.length; seat++) {
    if (isBot[seat]) continue;
    const name = playerNames[seat];
    if (!name) continue;
    const s = all[name] || _emptyStats();
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
    all[name] = s;
  }
  _save();
}

module.exports = { getStats, recordGameResult };
