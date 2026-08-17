/**
 * WpMessenger OG — persistent WhatsApp worker.
 *
 * Boot sequence: shared DB migrations → HTTP API + WebSocket hub →
 * WhatsApp session auto-reconnect → interrupted-job recovery.
 *
 * This process MUST run on a long-lived host (Railway/VPS/Docker). The
 * Next.js web app (Vercel/Netlify) never opens WhatsApp connections; it
 * proxies commands here over HTTPS with a shared bearer token.
 */
const http = require('http');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const config = require('./lib/config');
const { makeLogger } = require('./lib/logger');
const appSettings = require('./lib/appSettings');
const recentSends = require('./lib/recentSends');
const auth = require('./auth');
const hub = require('./webSocketHub');
const wa = require('./whatsappManager');
const broadcastService = require('./broadcastService');
const { router: apiRouter } = require('./routes');

const LOG = makeLogger('WORKER');

// Ephemeral scratch dirs in the OS temp folder — nothing persistent required.
fs.ensureDirSync(config.tmpDir);
fs.ensureDirSync(config.uploadsDir);
process.env.TMPDIR = config.tmpDir;
process.env.TEMP = config.tmpDir;
process.env.TMP = config.tmpDir;

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Filename, X-Mimetype, X-Worker-Token');
      res.set('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api', apiRouter);

  app.get('/', (req, res) => {
    res.json({ service: 'wp-messenger-og-worker', version: config.version, status: 'ok' });
  });

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

async function boot() {
  // All data lives in Firebase Realtime Database — nothing to migrate.
  LOG.info(`Firebase RTDB: ${config.firebase.databaseURL}`);
  await wa.init().catch(() => {});
  await recentSends.init().catch(() => {});
  await appSettings.refresh().catch(() => {});
  if (!config.workerApiToken) {
    LOG.warn('WORKER_API_TOKEN təyin edilməyib — API sorğuları 503 qaytaracaq. WEB app-də eyni tokeni təyin edin.');
  } else {
    LOG.info('Worker API auth: bearer token ✓');
  }

  const app = createApp();
  const server = http.createServer(app);
  server.timeout = 120000;
  server.keepAliveTimeout = 65000;

  hub.attach(server);
  server.listen(config.port, '0.0.0.0', () => {
    LOG.info(`WpMessenger OG Worker v${config.version} → port ${config.port}`);
  });

  // Reconnect stored WhatsApp sessions, then recover interrupted jobs.
  setTimeout(async () => {
    try {
      await wa.autoReconnectAll();
    } catch (e) {
      LOG.error('Auto-reconnect:', e.message);
    }
    try {
      broadcastService.purgeOldJobs().catch(() => {});
      const resumed = await broadcastService.recoverAndResume();
      if (resumed > 0) LOG.info(`Resumed ${resumed} interrupted job(s)`);
    } catch (e) {
      LOG.error('Job recovery error:', e.message);
    }
  }, 3000);

  // Whenever any WhatsApp socket connects, resume interrupted jobs.
  wa.onConnected(() => {
    broadcastService.resumeInterruptedJobs().catch((e) => LOG.error('Job resume hook error:', e.message));
  });

  // Realtime event forwarding to the frontend.
  for (const evt of ['status', 'qr', 'pair', 'error', 'connected']) {
    wa.emitter.on(evt, (payload) => {
      hub.broadcast(`wa:${evt}`, payload);
      if (evt === 'status' || evt === 'connected') hub.broadcast('stats', {});
    });
  }

  wa.startConnectionWatchdog();

  // Keep settings overrides in sync with the web panel + clean uploads.
  setInterval(() => {
    appSettings.refresh().catch(() => {});
    try {
      const files = fs.readdirSync(UPLOADS_DIR());
      for (const f of files) {
        try {
          const fp = path.join(UPLOADS_DIR(), f);
          if (fs.statSync(fp).isFile() && Date.now() - fs.statSync(fp).mtimeMs > config.uploadTtlMs) fs.unlinkSync(fp);
        } catch {}
      }
    } catch {}
  }, 600000);

  LOG.info('WpMessenger OG Worker is running');
}

function UPLOADS_DIR() {
  return config.uploadsDir;
}

// ─── Graceful shutdown ───
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  LOG.info(`Received ${signal} — shutting down...`);
  try { await broadcastService.shutdown(); } catch {}
  try { wa.saveSessionsData(); } catch {}
  for (const [, sock] of Object.entries(wa.activeConnections || {})) {
    try { sock?.end(new Error('Shutdown')); } catch {}
  }
  try { hub.shutdown(); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => LOG.error('Uncaught:', err.message, err.stack));
process.on('unhandledRejection', (reason) => LOG.error('Unhandled:', reason?.message || reason));

boot();
