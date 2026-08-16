const test = require('node:test');
const assert = require('node:assert/strict');
const { Queue } = require('../worker/lib/queue');
const { sleep } = require('../worker/lib/myfunc');

test('queue processes items sequentially and reports success/failure', async () => {
  const order = [];
  const q = new Queue({
    onItem: async (item) => {
      order.push(item);
      if (item === 'bad') throw new Error('boom');
    },
    delayMin: 5,
    delayMax: 5,
  });
  q.push('a');
  q.push('bad');
  q.push('b');
  await q.run();
  assert.deepEqual(order, ['a', 'bad', 'b']);
  assert.equal(q.success, 2);
  assert.equal(q.failed, 1);
});

test('cancel stops the worker and clears pending items', async () => {
  const q = new Queue({
    onItem: async () => { await sleep(30); },
    delayMin: 5,
    delayMax: 5,
  });
  q.push('a');
  q.push('b');
  q.push('c');
  const drain = q.run();
  await sleep(10);
  q.cancel();
  await drain;
  assert.equal(q.size, 0);
  assert.equal(q.busy, false);
});

test('removeWhere drops matching queued items only', async () => {
  const seen = [];
  const q = new Queue({
    onItem: async (item) => { seen.push(item); await sleep(5); },
    delayMin: 2,
    delayMax: 2,
  });
  q.push('job-1');
  q.push('job-2');
  q.push('job-3');
  const drain = q.run();
  await sleep(5);
  const removed = q.removeWhere((id) => id === 'job-2');
  assert.equal(removed, 1);
  await drain;
  assert.ok(seen.includes('job-1'));
  assert.ok(seen.includes('job-3'));
  assert.ok(!seen.includes('job-2'));
});
