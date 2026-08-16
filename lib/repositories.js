/**
 * Repositories — async data access on Firebase Realtime Database.
 *
 * All data lives under /wpm/* in RTDB: contacts, jobs, sessions, users,
 * settings. No SQL, no local files, no ./data, no PostgreSQL — works on
 * serverless and every deploy target with network access.
 */
const crypto = require('crypto');
const fb = require('./firebase');
const config = require('./config');
const { normalizePhone, formatPhone, isValidAzerbaijanMobile, cleanName, validateName } = require('./phone');

const P = {
  contacts: 'wpm/contacts',
  jobs: 'wpm/jobs',
  sessions: 'wpm/sessions',
  users: 'wpm/users',
  settings: 'wpm/settings',
};

// ─── Contacts ───

function rowToContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    normalizedPhone: row.normalizedPhone,
    whatsappStatus: row.waStatus || 'unknown',
    waCheckedAt: row.waCheckedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function allContacts() {
  const map = (await fb.get(P.contacts)) || {};
  return Object.values(map).map((c) => ({ ...c, id: String(c.id) }));
}

const contactsRepo = {
  async upsert(input) {
    const name = cleanName(input.name);
    const nameCheck = validateName(name);
    if (!nameCheck.ok) return { contact: null, created: false, updated: false, duplicate: false, reason: nameCheck.reason };
    const normalizedPhone = normalizePhone(input.phone);
    if (!normalizedPhone || !isValidAzerbaijanMobile(normalizedPhone)) {
      return { contact: null, created: false, updated: false, duplicate: false, reason: 'Yanlış telefon nömrəsi' };
    }
    const now = new Date().toISOString();
    const existing = (await allContacts()).find((c) => c.normalizedPhone === normalizedPhone);
    if (!existing) {
      const doc = { id: null, name, phone: formatPhone(normalizedPhone), normalizedPhone, waStatus: 'unknown', waCheckedAt: null, createdAt: now, updatedAt: now };
      const id = await fb.push(P.contacts, { ...doc, id: '' });
      doc.id = id;
      await fb.update(`${P.contacts}/${id}`, { id });
      return { contact: rowToContact(doc), created: true, updated: false, duplicate: false };
    }
    const duplicate = existing.name === name;
    if (!duplicate) {
      await fb.update(`${P.contacts}/${existing.id}`, { name, updatedAt: now });
      existing.name = name;
      existing.updatedAt = now;
    }
    return { contact: rowToContact(existing), created: false, updated: !duplicate, duplicate };
  },

  async getById(id) {
    const row = await fb.get(`${P.contacts}/${id}`);
    if (!row) return null;
    return rowToContact({ ...row, id: String(row.id) });
  },

  async getByPhone(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;
    const row = (await allContacts()).find((c) => c.normalizedPhone === normalizedPhone);
    return row ? rowToContact(row) : null;
  },

  async list(opts = {}) {
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(opts.pageSize, 10) || 20));
    const q = String(opts.q || '').trim().toLowerCase();
    const waStatus = opts.waStatus || '';
    let items = await allContacts();
    if (q) {
      items = items.filter((c) => c.name.toLowerCase().includes(q) || c.normalizedPhone.includes(q) || c.phone.includes(q));
    }
    if (waStatus && waStatus !== 'all') items = items.filter((c) => c.waStatus === waStatus);
    items.sort((a, b) => a.name.localeCompare(b.name, 'az') || String(a.id).localeCompare(String(b.id)));
    const total = items.length;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);
    return { items: paged.map(rowToContact), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  },

  async all() {
    const items = await allContacts();
    items.sort((a, b) => a.name.localeCompare(b.name, 'az'));
    return items.map(rowToContact);
  },

  async count() {
    return (await allContacts()).length;
  },

  async setWaStatus(phone, status) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return;
    const row = (await allContacts()).find((c) => c.normalizedPhone === normalizedPhone);
    if (!row) return;
    await fb.update(`${P.contacts}/${row.id}`, { waStatus: status, waCheckedAt: new Date().toISOString() });
  },

  async updateName(id, name) {
    const nameCheck = validateName(name);
    if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason };
    const row = await this.getById(id);
    if (!row) return { ok: false, reason: 'Kontakt tapılmadı' };
    await fb.update(`${P.contacts}/${id}`, { name: nameCheck.name, updatedAt: new Date().toISOString() });
    return { ok: true, contact: await this.getById(id) };
  },

  async updatePhone(id, phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || !isValidAzerbaijanMobile(normalizedPhone)) return { ok: false, reason: 'Yanlış nömrə formatı' };
    const row = await this.getById(id);
    if (!row) return { ok: false, reason: 'Kontakt tapılmadı' };
    const conflict = (await allContacts()).find((c) => c.normalizedPhone === normalizedPhone && String(c.id) !== String(id));
    if (conflict) return { ok: false, reason: `Bu nömrə artıq "${conflict.name}" kontaktında mövcuddur` };
    await fb.update(`${P.contacts}/${id}`, { phone: formatPhone(normalizedPhone), normalizedPhone, updatedAt: new Date().toISOString() });
    return { ok: true, contact: await this.getById(id) };
  },

  async remove(id) {
    const row = await fb.get(`${P.contacts}/${id}`);
    if (!row) return false;
    await fb.remove(`${P.contacts}/${id}`);
    return true;
  },

  async removeByPhone(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return false;
    const row = (await allContacts()).find((c) => c.normalizedPhone === normalizedPhone);
    if (!row) return false;
    await fb.remove(`${P.contacts}/${row.id}`);
    return true;
  },
};

// ─── Jobs ───

function jobId() {
  return crypto.randomBytes(4).toString('hex') + Date.now().toString(36);
}

function rowToJob(row) {
  if (!row) return null;
  let payloadSpec = row.payloadSpec;
  let targets = row.targets;
  if (typeof payloadSpec === 'string') { try { payloadSpec = JSON.parse(payloadSpec); } catch { payloadSpec = {}; } }
  if (typeof targets === 'string') { try { targets = JSON.parse(targets); } catch { targets = []; } }
  return {
    id: row.id,
    state: row.state,
    type: row.type,
    payloadSpec: payloadSpec || {},
    targets: Array.isArray(targets) ? targets : [],
    successCount: row.successCount || 0,
    failCount: row.failCount || 0,
    skipCount: row.skipCount || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

const jobStates = { RUNNING: 'running', INTERRUPTED: 'interrupted', COMPLETED: 'completed', CANCELLED: 'cancelled' };

const jobsRepo = {
  states: jobStates,

  async create(input) {
    const now = new Date().toISOString();
    const id = jobId();
    const job = {
      id,
      state: jobStates.RUNNING,
      type: input.type || 'text',
      payloadSpec: input.payloadSpec || {},
      targets: (input.targets || []).map((t) => ({ phone: t.phone, name: t.name || null, status: 'pending', error: null, attempts: 0 })),
      successCount: 0,
      failCount: 0,
      skipCount: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: null,
    };
    await fb.set(`${P.jobs}/${id}`, job);
    return job;
  },

  async read(id) {
    return rowToJob(await fb.get(`${P.jobs}/${id}`));
  },

  async write(job) {
    const patch = {
      state: job.state,
      type: job.type,
      payloadSpec: job.payloadSpec || {},
      targets: job.targets || [],
      successCount: job.successCount,
      failCount: job.failCount,
      skipCount: job.skipCount,
      updatedAt: new Date().toISOString(),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
    await fb.update(`${P.jobs}/${job.id}`, patch);
    return job;
  },

  async updateTarget(job, phone, patch) {
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
    await this.write(job);
  },

  async markCompleted(job, report = {}) {
    job.state = jobStates.COMPLETED;
    job.finishedAt = new Date().toISOString();
    if (typeof report.success === 'number') job.successCount = report.success;
    if (typeof report.fail === 'number') job.failCount = report.fail;
    if (typeof report.skip === 'number') job.skipCount = report.skip;
    await this.write(job);
  },

  async markInterrupted(job) {
    job.state = jobStates.INTERRUPTED;
    await this.write(job);
  },

  async markCancelled(job) {
    job.state = jobStates.CANCELLED;
    job.finishedAt = new Date().toISOString();
    await this.write(job);
  },

  async list(opts = {}) {
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(opts.pageSize, 10) || 20));
    const state = opts.state || '';
    const q = String(opts.q || '').trim().toLowerCase();
    let items = await this.all();
    if (state && state !== 'all') items = items.filter((j) => j.state === state);
    if (q) items = items.filter((j) => j.id.includes(q) || j.type.includes(q) || JSON.stringify(j.payloadSpec).toLowerCase().includes(q));
    const total = items.length;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);
    return { items: paged, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  },

  async all() {
    const map = (await fb.get(P.jobs)) || {};
    return Object.values(map).map(rowToJob).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  async listActive() {
    const items = await this.all();
    return items.filter((j) => j.state === jobStates.RUNNING || j.state === jobStates.INTERRUPTED);
  },

  async recoverInterrupted() {
    const recovered = [];
    for (const job of await this.listActive()) {
      if (job.state === jobStates.RUNNING) {
        await this.markInterrupted(job);
        recovered.push(job);
      }
    }
    return recovered;
  },

  async deleteJob(id) {
    await fb.remove(`${P.jobs}/${id}`);
  },

  async _reset() {
    await fb.remove(P.jobs);
    await fb.remove(P.contacts);
    await fb.remove(P.sessions);
    await fb.remove(P.settings);
  },
};

// ─── Sessions (auth tokens) ───

const sessionsRepo = {
  async create(userAgent, ip) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    await fb.set(`${P.sessions}/${token}`, {
      token,
      createdAt: now,
      lastSeenAt: now,
      userAgent: String(userAgent || '').slice(0, 300),
      ip: String(ip || '').slice(0, 64),
    });
    return token;
  },
  async touch(token) {
    const row = await fb.get(`${P.sessions}/${token}`);
    if (!row) return null;
    if (Date.now() - new Date(row.lastSeenAt).getTime() > config.sessionTtlMs) {
      await this.destroy(token);
      return null;
    }
    await fb.update(`${P.sessions}/${token}`, { lastSeenAt: new Date().toISOString() });
    return row;
  },
  async isValid(token) {
    return !!(await this.touch(token));
  },
  async destroy(token) {
    await fb.remove(`${P.sessions}/${token}`);
  },
  async destroyAll() {
    await fb.remove(P.sessions);
  },
};

// ─── Users ───

const ADMIN_KEY = 'admin';

const usersRepo = {
  async ensureAdmin() {
    const admin = await fb.get(`${P.users}/${ADMIN_KEY}`);
    if (admin && admin.username) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(config.adminPassword), salt, 64).toString('hex');
    await fb.set(`${P.users}/${ADMIN_KEY}`, {
      username: config.adminUsername,
      passwordHash: `${salt}:${hash}`,
      createdAt: new Date().toISOString(),
    });
    return { created: true, username: config.adminUsername };
  },

  async getAdmin() {
    const row = await fb.get(`${P.users}/${ADMIN_KEY}`);
    return row || null;
  },

  async verify(username, password) {
    const row = await this.getAdmin();
    if (!row || String(row.username).trim() !== String(username || '').trim()) return false;
    return this._checkHash(row.passwordHash, password);
  },

  async changeCredentials(currentPassword, newUsername, newPassword) {
    const row = await this.getAdmin();
    if (!row) return { ok: false, error: 'İstifadəçi tapılmadı' };
    if (!this._checkHash(row.passwordHash, currentPassword)) {
      return { ok: false, error: 'Cari şifrə yanlışdır' };
    }
    const name = String(newUsername || '').trim();
    if (name.length < 3 || name.length > 50 || /\s/.test(name)) {
      return { ok: false, error: 'İstifadəçi adı 3–50 simvol olmalı və boşluq ehtiva etməməlidir' };
    }
    const pass = String(newPassword || '');
    if (pass.length < 6) return { ok: false, error: 'Yeni şifrə ən azı 6 simvol olmalıdır' };
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pass, salt, 64).toString('hex');
    await fb.set(`${P.users}/${ADMIN_KEY}`, { ...row, username: name, passwordHash: `${salt}:${hash}` });
    await sessionsRepo.destroyAll();
    return { ok: true, username: name };
  },

  _checkHash(storedHash, password) {
    const [salt, hash] = String(storedHash || '').split(':');
    if (!salt || !hash) return false;
    const candidate = Buffer.from(crypto.scryptSync(String(password), salt, 64).toString('hex'), 'hex');
    const stored = Buffer.from(hash, 'hex');
    if (candidate.length !== stored.length) return false;
    return crypto.timingSafeEqual(candidate, stored);
  },
};

// ─── Settings ───

const SETTING_KEYS = [
  'broadcastDelayMinMs', 'broadcastDelayMaxMs', 'broadcastMaxRetries',
  'duplicateSendTtlMin', 'waPresenceCheck', 'waSkipUnregistered',
  'maxRecipients', 'maxMessageLength',
];

const settingsRepo = {
  async get(key) {
    return fb.get(`${P.settings}/${key}`);
  },
  async set(key, value) {
    await fb.set(`${P.settings}/${key}`, value);
  },
  async getAll() {
    return (await fb.get(P.settings)) || {};
  },
  async effective() {
    const ov = await this.getAll();
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
  },
};

module.exports = { contactsRepo, jobsRepo, sessionsRepo, usersRepo, settingsRepo, SETTING_KEYS, rowToJob };
