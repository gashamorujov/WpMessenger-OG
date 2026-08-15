/**
 * Auth sessions — persistent token store (SQLite).
 *
 * Login issues a random 256-bit token; the raw token is the session id and
 * is never stored in plain text in a way that leaks through logs. Tokens
 * live in the DB so sessions survive server restarts.
 */
const crypto = require('crypto');
const { getDb } = require('./index');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function create(userAgent, ip) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  getDb()
    .prepare('INSERT INTO sessions (token, createdAt, lastSeenAt, userAgent, ip) VALUES (?, ?, ?, ?, ?)')
    .run(token, now, now, String(userAgent || '').slice(0, 300), String(ip || '').slice(0, 64));
  return token;
}

function touch(token) {
  const row = getDb().prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  const lastSeen = new Date(row.lastSeenAt).getTime();
  if (Date.now() - lastSeen > SESSION_TTL_MS) {
    destroy(token);
    return null;
  }
  getDb().prepare('UPDATE sessions SET lastSeenAt = ? WHERE token = ?').run(new Date().toISOString(), token);
  return row;
}

function isValid(token) {
  return !!touch(token);
}

function destroy(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function destroyAll() {
  getDb().prepare('DELETE FROM sessions').run();
}

function count() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
}

function _reset() {
  getDb().prepare('DELETE FROM sessions').run();
}

module.exports = { create, touch, isValid, destroy, destroyAll, count, _reset, SESSION_TTL_MS };
