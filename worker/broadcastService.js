/**
 * BroadcastService — bulk-message orchestration for the persistent worker.
 *
 * Jobs are created by the Next.js web app in the SHARED database. The
 * worker receives {jobId} notifications, reads the job, executes it and
 * writes per-target progress back to the same database. The web app shows
 * progress by reading the database (and via the realtime WebSocket).
 *
 * All send jobs run through ONE global serialized queue so WhatsApp rate
 * limits are respected. Already-sent targets are never re-sent on resume.
 */
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const config = require('./lib/config');
const { Queue } = require('./lib/queue');
const { jobsRepo } = require('./lib/repositories');
const appSettings = require('./lib/appSettings');
const recentSends = require('./lib/recentSends');
const wa = require('./whatsappManager');
const hub = require('./webSocketHub');
const { broadcast, formatDuration, jidForPhone } = require('./lib/broadcast');
const { formatPhone } = require('./lib/phone');
const { jobSnapshot } = require('./lib/jobSnapshot');
const { makeLogger } = require('./lib/logger');

const LOG = makeLogger('BROADCAST');

const UPLOADS_DIR = config.uploadsDir;
fs.ensureDirSync(UPLOADS_DIR);

/** Stable identity of a payload — used by the cross-job duplicate guard. */
function payloadKeyForSpec(spec) {
  if (!spec) return '';
  const parts = [spec.type, spec.text, spec.caption, spec.fileName, spec.mimetype, spec.fileId, spec.latitude, spec.longitude];
  const body = parts.filter((v) => v !== undefined && v !== null && v !== '').join('\u0000');
  return crypto.createHash('sha1').update(body || 'empty').digest('hex');
}

const queuedJobIds = new Set();
const lastProgressAt = new Map();

/** Effective broadcast settings: DB overrides (Settings page) > env defaults. */
function getBroadcastSettings() {
  appSettings.refresh().catch(() => {});
  const ov = appSettings.getAll();
  return {
    delayMinMs: parseInt(ov.broadcastDelayMinMs, 10) || config.broadcastDelayMinMs,
    delayMaxMs: parseInt(ov.broadcastDelayMaxMs, 10) || config.broadcastDelayMaxMs,
    maxRetries: parseInt(ov.broadcastMaxRetries, 10) || config.broadcastMaxRetries,
    duplicateTtlMin: ov.duplicateSendTtlMin !== undefined ? parseInt(ov.duplicateSendTtlMin, 10) : config.duplicateSendTtlMin,
    waPresenceCheck: ov.waPresenceCheck !== undefined ? !!ov.waPresenceCheck : config.waPresenceCheck,
    waSkipUnregistered: ov.waSkipUnregistered !== undefined ? !!ov.waSkipUnregistered : config.waSkipUnregistered,
    maxRecipients: parseInt(ov.maxRecipients, 10) || config.maxRecipients,
    maxMessageLength: parseInt(ov.maxMessageLength, 10) || config.maxMessageLength,
  };
}

const globalQueue = new Queue({
  onItem: async (jobId) => {
    try {
      await executeJob(jobId);
    } catch (e) {
      LOG.error('Job execution error:', jobId, e.message);
      const job = await jobsRepo.read(jobId);
      if (job) {
        await jobsRepo.markInterrupted(job);
        hub.broadcast('job:update', jobSnapshot(await jobsRepo.read(jobId)));
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
    // Media may be referenced either by an absolute path (legacy) or by a
    // fileId stored by the web app's upload proxy (data/uploads/<fileId>).
    const mediaPath = spec.fileId ? path.join(UPLOADS_DIR, String(spec.fileId).replace(/[^A-Za-z0-9._\-]/g, '')) : spec.file;
    const readMedia = () => (mediaPath ? fs.readFileSync(mediaPath) : Buffer.alloc(0));
    switch (spec.type) {
      case 'text':
        return { text: spec.text };
      case 'image':
        return { image: readMedia(), caption: spec.caption || '' };
      case 'video':
        return { video: readMedia(), caption: spec.caption || '', mimetype: spec.mimetype || 'video/mp4' };
      case 'video_note':
        return { video: readMedia(), ptt: true };
      case 'gif':
        return { video: readMedia(), gifPlayback: true, caption: spec.caption || '', mimetype: spec.mimetype || 'video/mp4' };
      case 'voice':
        return { audio: readMedia(), mimetype: spec.mimetype || 'audio/ogg; codecs=opus', ptt: true };
      case 'audio':
        return { audio: readMedia(), mimetype: spec.mimetype || 'audio/mpeg', ptt: false, caption: spec.caption || '' };
      case 'document':
        return { document: readMedia(), fileName: spec.fileName || 'document', mimetype: spec.mimetype || 'application/octet-stream', caption: spec.caption || '' };
      case 'sticker':
        return { sticker: readMedia() };
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

function emitJob(job) {
  const snap = jobSnapshot(job);
  hub.broadcast('job:update', snap);
  return snap;
}

// ─── Job execution ───

async function executeJob(jobId) {
  const job = await jobsRepo.read(jobId);
  if (!job) return;
  if (job.state === 'cancelled' || job.state === 'completed') return;

  const sender = wa.getSenderSocket();
  if (!sender || !sender.sock) {
    await jobsRepo.markInterrupted(job);
    LOG.info(`Job ${job.id} interrupted — WhatsApp not connected.`);
    emitJob(await jobsRepo.read(job.id));
    return;
  }

  job.state = 'running';
  await jobsRepo.write(job);

  const payload = payloadFromSpec(job.payloadSpec);
  if (!payload) {
    const fresh = await jobsRepo.read(job.id);
    for (const t of fresh.targets) {
      if (t.status === 'pending' || t.status === 'failed') {
        await jobsRepo.updateTarget(fresh, t.phone, { status: 'failed', error: 'Media faylı tapılmadı və ya dəstəklənmir' });
      }
    }
    const final = await jobsRepo.read(job.id);
    await jobsRepo.markCompleted(final);
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
    isCancelled: async () => {
      const fresh = await jobsRepo.read(job.id);
      return !fresh || fresh.state === 'cancelled';
    },
    onProgress: async (u) => {
      const fresh = await jobsRepo.read(job.id);
      if (!fresh) return;
      const t = fresh.targets.find((x) => x.phone === u.phone);
      await jobsRepo.updateTarget(fresh, u.phone, {
        status: u.status,
        error: u.error || u.reason || null,
        attempts: u.status === 'failed' ? (t?.attempts || 0) + 1 : t?.attempts || 0,
      });
      const now = Date.now();
      const last = lastProgressAt.get(job.id) || 0;
      if (now - last >= 500) {
        lastProgressAt.set(job.id, now);
        emitJob(await jobsRepo.read(job.id));
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

  const final = await jobsRepo.read(job.id);
  if (!final) return;

  if (final.state === 'cancelled') {
    await jobsRepo.markCancelled(final);
    cleanupMedia(final);
    hub.broadcast('job:done', jobSnapshot(final));
    hub.broadcast('stats', {});
    return;
  }

  if (report.interrupted) {
    await jobsRepo.markInterrupted(final);
    hub.broadcast('job:done', jobSnapshot(final));
    hub.broadcast('stats', {});
    return;
  }

  await jobsRepo.markCompleted(final, report);
  hub.broadcast('job:done', jobSnapshot(final));
  hub.broadcast('stats', {});
}

function cleanupMedia() {}

// ─── Public API ───

/** Enqueue an existing (shared-DB) job for execution. */
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
async function resumeInterruptedJobs() {
  const sender = wa.getSenderSocket();
  if (!sender || !sender.sock) return 0;
  let resumed = 0;
  for (const job of await jobsRepo.listActive()) {
    if (job.state !== 'interrupted') continue;
    if (queuedJobIds.has(job.id)) continue;
    enqueueJob(job.id);
    emitJob(await jobsRepo.read(job.id));
    resumed++;
  }
  return resumed;
}

/** Mark 'running' jobs (crash leftovers) as interrupted, then resume. */
async function recoverAndResume() {
  const recovered = await jobsRepo.recoverInterrupted();
  for (const job of recovered) {
    LOG.info(`Recovered interrupted job ${job.id}`);
    emitJob(await jobsRepo.read(job.id));
  }
  return resumeInterruptedJobs();
}

/** Cancel a specific job. Cancelled jobs are never resumed. */
async function cancelJob(jobId) {
  const job = await jobsRepo.read(jobId);
  if (!job) return false;
  if (job.state !== 'running' && job.state !== 'interrupted') return false;
  await jobsRepo.markCancelled(job);
  cleanupMedia(job);
  const removed = globalQueue.removeWhere((id) => id === jobId);
  if (removed > 0) queuedJobIds.delete(jobId);
  hub.broadcast('job:done', jobSnapshot(await jobsRepo.read(jobId)));
  hub.broadcast('stats', {});
  return true;
}

/** Cancel every active job. @returns {number} jobs cancelled */
async function cancelAllActive() {
  let cancelled = 0;
  for (const job of await jobsRepo.listActive()) {
    if (await cancelJob(job.id)) cancelled++;
  }
  return cancelled;
}

/**
 * Retry the failed targets of a completed/interrupted job as a new job.
 */
async function retryFailed(jobId) {
  const old = await jobsRepo.read(jobId);
  if (!old) return null;
  const failed = old.targets.filter((t) => t.status === 'failed');
  if (failed.length === 0) return null;

  const job = await jobsRepo.create({
    type: old.type,
    payloadSpec: old.payloadSpec,
    targets: failed.map((t) => ({ phone: t.phone, name: t.name })),
  });
  job.payloadKey = old.payloadKey || payloadKeyForSpec(job.payloadSpec);
  await jobsRepo.write(job);

  const payload = payloadFromSpec(job.payloadSpec);
  if (!payload) {
    const fresh = await jobsRepo.read(job.id);
    for (const t of fresh.targets) {
      await jobsRepo.updateTarget(fresh, t.phone, { status: 'failed', error: 'Media faylı artıq mövcud deyil — yeni media göndərin' });
    }
    await jobsRepo.markCompleted(await jobsRepo.read(job.id));
    cleanupMedia(fresh);
    hub.broadcast('job:new', jobSnapshot(await jobsRepo.read(job.id)));
    hub.broadcast('job:done', jobSnapshot(await jobsRepo.read(job.id)));
    return jobsRepo.read(job.id);
  }

  enqueueJob(job.id);
  hub.broadcast('job:new', jobSnapshot(await jobsRepo.read(job.id)));
  hub.broadcast('stats', {});
  return jobsRepo.read(job.id);
}

/** Graceful shutdown: persist state; running jobs become resumable. */
async function shutdown() {
  for (const job of await jobsRepo.listActive()) {
    if (job.state === 'running') {
      await jobsRepo.markInterrupted(job);
      queuedJobIds.delete(job.id);
    }
  }
  globalQueue.cancel();
  LOG.info('Broadcast service shut down; active jobs marked interrupted (resumable).');
}

/** Delete old terminal jobs (retention). */
async function purgeOldJobs(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  let purged = 0;
  for (const job of await jobsRepo.all()) {
    if (job.state === 'completed' || job.state === 'cancelled') {
      const finished = new Date(job.finishedAt || job.updatedAt).getTime();
      if (now - finished > maxAgeMs) {
        await jobsRepo.deleteJob(job.id);
        cleanupMedia(job);
        purged++;
      }
    }
  }
  if (purged > 0) LOG.info(`Purged ${purged} old job(s).`);
  return purged;
}

module.exports = {
  enqueueJob,
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
