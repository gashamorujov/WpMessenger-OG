const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'frontend', 'js', 'config.generated.js');

function runBuild(env) {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-config.js')], { env: { ...process.env, ...env }, stdio: 'pipe' });
  return fs.readFileSync(OUT, 'utf-8');
}

test('build-config: explicit API_URL + WS_URL', () => {
  const body = runBuild({ API_URL: 'https://wpm.up.railway.app', WS_URL: 'wss://wpm.up.railway.app' });
  assert.ok(body.includes('https://wpm.up.railway.app'));
  assert.ok(body.includes('wss://wpm.up.railway.app'));
});

test('build-config: WS_URL derived from API_URL', () => {
  const body = runBuild({ API_URL: 'https://api.example.com', WS_URL: '' });
  assert.ok(body.includes('"wsUrl": "wss://api.example.com"'));
});

test('build-config: no API_URL → same origin', () => {
  const body = runBuild({ API_URL: '', WS_URL: '' });
  assert.ok(body.includes('"apiUrl": ""'));
  assert.ok(body.includes('"wsUrl": ""'));
});

test.after(() => {
  try { fs.unlinkSync(OUT); } catch {}
});
