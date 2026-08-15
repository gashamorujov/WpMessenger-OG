const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-auth-'));
process.env.DATA_DIR = tmp;
process.env.DATABASE_URL = path.join(tmp, 'app.db');
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'sifre-12345';

const { migrate, close } = require('../db');
const auth = require('../server/auth');
const sessions = require('../db/sessions');

test('auth: user creation, verify, sessions', () => {
  migrate();
  const created = auth.createUserIfNeeded();
  assert.equal(created.generated, false);
  assert.equal(auth.verify('admin', 'sifre-12345'), true);
  assert.equal(auth.verify('admin', 'yanlis'), false);
  assert.equal(auth.verify('baskasi', 'sifre-12345'), false);

  const token = auth.login('admin', 'sifre-12345', 'test-agent', '127.0.0.1');
  assert.ok(token);
  assert.equal(sessions.isValid(token), true);
  assert.equal(sessions.isValid('invalid-token'), false);

  sessions.destroy(token);
  assert.equal(sessions.isValid(token), false);
});

test.after(() => { close(); });
