'use strict';
const { getDb } = require('./db');

// Player feedback store — bug reports and contact messages sent from the
// About panel's Contact form, listed/dismissed from Developer Settings.
// Deliberately collects no contact details (no email, see the Privacy
// Policy): replies, if any, happen in-game or not at all, and an account
// request is tied to the sender's logged-in profile instead.

const CATEGORIES = ['bug', 'feedback', 'account'];
const MAX_MESSAGE = 2000;
// Hard cap on stored rows so a spammer can't grow the database without
// bound — once over, the oldest reports are trimmed first.
const MAX_ROWS = 500;

function submit({ profileId, name, category, message, version, userAgent }) {
  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'Please write a message.' };
  if (text.length > MAX_MESSAGE) return { ok: false, error: `Message is too long (max ${MAX_MESSAGE} characters).` };
  const cat = CATEGORIES.includes(category) ? category : 'feedback';
  const db = getDb();
  db.prepare('INSERT INTO feedback (ts, profile_id, name, category, message, version, user_agent) VALUES (?,?,?,?,?,?,?)')
    .run(Date.now(), profileId || null, String(name || 'Guest').slice(0, 40), cat, text,
      String(version || '').slice(0, 20), String(userAgent || '').slice(0, 300));
  db.prepare('DELETE FROM feedback WHERE id NOT IN (SELECT id FROM feedback ORDER BY id DESC LIMIT ?)').run(MAX_ROWS);
  return { ok: true };
}

function list() {
  return getDb().prepare('SELECT id, ts, profile_id AS profileId, name, category, message, version, user_agent AS userAgent FROM feedback ORDER BY id DESC').all();
}

function remove(id) {
  getDb().prepare('DELETE FROM feedback WHERE id = ?').run(Number(id));
}

// Profile deleted (see 'delete_profile' in index.js) — drop its reports,
// same purge() convention as economy.js/friends.js/cosmetics.js.
function purge(profileId) {
  getDb().prepare('DELETE FROM feedback WHERE profile_id = ?').run(profileId);
}

module.exports = { CATEGORIES, MAX_MESSAGE, submit, list, remove, purge };
