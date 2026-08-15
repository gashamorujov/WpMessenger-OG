/**
 * WpMessenger OG — WhatsApp Web Management Panel.
 *
 * Boot sequence: DB migrations → admin user → HTTP API + static frontend →
 * WebSocket hub → WhatsApp session auto-reconnect → job recovery.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const fs = require('fs-extra');
const { migrate, close } = require('./db');
const settings = require('./settings');
const auth = require('./server/auth');
const hub = require('./server/webSocketHub');
const wa = require('./server/whatsappManager');
const broadcastService = require('./server/broadcastService');
const { router: apiRouter } = require('./server/routes');
const { makeLogger } = require('./lib/logger');

const LOG = makeLogger('SERVER');

const TEMP_DIR = path.join(settings.dataDir, 'temp');
fs.ensureDirSync(TEMP_DIR);
process.env.TMPDIR = TEMP_DIR;
process.env.TEMP = TEMP_DIR;
process.env.TMP = TEMP_DIR;

// ─── Express app ───
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api', apiRouter);

// Static frontend (SPA) — everything non-API falls back to index.html
const FRONTEND_DIR = path.join(__dirname, 'frontend');
app.use(express.static(FRONTEND_DIR, { maxAge: '1h', index: false }));
app.get(/^\/(?!api\/|ws).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ─── HTTP server + WebSocket ───
const server = http.createServer(app);
server.timeout = 120000;
server.keepAliveTimeout = 65000;

async function boot() {
  try {
    migrate();
    const creds = auth.createUserIfNeeded();
    if (creds?.generated) {
      LOG.info('────────────────────────────────────────────');
      LOG.info('WEB PANEL LOGIN');
      LOG.info(`  URL:    http://localhost:${settings.port}`);
      LOG.info(`  User:   ${creds.username}`);
      LOG.info(`  Pass:   ${creds.password}`);
      LOG.info('  ⚠ Change it in Settings after login (or set ADMIN_PASSWORD env).');
      LOG.info('────────────────────────────────────────────');
    }

    hub.attach(server);
    server.listen(settings.port, '0.0.0.0', () => {
      LOG.info(`WpMessenger OG v${settings.version} → http://0.0.0.0:${settings.port}`);
    });

    // Reconnect stored WhatsApp sessions, then recover interrupted jobs.
    setTimeout(async () => {
      try {
        await wa.autoReconnectAll();
      } catch (e) {
        LOG.error('Auto-reconnect:', e.message);
      }
      try {
        broadcastService.purgeOldJobs();
        const resumed = broadcastService.recoverAndResume();
        if (resumed > 0) LOG.info(`Resumed ${resumed} interrupted job(s)`);
      } catch (e) {
        LOG.error('Job recovery error:', e.message);
      }
    }, 3000);

    // Whenever any WhatsApp socket connects, resume interrupted jobs.
    wa.onConnected(() => {
      try {
        broadcastService.resumeInterruptedJobs();
      } catch (e) {
        LOG.error('Job resume hook error:', e.message);
      }
    });

    // Realtime event forwarding to the frontend.
    for (const evt of ['status', 'qr', 'pair', 'error', 'connected']) {
      wa.emitter.on(evt, (payload) => {
        hub.broadcast(`wa:${evt}`, payload);
        if (evt === 'status' || evt === 'connected') hub.broadcast('stats', {});
      });
    }

    wa.startConnectionWatchdog();

    // Temp upload cleanup every 10 minutes (orphaned uploads).
    setInterval(() => {
      try {
        const files = fs.readdirSync(TEMP_DIR);
        for (const f of files) {
          try {
            const fp = path.join(TEMP_DIR, f);
            if (fs.statSync(fp).isFile() && Date.now() - fs.statSync(fp).mtimeMs > 30 * 60 * 1000) fs.unlinkSync(fp);
          } catch {}
        }
      } catch {}
    }, 600000);

    LOG.info('WpMessenger OG is running — WhatsApp Web Management Panel');
  } catch (err) {
    LOG.error('Startup error:', err.message, err.stack);
    process.exit(1);
  }
}

// ─── Graceful shutdown ───
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  LOG.info(`Received ${signal} — shutting down...`);
  try { broadcastService.shutdown(); } catch {}
  try { wa.saveSessionsData(); } catch {}
  for (const [, sock] of Object.entries(wa.activeConnections || {})) {
    try { sock?.end(new Error('Shutdown')); } catch {}
  }
  try { hub.shutdown(); } catch {}
  try { server.close(); } catch {}
  try { close(); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => LOG.error('Uncaught:', err.message, err.stack));
process.on('unhandledRejection', (reason) => LOG.error('Unhandled:', reason?.message || reason));

boot();
