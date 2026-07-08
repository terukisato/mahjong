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
npm test     # run the yaku/scoring regression suite
```

Open `http://localhost:3000` in a browser (or several tabs/devices, for a real multiplayer match) and click **Find Match**.

## Project structure

```
server/
  index.js        WebSocket server + matchmaking (one shared "waiting room" per game mode)
  room.js         Game state machine: turns, calls, scoring, round/game lifecycle
  mahjong.js      Pure game logic: tile decomposition, win checking, yaku/fu/scoring
  bot.js          Simple heuristic AI for empty seats
  mahjong.test.js Regression test suite for mahjong.js (plain Node assertions, no framework)
public/
  index.html      All screens (lobby, table, results) in one page
  script.js       Client state, WebSocket handling, rendering, SVG tile art
  style.css       Styling
  audio/          Music, sound effects, and per-theme voice lines
scripts/
  sync-version.js Keeps package.json's version in sync with the version shown in the about modal
```

There is no build step — `public/` is served as static files directly.

## Architecture notes

- **Server owns all game state.** `room.js` is the single source of truth; the client only ever renders whatever `game_state` it's sent and never computes legality itself.
- **`mahjong.js` is pure and stateless.** It has no notion of turn order, sockets, or players — just "given these tiles, is this a win / what yaku / how many points."
- Each client gets its own filtered `game_state` broadcast (own hand visible, opponents' hands sent as bare counts) — see `_sendState` in `room.js`.

## Testing

`npm test` runs `server/mahjong.test.js`, a from-scratch regression suite (no test framework dependency) covering every yaku, several edge cases that are easy to get subtly wrong (ron- vs tsumo-completed triplets for sanankou/suuankou, wait-shape requirements for pinfu, dealer double-wind, dora indicator wraparound for honors, etc.), and the dora/fu helpers. Run it after any change to `server/mahjong.js`.

## Deployment

Configured for [Railway](https://railway.app) (`railway.json`, `Procfile`) — deploys via Nixpacks and runs `npm start`. `PORT` is read from the environment, defaulting to 3000.

## License

MIT — see `package.json`.
