/**
 * Worker REST API — called by the Next.js web app (and health checks).
 *
 * Every route except /api/health requires the shared bearer token.
 * The worker never exposes admin sessions; the web app owns the UI auth.
 */
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const config = require('./lib/config');
const { requireWorkerAuth } = require('./auth');
const wa = require('./whatsappManager');
const broadcastService = require('./broadcastService');
const hub = require('./webSocketHub');
const waPresence = require('./lib/waPresence');
const { jobsRepo } = require('./lib/repositories');
const { normalizePhone } = require('./lib/phone');
const { makeLogger } = require('./lib/logger');

const LOG = makeLogger('WORKER-API');

const UPLOADS_DIR = path.join(config.dataDir, 'uploads');
fs.ensureDirSync(UPLOADS_DIR);

const router = express.Router();

function ok(res, data) {
  return res.json({ ok: true, ...data });
}

function clientError(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

// ─── Health (no auth — used by platform healthchecks) ───

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    version: config.version,
    whatsappConnected: wa.getSessions().filter((s) => s.status === 'connected').length,
  });
});

// ─── WhatsApp session management ───

router.get('/status', requireWorkerAuth, (req, res) => {
  res.json({ sessions: wa.getSessions() });
});

router.post('/connect', requireWorkerAuth, async (req, res) => {
  const { phone, method } = req.body || {};
  const isQr = method === 'qr';
  if (isQr && !phone) {
    const result = await wa.connectWithPhone('main', 'qr');
    if (!result.ok && result.error) return clientError(res, result.error, 400);
    return ok(res, { phone: 'main', sessionKey: 'main' });
  }
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return clientError(res, 'Yanlış nömrə formatı. Nümunə: 0503482680 və ya +994503482680');
  }
  const result = await wa.connectWithPhone(normalized, isQr ? 'qr' : 'pair');
  if (!result.ok && result.error) return clientError(res, result.error, 400);
  return ok(res, { phone: normalized });
});

router.post('/disconnect', requireWorkerAuth, async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return clientError(res, 'Nömrə tələb olunur');
  await wa.disconnectSession(phone);
  return ok(res, { phone });
});

router.get('/qr/:key', requireWorkerAuth, (req, res) => {
  const qr = wa.getPendingQr(req.params.key);
  if (!qr) return res.json({ qr: null });
  return res.json(qr);
});

router.get('/pair/:phone', requireWorkerAuth, (req, res) => {
  const pair = wa.getPendingPair(req.params.phone);
  if (!pair) return res.json({ code: null });
  return res.json(pair);
});

router.post('/ws-ticket', requireWorkerAuth, (req, res) => {
  res.json(hub.createTicket());
});

// ─── Contacts (WhatsApp-side helpers) ───

router.post('/contact-mirror', requireWorkerAuth, async (req, res) => {
  const { name, normalizedPhone } = req.body || {};
  const sender = wa.getSenderSocket();
  if (!sender || !sender.sock) return clientError(res, 'WhatsApp bağlantısı yoxdur', 409);
  if (!name || !normalizedPhone) return clientError(res, 'Kontakt məlumatları çatışmır');
  const result = await waPresence.addContactToWhatsApp(sender.sock, { name, phone: normalizedPhone });
  if (!result.ok) return clientError(res, result.reason || 'Kontakt əlavə edilə bilmədi', 502);
  return ok(res);
});

router.post('/check-registered', requireWorkerAuth, async (req, res) => {
  const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
  const sender = wa.getSenderSocket();
  if (!sender || !sender.sock) return clientError(res, 'WhatsApp bağlantısı yoxdur', 409);
  const map = await waPresence.checkRegistered(sender.sock, phones.map((p) => normalizePhone(p)).filter(Boolean));
  const results = {};
  for (const [phone, exists] of map) results[phone] = exists;
  res.json({ results });
});

// ─── Media uploads (proxied from the web app) ───

router.post('/upload', requireWorkerAuth, (req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > config.maxUploadBytes) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    const rawName = decodeURIComponent(String(req.headers['x-filename'] || 'file'));
    const safe = String(rawName).replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    try {
      fs.writeFileSync(path.join(UPLOADS_DIR, fileId), Buffer.concat(chunks));
      res.json({ fileId, size });
    } catch (e) {
      LOG.error('upload failed:', e.message);
      clientError(res, 'Fayl saxlanıla bilmədi: ' + e.message, 500);
    }
  });
  req.on('error', (e) => {
    LOG.error('upload error:', e.message);
    if (!res.headersSent) clientError(res, 'Yükləmə xətası', 400);
  });
});

// ─── Jobs (executed from the shared database) ───

router.post('/jobs', requireWorkerAuth, async (req, res) => {
  const { jobId } = req.body || {};
  if (!jobId) return clientError(res, 'jobId tələb olunur');
  const job = await jobsRepo.read(jobId).catch(() => null);
  if (!job) return clientError(res, 'İş tapılmadı', 404);
  const enqueued = broadcastService.enqueueJob(jobId);
  res.status(enqueued ? 202 : 200).json({ ok: true, enqueued });
});

router.post('/jobs/:id/cancel', requireWorkerAuth, async (req, res) => {
  const okCancelled = await broadcastService.cancelJob(req.params.id);
  if (!okCancelled) return clientError(res, 'İş tapılmadı və ya artıq sonlanıb', 404);
  return ok(res);
});

router.post('/jobs/:id/retry-failed', requireWorkerAuth, async (req, res) => {
  const job = await broadcastService.retryFailed(req.params.id);
  if (!job) return clientError(res, 'Yenidən cəhd ediləcək uğursuz nömrə yoxdur', 404);
  res.status(201).json({ job: broadcastService.jobSnapshot(job) });
});

router.post('/jobs/cancel-all', requireWorkerAuth, async (req, res) => {
  const cancelled = await broadcastService.cancelAllActive();
  return ok(res, { cancelled });
});

module.exports = { router };
