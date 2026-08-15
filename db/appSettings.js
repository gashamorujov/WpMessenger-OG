/**
 * App settings — editable key/value store (SQLite).
 *
 * Values override the defaults from settings.js / environment variables and
 * can be changed from the Settings page without restarting.
 */
const { getDb } = require('./index');

const KEYS = [
  'broadcastDelayMinMs',
  'broadcastDelayMaxMs',
  'broadcastMaxRetries',
  'duplicateSendTtlMin',
  'waPresenceCheck',
  'waSkipUnregistered',
  'maxRecipients',
  'maxMessageLength',
];

function get(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function set(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function getAll() {
  const out = {};
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  for (const row of rows) {
    try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
  }
  return out;
}

function hasAny() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM settings').get().n > 0;
}

function _reset() {
  getDb().prepare('DELETE FROM settings').run();
}

module.exports = { get, set, getAll, hasAny, KEYS, _reset };
