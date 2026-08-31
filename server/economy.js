'use strict';
const fs = require('fs');
const path = require('path');

// Coin economy — a soft currency earned by playing, spent (later) on
// cosmetic customization. Sits alongside profiles.js (who a player is),
// stats.js (how they've done) and friends.js (their social graph). Same
// plain-JSON-file approach and reasoning as those: no real concurrency at
// this scale, re-read on every call rather than cached in memory (a restart
// mid-write would otherwise let a stale cache clobber the file — see
// stats.js's own comment). Same DATA_DIR env var so this file sits next to
// the others on whatever persistent volume a deployment mounts.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const COINS_FILE = path.join(DATA_DIR, 'coins.json');

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

function _load() {
  try {
    return JSON.parse(fs.readFileSync(COINS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function _save(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(COINS_FILE, JSON.stringify(all, null, 2));
}

// The normalized record for one profile id — every field defaulted, so
// callers never have to null-check. `earnedToday` is rolled back to 0 here
// (not on write) the first time it's read on a new UTC day.
function _record(all, id) {
  const r = all[id] || {};
  r.balance = Number.isFinite(r.balance) ? r.balance : 0;
  r.lastDailyBonus = typeof r.lastDailyBonus === 'string' ? r.lastDailyBonus : '';
  r.earnedToday = Number.isFinite(r.earnedToday) ? r.earnedToday : 0;
  r.earnedTodayDate = typeof r.earnedTodayDate === 'string' ? r.earnedTodayDate : '';
  if (r.earnedTodayDate !== _today()) {
    r.earnedToday = 0;
    r.earnedTodayDate = _today();
  }
  all[id] = r;
  return r;
}

function getBalance(id) {
  return _record(_load(), id).balance;
}

// Once-per-UTC-day login bonus. Returns {balance, granted, amount} either
// way — `granted:false` (amount 0) when already claimed today.
function claimDailyBonus(id) {
  if (!id) return { balance: 0, granted: false, amount: 0 };
  const all = _load();
  const rec = _record(all, id);
  if (rec.lastDailyBonus === _today()) {
    return { balance: rec.balance, granted: false, amount: 0 };
  }
  rec.balance += DAILY_BONUS;
  rec.lastDailyBonus = _today();
  _save(all);
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

  const all = _load();
  const rec = _record(all, id);
  const room = Math.max(0, DAILY_EARN_CAP - rec.earnedToday);
  const delta = Math.min(gross, room);
  if (delta > 0) {
    rec.balance += delta;
    rec.earnedToday += delta;
    _save(all);
  }
  return { balance: rec.balance, delta, base, bonus, gross, capped: delta < gross };
}

// Deduct coins — for the future shop. Not called anywhere yet; here so the
// spend side of the contract exists. Returns {ok, balance, error?}.
function spend(id, amount) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  const all = _load();
  const rec = _record(all, id);
  if (amount > rec.balance) return { ok: false, balance: rec.balance, error: 'Not enough coins' };
  rec.balance -= amount;
  _save(all);
  return { ok: true, balance: rec.balance };
}

// Profile deleted (see 'delete_profile' in index.js) — drop its wallet.
function purge(id) {
  const all = _load();
  if (all[id]) { delete all[id]; _save(all); }
}

module.exports = {
  getBalance, claimDailyBonus, awardGameCoins, spend, purge,
  DAILY_BONUS, DAILY_EARN_CAP,
};
