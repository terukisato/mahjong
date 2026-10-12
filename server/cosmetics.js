'use strict';
const { getDb } = require('./db');
const { spend, getBalance } = require('./economy');
const { setIcon, setNameplateSkin, setCallStyle } = require('./profiles');

// Shop catalog — the server-authoritative source of prices/tiers. Never
// trust a price from the client; every purchase looks the item up here.
// Mirrors ICON_CATALOG/NAMEPLATE_CATALOG/CALLSTYLE_CATALOG in public/script.js (same ids on
// both sides so no client<->server id translation is ever needed) — that
// copy only drives rendering, this one is what actually gets charged.
const CATALOG = {
  icon: {
    tsuki:   { price: 600,  tier: 'common' },
    neko:    { price: 700,  tier: 'common' },
    koi:     { price: 1100, tier: 'uncommon' },
    kitsune: { price: 1800, tier: 'rare' },
    daruma:  { price: 6000, tier: 'legendary' },
  },
  nameplate: {
    hai:        { price: 1300, tier: 'uncommon' },
    tatamiberi: { price: 1400, tier: 'uncommon' },
    andon:      { price: 2200, tier: 'rare' },
    hyosatsu:   { price: 2600, tier: 'rare' },
    kinpaku:    { price: 8000, tier: 'legendary' },
  },
  // Win/riichi call styles — how the ツモ/ロン/リーチ call is staged in the
  // cutscene. Everyone at the table sees the CALLER's equipped style.
  callstyle: {
    noren:     { price: 1000, tier: 'common' },
    lantern:   { price: 1200, tier: 'uncommon' },
    tenbou:    { price: 1200, tier: 'uncommon' },
    sakura:    { price: 2200, tier: 'rare' },
    sensu:     { price: 2400, tier: 'rare' },
    kaminari:  { price: 3000, tier: 'rare' },
    hanabi:    { price: 6500, tier: 'legendary' },
  },
};

// Catalog section an item id belongs to, or null if it isn't for sale.
function _typeOf(itemId) {
  for (const type of Object.keys(CATALOG)) if (CATALOG[type][itemId]) return type;
  return null;
}

// Always-owned — the free icons that already ship (see playerIcons in
// script.js) plus the plain nameplate. Never purchasable, never stored in
// cosmetic_purchases (that table only ever needs a row for something
// actually bought).
const FREE_ICONS = ['default', 'man', 'sou', 'pin', 'chun', 'hatsu'];
const FREE_NAMEPLATE = 'default';
const FREE_CALLSTYLE = 'default'; // the jade-band call everyone has

function _ownedRows(profileId) {
  return getDb().prepare('SELECT item_id FROM cosmetic_purchases WHERE profile_id = ?')
    .all(profileId).map(r => r.item_id);
}

// {icons:[...], nameplates:[...], callStyles:[...]} — always includes the
// free defaults, plus whatever's actually been bought. Drives both the
// Shop's owned/locked state and the equip gate below.
function getOwned(profileId) {
  const icons = [...FREE_ICONS];
  const nameplates = [FREE_NAMEPLATE];
  const callStyles = [FREE_CALLSTYLE];
  if (!profileId) return { icons, nameplates, callStyles };
  for (const id of _ownedRows(profileId)) {
    if (CATALOG.icon[id]) icons.push(id);
    else if (CATALOG.nameplate[id]) nameplates.push(id);
    else if (CATALOG.callstyle[id]) callStyles.push(id);
  }
  return { icons, nameplates, callStyles };
}

function _isOwned(profileId, type, itemId) {
  if (type === 'icon' && FREE_ICONS.includes(itemId)) return true;
  if (type === 'nameplate' && itemId === FREE_NAMEPLATE) return true;
  if (type === 'callstyle' && itemId === FREE_CALLSTYLE) return true;
  return getDb().prepare('SELECT 1 FROM cosmetic_purchases WHERE profile_id = ? AND item_id = ?')
    .get(profileId, itemId) != null;
}

// Buys one catalog item. Returns {ok, balance, error?}. Validates the item
// exists and isn't already owned before ever touching the wallet — spend()
// itself re-validates the balance, this only adds the "what are we even
// buying" checks specific to cosmetics.
function purchase(profileId, itemId) {
  if (!profileId) return { ok: false, balance: 0, error: 'Not signed in' };
  const type = _typeOf(itemId);
  if (!type) return { ok: false, balance: getBalance(profileId), error: 'Unknown item' };
  if (_isOwned(profileId, type, itemId)) {
    return { ok: false, balance: getBalance(profileId), error: 'Already owned' };
  }
  const result = spend(profileId, CATALOG[type][itemId].price);
  if (!result.ok) return result;
  getDb().prepare('INSERT INTO cosmetic_purchases (profile_id, item_id, purchased_at) VALUES (?,?,?)')
    .run(profileId, itemId, Date.now());
  return { ok: true, balance: result.balance };
}

// Equip helpers — ownership-checked wrappers around profiles.setIcon/
// setNameplateSkin, called from index.js's equip_icon/equip_nameplate
// handlers. `name` is needed because profiles.js's setters are keyed by
// name (see that file's own comment on why); `profileId` is what ownership
// is keyed by everywhere else in this file.
function setEquippedIcon(profileId, name, iconId) {
  if (!_isOwned(profileId, 'icon', iconId)) return { ok: false, error: 'Not owned' };
  setIcon(name, iconId);
  return { ok: true };
}

function setEquippedNameplate(profileId, name, skinId) {
  if (!_isOwned(profileId, 'nameplate', skinId)) return { ok: false, error: 'Not owned' };
  setNameplateSkin(name, skinId);
  return { ok: true };
}

function setEquippedCallStyle(profileId, name, styleId) {
  if (!_isOwned(profileId, 'callstyle', styleId)) return { ok: false, error: 'Not owned' };
  setCallStyle(name, styleId);
  return { ok: true };
}

// Profile deleted (see 'delete_profile' in index.js) — drop its purchase
// history, same purge() convention as economy.js/friends.js.
function purge(profileId) {
  getDb().prepare('DELETE FROM cosmetic_purchases WHERE profile_id = ?').run(profileId);
}

module.exports = { CATALOG, getOwned, purchase, setEquippedIcon, setEquippedNameplate, setEquippedCallStyle, purge };
