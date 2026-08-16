/**
 * Worker configuration — environment variables only, nothing hard-coded.
 *
 * The worker is the persistent WhatsApp backend. All shared data (jobs,
 * settings, contacts, WhatsApp auth state) lives in Firebase Realtime
 * Database — no local database, no ./data folder, no PostgreSQL.
 */
const path = require('path');
const os = require('os');

const intEnv = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
};
const boolEnv = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v !== 'false' && v !== '0';
};

const ROOT = path.join(__dirname, '..', '..');

const config = {
  root: ROOT,
  version: '8.0.0',

  // HTTP + WebSocket
  port: intEnv('PORT', 3100),
  trustProxy: process.env.TRUST_PROXY ? boolEnv('TRUST_PROXY', false) : true,

  // Shared secret between web app and worker (required for API access)
  workerApiToken: process.env.WORKER_API_TOKEN || '',

  // Ephemeral runtime dirs (OS temp — nothing persistent is required)
  tmpDir: process.env.TMP_DIR ? path.resolve(process.env.TMP_DIR) : path.join(os.tmpdir(), 'wpm-tmp'),
  uploadsDir: process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(os.tmpdir(), 'wpm-uploads'),

  // WhatsApp
  waPresenceCheck: boolEnv('WA_PRESENCE_CHECK', true),
  waSkipUnregistered: boolEnv('WA_SKIP_UNREGISTERED', true),

  // Broadcast pacing (per-target random delay between sends)
  broadcastDelayMinMs: intEnv('BROADCAST_DELAY_MIN_MS', 3000),
  broadcastDelayMaxMs: intEnv('BROADCAST_DELAY_MAX_MS', 7000),
  broadcastMaxRetries: intEnv('BROADCAST_MAX_RETRIES', 2),

  // Cross-job duplicate-send guard TTL (minutes; 0 disables)
  duplicateSendTtlMin: intEnv('DUPLICATE_SEND_TTL_MIN', 10),

  // Safety limits
  maxRecipients: intEnv('MAX_RECIPIENTS', 10000),
  maxMessageLength: intEnv('MAX_MESSAGE_LENGTH', 100000),
  maxUploadBytes: intEnv('MAX_UPLOAD_BYTES', 64 * 1024 * 1024),

  // Uploads kept for 30 minutes before cleanup
  uploadTtlMs: intEnv('UPLOAD_TTL_MS', 30 * 60 * 1000),

  // Realtime ticket TTL (seconds)
  wsTicketTtlSec: intEnv('WS_TICKET_TTL_SEC', 120),

  // Firebase Realtime Database — shared store + realtime event feed.
  firebase: {
    enabled: boolEnv('FIREBASE_ENABLED', true) && !!String(process.env.FIREBASE_DATABASE_URL || 'https://chatog-94528-default-rtdb.firebaseio.com').trim(),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://chatog-94528-default-rtdb.firebaseio.com',
  },
};

module.exports = config;
