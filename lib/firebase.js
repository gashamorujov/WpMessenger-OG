/**
 * Firebase Realtime Database bridge (REST, zero extra dependencies).
 *
 * The web app and the worker publish realtime events under /wpm/events; the
 * SPA listens with the Firebase JS SDK (injected in app/layout.js). When
 * Firebase is disabled or unreachable, everything keeps working through the
 * worker WebSocket hub (fallback). Writes are fire-and-forget.
 */
const config = require('./config');

const EVENTS_PATH = 'wpm/events';

function dbUrl() {
  return String(config.firebase.databaseURL || '').replace(/\/+$/, '');
}

function endpoint(path) {
  const p = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${dbUrl()}/${p}.json`;
}

/** Publish one realtime event. Returns true on success, false otherwise. */
async function publish(type, data) {
  if (!config.firebase.enabled || !dbUrl()) return false;
  const payload = { type, data: data === undefined ? null : data, ts: Date.now() };
  try {
    const res = await fetch(endpoint(EVENTS_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { publish, endpoint, EVENTS_PATH, dbUrl };
