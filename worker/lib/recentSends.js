/**
 * RecentSends — cross-job duplicate-send guard (keyed by payload).
 *
 * Records { phone → { ts, key } } for every bulk message sent. Stored in
 * Firebase RTDB (wpm/wa/recentSends) with an in-memory cache and debounced
 * writes, so a phone is only blocked when the SAME payload (message text /
 * media identity) was sent within the TTL. No local files are used.
 *
 * TTL: DUPLICATE_SEND_TTL_MIN (default 10 min; 0 disables the guard).
 */
const fb = require('../../lib/firebase');
const { makeLogger } = require('./logger');
const { normalizePhone } = require('./phone');

const LOG = makeLogger('RECENT-SENDS');
const PATH = 'wpm/wa/recentSends';

const appSettings = require('./appSettings');

function ttlMs() {
  const v = appSettings.get('duplicateSendTtlMin');
  const min = v !== undefined ? parseInt(v, 10) : parseInt(process.env.DUPLICATE_SEND_TTL_MIN, 10) || 10;
  return min * 60 * 1000;
}

let sends = {};
let loaded = false;
let saveTimer = null;

async function init() {
  if (loaded) return;
  loaded = true;
  try {
    sends = (await fb.get(PATH)) || {};
  } catch (e) {
    LOG.error('Load recent-sends failed:', e.message);
    sends = {};
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fb.set(PATH, sends).catch((e) => LOG.error('Save recent-sends failed:', e.message));
  }, 1500);
}

async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await fb.set(PATH, sends).catch((e) => LOG.error('Save recent-sends failed:', e.message));
}

function markSent(phone, payloadKey = '') {
  const ttl = ttlMs();
  if (ttl <= 0) return;
  const p = normalizePhone(phone);
  if (!p) return;
  sends[p] = { ts: Date.now(), key: String(payloadKey || '') };
  scheduleSave();
}

function isDuplicate(phone, payloadKey = '') {
  const ttl = ttlMs();
  if (ttl <= 0) return false;
  const p = normalizePhone(phone);
  if (!p) return false;
  const rec = sends[p];
  if (!rec) return false;
  if (Date.now() - rec.ts >= ttl) return false;
  return !payloadKey || rec.key === String(payloadKey);
}

function isRecent(phone) {
  const ttl = ttlMs();
  if (ttl <= 0) return false;
  const p = normalizePhone(phone);
  if (!p) return false;
  const rec = sends[p];
  if (!rec) return false;
  return Date.now() - rec.ts < ttl;
}

function recentPhones() {
  const ttl = ttlMs();
  if (ttl <= 0) return [];
  const now = Date.now();
  return Object.keys(sends).filter((p) => now - sends[p].ts < ttl);
}

async function _reset() {
  sends = {};
  loaded = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await fb.remove(PATH).catch(() => {});
}

module.exports = { init, flush, markSent, isDuplicate, isRecent, recentPhones, ttlMs, _reset };
