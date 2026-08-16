const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the shared config at a throwaway SQLite DB before loading modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-storage-'));
process.env.DATABASE_URL = path.join(tmp, 'app.db');
process.env.DATA_DIR = tmp;

const { storage } = require('../lib/storage');
const { contactsRepo, jobsRepo, sessionsRepo, usersRepo, settingsRepo } = require('../lib/repositories');

test('storage initialises SQLite with the full schema', async () => {
  const db = await storage();
  assert.equal(db.dialect, 'sqlite');
  for (const table of ['users', 'sessions', 'contacts', 'jobs', 'settings']) {
    const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
    assert.ok(row, `table ${table} missing`);
  }
});

test('contacts CRUD + normalization dedupe', async () => {
  const a = await contactsRepo.upsert({ name: 'Əli Məmmədov', phone: '0501234567' });
  assert.equal(a.created, true);
  assert.equal(a.contact.normalizedPhone, '994501234567');

  const b = await contactsRepo.upsert({ name: 'Əli Məmmədov', phone: '+994501234567' });
  assert.equal(b.created, false);
  assert.equal(b.duplicate, true);

  const c = await contactsRepo.upsert({ name: 'Əli M.', phone: '0501234567' });
  assert.equal(c.updated, true);

  assert.equal(await contactsRepo.count(), 1);
  const list = await contactsRepo.list({});
  assert.equal(list.items.length, 1);

  await contactsRepo.setWaStatus('994501234567', 'yes');
  const row = await contactsRepo.getByPhone('0501234567');
  assert.equal(row.whatsappStatus, 'yes');

  assert.equal(await contactsRepo.remove(row.id), true);
  assert.equal(await contactsRepo.count(), 0);
});

test('jobs lifecycle: create → interrupted → recover → cancelled', async () => {
  const job = await jobsRepo.create({
    type: 'text',
    payloadSpec: { type: 'text', text: 'Salam' },
    targets: [{ phone: '994501234567', name: 'Əli' }, { phone: '994551234567' }],
  });
  assert.equal(job.state, 'running');
  assert.equal(job.targets.length, 2);

  await jobsRepo.updateTarget(job, '994501234567', { status: 'sent' });
  const mid = await jobsRepo.read(job.id);
  assert.equal(mid.successCount, 1);
  assert.equal(mid.targets[0].status, 'sent');

  // recoverInterrupted converts leftover 'running' jobs to 'interrupted'
  const recovered = await jobsRepo.recoverInterrupted();
  assert.ok(recovered.some((j) => j.id === job.id && j.state === 'interrupted'));

  await jobsRepo.markCancelled(await jobsRepo.read(job.id));
  const done = await jobsRepo.read(job.id);
  assert.equal(done.state, 'cancelled');
  assert.ok(done.finishedAt);
});

test('sessions + settings', async () => {
  const token = await sessionsRepo.create('test-agent', '127.0.0.1');
  assert.equal(await sessionsRepo.isValid(token), true);
  await sessionsRepo.destroy(token);
  assert.equal(await sessionsRepo.isValid(token), false);

  await settingsRepo.set('broadcastMaxRetries', 5);
  const effective = await settingsRepo.effective();
  assert.equal(effective.maxRetries, 5);
});

test('admin bootstrap fails cleanly without ADMIN_PASSWORD', async () => {
  const res = await usersRepo.ensureAdmin();
  assert.equal(res.created, false);
  assert.match(res.reason, /ADMIN_PASSWORD/);
  assert.equal(await usersRepo.verify('admin', 'x'), false);
});
