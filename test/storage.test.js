const test = require('node:test');
const assert = require('node:assert/strict');

// Use the in-memory Firebase transport — no network, no local files.
process.env.FIREBASE_DATABASE_URL = 'memory://';

const fb = require('../lib/firebase');
const { contactsRepo, jobsRepo, sessionsRepo, usersRepo, settingsRepo } = require('../lib/repositories');

test.beforeEach(() => {
  fb._memoryReset();
});

test('firebase transport: set/get/update/push/remove semantics', async () => {
  const id = await fb.push('wpm/test', { a: 1 });
  assert.ok(id);
  const val = await fb.get('wpm/test/' + id);
  assert.equal(val.a, 1);

  await fb.update('wpm/test/' + id, { b: 2, a: null });
  const after = await fb.get('wpm/test/' + id);
  assert.deepEqual(after, { b: 2 });

  await fb.set('wpm/test/' + id, { c: 3 });
  assert.deepEqual(await fb.get('wpm/test/' + id), { c: 3 });

  await fb.remove('wpm/test/' + id);
  assert.equal(await fb.get('wpm/test/' + id), null);
});

test('buffer round-trip (Baileys auth state style)', async () => {
  const buf = Buffer.from([1, 2, 3, 255]);
  await fb.set('wpm/buf', { key: { type: 'Buffer', data: Array.from(buf) }, plain: 'x' });
  const out = await fb.get('wpm/buf');
  assert.ok(Buffer.isBuffer(out.key));
  assert.deepEqual(Array.from(out.key), [1, 2, 3, 255]);
  assert.equal(out.plain, 'x');
});

test('contacts CRUD + normalization dedupe (Firebase)', async () => {
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

test('jobs lifecycle: create → interrupted → recover → cancelled (Firebase)', async () => {
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

  const recovered = await jobsRepo.recoverInterrupted();
  assert.ok(recovered.some((j) => j.id === job.id && j.state === 'interrupted'));

  await jobsRepo.markCancelled(await jobsRepo.read(job.id));
  const done = await jobsRepo.read(job.id);
  assert.equal(done.state, 'cancelled');
  assert.ok(done.finishedAt);
});

test('sessions + settings (Firebase)', async () => {
  const token = await sessionsRepo.create('test-agent', '127.0.0.1');
  assert.equal(await sessionsRepo.isValid(token), true);
  await sessionsRepo.destroy(token);
  assert.equal(await sessionsRepo.isValid(token), false);

  await settingsRepo.set('broadcastMaxRetries', 5);
  const effective = await settingsRepo.effective();
  assert.equal(effective.maxRetries, 5);
});

test('admin bootstrap creates default credentials; changeCredentials invalidates sessions', async () => {
  const res = await usersRepo.ensureAdmin();
  assert.equal(res.created, true);
  assert.equal(res.username, 'gasham');
  assert.equal(await usersRepo.verify('gasham', 'gasham1006'), true);
  assert.equal(await usersRepo.verify('gasham', 'wrong'), false);

  const token = await sessionsRepo.create('test-agent', '127.0.0.1');
  assert.equal(await sessionsRepo.isValid(token), true);
  const bad = await usersRepo.changeCredentials('wrong-pass', 'gasham2', 'newpass123');
  assert.equal(bad.ok, false);
  assert.equal(await sessionsRepo.isValid(token), true);

  const ok = await usersRepo.changeCredentials('gasham1006', 'gasham2', 'newpass123');
  assert.equal(ok.ok, true);
  assert.equal(ok.username, 'gasham2');
  assert.equal(await sessionsRepo.isValid(token), false);
  assert.equal(await usersRepo.verify('gasham', 'gasham1006'), false);
  assert.equal(await usersRepo.verify('gasham2', 'newpass123'), true);
});
