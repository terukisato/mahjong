# 雀心 Janshin

A riichi mahjong web game for quick, casual matches against AI opponents. Built as a lightweight Node.js + WebSocket server with a dependency-free vanilla-JS frontend (tiles are rendered as inline SVG — no image assets, no build step).

## Features

- Full riichi mahjong rule set: all standard yaku and yakuman, dora/ura dora/aka dora, fu/han scoring, furiten, ippatsu, chankan, rinshan, kan (ankan/minkan/kakan), nagashi mangan, tenpai payments, honba/riichi-stick carryover
- Tōnpūsen (東風戦, 4-round) and Hanchan (半荘戦, 8-round) game modes
- Play with 1-4 humans; empty seats are filled by AI bots
- Voice lines, sound effects, and background music with per-track volume controls and selectable voice themes
- Round-end and game-end results panels, in-game chat

## Quick start

Requires Node.js 18+.

```bash
npm install
npm start    # production server on http://localhost:3000
npm run dev  # same, with nodemon auto-restart
npm test     # run the full test suite (node:test)
```

Open `http://localhost:3000` in a browser (or several tabs/devices, for a real multiplayer match) and click **Find Match**.

## Project structure

```
server/
  index.js        WebSocket server + matchmaking (one shared "waiting room" per game mode)
  room.js         Game state machine: turns, calls, scoring, round/game lifecycle
  mahjong.js      Pure game logic: tile decomposition, win checking, yaku/fu/scoring
  bot.js          Simple heuristic AI for empty seats
  *.test.js       node:test suites, one per module (mahjong, room, bot, stats, …)
public/
  index.html      All screens (lobby, table, results) in one page
  script.js       Client state, WebSocket handling, rendering, SVG tile art
  style.css       Styling
  release-notes.js What's New entries; the newest published one is the game's version
  audio/          Music, sound effects, and per-theme voice lines
scripts/
  release-notes.js Drafts and publishes entries in public/release-notes.js (npm run release-notes)
  sync-version.js Keeps package.json's version in sync with the newest release note
```

There is no build step — `public/` is served as static files directly.

## Architecture notes

- **Server owns all game state.** `room.js` is the single source of truth; the client only ever renders whatever `game_state` it's sent and never computes legality itself.
- **`mahjong.js` is pure and stateless.** It has no notion of turn order, sockets, or players — just "given these tiles, is this a win / what yaku / how many points."
- Each client gets its own filtered `game_state` broadcast (own hand visible, opponents' hands sent as bare counts) — see `_sendState` in `room.js`.

## Testing

Tests use Node's built-in test runner (`node:test` + `assert`), so there are no test dependencies. Every `server/*.test.js` file is picked up automatically.

```bash
npm test                # run every suite once
npm run test:watch      # re-run on file changes
npm run test:coverage   # run with a coverage report; fails below 80% line coverage
node --test --test-name-pattern="Pinfu" server/mahjong.test.js   # run matching tests only
```

The suites cover yaku/fu/dora detection (`mahjong.test.js`), payments and round flow on the real `Room` class (`room.test.js`), bot decisions, achievements, stats, economy, friends and history. Tests that touch persistence point `DATA_DIR` at a fresh temp directory, so they never read or write the real database.

**CI:** `.github/workflows/ci.yml` runs `npm ci`, `npm audit --audit-level=high` and `npm run test:coverage` on every push to `master`/`test` and on every pull request.

## Deployment

Configured for [Railway](https://railway.app) (`railway.json`, `Procfile`) — deploys via Nixpacks and runs `npm start`. `PORT` is read from the environment, defaulting to 3000.

## License

MIT — see `package.json`.
