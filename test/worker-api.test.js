const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-worker-test-'));
const PORT = 3900 + Math.floor(Math.random() * 500);
const TOKEN = 'test-token-123';
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('worker did not become healthy');
}

test.before(async () => {
  child = spawn(process.execPath, ['worker/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      WORKER_API_TOKEN: TOKEN,
      DATABASE_URL: path.join(tmp, 'app.db'),
      DATA_DIR: tmp,
      SESSION_PATH: path.join(tmp, 'sessions'),
      BROADCAST_DELAY_MIN_MS: '0',
      BROADCAST_DELAY_MAX_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  await waitForHealth();
});

test.after(() => {
  if (child) child.kill('SIGTERM');
});

test('health endpoint is open', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.version, '8.0.0');
});

test('worker API requires the shared bearer token', async () => {
  const noAuth = await fetch(`${BASE}/api/status`);
  assert.equal(noAuth.status, 401);
  const bad = await fetch(`${BASE}/api/status`, { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${BASE}/api/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(Array.isArray(body.sessions));
});

test('upload stores a file and returns fileId', async () => {
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent('test.pdf'), 'X-Mimetype': encodeURIComponent('application/pdf') },
    body: Buffer.from('hello-upload'),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.fileId);
  assert.equal(body.size, 12);
  assert.ok(fs.existsSync(path.join(tmp, 'uploads', body.fileId)));
});

test('job created in the shared DB is executed by the worker', async () => {
  // Create a job in the shared database from the test process...
  process.env.DATABASE_URL = path.join(tmp, 'app.db');
  process.env.DATA_DIR = tmp;
  const { jobsRepo } = require('../lib/repositories');
  const job = await jobsRepo.create({
    type: 'text',
    payloadSpec: { type: 'text', text: 'Salam' },
    targets: [{ phone: '994501234567', name: 'Əli' }],
  });

  const res = await fetch(`${BASE}/api/jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id }),
  });
  assert.equal(res.status, 202);

  // WhatsApp is not connected → the worker marks the job interrupted.
  let final = null;
  for (let i = 0; i < 30; i++) {
    final = await jobsRepo.read(job.id);
    if (final.state !== 'running') break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(final.state, 'interrupted');
});

test('ws-ticket issues a short-lived ticket', async () => {
  const res = await fetch(`${BASE}/api/ws-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ticket && body.ticket.length >= 32);
  assert.ok(body.ttl > 0);
});
