const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wpm-recent-'));
process.env.DATA_DIR = tmp;
process.env.DATABASE_URL = path.join(tmp, 'app.db');

const { migrate, close } = require('../db');
const recentSends = require('../lib/recentSends');

test('recentSends: duplicate guard by payload key', () => {
  migrate();
  recentSends._reset();
  recentSends.markSent('0501234567', 'key-1');
  assert.equal(recentSends.isDuplicate('994501234567', 'key-1'), true);
  assert.equal(recentSends.isDuplicate('994501234567', 'key-2'), false);
  assert.equal(recentSends.isRecent('0501234567'), true);
  assert.equal(recentSends.isRecent('0551234567'), false);
});

test.after(() => { close(); });
