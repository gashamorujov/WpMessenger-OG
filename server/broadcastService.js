/**
 * BroadcastService — bulk-message orchestration for the web panel.
 *
 * All send jobs run through ONE global serialized queue so WhatsApp rate
 * limits are respected even when multiple jobs are active. Per-target
 * status is persisted after every send; already-sent targets are never
 * re-sent on resume/retry. Every state change is pushed to the frontend
 * through the WebSocket hub.
 *
 * Lifecycle (persisted via db/jobs):
 *   running → completed | cancelled
 *   running → interrupted (connection lost / process died) → running (auto-resume)
 */
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { Queue } = require('../lib/queue');
const jobStore = require('../db/jobs');
const recentSends = require('../lib/recentSends');
const wa = require('./whatsappManager');
const hub = require('./webSocketHub');
const { broadcast, formatDuration, jidForPhone } = require('../lib/broadcast');
const { formatPhone } = require('../lib/phone');
const { makeLogger } = require('../lib/logger');
const settings = require('../settings');
const appSettings = require('../db/appSettings');

const LOG = makeLogger('BROADCAST');

const JOBS_DIR = path.join(settings.dataDir, 'jobs');
fs.ensureDirSync(JOBS_DIR);

/** Stable identity of a payload — used by the cross-job duplicate guard. */
function payloadKeyForSpec(spec) {
  if (!spec) return '';
  const parts = [spec.type, spec.text, spec.caption, spec.fileName, spec.mimetype, spec.latitude, spec.longitude];
  const body = parts.filter((v) => v !== undefined && v !== null && v !== '').join('\u0000');
  return crypto.createHash('sha1').update(body || 'empty').digest('hex');
}

const queuedJobIds = new Set();
const lastProgressAt = new Map();

/** Effective broadcast settings: DB overrides (Settings page) > env defaults. */
function getBroadcastSettings() {
  const ov = appSettings.getAll();
  return {
    delayMinMs: parseInt(ov.broadcastDelayMinMs, 10) || settings.broadcastDelayMinMs,
    delayMaxMs: parseInt(ov.broadcastDelayMaxMs, 10) || settings.broadcastDelayMaxMs,
    maxRetries: parseInt(ov.broadcastMaxRetries, 10) || settings.broadcastMaxRetries,
    duplicateTtlMin: ov.duplicateSendTtlMin !== undefined ? parseInt(ov.duplicateSendTtlMin, 10) : settings.duplicateSendTtlMin,
    waPresenceCheck: ov.waPresenceCheck !== undefined ? !!ov.waPresenceCheck : settings.waPresenceCheck,
    waSkipUnregistered: ov.waSkipUnregistered !== undefined ? !!ov.waSkipUnregistered : settings.waSkipUnregistered,
    maxRecipients: parseInt(ov.maxRecipients, 10) || settings.maxRecipients,
    maxMessageLength: parseInt(ov.maxMessageLength, 10) || settings.maxMessageLength,
  };
}

const globalQueue = new Queue({
  onItem: async (jobId) => {
    try {
      await executeJob(jobId);
    } catch (e) {
      LOG.error('Job execution error:', jobId, e.message);
      const job = jobStore.read(jobId);
      if (job) {
        jobStore.markInterrupted(job);
        hub.broadcast('job:update', jobSnapshot(job));
      }
    } finally {
      queuedJobIds.delete(jobId);
      lastProgressAt.delete(jobId);
    }
  },
  delayMin: 2000,
  delayMax: 4000,
});

// ─── Payload (de)serialization ───

function payloadFromSpec(spec) {
  if (!spec) return null;
  try {
    switch (spec.type) {
      case 'text':
        return { text: spec.text };
      case 'image':
        return { image: fs.readFileSync(spec.file), caption: spec.caption || '' };
      case 'video':
        return { video: fs.readFileSync(spec.file), caption: spec.caption || '', mimetype: spec.mimetype || 'video/mp4' };
      case 'video_note':
        return { video: fs.readFileSync(spec.file), ptt: true };
      case 'gif':
        return { video: fs.readFileSync(spec.file), gifPlayback: true, caption: spec.caption || '', mimetype: spec.mimetype || 'video/mp4' };
      case 'voice':
        return { audio: fs.readFileSync(spec.file), mimetype: spec.mimetype || 'audio/ogg; codecs=opus', ptt: true };
      case 'audio':
        return { audio: fs.readFileSync(spec.file), mimetype: spec.mimetype || 'audio/mpeg', ptt: false, caption: spec.caption || '' };
      case 'document':
        return { document: fs.readFileSync(spec.file), fileName: spec.fileName || 'document', mimetype: spec.mimetype || 'application/octet-stream', caption: spec.caption || '' };
      case 'sticker':
        return { sticker: fs.readFileSync(spec.file) };
      case 'contact':
        return { contacts: spec.contact };
      case 'location':
        return { location: { degreesLatitude: spec.latitude, degreesLongitude: spec.longitude } };
      default:
        return null;
    }
  } catch (e) {
    LOG.error('payloadFromSpec error:', e.message);
    return null;
  }
}

// ─── Job snapshots (pushed to the UI) ───

function payloadPreview(spec) {
  if (!spec) return { type: 'text', text: '' };
  const base = { type: spec.type || 'text' };
  if (spec.text !== undefined && spec.text !== null) base.text = String(spec.text).slice(0, 500);
  if (spec.caption) base.caption = String(spec.caption).slice(0, 500);
  if (spec.fileName) base.fileName = spec.fileName;
  if (spec.mimetype) base.mimetype = spec.mimetype;
  return base;
}

function jobSnapshot(job) {
  if (!job) return null;
  return {
    id: job.id,
    state: job.state,
    type: job.type,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    total: job.targets.length,
    done: job.targets.filter((t) => t.status !== 'pending').length,
    successCount: job.successCount,
    failCount: job.failCount,
    skipCount: job.skipCount,
    payload: payloadPreview(job.payloadSpec),
    targets: job.targets.map((t) => ({
      phone: t.phone,
      name: t.name,
      status: t.status,
      error: t.error,
      attempts: t.attempts,
    })),
  };
}

function emitJob(job) {
  const snap = jobSnapshot(job);
  hub.broadcast('job:update', snap);
  return snap;
}

// ─── Job execution ───

async function executeJob(jobId) {
  const job = jobStore.read(jobId);
  if (!job) return;
  if (job.state === 'cancelled' || job.state === 'completed') return;

  const sender = wa.getSenderSocket();
  if (!sender || !sender.sock) {
    jobStore.markInterrupted(job);
    LOG.info(`Job ${job.id} interrupted — WhatsApp not connected.`);
    emitJob(jobStore.read(job.id));
    return;
  }

  job.state = 'running';
  jobStore.update(job);

  const payload = payloadFromSpec(job.payloadSpec);
  if (!payload) {
    for (const t of job.targets) {
      if (t.status === 'pending' || t.status === 'failed') {
        jobStore.updateTarget(job, t.phone, { status: 'failed', error: 'Media faylı tapılmadı və ya dəstəklənmir' });
      }
    }
    const final = jobStore.read(job.id);
    jobStore.markCompleted(final);
    cleanupMedia(final);
    hub.broadcast('job:done', jobSnapshot(final));
    hub.broadcast('stats', {});
    return;
  }

  const bc = getBroadcastSettings();
  const pending = job.targets.filter((t) => t.status === 'pending' || t.status === 'failed');
  const targets = pending.map((t) => ({
    jid: jidForPhone(t.phone),
    label: t.name ? `${t.name} — ${formatPhone(t.phone)}` : formatPhone(t.phone),
    phone: t.phone,
  }));

  const report = await broadcast(sender.sock, targets, payload, {
    isCancelled: () => {
      const fresh = jobStore.read(job.id);
      return !fresh || fresh.state === 'cancelled';
    },
    onProgress: (u) => {
      const fresh = jobStore.read(job.id);
      if (!fresh) return;
      const t = fresh.targets.find((x) => x.phone === u.phone);
      jobStore.updateTarget(fresh, u.phone, {
        status: u.status,
        error: u.error || u.reason || null,
        attempts: u.status === 'failed' ? (t?.attempts || 0) + 1 : t?.attempts || 0,
      });
      const now = Date.now();
      const last = lastProgressAt.get(job.id) || 0;
      if (now - last >= 500) {
        lastProgressAt.set(job.id, now);
        emitJob(jobStore.read(job.id));
      }
    },
    checkRegistered: bc.waPresenceCheck,
    skipUnregistered: bc.waSkipUnregistered,
    duplicateGuard: {
      isDuplicate: (phone) => recentSends.isDuplicate(phone, job.payloadKey || ''),
      markSent: (phone) => recentSends.markSent(phone, job.payloadKey || ''),
    },
    maxRetries: bc.maxRetries,
    delayMinMs: bc.delayMinMs,
    delayMaxMs: bc.delayMaxMs,
    ackTracking: true,
  });

  const final = jobStore.read(job.id);
  if (!final) return;

  if (final.state === 'cancelled') {
    jobStore.markCancelled(final);
    cleanupMedia(final);
    hub.broadcast('job:done', jobSnapshot(final));
    hub.broadcast('stats', {});
    return;
  }

  if (report.interrupted) {
    jobStore.markInterrupted(final);
    hub.broadcast('job:done', jobSnapshot(final));
    hub.broadcast('stats', {});
    return;
  }

  jobStore.markCompleted(final, report);
  // Media stays with the job until retention purge so "retry failed" works
  // without asking for a new file.
  hub.broadcast('job:done', jobSnapshot(final));
  hub.broadcast('stats', {});
}

function cleanupMedia(job) {
  try {
    fs.removeSync(path.join(JOBS_DIR, job.id, 'media'));
  } catch {}
}

// ─── Public API ───

/**
 * Create a job from a built payload and enqueue it.
 * @param {{type: string, payloadSpec: object, targets: Array<{phone: string, name?: string}>, tempFile?: string|null}} input
 */
function createJob(input) {
  const job = jobStore.create({
    type: input.type,
    payloadSpec: input.payloadSpec,
    targets: input.targets,
  });
  job.payloadKey = payloadKeyForSpec(job.payloadSpec);
  jobStore.update(job);

  if (input.tempFile) {
    try {
      const mediaDir = path.join(JOBS_DIR, job.id, 'media');
      fs.ensureDirSync(mediaDir);
      const dest = path.join(mediaDir, path.basename(input.tempFile));
      fs.moveSync(input.tempFile, dest, { overwrite: true });
      job.payloadSpec.file = dest;
      jobStore.update(job);
    } catch (e) {
      LOG.error('Job media move failed:', e.message);
    }
  }

  enqueueJob(job.id);
  hub.broadcast('job:new', jobSnapshot(jobStore.read(job.id)));
  hub.broadcast('stats', {});
  return jobStore.read(job.id);
}

function enqueueJob(jobId) {
  if (queuedJobIds.has(jobId)) return false;
  queuedJobIds.add(jobId);
  globalQueue.push(jobId).catch(() => {});
  return true;
}

/**
 * Resume all interrupted jobs (called on boot and whenever a WhatsApp
 * socket connects). Already-queued jobs are never double-enqueued.
 */
function resumeInterruptedJobs() {
  const sender = wa.getSenderSocket();
  if (!sender || !sender.sock) return 0;
  let resumed = 0;
  for (const job of jobStore.listActive()) {
    if (job.state !== 'interrupted') continue;
    if (queuedJobIds.has(job.id)) continue;
    enqueueJob(job.id);
    emitJob(jobStore.read(job.id));
    resumed++;
  }
  return resumed;
}

/** Mark 'running' jobs (crash leftovers) as interrupted, then resume. */
function recoverAndResume() {
  const recovered = jobStore.recoverInterrupted();
  for (const job of recovered) {
    LOG.info(`Recovered interrupted job ${job.id}`);
    emitJob(jobStore.read(job.id));
  }
  return resumeInterruptedJobs();
}

/** Cancel a specific job. Cancelled jobs are never resumed. */
function cancelJob(jobId) {
  const job = jobStore.read(jobId);
  if (!job) return false;
  if (job.state !== 'running' && job.state !== 'interrupted') return false;
  jobStore.markCancelled(job);
  cleanupMedia(job);
  const removed = globalQueue.removeWhere((id) => id === jobId);
  if (removed > 0) queuedJobIds.delete(jobId);
  hub.broadcast('job:done', jobSnapshot(jobStore.read(jobId)));
  hub.broadcast('stats', {});
  return true;
}

/** Cancel every active job. @returns {number} jobs cancelled */
function cancelAllActive() {
  let cancelled = 0;
  for (const job of jobStore.listActive()) {
    if (cancelJob(job.id)) cancelled++;
  }
  return cancelled;
}

/**
 * Retry the failed targets of a completed/interrupted job as a new job.
 */
function retryFailed(jobId) {
  const old = jobStore.read(jobId);
  if (!old) return null;
  const failed = old.targets.filter((t) => t.status === 'failed');
  if (failed.length === 0) return null;

  const job = jobStore.create({
    type: old.type,
    payloadSpec: old.payloadSpec,
    targets: failed.map((t) => ({ phone: t.phone, name: t.name })),
  });
  job.payloadKey = old.payloadKey || payloadKeyForSpec(job.payloadSpec);
  jobStore.update(job);

  const payload = payloadFromSpec(job.payloadSpec);
  if (!payload) {
    const fresh = jobStore.read(job.id);
    for (const t of fresh.targets) {
      jobStore.updateTarget(fresh, t.phone, { status: 'failed', error: 'Media faylı artıq mövcud deyil — yeni media göndərin' });
    }
    jobStore.markCompleted(jobStore.read(job.id));
    cleanupMedia(fresh);
    hub.broadcast('job:new', jobSnapshot(jobStore.read(job.id)));
    hub.broadcast('job:done', jobSnapshot(jobStore.read(job.id)));
    return jobStore.read(job.id);
  }

  enqueueJob(job.id);
  hub.broadcast('job:new', jobSnapshot(jobStore.read(job.id)));
  hub.broadcast('stats', {});
  return jobStore.read(job.id);
}

/** Graceful shutdown: persist state; running jobs become resumable. */
function shutdown() {
  for (const job of jobStore.listActive()) {
    if (job.state === 'running') {
      jobStore.markInterrupted(job);
      queuedJobIds.delete(job.id);
    }
  }
  globalQueue.cancel();
  LOG.info('Broadcast service shut down; active jobs marked interrupted (resumable).');
}

/** Delete old terminal jobs (retention). */
function purgeOldJobs(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  let purged = 0;
  for (const job of jobStore.all()) {
    if (job.state === 'completed' || job.state === 'cancelled') {
      const finished = new Date(job.finishedAt || job.updatedAt).getTime();
      if (now - finished > maxAgeMs) {
        jobStore.deleteJob(job.id);
        cleanupMedia(job);
        purged++;
      }
    }
  }
  if (purged > 0) LOG.info(`Purged ${purged} old job(s).`);
  return purged;
}

module.exports = {
  createJob,
  resumeInterruptedJobs,
  recoverAndResume,
  cancelJob,
  cancelAllActive,
  retryFailed,
  shutdown,
  purgeOldJobs,
  payloadFromSpec,
  payloadKeyForSpec,
  getBroadcastSettings,
  jobSnapshot,
};
