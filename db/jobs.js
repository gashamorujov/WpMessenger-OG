/**
 * Jobs — persistent SQLite store for broadcast/messaging jobs.
 *
 * A job describes one send operation: payload (text or media spec),
 * targets with per-target status, counters and lifecycle state:
 *   running → completed | cancelled
 *   running → interrupted (connection lost / process died) → running (auto-resume)
 */
const { getDb } = require('./index');
const { makeLogger } = require('../lib/logger');
const crypto = require('crypto');

const LOG = makeLogger('JOBS');

const STATES = {
  RUNNING: 'running',
  INTERRUPTED: 'interrupted',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const TARGET_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

function newId() {
  return crypto.randomBytes(4).toString('hex') + Date.now().toString(36);
}

function rowToJob(row) {
  if (!row) return null;
  let payloadSpec = {};
  let targets = [];
  try { payloadSpec = JSON.parse(row.payloadSpec || '{}'); } catch {}
  try { targets = JSON.parse(row.targets || '[]'); } catch {}
  return {
    id: row.id,
    state: row.state,
    type: row.type,
    payloadSpec,
    targets,
    successCount: row.successCount,
    failCount: row.failCount,
    skipCount: row.skipCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function create(input) {
  const now = new Date().toISOString();
  const id = newId();
  const job = {
    id,
    state: STATES.RUNNING,
    type: input.type || 'text',
    payloadSpec: input.payloadSpec || {},
    targets: (input.targets || []).map((t) => ({
      phone: t.phone,
      name: t.name || null,
      status: TARGET_STATUS.PENDING,
      error: null,
      attempts: 0,
    })),
    successCount: 0,
    failCount: 0,
    skipCount: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
  };
  write(job);
  return job;
}

function write(job) {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, state, type, payloadSpec, targets, successCount, failCount, skipCount, createdAt, updatedAt, startedAt, finishedAt)
       VALUES (@id, @state, @type, @payloadSpec, @targets, @successCount, @failCount, @skipCount, @createdAt, @updatedAt, @startedAt, @finishedAt)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         type = excluded.type,
         payloadSpec = excluded.payloadSpec,
         targets = excluded.targets,
         successCount = excluded.successCount,
         failCount = excluded.failCount,
         skipCount = excluded.skipCount,
         updatedAt = excluded.updatedAt,
         startedAt = excluded.startedAt,
         finishedAt = excluded.finishedAt`
    )
    .run({
      id: job.id,
      state: job.state,
      type: job.type,
      payloadSpec: JSON.stringify(job.payloadSpec || {}),
      targets: JSON.stringify(job.targets || []),
      successCount: job.successCount,
      failCount: job.failCount,
      skipCount: job.skipCount,
      createdAt: job.createdAt,
      updatedAt: new Date().toISOString(),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    });
}

function update(job) {
  job.updatedAt = new Date().toISOString();
  write(job);
  return job;
}

function read(id) {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return rowToJob(row);
}

/** Update one target and keep counters consistent. */
function updateTarget(job, phone, patch) {
  const t = job.targets.find((x) => x.phone === phone);
  if (!t) return;
  const prev = t.status;
  Object.assign(t, patch);
  const next = t.status;

  const recount = (from, to) => {
    if (from === 'sent') job.successCount = Math.max(0, job.successCount - 1);
    if (from === 'failed') job.failCount = Math.max(0, job.failCount - 1);
    if (from === 'skipped') job.skipCount = Math.max(0, job.skipCount - 1);
    if (to === 'sent') job.successCount++;
    if (to === 'failed') job.failCount++;
    if (to === 'skipped') job.skipCount++;
  };
  if (prev !== next) recount(prev, next);
  if (patch.error) t.error = String(patch.error).slice(0, 300);
  update(job);
}

function markCompleted(job, report = {}) {
  job.state = STATES.COMPLETED;
  job.finishedAt = new Date().toISOString();
  if (typeof report.success === 'number') job.successCount = report.success;
  if (typeof report.fail === 'number') job.failCount = report.fail;
  if (typeof report.skip === 'number') job.skipCount = report.skip;
  update(job);
}

function markInterrupted(job) {
  job.state = STATES.INTERRUPTED;
  update(job);
}

function markCancelled(job) {
  job.state = STATES.CANCELLED;
  job.finishedAt = new Date().toISOString();
  update(job);
}

/** List jobs with optional filters (used by History + Active processes). */
function list(opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(opts.pageSize, 10) || 20));
  const state = opts.state || '';
  const q = String(opts.q || '').trim().toLowerCase();
  const where = [];
  const params = [];

  if (state && state !== 'all') {
    where.push('state = ?');
    params.push(state);
  }
  if (q) {
    where.push('(id LIKE ? OR type LIKE ? OR payloadSpec LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM jobs ${whereSql}`).get(...params).n;
  const rows = db
    .prepare(`SELECT * FROM jobs ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  return {
    items: rows.map(rowToJob),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function all() {
  return getDb().prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all().map(rowToJob);
}

function listActive() {
  return getDb()
    .prepare("SELECT * FROM jobs WHERE state IN ('running','interrupted') ORDER BY createdAt DESC")
    .all()
    .map(rowToJob);
}

/** Mark all 'running' jobs as 'interrupted' (process died while running). */
function recoverInterrupted() {
  const recovered = [];
  for (const job of listActive()) {
    if (job.state === STATES.RUNNING) {
      markInterrupted(job);
      recovered.push(job);
    }
  }
  return recovered;
}

function deleteJob(id) {
  getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

function _reset() {
  getDb().prepare('DELETE FROM jobs').run();
}

module.exports = {
  STATES,
  TARGET_STATUS,
  newId,
  create,
  read,
  write,
  update,
  updateTarget,
  markCompleted,
  markInterrupted,
  markCancelled,
  list,
  all,
  listActive,
  recoverInterrupted,
  deleteJob,
  _reset,
};
