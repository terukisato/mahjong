'use strict';
// One-time migration: imports the old plain-JSON player data (profiles.json,
// coins.json, friends.json, game-history.json, player-stats.json) into the
// shared SQLite database these files' modules now read/write instead (see
// server/db.js). Run this once after pulling in the SQLite-backed
// profiles.js/economy.js/friends.js/history.js/stats.js, so whatever's
// already in DATA_DIR's JSON files isn't just abandoned.
//
// Idempotent — every insert is "ON CONFLICT DO NOTHING", so a profile/wallet/
// friendship/game/stats record already present in the database (e.g. from a
// previous run of this same script, or because someone already played after
// switching over) is left alone rather than overwritten. The JSON files
// themselves are never modified or deleted — safe to run, check the counts,
// and re-run if anything looks off.
//
// Usage: node server/migrate-json-to-sqlite.js [--dry-run]
//   Respects the same DATA_DIR env var as every other module here.

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const dryRun = process.argv.includes('--dry-run');

function readJson(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`  ! failed to parse ${name}: ${e.message}`);
    return null;
  }
}

function migrateProfiles(db) {
  const all = readJson('profiles.json');
  if (!all) { console.log('profiles.json: not found, skipping.'); return; }
  const insert = db.prepare(`
    INSERT INTO profiles (id, name, salt, code_hash, icon, title, voice_theme, remember_salt, remember_token_hash)
    VALUES (@id, @name, @salt, @code_hash, @icon, @title, @voice_theme, @remember_salt, @remember_token_hash)
    ON CONFLICT(id) DO NOTHING
  `);
  let n = 0;
  for (const [key, p] of Object.entries(all)) {
    if (!p || !p.id || !p.name || !p.salt || !p.codeHash) {
      console.log(`  ! skipping malformed profile record under key "${key}"`);
      continue;
    }
    const r = insert.run({
      id: p.id, name: p.name, salt: p.salt, code_hash: p.codeHash,
      icon: p.icon || 'default', title: p.title || 'Beginner', voice_theme: p.voiceTheme || 'Default',
      remember_salt: p.remember ? p.remember.salt : null,
      remember_token_hash: p.remember ? p.remember.tokenHash : null,
    });
    if (r.changes) n++;
  }
  console.log(`profiles.json: ${n} profile(s) imported.`);
}

function migrateCoins(db) {
  const all = readJson('coins.json');
  if (!all) { console.log('coins.json: not found, skipping.'); return; }
  const insert = db.prepare(`
    INSERT INTO coins (profile_id, balance, last_daily_bonus, earned_today, earned_today_date)
    VALUES (@profile_id, @balance, @last_daily_bonus, @earned_today, @earned_today_date)
    ON CONFLICT(profile_id) DO NOTHING
  `);
  let n = 0;
  for (const [id, r] of Object.entries(all)) {
    const row = insert.run({
      profile_id: id,
      balance: Number.isFinite(r.balance) ? r.balance : 0,
      last_daily_bonus: r.lastDailyBonus || '',
      earned_today: Number.isFinite(r.earnedToday) ? r.earnedToday : 0,
      earned_today_date: r.earnedTodayDate || '',
    });
    if (row.changes) n++;
  }
  console.log(`coins.json: ${n} wallet(s) imported.`);
}

function migrateFriends(db) {
  const all = readJson('friends.json');
  if (!all) { console.log('friends.json: not found, skipping.'); return; }
  const insertEdge = db.prepare('INSERT OR IGNORE INTO friend_edges (id1, id2) VALUES (?,?)');
  const insertReq = db.prepare('INSERT OR IGNORE INTO friend_requests (from_id, to_id) VALUES (?,?)');
  const insertNotif = db.prepare(`
    INSERT INTO friend_notifications (nid, owner_id, type, from_id, from_name, ts, read)
    VALUES (@nid, @owner_id, @type, @from_id, @from_name, @ts, @read)
    ON CONFLICT(nid) DO NOTHING
  `);
  let edges = 0, requests = 0, notifs = 0;
  for (const [id, rec] of Object.entries(all)) {
    // Each mutual friendship is listed on BOTH sides' `friends` arrays —
    // INSERT OR IGNORE means walking every profile's list (and hitting the
    // same pair twice) is harmless, not double-counted here since .changes
    // is 0 the second time.
    for (const fid of rec.friends || []) {
      const [id1, id2] = id < fid ? [id, fid] : [fid, id];
      if (insertEdge.run(id1, id2).changes) edges++;
    }
    // `incoming` is just the mirror of someone else's `outgoing` entry, so
    // walking every profile's own `outgoing` list already covers every
    // pending request exactly once — no need to also read `incoming`.
    for (const fid of rec.outgoing || []) {
      if (insertReq.run(id, fid).changes) requests++;
    }
    for (const n of rec.notifications || []) {
      if (!n || !n.nid) continue;
      const row = insertNotif.run({
        nid: n.nid, owner_id: id, type: n.type, from_id: n.fromId,
        from_name: n.fromName || '', ts: n.ts || Date.now(), read: n.read ? 1 : 0,
      });
      if (row.changes) notifs++;
    }
  }
  console.log(`friends.json: ${edges} friendship(s), ${requests} pending request(s), ${notifs} notification(s) imported.`);
}

function migrateHistory(db) {
  const all = readJson('game-history.json');
  if (!all) { console.log('game-history.json: not found, skipping.'); return; }
  const insert = db.prepare(`
    INSERT INTO game_history
      (game_id, profile_id, date, variant, match_kind, game_mode, num_players, seat, player_names, final_scores, placements, rounds)
    VALUES (@game_id, @profile_id, @date, @variant, @match_kind, @game_mode, @num_players, @seat, @player_names, @final_scores, @placements, @rounds)
    ON CONFLICT(game_id, profile_id) DO NOTHING
  `);
  let n = 0;
  for (const [id, games] of Object.entries(all)) {
    for (const g of games || []) {
      const row = insert.run({
        game_id: g.id, profile_id: id, date: g.date, variant: g.variant,
        match_kind: g.matchKind, game_mode: g.gameMode, num_players: g.numPlayers, seat: g.seat,
        player_names: JSON.stringify(g.playerNames), final_scores: JSON.stringify(g.finalScores),
        placements: JSON.stringify(g.placements), rounds: JSON.stringify(g.rounds || []),
      });
      if (row.changes) n++;
    }
  }
  console.log(`game-history.json: ${n} game record(s) imported.`);
}

// player-stats.json's records are copied as-is, whatever shape they're
// currently in (some may predate a later field stats.js's own _normalize()
// backfills) — that function already runs on every read/write, transparently
// upgrading an old-shaped record the first time it's touched, exactly the
// same as it does reading straight from the JSON file today. No special
// handling needed here.
function migrateStats(db) {
  const all = readJson('player-stats.json');
  if (!all) { console.log('player-stats.json: not found, skipping.'); return; }
  const insert = db.prepare('INSERT INTO stats (profile_id, data) VALUES (?, ?) ON CONFLICT(profile_id) DO NOTHING');
  let n = 0;
  for (const [id, rec] of Object.entries(all)) {
    if (insert.run(id, JSON.stringify(rec)).changes) n++;
  }
  console.log(`player-stats.json: ${n} stats record(s) imported.`);
}

function main() {
  const db = getDb();
  console.log(`Migrating JSON data from ${DATA_DIR} into ${path.join(DATA_DIR, 'janshin.db')}${dryRun ? ' (--dry-run)' : ''}...`);
  db.exec('BEGIN');
  try {
    migrateProfiles(db);
    migrateCoins(db);
    migrateFriends(db);
    migrateHistory(db);
    migrateStats(db);
    if (dryRun) {
      db.exec('ROLLBACK');
      console.log('--dry-run: rolled back, nothing was written.');
    } else {
      db.exec('COMMIT');
      console.log('Done.');
    }
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

main();
