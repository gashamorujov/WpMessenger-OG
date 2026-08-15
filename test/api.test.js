const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-api-'));
process.env.DATA_DIR = tmp;
process.env.DATABASE_URL = path.join(tmp, 'app.db');
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-pass-1';

const { migrate, close } = require('../db');
const auth = require('../server/auth');
const { createApp } = require('../server/app');

let server;
let base;

function buildApp() {
  return createApp();
}

async function req(method, p, { body, token } = {}) {
  const headers = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(base + '/api' + p, { method, headers, body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

test.before(async () => {
  migrate();
  auth.createUserIfNeeded();
  const app = buildApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('API: unauthenticated requests rejected', async () => {
  const r = await req('GET', '/overview');
  assert.equal(r.status, 401);
});

test('API: login flow', async () => {
  const bad = await req('POST', '/auth/login', { body: { username: 'admin', password: 'yanlis' } });
  assert.equal(bad.status, 401);

  const ok = await req('POST', '/auth/login', { body: { username: 'admin', password: 'test-pass-1' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);

  const me = await req('GET', '/auth/me', { token: ok.data.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.loggedIn, true);
  global.__token = ok.data.token;
});

test('API: overview dashboard', async () => {
  const r = await req('GET', '/overview', { token: global.__token });
  assert.equal(r.status, 200);
  assert.ok(r.data.whatsapp);
  assert.equal(typeof r.data.contactsCount, 'number');
});

test('API: contacts CRUD + duplicate + validation', async () => {
  const t = global.__token;
  const c1 = await req('POST', '/contacts', { token: t, body: { name: 'Aytən Quliyeva', phone: '0503482680' } });
  assert.equal(c1.status, 201);
  assert.equal(c1.data.created, true);

  const c2 = await req('POST', '/contacts', { token: t, body: { name: 'Aytən Quliyeva', phone: '9940503482680' } });
  assert.equal(c2.status, 200);
  assert.equal(c2.data.duplicate, true);

  const bad = await req('POST', '/contacts', { token: t, body: { name: 'X', phone: 'not-a-phone' } });
  assert.equal(bad.status, 400);

  const list = await req('GET', '/contacts?q=quliyeva&page=1&pageSize=10', { token: t });
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);

  const all = await req('GET', '/contacts/all', { token: t });
  assert.equal(all.data.items.length >= 1, true);

  const del = await req('DELETE', `/contacts/${c1.data.contact.id}`, { token: t });
  assert.equal(del.status, 200);
});

test('API: message send → job → cancel → history', async () => {
  const t = global.__token;
  const send = await req('POST', '/messages/send', { token: t, body: { recipientsMode: 'single', phone: '0501234567', text: 'Salam, test mesajı' } });
  assert.equal(send.status, 201);
  const jobId = send.data.job.id;
  assert.ok(['running', 'interrupted'].includes(send.data.job.state), 'job should be running or interrupted');
  assert.equal(send.data.job.total, 1);

  const detail = await req('GET', `/jobs/${jobId}`, { token: t });
  assert.equal(detail.status, 200);

  const cancel = await req('POST', `/jobs/${jobId}/cancel`, { token: t });
  assert.equal(cancel.status, 200);

  const history = await req('GET', '/history', { token: t });
  assert.equal(history.status, 200);
  assert.ok(history.data.items.some((j) => j.id === jobId && j.state === 'cancelled'));
});

test('API: invalid message rejected', async () => {
  const r = await req('POST', '/messages/send', { token: global.__token, body: { recipientsMode: 'single', phone: '0501234567', text: '' } });
  assert.equal(r.status, 400);
});

test('API: settings read + update', async () => {
  const t = global.__token;
  const s = await req('GET', '/settings', { token: t });
  assert.equal(s.status, 200);
  assert.equal(s.data.effective.delayMinMs >= 0, true);

  const up = await req('PUT', '/settings', { token: t, body: { overrides: { broadcastDelayMinMs: 1500, waSkipUnregistered: false } } });
  assert.equal(up.status, 200);
  assert.equal(up.data.effective.delayMinMs, 1500);
  assert.equal(up.data.effective.waSkipUnregistered, false);

  const badUp = await req('PUT', '/settings', { token: t, body: { overrides: { broadcastDelayMinMs: 'abc' } } });
  assert.equal(badUp.status, 400);
});

test('API: CORS preflight + dynamic frontend config', async () => {
  const pre = await fetch(base + '/api/health', { method: 'OPTIONS', headers: { Origin: 'https://frontend.example.com', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');

  const cfg = await fetch(base + '/js/config.generated.js');
  assert.equal(cfg.status, 200);
  const body = await cfg.text();
  assert.ok(body.includes('window.__WPM_CONFIG__'));
  assert.ok(body.includes('"apiUrl"'));
});

test('API: login rate limiting', async () => {
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await req('POST', '/auth/login', { body: { username: 'admin', password: 'yanlis' } });
    if (r.status === 429) { got429 = true; break; }
  }
  assert.equal(got429, true);
});

test.after(async () => {
  try { server.close(); } catch {}
  close();
});
