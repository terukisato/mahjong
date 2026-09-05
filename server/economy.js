'use strict';
const { getDb } = require('./db');

// Coin economy — a soft currency earned by playing, spent (later) on
// cosmetic customization. Sits alongside profiles.js (who a player is),
// stats.js (how they've done) and friends.js (their social graph) in the
// same shared SQLite database (see server/db.js) — this file only ever
// touches its own `coins` table.

// Granted once per UTC calendar day when a profile is unlocked.
const DAILY_BONUS = 100;
// Ceiling on coins EARNED FROM GAMES per UTC day (the login bonus above is
// separate and uncapped). High enough a normal session never touches it;
// just stops all-day grinding against bots.
const DAILY_EARN_CAP = 500;
// Games vs bots (Quick Match) pay a fraction of a Room Match's rate.
const QUICK_MULTIPLIER = 0.6;
// Performance bonus: +1 per this many points above the starting stock...
const BONUS_PER_POINTS = 2000;
// ...capped here, and never negative (a below-start finish is just +0).
const BONUS_CAP = 25;
const START_STOCK = { yonma: 25000, sanma: 35000 };

// Base placement reward: [1st, 2nd, 3rd, 4th]. Hanchan (8 rounds, ~2x the
// length of a tonpuu) pays ~1.5x, rounded to tidy numbers.
const BASE = {
  yonma: { tonpuu: [50, 25, 10, 5], hanchan: [75, 40, 15, 10] },
  sanma: { tonpuu: [45, 20, 5],     hanchan: [70, 30, 10] },
};

function _today() {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

// Reads one profile's wallet row (a fresh, all-zero one for an id that's
// never earned anything), rolling earnedToday/earnedTodayDate back to 0 the
// first time it's read on a new UTC day — same normalization the old
// coins.json record did on load. Callers write it back with _put.
function _get(db, id) {
  const row = db.prepare('SELECT balance, last_daily_bonus, earned_today, earned_today_date FROM coins WHERE profile_id = ?').get(id);
  const rec = row
    ? { balance: row.balance, lastDailyBonus: row.last_daily_bonus, earnedToday: row.earned_today, earnedTodayDate: row.earned_today_date }
    : { balance: 0, lastDailyBonus: '', earnedToday: 0, earnedTodayDate: '' };
  if (rec.earnedTodayDate !== _today()) {
    rec.earnedToday = 0;
    rec.earnedTodayDate = _today();
  }
  return rec;
}

function _put(db, id, rec) {
  db.prepare(`
    INSERT INTO coins (profile_id, balance, last_daily_bonus, earned_today, earned_today_date)
    VALUES (?,?,?,?,?)
    ON CONFLICT(profile_id) DO UPDATE SET
      balance = excluded.balance,
      last_daily_bonus = excluded.last_daily_bonus,
      earned_today = excluded.earned_today,
      earned_today_date = excluded.earned_today_date
  `).run(id, rec.balance, rec.lastDailyBonus, rec.earnedToday, rec.earnedTodayDate);
}

function getBalance(id) {
  return _get(getDb(), id).balance;
}

// Once-per-UTC-day login bonus. Returns {balance, granted, amount} either
// way — `granted:false` (amount 0) when already claimed today.
function claimDailyBonus(id) {
  if (!id) return { balance: 0, granted: false, amount: 0 };
  const db = getDb();
  const rec = _get(db, id);
  if (rec.lastDailyBonus === _today()) {
    return { balance: rec.balance, granted: false, amount: 0 };
  }
  rec.balance += DAILY_BONUS;
  rec.lastDailyBonus = _today();
  _put(db, id, rec);
  return { balance: rec.balance, granted: true, amount: DAILY_BONUS };
}

// End-of-game payout. `mode` is 'tonpuu' | 'hanchan', `matchKind` is
// 'quick' | 'room', `placement` is 1-based (1..4). Returns
// {balance, delta, base, bonus, gross, capped} — `delta` is what actually
// landed after the daily cap (can be 0 if the cap was already hit); `gross`
// is what it would have been.
function awardGameCoins(id, { variant, mode, matchKind, placement, finalScore }) {
  const zero = { balance: getBalance(id), delta: 0, base: 0, bonus: 0, gross: 0, capped: false };
  if (!id) return zero;
  const table = BASE[variant] && BASE[variant][mode === 'hanchan' ? 'hanchan' : 'tonpuu'];
  if (!table) return zero;
  const base = (placement >= 1 && placement <= table.length) ? table[placement - 1] : 0;

  const start = START_STOCK[variant] || 25000;
  const bonus = Math.min(BONUS_CAP, Math.max(0, Math.floor((finalScore - start) / BONUS_PER_POINTS)));

  let gross = base + bonus;
  if (matchKind === 'quick') gross = Math.round(gross * QUICK_MULTIPLIER);

  const db = getDb();
  const rec = _get(db, id);
  const room = Math.max(0, DAILY_EARN_CAP - rec.earnedToday);
  const delta = Math.min(gross, room);
  if (delta > 0) {
    rec.balance += delta;
    rec.earnedToday += delta;
    _put(db, id, rec);
  }
  return { balance: rec.balance, delta, base, bonus, gross, capped: delta < gross };
}

// Deduct coins — for the future shop. Not called anywhere yet; here so the
// spend side of the contract exists. Returns {ok, balance, error?}.
function spend(id, amount) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  const db = getDb();
  const rec = _get(db, id);
  if (amount > rec.balance) return { ok: false, balance: rec.balance, error: 'Not enough coins' };
  rec.balance -= amount;
  _put(db, id, rec);
  return { ok: true, balance: rec.balance };
}

// Profile deleted (see 'delete_profile' in index.js) — drop its wallet.
function purge(id) {
  getDb().prepare('DELETE FROM coins WHERE profile_id = ?').run(id);
}

module.exports = {
  getBalance, claimDailyBonus, awardGameCoins, spend, purge,
  DAILY_BONUS, DAILY_EARN_CAP,
};
