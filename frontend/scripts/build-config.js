#!/usr/bin/env node
/**
 * Standalone config generator for frontend-only deploys (Vercel/Netlify).
 * Same output as scripts/build-config.js but self-contained, because these
 * platforms only upload the frontend/ directory.
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

const payload = { apiUrl, wsUrl, frontendUrl, version: '7.1.0' };
const out = path.join(__dirname, '..', 'js', 'config.generated.js');
fs.writeFileSync(out, 'window.__WPM_CONFIG__ = ' + JSON.stringify(payload, null, 2) + ';\n');
console.log(`[build-config] ${out}`);
console.log(`[build-config] apiUrl=${apiUrl || '(same origin)'} wsUrl=${wsUrl || '(same origin)'}`);
