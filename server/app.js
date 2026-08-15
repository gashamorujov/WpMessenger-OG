/**
 * Express application factory — single source of truth for the HTTP layer.
 *
 * Used by index.js (production server) and the test suite, so tests always
 * exercise the exact production middleware chain: CORS, security headers,
 * dynamic frontend config, REST API, static SPA frontend.
 */
const path = require('path');
const express = require('express');
const settings = require('../settings');
const { router: apiRouter } = require('./routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', settings.trustProxy);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ─── Production CORS ───
  // Auth uses a Bearer token, so cross-origin frontends work out-of-the-box.
  // If CORS_ORIGIN is configured, only those origins are allowed (with
  // credentials). Otherwise any origin is allowed for the API.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (settings.corsOrigins.length > 0) {
        if (settings.corsOrigins.includes(origin)) {
          res.set('Access-Control-Allow-Origin', origin);
          res.set('Access-Control-Allow-Credentials', 'true');
        }
      } else {
        res.set('Access-Control-Allow-Origin', '*');
      }
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ─── Security headers ───
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // ─── Dynamic frontend config ───
  // Served by the backend (same-origin deploys) and also generated as a
  // static file by `npm run build` for Vercel/Netlify frontend-only deploys.
  app.get('/js/config.generated.js', (req, res) => {
    const payload = {
      apiUrl: settings.apiUrl,
      wsUrl: settings.wsUrl,
      frontendUrl: settings.frontendUrl,
      version: settings.version,
    };
    res.type('application/javascript');
    res.send(`window.__WPM_CONFIG__ = ${JSON.stringify(payload)};`);
  });

  app.use('/api', apiRouter);

  // Static frontend (SPA) — everything non-API falls back to index.html
  const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
  app.use(express.static(FRONTEND_DIR, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api\/|ws).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });

  return app;
}

module.exports = { createApp };
