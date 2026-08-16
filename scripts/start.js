#!/usr/bin/env node
/**
 * Production start — `npm start`.
 *
 * When the build produced a standalone output (output: 'standalone'), the
 * static assets are copied into .next/standalone and the standalone server
 * is started (port: PORT || 3000, host: 0.0.0.0). Otherwise falls back to
 * `next start`. No hardcoded hosts or ports anywhere.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');
const STANDALONE_SERVER = path.join(STANDALONE, 'server.js');
const STATIC_SRC = path.join(ROOT, '.next', 'static');
const PUBLIC_SRC = path.join(ROOT, 'public');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function runStandalone() {
  copyDir(STATIC_SRC, path.join(STANDALONE, '.next', 'static'));
  copyDir(PUBLIC_SRC, path.join(STANDALONE, 'public'));
  const env = { ...process.env };
  if (!env.HOSTNAME) env.HOSTNAME = '0.0.0.0';
  const child = spawn(process.execPath, ['server.js'], { cwd: STANDALONE, stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code === null ? 1 : code));
}

function runNextStart() {
  const child = spawn('npx', ['next', 'start'], { cwd: ROOT, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code === null ? 1 : code));
}

if (fs.existsSync(STANDALONE_SERVER) && fs.existsSync(STATIC_SRC)) {
  runStandalone();
} else {
  runNextStart();
}
