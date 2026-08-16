/**
 * Worker → Firebase Realtime Database mirror.
 *
 * Every WebSocket hub broadcast is also pushed to /wpm/events so browsers
 * receive realtime updates through Firebase (the SPA listens with the
 * Firebase JS SDK). The event list is pruned so it never grows unbounded.
 * Falls back silently when Firebase is disabled/unreachable.
 */
const config = require('./config');
const { makeLogger } = require('./logger');

const LOG = makeLogger('FIREBASE');
const EVENTS_PATH = 'wpm/events';
const MAX_EVENTS = 150;
const PRUNE_BATCH = 40;
let lastPruneAt = 0;

function dbUrl() {
  return String(config.firebase.databaseURL || '').replace(/\/+$/, '');
}

function endpoint(path, query = '') {
  const p = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${dbUrl()}/${p}.json${query}`;
}

async function publish(type, data) {
  if (!config.firebase.enabled || !dbUrl()) return false;
  try {
    const res = await fetch(endpoint(EVENTS_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data: data === undefined ? null : data, ts: Date.now() }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.ok) maybePrune();
    return res.ok;
  } catch (e) {
    LOG.warn('firebase publish failed:', e.message);
    return false;
  }
}

/** At most once per minute: if too many events, delete the oldest batch. */
async function maybePrune() {
  if (Date.now() - lastPruneAt < 60000) return;
  lastPruneAt = Date.now();
  try {
    const res = await fetch(endpoint(EVENTS_PATH, '?orderBy=%22$key%22&limitToFirst=' + PRUNE_BATCH + '&shallow=true'), {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const keys = data && typeof data === 'object' ? Object.keys(data) : [];
    if (keys.length < MAX_EVENTS) return;
    const body = {};
    for (const k of keys) body[k] = null;
    await fetch(endpoint(EVENTS_PATH), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
  } catch {}
}

module.exports = { publish, maybePrune, endpoint, EVENTS_PATH, dbUrl };
