/**
 * REST API — WpMessenger OG.
 *
 * Frontend never talks to WhatsApp directly; everything goes through these
 * endpoints (+ the /ws realtime channel).
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const settings = require('../settings');
const auth = require('./auth');
const sessions = require('../db/sessions');
const contactsDb = require('../db/contacts');
const jobStore = require('../db/jobs');
const appSettings = require('../db/appSettings');
const wa = require('./whatsappManager');
const broadcastService = require('./broadcastService');
const waPresence = require('../lib/waPresence');
const RateLimiter = require('../lib/rateLimit');
const { normalizePhone, isValidAzerbaijanMobile, formatPhone, extractNumbers, validateName, cleanName } = require('../lib/phone');
const { makeLogger } = require('../lib/logger');

const LOG = makeLogger('API');

const router = express.Router();
const limiter = new RateLimiter({ windowMs: settings.rateLimitWindowMs, max: settings.rateLimitMax });

// ─── Media uploads ───
const TEMP_DIR = path.join(settings.dataDir, 'temp');
fs.ensureDirSync(TEMP_DIR);

const upload = multer({
  storage: multer.diskStorage({
    destination: TEMP_DIR,
    filename: (req, file, cb) => {
      const safe = String(file.originalname || 'file').replace(/[^\w.\-]+/g, '_').slice(-120);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
});

function unlinkQuiet(p) {
  try { if (p) fs.unlinkSync(p); } catch {}
}

function clientError(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

// ─── Auth ───

router.post('/auth/login', limiter.middleware({ max: 10 }), (req, res) => {
  const { username, password } = req.body || {};
  const token = auth.login(username, password, req.headers['user-agent'], req.ip);
  if (!token) return clientError(res, 'İstifadəçi adı və ya şifrə yanlışdır', 401);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(settings.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: sessions.SESSION_TTL_MS,
    path: '/',
  });
  return res.json({ token, username: String(username).trim(), version: settings.version });
});

router.post('/auth/logout', auth.requireAuth, (req, res) => {
  sessions.destroy(req.sessionToken);
  res.clearCookie(settings.cookieName, { path: '/' });
  res.json({ ok: true });
});

router.get('/auth/me', auth.requireAuth, (req, res) => {
  res.json({ loggedIn: true, username: settings.adminUsername, version: settings.version });
});

// ─── Dashboard overview ───

router.get('/overview', auth.requireAuth, (req, res) => {
  const sessionsList = wa.getSessions();
  const connected = sessionsList.filter((s) => s.status === 'connected').length;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayJobs = jobStore.all().filter((j) => new Date(j.createdAt).getTime() >= startOfDay.getTime());
  const today = {
    jobs: todayJobs.length,
    recipients: todayJobs.reduce((n, j) => n + j.targets.length, 0),
    success: todayJobs.reduce((n, j) => n + j.successCount, 0),
    fail: todayJobs.reduce((n, j) => n + j.failCount, 0),
    skip: todayJobs.reduce((n, j) => n + j.skipCount, 0),
  };

  const activeJobs = jobStore.listActive().map((j) => broadcastService.jobSnapshot(j));
  res.json({
    whatsapp: {
      status: connected > 0 ? 'connected' : sessionsList.length ? sessionsList[0].status : 'disconnected',
      connected,
      sessions: sessionsList,
    },
    contactsCount: contactsDb.count(),
    today,
    activeJobs,
    activeCount: activeJobs.length,
    historyCount: jobStore.all().filter((j) => j.state === 'completed' || j.state === 'cancelled').length,
    version: settings.version,
  });
});

// ─── Contacts ───

router.get('/contacts', auth.requireAuth, (req, res) => {
  res.json(contactsDb.list({
    q: req.query.q || '',
    waStatus: req.query.waStatus || 'all',
    page: req.query.page,
    pageSize: req.query.pageSize,
  }));
});

async function mirrorContactToWhatsApp(contact) {
  const sender = wa.getSenderSocket();
  if (!sender || !sender.sock) return;
  try {
    await waPresence.addContactToWhatsApp(sender.sock, { name: contact.name, phone: contact.normalizedPhone });
    LOG.info(`Contact mirrored to WhatsApp: ${contact.name}`);
  } catch (e) {
    LOG.warn('Mirror contact to WhatsApp failed:', e.message);
  }
  try {
    const map = await waPresence.checkRegistered(sender.sock, [contact.normalizedPhone]);
    const exists = map.get(contact.normalizedPhone);
    if (exists === true || exists === false) {
      contactsDb.setWaStatus(contact.normalizedPhone, exists ? 'yes' : 'no');
    }
  } catch (e) {
    LOG.warn('WhatsApp registration check failed:', e.message);
  }
}

router.post('/contacts', auth.requireAuth, async (req, res) => {
  const { name, phone } = req.body || {};
  const result = contactsDb.upsert({ name, phone });
  if (!result.contact) return clientError(res, result.reason || 'Kontakt yaradıla bilmədi');
  if (result.created) {
    mirrorContactToWhatsApp(result.contact).catch((e) => LOG.warn('contact mirror:', e.message));
  }
  res.status(result.created ? 201 : 200).json(result);
});

router.post('/contacts/import', auth.requireAuth, (req, res) => {
  const list = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  if (list.length === 0) return clientError(res, 'Kontakt siyahısı boşdur');
  if (list.length > 5000) return clientError(res, 'Maksimum 5000 kontakt import edilə bilər');
  const summary = { created: 0, updated: 0, duplicates: 0, invalid: 0, errors: [] };
  for (const item of list) {
    const r = contactsDb.upsert({ name: item.name, phone: item.phone });
    if (!r.contact) {
      summary.invalid++;
      summary.errors.push({ name: item.name, phone: item.phone, reason: r.reason || 'Yanlış məlumat' });
    } else if (r.created) summary.created++;
    else if (r.duplicate) summary.duplicates++;
    else summary.updated++;
  }
  if (summary.created > 0) {
    const sender = wa.getSenderSocket();
    const contacts = contactsDb.all();
    const fresh = contacts.slice(-summary.created);
    (async () => {
      if (sender) {
        for (const c of fresh) {
          try { await waPresence.addContactToWhatsApp(sender.sock, { name: c.name, phone: c.normalizedPhone }); } catch {}
        }
      }
    })().catch(() => {});
  }
  res.json(summary);
});

router.get('/contacts/all', auth.requireAuth, (req, res) => {
  res.json({
    items: contactsDb.all().map((c) => ({ id: c.id, name: c.name, normalizedPhone: c.normalizedPhone, whatsappStatus: c.whatsappStatus })),
  });
});

router.get('/contacts/:id', auth.requireAuth, (req, res) => {
  const contact = contactsDb.getById(req.params.id);
  if (!contact) return clientError(res, 'Kontakt tapılmadı', 404);
  res.json(contact);
});

router.put('/contacts/:id', auth.requireAuth, (req, res) => {
  const id = req.params.id;
  const { name, phone } = req.body || {};
  let contact = contactsDb.getById(id);
  if (!contact) return clientError(res, 'Kontakt tapılmadı', 404);

  if (name !== undefined) {
    const r = contactsDb.updateName(id, name);
    if (!r.ok) return clientError(res, r.reason);
    contact = r.contact;
  }
  if (phone !== undefined) {
    const r = contactsDb.updatePhone(id, phone);
    if (!r.ok) return clientError(res, r.reason);
    contact = r.contact;
    mirrorContactToWhatsApp(contact).catch(() => {});
  }
  res.json({ ok: true, contact });
});

router.delete('/contacts/:id', auth.requireAuth, (req, res) => {
  if (!contactsDb.remove(req.params.id)) return clientError(res, 'Kontakt tapılmadı', 404);
  res.json({ ok: true });
});

// ─── WhatsApp sessions ───

router.get('/wa/status', auth.requireAuth, (req, res) => {
  res.json({ sessions: wa.getSessions() });
});

router.post('/wa/connect', auth.requireAuth, async (req, res) => {
  const { phone, method } = req.body || {};
  const isQr = method === 'qr';
  if (isQr && !phone) {
    // QR linking does not need a number — a fixed 'main' session is used.
    const result = await wa.connectWithPhone('main', 'qr');
    if (!result.ok && result.error) return clientError(res, result.error);
    return res.json({ ok: true, phone: 'main', sessionKey: 'main' });
  }
  const normalized = normalizePhone(phone);
  if (!normalized || !isValidAzerbaijanMobile(normalized)) {
    return clientError(res, 'Yanlış nömrə formatı. Nümunə: 0503482680 və ya +994503482680');
  }
  const result = await wa.connectWithPhone(normalized, isQr ? 'qr' : 'pair');
  if (!result.ok && result.error) return clientError(res, result.error);
  res.json({ ok: true, phone: normalized });
});

router.get('/wa/qr/:phone', auth.requireAuth, (req, res) => {
  const qr = wa.getPendingQr(req.params.phone);
  if (!qr) return res.json({ qr: null });
  res.json(qr);
});

router.get('/wa/pair/:phone', auth.requireAuth, (req, res) => {
  const pair = wa.getPendingPair(req.params.phone);
  if (!pair) return res.json({ code: null });
  res.json(pair);
});

router.post('/wa/disconnect', auth.requireAuth, async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return clientError(res, 'Nömrə tələb olunur');
  await wa.disconnectSession(phone);
  res.json({ ok: true });
});

// ─── Recipient + payload helpers ───

function resolveRecipients(body) {
  const mode = body.recipientsMode || 'single';
  const bc = broadcastService.getBroadcastSettings();
  const out = [];
  const errors = [];
  const pushPhone = (raw, name) => {
    const normalized = normalizePhone(raw);
    if (!normalized || !isValidAzerbaijanMobile(normalized)) {
      errors.push(`${name ? name + ': ' : ''}${raw} — yanlış nömrə`);
      return;
    }
    if (!out.some((t) => t.phone === normalized)) out.push({ phone: normalized, name: cleanName(name) || null });
  };

  if (mode === 'single') {
    if (body.phone) pushPhone(body.phone, '');
  } else if (mode === 'list') {
    const { numbers, invalid } = extractNumbers(body.numbers || '');
    for (const n of numbers) pushPhone(n, '');
    for (const n of invalid) errors.push(`${n} — yanlış nömrə`);
  } else if (mode === 'contacts') {
    let ids = [];
    try {
      ids = typeof body.contactIds === 'string' ? JSON.parse(body.contactIds || '[]') : (Array.isArray(body.contactIds) ? body.contactIds : []);
    } catch {
      ids = [];
    }
    for (const id of ids) {
      const c = contactsDb.getById(id);
      if (c) pushPhone(c.normalizedPhone, c.name);
      else errors.push(`Kontakt #${id} tapılmadı`);
    }
  } else if (mode === 'all') {
    for (const c of contactsDb.all()) pushPhone(c.normalizedPhone, c.name);
  }

  if (out.length > bc.maxRecipients) {
    errors.push(`Maksimum ${bc.maxRecipients} alıcı göndərilə bilər`);
    out.length = bc.maxRecipients;
  }
  return { phones: out, errors };
}

function buildPayload(body, file) {
  if (file) {
    let type = body.messageType || '';
    if (!type) {
      const mt = (file.mimetype || '').toLowerCase();
      if (mt.startsWith('image/')) type = 'image';
      else if (mt.startsWith('video/')) type = 'video';
      else if (mt.startsWith('audio/')) type = mt.includes('opus') || mt.includes('ogg') ? 'voice' : 'audio';
      else type = 'document';
    }
    const spec = {
      type,
      file: file.path,
      mimetype: file.mimetype || 'application/octet-stream',
      fileName: body.fileName || file.originalname || 'file',
    };
    if (body.caption) spec.caption = String(body.caption).slice(0, 2000);
    if (type === 'text') { unlinkQuiet(file.path); return { type: 'text', spec: { type: 'text', text: body.text || '' } }; }
    return { type, spec };
  }
  const text = String(body.text || '').trim();
  return { type: 'text', spec: { type: 'text', text } };
}

// ─── Messages ───

router.post('/messages/send', auth.requireAuth, upload.single('file'), (req, res) => {
  const file = req.file;
  try {
    const { phones, errors } = resolveRecipients(req.body || {});
    if (errors.length > 0) {
      unlinkQuiet(file?.path);
      return clientError(res, errors.join('\n'));
    }
    if (phones.length === 0) {
      unlinkQuiet(file?.path);
      return clientError(res, 'Ən azı bir alıcı seçin və ya nömrə daxil edin');
    }

    const { type, spec } = buildPayload(req.body || {}, file);
    if (type === 'text' && !spec.text) {
      unlinkQuiet(file?.path);
      return clientError(res, 'Mesaj mətni boş ola bilməz');
    }
    const bc = broadcastService.getBroadcastSettings();
    if (spec.text && spec.text.length > bc.maxMessageLength) {
      unlinkQuiet(file?.path);
      return clientError(res, `Mesaj çox uzundur (maksimum ${bc.maxMessageLength} simvol)`);
    }

    const job = broadcastService.createJob({
      type,
      payloadSpec: spec,
      targets: phones,
      tempFile: file?.path || null,
    });
    return res.status(201).json({ job: broadcastService.jobSnapshot(job) });
  } catch (e) {
    unlinkQuiet(file?.path);
    LOG.error('send error:', e.message);
    return clientError(res, 'Mesaj göndərilə bilmədi: ' + e.message, 500);
  }
});

// ─── Jobs / Active processes ───

router.get('/jobs', auth.requireAuth, (req, res) => {
  if (req.query.state === 'active') {
    const items = jobStore.listActive().map((j) => broadcastService.jobSnapshot(j));
    return res.json({ items, total: items.length, page: 1, pageSize: items.length, pages: 1 });
  }
  res.json(jobStore.list({
    state: req.query.state || 'all',
    q: req.query.q || '',
    page: req.query.page,
    pageSize: req.query.pageSize,
  }));
});

router.get('/jobs/:id', auth.requireAuth, (req, res) => {
  const job = jobStore.read(req.params.id);
  if (!job) return clientError(res, 'İş tapılmadı', 404);
  res.json(broadcastService.jobSnapshot(job));
});

router.post('/jobs/:id/cancel', auth.requireAuth, (req, res) => {
  const ok = broadcastService.cancelJob(req.params.id);
  if (!ok) return clientError(res, 'İş tapılmadı və ya artıq sonlanıb', 404);
  res.json({ ok: true });
});

router.post('/jobs/:id/retry-failed', auth.requireAuth, (req, res) => {
  const job = broadcastService.retryFailed(req.params.id);
  if (!job) return clientError(res, 'Yenidən cəhd ediləcək uğursuz nömrə yoxdur', 404);
  res.status(201).json({ job: broadcastService.jobSnapshot(job) });
});

router.post('/jobs/cancel-all', auth.requireAuth, (req, res) => {
  const cancelled = broadcastService.cancelAllActive();
  res.json({ ok: true, cancelled });
});

// ─── History ───

router.get('/history', auth.requireAuth, (req, res) => {
  const state = req.query.state && req.query.state !== 'all' ? req.query.state : '';
  const result = jobStore.list({
    state: state === 'active' ? '' : state,
    q: req.query.q || '',
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  const items = result.items.filter((j) => ['completed', 'cancelled', 'interrupted'].includes(j.state));
  res.json({ ...result, items, total: items.length, pages: Math.max(1, Math.ceil(items.length / result.pageSize)) });
});

// ─── Settings ───

router.get('/settings', auth.requireAuth, (req, res) => {
  res.json({
    version: settings.version,
    effective: broadcastService.getBroadcastSettings(),
    overrides: appSettings.getAll(),
    env: {
      port: settings.port,
      apiUrl: settings.apiUrl,
      wsUrl: settings.wsUrl,
      frontendUrl: settings.frontendUrl,
      dataDir: settings.dataDir,
      sessionDir: settings.sessionDir,
      dbFile: settings.dbFile,
      waPresenceCheck: settings.waPresenceCheck,
      waSkipUnregistered: settings.waSkipUnregistered,
    },
  });
});

router.put('/settings', auth.requireAuth, (req, res) => {
  const overrides = req.body?.overrides || {};
  const validators = {
    broadcastDelayMinMs: (v) => Number.isInteger(v) && v >= 0 && v <= 600000,
    broadcastDelayMaxMs: (v) => Number.isInteger(v) && v >= 0 && v <= 600000,
    broadcastMaxRetries: (v) => Number.isInteger(v) && v >= 0 && v <= 20,
    duplicateSendTtlMin: (v) => Number.isInteger(v) && v >= 0 && v <= 1440,
    maxRecipients: (v) => Number.isInteger(v) && v >= 1 && v <= 100000,
    maxMessageLength: (v) => Number.isInteger(v) && v >= 1 && v <= 1000000,
    waPresenceCheck: (v) => typeof v === 'boolean',
    waSkipUnregistered: (v) => typeof v === 'boolean',
  };
  const invalid = [];
  for (const [key, value] of Object.entries(overrides)) {
    const validate = validators[key];
    if (!validate) { invalid.push(key); continue; }
    if (!validate(value)) { invalid.push(key); continue; }
    appSettings.set(key, value);
  }
  if (invalid.length) {
    return clientError(res, `Yanlış parametrlər: ${invalid.join(', ')}`);
  }
  res.json({
    ok: true,
    effective: broadcastService.getBroadcastSettings(),
    overrides: appSettings.getAll(),
  });
});

// ─── Health ───

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    version: settings.version,
    whatsappConnected: wa.getSessions().filter((s) => s.status === 'connected').length,
    db: true,
  });
});

module.exports = { router, limiter };
