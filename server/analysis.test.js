'use strict';
// Tests for the replay pipeline: room.js's move log (replay.js format), the
// state rebuild every consumer steps through, and analysis.js's review.
// Run with: node --test server/analysis.test.js
const assert = require('assert');
const { test } = require('node:test');
const { key } = require('./mahjong');
const R = require('./replay');
const { analyzeGame } = require('./analysis');

// Plays one whole all-bot game headlessly: setTimeout is swapped for a
// manual queue (Room schedules every bot turn/round transition through it),
// and every round's log is replayed and checked against the real table at
// the moment the round ends. Returns {replay, checked}.
function playBotGame(numPlayers) {
  const queue = [];
  let now = 0;
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  global.setTimeout = (fn, ms) => { const t = { fn, at: now + (ms || 0) }; queue.push(t); return t; };
  global.clearTimeout = t => { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); };
  try {
    const history = require('./history');
    const stats = require('./stats');
    const economy = require('./economy');
    const saved = [history.recordGame, stats.recordGameResult, economy.awardGameCoins];
    let replay = null;
    // room.js destructured these at require time, so stub via the cache
    // before the first require of room.js below.
    history.recordGame = a => { replay = a.replay; };
    stats.recordGameResult = () => [];
    economy.awardGameCoins = () => ({});
    delete require.cache[require.resolve('./room')];
    const { Room } = require('./room');
    [history.recordGame, stats.recordGameResult, economy.awardGameCoins] = saved;

    const room = new Room('tonpuu', 'normal', {}, numPlayers);
    for (let i = 0; i < numPlayers; i++) room.seats[i] = { isBot: true, seat: i, name: `Bot${i}`, difficulty: 'normal' };
    room._send = () => {};
    room._broadcastAll = () => {};
    let checked = 0;
    const end = room._rlEnd.bind(room);
    room._rlEnd = payload => {
      const g = room.game, log = g.replayLog;
      const st = R.initialState(log);
      for (const e of log.ev) R.applyEvent(st, e);
      for (let s = 0; s < numPlayers; s++) {
        assert.deepStrictEqual(st.hands[s].map(R.codeKey).sort(), g.hands[s].map(key).sort(), `hand seat ${s}`);
        assert.deepStrictEqual(st.discards[s].filter(d => !d.called).map(d => R.codeKey(d.k)), g.discards[s].map(key), `pond seat ${s}`);
        assert.strictEqual(st.melds[s].length, g.melds[s].length, `melds seat ${s}`);
      }
      checked++;
      end(payload);
    };
    room.start();
    for (let steps = 0; queue.length && steps < 200000 && room.phase !== 'done'; steps++) {
      queue.sort((a, b) => a.at - b.at);
      const t = queue.shift(); now = t.at; t.fn();
      if (room.phase === 'playing' && room.pendingNextRound && !queue.length) {
        const f = room.pendingNextRound; room.pendingNextRound = null; f();
      }
    }
    delete require.cache[require.resolve('./room')];
    return { replay, checked };
  } finally {
    global.setTimeout = realSet; global.clearTimeout = realClear;
  }
}

test('tile codes round-trip, red fives included', () => {
  assert.strictEqual(R.enc({ v: 5, s: 'p', red: true }), '0p');
  assert.deepStrictEqual(R.dec('0p'), { v: 5, s: 'p', red: true });
  assert.strictEqual(R.codeKey('0s'), '5s');
  assert.deepStrictEqual(R.sortCodes(['3z', '5p', '0p', '1m']), ['1m', '0p', '5p', '3z']);
});

for (const n of [4, 3]) {
  test(`a ${n}-player bot game's replay rebuilds every round exactly, and analyses cleanly`, () => {
    const { replay, checked } = playBotGame(n);
    assert.ok(replay, 'game should finish and hand a replay to recordGame');
    assert.strictEqual(replay.rounds.length, checked);
    assert.ok(checked >= n, 'tonpuu plays at least one round per dealer');
    for (const r of replay.rounds) assert.ok(r.res && r.res.reason, 'each round carries its result');
    const a = analyzeGame(replay, 0, Array.from({ length: n }, (_, i) => `Bot${i}`));
    assert.strictEqual(a.rounds.length, replay.rounds.length);
    assert.ok(a.summary.decisions > 0);
    for (const round of a.rounds) {
      for (const d of round.decisions) {
        assert.ok(['best', 'good', 'tip', 'inaccuracy', 'mistake', 'blunder'].includes(d.sev));
        assert.ok(typeof d.text === 'string' && d.text.length);
        assert.ok(Number.isInteger(d.i));
      }
    }
    // Grades vary game to game (random deals), so only the shape is checked.
    assert.ok(a.summary.accuracy >= 0 && a.summary.accuracy <= 100);
    assert.ok(a.summary.rating >= 0 && a.summary.rating <= 100);
  });
}

// Hand-built round: seat 0 is dealt a tenpai hand and draws its winning
// tile, then discards instead of declaring tsumo.
test('discarding a winning hand is flagged as a missed tsumo', () => {
  const hand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '2z', '2z', '6m', '7m'];
  const round = {
    dealer: 0, round: 1, roundWind: 1, honba: 0, riichiSticks: 0, scores: [25000, 25000, 25000, 25000],
    hands: [hand, ['1z', '1z', '1z', '3z', '3z', '3z', '9p', '9p', '9p', '1s', '1s', '4z', '4z'],
      ['1p', '1p', '2p', '2p', '3p', '3p', '7p', '7p', '8p', '8p', '9s', '9s', '6z'],
      ['2s', '2s', '3s', '3s', '4s', '4s', '6s', '6s', '7z', '7z', '5z', '5z', '4m']],
    dora: ['1z'],
    ev: [{ t: 'd', s: 0, k: '8m' }, { t: 'x', s: 0, k: '8m', tg: 1 }],
    res: { reason: 'draw', winners: [], scores: [25000, 25000, 25000, 25000] },
  };
  const a = analyzeGame({ rules: { kuitanAri: true }, rounds: [round] }, 0, ['Me', 'A', 'B', 'C']);
  const d = a.rounds[0].decisions.find(x => x.i === 1);
  assert.strictEqual(d.sev, 'blunder');
  assert.match(d.text, /Tsumo/);
});

test('passing an offered ron is flagged', () => {
  const round = {
    dealer: 1, round: 1, roundWind: 1, honba: 0, riichiSticks: 0, scores: [25000, 25000, 25000, 25000],
    hands: [['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '2z', '2z', '6m', '7m'],
      ['1z', '1z', '1z', '3z', '3z', '3z', '9p', '9p', '9p', '1s', '1s', '4z', '4z'],
      ['1p', '1p', '2p', '2p', '3p', '3p', '7p', '7p', '8p', '8p', '9s', '9s', '6z'],
      ['2s', '2s', '3s', '3s', '4s', '4s', '6s', '6s', '7z', '7z', '5z', '5z', '4m']],
    dora: ['1z'],
    ev: [{ t: 'd', s: 1, k: '8m' }, { t: 'x', s: 1, k: '8m', tg: 1 }, { t: 'pass', s: 0, o: ['ron'] }],
    res: { reason: 'draw', winners: [], scores: [25000, 25000, 25000, 25000] },
  };
  const a = analyzeGame({ rules: {}, rounds: [round] }, 0, ['Me', 'A', 'B', 'C']);
  const d = a.rounds[0].decisions.find(x => x.i === 2);
  assert.strictEqual(d.sev, 'blunder');
  assert.match(d.text, /Ron/);
});

test('a pure-efficiency mistake recommends the better tile', () => {
  // 1-shanten with an isolated 9p: cutting 9p is clearly best, cutting into
  // the 2m-3m ryanmen is a step back in acceptance.
  const round = {
    dealer: 0, round: 1, roundWind: 1, honba: 0, riichiSticks: 0, scores: [25000, 25000, 25000, 25000],
    hands: [['2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '4m', '5m', '6m', '3s', '9p'],
      ['1z', '1z', '1z', '3z', '3z', '3z', '9p', '9p', '9p', '1s', '1s', '4z', '4z'],
      ['1p', '1p', '2p', '2p', '3p', '3p', '7p', '7p', '8p', '8p', '9s', '9s', '6z'],
      ['2s', '2s', '3s', '3s', '4s', '4s', '6s', '6s', '7z', '7z', '5z', '5z', '1m']],
    dora: ['1z'],
    ev: [{ t: 'd', s: 0, k: '6z' }, { t: 'x', s: 0, k: '2m' }],
    res: { reason: 'draw', winners: [], scores: [25000, 25000, 25000, 25000] },
  };
  const a = analyzeGame({ rules: {}, rounds: [round] }, 0, ['Me', 'A', 'B', 'C']);
  const d = a.rounds[0].decisions.find(x => x.i === 1);
  assert.notStrictEqual(d.sev, 'best');
  assert.notStrictEqual(d.best.k, '2m');
  assert.match(d.text, /instead of \[\[2m\]\]/);
});
