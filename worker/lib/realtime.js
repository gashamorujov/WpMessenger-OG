/**
 * Worker → Firebase Realtime Database mirror.
 *
 * Every WebSocket hub broadcast is also pushed to /wpm/events so browsers
 * receive realtime updates through Firebase (the SPA listens with the
 * Firebase JS SDK). The event list is pruned (REST transport only) so it
 * never grows unbounded. Falls back silently when Firebase is disabled.
 */
const fb = require('../../lib/firebase');
const { makeLogger } = require('./logger');

const LOG = makeLogger('FIREBASE');
const EVENTS_PATH = fb.EVENTS_PATH;
const MAX_EVENTS = 150;
const PRUNE_BATCH = 40;
let lastPruneAt = 0;

async function publish(type, data) {
  try {
    const ok = await fb.publish(type, data);
    if (ok) maybePrune();
    return ok;
  } catch (e) {
    LOG.warn('firebase publish failed:', e.message);
    return false;
  }
}

/** At most once per minute (REST transport): delete the oldest events. */
async function maybePrune() {
  if (fb.transportKind() !== 'rest') return;
  if (Date.now() - lastPruneAt < 60000) return;
  lastPruneAt = Date.now();
  try {
    const res = await fetch(fb.endpoint(EVENTS_PATH, '?orderBy=%22$key%22&limitToFirst=' + PRUNE_BATCH + '&shallow=true'), {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const keys = data && typeof data === 'object' ? Object.keys(data) : [];
    if (keys.length < MAX_EVENTS) return;
    const body = {};
    for (const k of keys) body[k] = null;
    await fetch(fb.endpoint(EVENTS_PATH), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
  } catch {}
}

module.exports = { publish, maybePrune };
