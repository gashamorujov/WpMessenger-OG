#!/usr/bin/env node
/**
 * Generates frontend/js/config.generated.js from environment variables.
 *
 * Used by `npm run build` (repo root) and by Vercel/Netlify when deploying
 * only the frontend/ directory. The backend also serves the same file
 * dynamically at /js/config.generated.js, so same-origin deploys need no
 * build step at all.
 *
 * Env vars:
 *   FRONTEND_URL  — public URL of the frontend (optional)
 *   API_URL       — backend API origin, e.g. https://wpm.up.railway.app (optional)
 *   BACKEND_URL   — alias of API_URL (optional)
 *   WS_URL        — WebSocket base, e.g. wss://wpm.up.railway.app (optional; derived from API_URL)
 */
const fs = require('fs');
const path = require('path');

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
const toWs = (u) => (u ? u.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') : '');

function platformUrl() {
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

const frontendUrl = clean(process.env.FRONTEND_URL) || platformUrl();
const apiUrl = clean(process.env.API_URL) || (process.env.BACKEND_URL ? clean(process.env.BACKEND_URL) : frontendUrl);
const wsUrl = clean(process.env.WS_URL) || toWs(apiUrl);

let version = '7.1.0';
try { version = require('../package.json').version; } catch {}

const payload = { apiUrl, wsUrl, frontendUrl, version };
const out = path.join(__dirname, '..', 'frontend', 'js', 'config.generated.js');
fs.writeFileSync(out, 'window.__WPM_CONFIG__ = ' + JSON.stringify(payload, null, 2) + ';\n');
console.log(`[build-config] ${out}`);
console.log(`[build-config] apiUrl=${apiUrl || '(same origin)'} wsUrl=${wsUrl || '(same origin)'} frontendUrl=${frontendUrl || '(same origin)'}`);
