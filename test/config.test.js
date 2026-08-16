const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function loadConfig(env) {
  const cfgPath = path.join(__dirname, '..', 'lib', 'config.js');
  const previous = { ...process.env };
  Object.keys(previous).forEach((k) => { if (k.startsWith('RAILWAY_') || k.startsWith('RENDER_') || k.startsWith('VERCEL_') || k.startsWith('FLY_') || k.startsWith('WORKER_') || k.startsWith('DATABASE_') || k.startsWith('NEXT_PUBLIC_APP_URL') || k.startsWith('ADMIN_')) delete process.env[k]; });
  Object.assign(process.env, env);
  delete require.cache[require.resolve(cfgPath)];
  const cfg = require(cfgPath);
  // restore
  process.env = previous;
  return cfg;
}

test('config derives worker WS URL from WORKER_API_URL', () => {
  const cfg = loadConfig({ WORKER_API_URL: 'https://worker.example.com' });
  assert.equal(cfg.workerWsUrl, 'wss://worker.example.com');
});

test('config defaults to the Firebase project (chatog-94528)', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.firebase.enabled, true);
  assert.equal(cfg.firebase.databaseURL, 'https://chatog-94528-default-rtdb.firebaseio.com');
  assert.equal(cfg.firebase.projectId, 'chatog-94528');
  assert.ok(!('databaseUrl' in cfg));
  assert.ok(!('isPostgres' in cfg));
});

test('config has no hardcoded localhost defaults for worker URLs', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.workerApiUrl, '');
  assert.equal(cfg.workerWsUrl, '');
  assert.ok(!JSON.stringify(cfg).includes('localhost'));
});

test('config derives next URL from platform env', () => {
  const cfg = loadConfig({ RENDER_EXTERNAL_URL: 'https://panel.onrender.com' });
  assert.equal(cfg.nextUrl, 'https://panel.onrender.com');
});
