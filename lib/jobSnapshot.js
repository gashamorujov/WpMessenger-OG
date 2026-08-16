/**
 * Job snapshot — the shape served to the UI (no internal JSON blobs).
 */
function payloadPreview(spec) {
  if (!spec) return { type: 'text', text: '' };
  const base = { type: spec.type || 'text' };
  if (spec.text != null) base.text = String(spec.text).slice(0, 500);
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
    targets: job.targets.map((t) => ({ phone: t.phone, name: t.name, status: t.status, error: t.error, attempts: t.attempts })),
  };
}

module.exports = { jobSnapshot, payloadPreview };
