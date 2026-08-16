const test = require('node:test');
const assert = require('node:assert/strict');

test('firebase config defaults to the project config (chatog-94528)', () => {
  const config = require('../lib/config');
  assert.equal(config.firebase.enabled, true);
  assert.equal(config.firebase.databaseURL, 'https://chatog-94528-default-rtdb.firebaseio.com');
  assert.equal(config.firebase.projectId, 'chatog-94528');
  assert.equal(config.firebase.appId, '1:877401186095:web:04d181fbbf2aaebb64cbda');
});

test('firebase endpoint builds RTDB REST URLs', () => {
  const { endpoint } = require('../lib/firebase');
  assert.equal(endpoint('wpm/events'), 'https://chatog-94528-default-rtdb.firebaseio.com/wpm/events.json');
  assert.equal(endpoint('/wpm/events/'), 'https://chatog-94528-default-rtdb.firebaseio.com/wpm/events.json');
});

test('firebase publish is a safe no-op when disabled', async () => {
  const prev = process.env.FIREBASE_ENABLED;
  process.env.FIREBASE_ENABLED = 'false';
  delete require.cache[require.resolve('../lib/config')];
  delete require.cache[require.resolve('../lib/firebase')];
  const fb = require('../lib/firebase');
  assert.equal(await fb.publish('test', { x: 1 }), false);
  if (prev === undefined) delete process.env.FIREBASE_ENABLED;
  else process.env.FIREBASE_ENABLED = prev;
});

test('worker realtime mirror is a safe no-op when disabled', async () => {
  const prev = process.env.FIREBASE_ENABLED;
  process.env.FIREBASE_ENABLED = 'false';
  delete require.cache[require.resolve('../worker/lib/config')];
  delete require.cache[require.resolve('../worker/lib/realtime')];
  delete require.cache[require.resolve('../lib/firebase')];
  const realtime = require('../worker/lib/realtime');
  assert.equal(await realtime.publish('stats', {}), false);
  if (prev === undefined) delete process.env.FIREBASE_ENABLED;
  else process.env.FIREBASE_ENABLED = prev;
});
