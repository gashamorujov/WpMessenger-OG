/**
 * Central configuration — read from environment variables only.
 *
 * No hardcoded hosts, ports or URLs. Production databases/worker URLs are
 * derived from platform env vars (Railway/Render/Vercel/Fly) when not
 * explicitly set, so a plain `npm start` works everywhere.
 */
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
const toWs = (u) => (u ? u.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') : '');
const intEnv = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
};
const boolEnv = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v !== 'false' && v !== '0';
};

function platformBaseUrl() {
  const candidates = [
    process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
    process.env.RAILWAY_STATIC_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    process.env.FLY_APP_NAME && `https://${process.env.FLY_APP_NAME}.fly.dev`,
  ];
  return candidates.find(Boolean) || '';
}

const platformUrl = platformBaseUrl();

const config = {
  version: '8.0.0',

  // Next.js app (public URL of this deployment)
  nextUrl: clean(process.env.NEXT_PUBLIC_APP_URL) || clean(process.env.APP_URL) || platformUrl,

  // Persistent WhatsApp worker
  workerApiUrl: clean(process.env.WORKER_API_URL) || '',
  workerWsUrl: clean(process.env.WORKER_WS_URL) || toWs(clean(process.env.WORKER_API_URL)),
  workerApiToken: process.env.WORKER_API_TOKEN || '',
  workerTimeoutMs: intEnv('WORKER_TIMEOUT_MS', 10000),

  // Panel login — default credentials work out of the box; change them from
  // the admin panel (Settings → Security) or via ADMIN_USERNAME/ADMIN_PASSWORD.
  adminUsername: process.env.ADMIN_USERNAME || 'gasham',
  adminPassword: process.env.ADMIN_PASSWORD || 'gasham1006',

  // Database (SQLite local, PostgreSQL production)
  databaseUrl: process.env.DATABASE_URL || './data/app.db',
  isPostgres: /^postgres(?:ql)?:\/\//i.test(String(process.env.DATABASE_URL || '')),
  dataDir: process.env.DATA_DIR || './data',

  // HTTP
  port: intEnv('PORT', 3000),
  cookieName: 'wpm_session',
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,

  // Firebase Realtime Database — realtime event mirror (REST from servers,
  // Firebase JS SDK in the browser). Defaults to the project config; disable
  // with FIREBASE_ENABLED=false to fall back to the worker WebSocket hub.
  firebase: {
    enabled: boolEnv('FIREBASE_ENABLED', true) && !!String(process.env.FIREBASE_DATABASE_URL || 'https://chatog-94528-default-rtdb.firebaseio.com').trim(),
    apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyDnbN3yJfuHejYqTv5HsisJMec0QjpaJzg',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'chatog-94528.firebaseapp.com',
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://chatog-94528-default-rtdb.firebaseio.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'chatog-94528',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'chatog-94528.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '877401186095',
    appId: process.env.FIREBASE_APP_ID || '1:877401186095:web:04d181fbbf2aaebb64cbda',
  },

  // Rate limiting (in-memory, per function instance)
  rateLimitWindowMs: intEnv('RATE_LIMIT_WINDOW_MS', 60000),
  rateLimitMax: intEnv('RATE_LIMIT_MAX', 240),
  loginRateLimitMax: intEnv('LOGIN_RATE_LIMIT_MAX', 10),

  // Safety limits
  maxRecipients: intEnv('MAX_RECIPIENTS', 10000),
  maxMessageLength: intEnv('MAX_MESSAGE_LENGTH', 100000),
  maxUploadBytes: intEnv('MAX_UPLOAD_BYTES', 60 * 1024 * 1024),

  // Broadcast pacing defaults (overridable from the Settings page)
  broadcastDelayMinMs: intEnv('BROADCAST_DELAY_MIN_MS', 3000),
  broadcastDelayMaxMs: intEnv('BROADCAST_DELAY_MAX_MS', 7000),
  broadcastMaxRetries: intEnv('BROADCAST_MAX_RETRIES', 2),
  duplicateSendTtlMin: intEnv('DUPLICATE_SEND_TTL_MIN', 10),
  waPresenceCheck: boolEnv('WA_PRESENCE_CHECK', true),
  waSkipUnregistered: boolEnv('WA_SKIP_UNREGISTERED', true),
};


module.exports = config;
