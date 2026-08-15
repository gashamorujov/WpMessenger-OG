/**
 * Central configuration — WpMessenger OG.
 *
 * All secrets are read from environment variables only; nothing is
 * hard-coded. If ADMIN_PASSWORD is not provided, a random password is
 * generated on first boot and printed to the logs once.
 */
const path = require('path');

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v !== 'false' && v !== '0';
}

const ROOT = __dirname;

// ─── Platform URL auto-detection ───
// When API_URL/WS_URL/FRONTEND_URL are not set, derive them from common
// PaaS environment variables so the panel works after deploy with zero
// configuration (Railway, Render, Vercel, Heroku-style PORT, etc.).
function platformBaseUrl() {
  const candidates = [
    process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
    process.env.RAILWAY_STATIC_URL && process.env.RAILWAY_STATIC_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    process.env.FLY_APP_NAME && `https://${process.env.FLY_APP_NAME}.fly.dev`,
  ];
  return candidates.find(Boolean) || '';
}

function toWs(url) {
  if (!url) return '';
  return url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

function cleanUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

const platformUrl = platformBaseUrl();
const frontendUrl = cleanUrl(process.env.FRONTEND_URL) || platformUrl;
const apiUrl = cleanUrl(process.env.API_URL) || (process.env.BACKEND_URL ? cleanUrl(process.env.BACKEND_URL) : frontendUrl);
const wsUrl = cleanUrl(process.env.WS_URL) || toWs(apiUrl);

function parseOrigins(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const settings = {
  root: ROOT,

  // Web panel authentication
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // Persistence
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data'),
  sessionDir: process.env.SESSION_PATH ? path.resolve(process.env.SESSION_PATH) : path.join(ROOT, 'sessions'),
  dbFile: process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('file:')
    ? process.env.DATABASE_URL.slice(5)
    : process.env.DATABASE_URL || path.join(ROOT, 'data', 'app.db'),

  // HTTP / WebSocket / CORS
  port: intEnv('PORT', 3000),
  frontendUrl,
  apiUrl,
  wsUrl,
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN),
  trustProxy: process.env.TRUST_PROXY ? boolEnv('TRUST_PROXY', false) : true,

  // WhatsApp registration pre-check (sock.onWhatsApp USync query)
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

  // Rate limiting (per IP, fixed window)
  rateLimitWindowMs: intEnv('RATE_LIMIT_WINDOW_MS', 60000),
  rateLimitMax: intEnv('RATE_LIMIT_MAX', 240),

  // Session cookie name
  cookieName: 'wpm_session',
};

settings.version = '7.1.0';
settings.repo = 'WpMessenger-OG/WpMessenger-OG';

module.exports = settings;
