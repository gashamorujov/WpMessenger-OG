/**
 * Repositories — async data access on top of the unified storage layer.
 * Works with SQLite (local) and PostgreSQL (production).
 */
const crypto = require('crypto');
const { storage } = require('./storage');
const config = require('./config');
const { normalizePhone, formatPhone, isValidAzerbaijanMobile, cleanName, validateName } = require('./phone');

// ─── Contacts ───

function rowToContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    normalizedPhone: row.normalizedPhone,
    whatsappStatus: row.waStatus,
    waCheckedAt: row.waCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
    const db = await storage();
    const now = new Date().toISOString();
    const existing = await db.get('SELECT * FROM contacts WHERE normalizedPhone = ?', [normalizedPhone]);
    if (!existing) {
      const row = await db.get(
        'INSERT INTO contacts (name, phone, normalizedPhone, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [name, formatPhone(normalizedPhone), normalizedPhone, now, now]
      );
      return { contact: rowToContact(row), created: true, updated: false, duplicate: false };
    }
    const duplicate = existing.name === name;
    if (!duplicate) {
      await db.run('UPDATE contacts SET name = ?, updatedAt = ? WHERE id = ?', [name, now, existing.id]);
    }
    const row = await db.get('SELECT * FROM contacts WHERE id = ?', [existing.id]);
    return { contact: rowToContact(row), created: false, updated: !duplicate, duplicate };
  },

  async getById(id) {
    const db = await storage();
    return rowToContact(await db.get('SELECT * FROM contacts WHERE id = ?', [id]));
  },

  async getByPhone(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;
    const db = await storage();
    return rowToContact(await db.get('SELECT * FROM contacts WHERE normalizedPhone = ?', [normalizedPhone]));
  },

  async list(opts = {}) {
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(opts.pageSize, 10) || 20));
    const q = String(opts.q || '').trim().toLowerCase();
    const waStatus = opts.waStatus || '';
    const where = [];
    const params = [];
    if (q) {
      where.push('(LOWER(name) LIKE ? OR normalizedPhone LIKE ? OR phone LIKE ?)');
      const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
      params.push(like, like, like);
    }
    if (waStatus && waStatus !== 'all') {
      where.push('waStatus = ?');
      params.push(waStatus);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const db = await storage();
    const totalRow = await db.get(`SELECT COUNT(*) AS n FROM contacts ${whereSql}`, params);
    const rows = await db.all(`SELECT * FROM contacts ${whereSql} ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.map(rowToContact), total: totalRow.n, page, pageSize, pages: Math.max(1, Math.ceil(totalRow.n / pageSize)) };
  },

  async all() {
    const db = await storage();
    return (await db.all('SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC')).map(rowToContact);
  },

  async count() {
    const db = await storage();
    const row = await db.get('SELECT COUNT(*) AS n FROM contacts');
    return row.n;
  },

  async setWaStatus(phone, status) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return;
    const db = await storage();
    await db.run('UPDATE contacts SET waStatus = ?, waCheckedAt = ? WHERE normalizedPhone = ?', [status, new Date().toISOString(), normalizedPhone]);
  },

  async updateName(id, name) {
    const nameCheck = validateName(name);
    if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason };
    const db = await storage();
    const r = await db.run('UPDATE contacts SET name = ?, updatedAt = ? WHERE id = ?', [nameCheck.name, new Date().toISOString(), id]);
    return r.changes > 0 ? { ok: true, contact: await this.getById(id) } : { ok: false, reason: 'Kontakt tapılmadı' };
  },

  async updatePhone(id, phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || !isValidAzerbaijanMobile(normalizedPhone)) return { ok: false, reason: 'Yanlış nömrə formatı' };
    const db = await storage();
    const existing = await db.get('SELECT * FROM contacts WHERE id = ?', [id]);
    if (!existing) return { ok: false, reason: 'Kontakt tapılmadı' };
    const conflict = await db.get('SELECT * FROM contacts WHERE normalizedPhone = ? AND id != ?', [normalizedPhone, id]);
    if (conflict) return { ok: false, reason: `Bu nömrə artıq "${conflict.name}" kontaktında mövcuddur` };
    await db.run('UPDATE contacts SET phone = ?, normalizedPhone = ?, updatedAt = ? WHERE id = ?', [formatPhone(normalizedPhone), normalizedPhone, new Date().toISOString(), id]);
    return { ok: true, contact: await this.getById(id) };
  },

  async remove(id) {
    const db = await storage();
    const r = await db.run('DELETE FROM contacts WHERE id = ?', [id]);
    return r.changes > 0;
  },

  async removeByPhone(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return false;
    const db = await storage();
    const r = await db.run('DELETE FROM contacts WHERE normalizedPhone = ?', [normalizedPhone]);
    return r.changes > 0;
  },
};

// ─── Jobs ───

function jobId() {
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
    const db = await storage();
    await db.run(
      `INSERT INTO jobs (id, state, type, payloadSpec, targets, successCount, failCount, skipCount, createdAt, updatedAt, startedAt, finishedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [job.id, job.state, job.type, JSON.stringify(job.payloadSpec), JSON.stringify(job.targets), 0, 0, 0, now, now, now, null]
    );
    return job;
  },

  async read(id) {
    const db = await storage();
    return rowToJob(await db.get('SELECT * FROM jobs WHERE id = ?', [id]));
  },

  async write(job) {
    const db = await storage();
    await db.run(
      `UPDATE jobs SET state = ?, type = ?, payloadSpec = ?, targets = ?, successCount = ?, failCount = ?, skipCount = ?,
       updatedAt = ?, startedAt = ?, finishedAt = ? WHERE id = ?`,
      [job.state, job.type, JSON.stringify(job.payloadSpec || {}), JSON.stringify(job.targets || []), job.successCount, job.failCount, job.skipCount,
       new Date().toISOString(), job.startedAt, job.finishedAt, job.id]
    );
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
    const where = [];
    const params = [];
    if (state && state !== 'all') { where.push('state = ?'); params.push(state); }
    if (q) { where.push('(id LIKE ? OR type LIKE ? OR payloadSpec LIKE ?)'); const like = `%${q}%`; params.push(like, like, like); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const db = await storage();
    const totalRow = await db.get(`SELECT COUNT(*) AS n FROM jobs ${whereSql}`, params);
    const rows = await db.all(`SELECT * FROM jobs ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.map(rowToJob), total: totalRow.n, page, pageSize, pages: Math.max(1, Math.ceil(totalRow.n / pageSize)) };
  },

  async all() {
    const db = await storage();
    return (await db.all('SELECT * FROM jobs ORDER BY createdAt DESC')).map(rowToJob);
  },

  async listActive() {
    const db = await storage();
    return (await db.all("SELECT * FROM jobs WHERE state IN ('running','interrupted') ORDER BY createdAt DESC")).map(rowToJob);
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
    const db = await storage();
    await db.run('DELETE FROM jobs WHERE id = ?', [id]);
  },

  async _reset() {
    const db = await storage();
    await db.run('DELETE FROM jobs');
    await db.run('DELETE FROM contacts');
    await db.run('DELETE FROM sessions');
    await db.run('DELETE FROM settings');
  },
};

// ─── Sessions (auth tokens) ───

const sessionsRepo = {
  async create(userAgent, ip) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    const db = await storage();
    await db.run('INSERT INTO sessions (token, createdAt, lastSeenAt, userAgent, ip) VALUES (?, ?, ?, ?, ?)', [token, now, now, String(userAgent || '').slice(0, 300), String(ip || '').slice(0, 64)]);
    return token;
  },
  async touch(token) {
    const db = await storage();
    const row = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!row) return null;
    if (Date.now() - new Date(row.lastSeenAt).getTime() > config.sessionTtlMs) {
      await this.destroy(token);
      return null;
    }
    await db.run('UPDATE sessions SET lastSeenAt = ? WHERE token = ?', [new Date().toISOString(), token]);
    return row;
  },
  async isValid(token) {
    return !!(await this.touch(token));
  },
  async destroy(token) {
    const db = await storage();
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
  },
  async destroyAll() {
    const db = await storage();
    await db.run('DELETE FROM sessions');
  },
};

// ─── Users ───

const usersRepo = {
  async ensureAdmin() {
    const db = await storage();
    const row = await db.get('SELECT COUNT(*) AS n FROM users');
    if (row.n > 0) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(config.adminPassword), salt, 64).toString('hex');
    await db.run('INSERT INTO users (username, passwordHash, createdAt) VALUES (?, ?, ?)', [config.adminUsername, `${salt}:${hash}`, new Date().toISOString()]);
    return { created: true, username: config.adminUsername };
  },

  async getAdmin() {
    const db = await storage();
    return db.get('SELECT * FROM users ORDER BY id LIMIT 1');
  },

  async verify(username, password) {
    const db = await storage();
    const row = await db.get('SELECT * FROM users WHERE username = ?', [String(username || '').trim()]);
    if (!row) return false;
    return this._checkHash(row.passwordHash, password);
  },

  async changeCredentials(currentPassword, newUsername, newPassword) {
    const db = await storage();
    const row = await db.get('SELECT * FROM users ORDER BY id LIMIT 1');
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
    await db.run('UPDATE users SET username = ?, passwordHash = ? WHERE id = ?', [name, `${salt}:${hash}`, row.id]);
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
    const db = await storage();
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch { return row.value; }
  },
  async set(key, value) {
    const db = await storage();
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
  },
  async getAll() {
    const db = await storage();
    const rows = await db.all('SELECT key, value FROM settings');
    const out = {};
    for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
    return out;
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
