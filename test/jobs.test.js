const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-jobs-'));
process.env.DATA_DIR = tmp;
process.env.DATABASE_URL = path.join(tmp, 'app.db');

const { migrate, close } = require('../db');
const jobStore = require('../db/jobs');

test('jobs: create → updateTarget → completed', () => {
  migrate();
  const job = jobStore.create({
    type: 'text',
    payloadSpec: { type: 'text', text: 'Salam' },
    targets: [{ phone: '994501234567', name: 'A' }, { phone: '994551234567', name: 'B' }],
  });
  assert.equal(job.state, 'running');
  assert.equal(job.targets.length, 2);

  jobStore.updateTarget(job, '994501234567', { status: 'sent', error: null });
  assert.equal(job.successCount, 1);
  jobStore.updateTarget(job, '994551234567', { status: 'failed', error: 'Xəta' });
  assert.equal(job.failCount, 1);

  const report = { success: 1, fail: 1, skip: 0 };
  jobStore.markCompleted(job, report);
  const done = jobStore.read(job.id);
  assert.equal(done.state, 'completed');
  assert.equal(done.successCount, 1);
  assert.equal(done.finishedAt !== null, true);
});

test('jobs: interrupted → recover → listActive', () => {
  const j1 = jobStore.create({ type: 'text', payloadSpec: { type: 'text', text: 'x' }, targets: [{ phone: '994701234567' }] });
  const j2 = jobStore.create({ type: 'text', payloadSpec: { type: 'text', text: 'y' }, targets: [{ phone: '994771234567' }] });
  jobStore.markInterrupted(j1);
  jobStore.markCancelled(j2);

  assert.equal(jobStore.listActive().length, 1);
  const recovered = jobStore.recoverInterrupted();
  assert.equal(recovered.length, 0); // j1 already interrupted, j2 cancelled

  const running = jobStore.create({ type: 'text', payloadSpec: { type: 'text', text: 'z' }, targets: [{ phone: '994781234567' }] });
  assert.equal(jobStore.recoverInterrupted().length, 1);
  assert.equal(jobStore.read(running.id).state, 'interrupted');

  jobStore.deleteJob(j1.id);
  assert.equal(jobStore.read(j1.id), null);
});

test('jobs: pagination + history filter', () => {
  for (let i = 0; i < 25; i++) {
    jobStore.create({ type: 'text', payloadSpec: { type: 'text', text: 'm' + i }, targets: [{ phone: '9945012345' + String(i).padStart(2, '0') }] });
  }
  const page = jobStore.list({ page: 2, pageSize: 10 });
  assert.equal(page.items.length, 10);
  assert.ok(page.pages >= 3);
});

test.after(() => { close(); });
