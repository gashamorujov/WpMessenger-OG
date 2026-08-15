/**
 * Contacts — persistent SQLite store (replaces the old data/contacts.json).
 *
 * Every contact is normalized (994XXXXXXXXX) and stored once: the same
 * number entered in any format (0503482680 / 9940503482680 / +994503482680)
 * resolves to the same row, so duplicates are impossible.
 */
const { getDb } = require('./index');
const { normalizePhone, formatPhone, isValidAzerbaijanMobile, cleanName, validateName } = require('../lib/phone');
const { makeLogger } = require('../lib/logger');

const LOG = makeLogger('CONTACTS');

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

/**
 * Create or update a contact by normalized phone (upsert).
 * @returns {{contact: object|null, created: boolean, updated: boolean, duplicate: boolean, reason?: string}}
 */
function upsert(input) {
  const name = cleanName(input.name);
  const nameCheck = validateName(name);
  if (!nameCheck.ok) return { contact: null, created: false, updated: false, duplicate: false, reason: nameCheck.reason };

  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone || !isValidAzerbaijanMobile(normalizedPhone)) {
    return { contact: null, created: false, updated: false, duplicate: false, reason: 'Yanlış telefon nömrəsi' };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM contacts WHERE normalizedPhone = ?').get(normalizedPhone);

  if (!existing) {
    const info = db
      .prepare('INSERT INTO contacts (name, phone, normalizedPhone, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(name, formatPhone(normalizedPhone), normalizedPhone, now, now);
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
    return { contact: rowToContact(row), created: true, updated: false, duplicate: false };
  }

  const duplicate = existing.name === name;
  if (!duplicate) {
    db.prepare('UPDATE contacts SET name = ?, updatedAt = ? WHERE id = ?').run(name, now, existing.id);
  }
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(existing.id);
  return { contact: rowToContact(row), created: false, updated: !duplicate, duplicate };
}

function getById(id) {
  const row = getDb().prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  return rowToContact(row);
}

function getByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const row = getDb().prepare('SELECT * FROM contacts WHERE normalizedPhone = ?').get(normalizedPhone);
  return rowToContact(row);
}

/**
 * @param {{q?: string, waStatus?: string, page?: number, pageSize?: number, sort?: string}} opts
 * @returns {{items: object[], total: number, page: number, pageSize: number, pages: number}}
 */
function list(opts = {}) {
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

  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM contacts ${whereSql}`).get(...params).n;
  const rows = db
    .prepare(`SELECT * FROM contacts ${whereSql} ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map(rowToContact),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function all() {
  return getDb().prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC').all().map(rowToContact);
}

function count() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
}

/** Cache the WhatsApp-registration status for a phone. */
function setWaStatus(phone, status) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return;
  getDb()
    .prepare('UPDATE contacts SET waStatus = ?, waCheckedAt = ? WHERE normalizedPhone = ?')
    .run(status, new Date().toISOString(), normalizedPhone);
}

function updateName(id, name) {
  const nameCheck = validateName(name);
  if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason };
  const info = getDb()
    .prepare('UPDATE contacts SET name = ?, updatedAt = ? WHERE id = ?')
    .run(nameCheck.name, new Date().toISOString(), id);
  return info.changes > 0 ? { ok: true, contact: getById(id) } : { ok: false, reason: 'Kontakt tapılmadı' };
}

function updatePhone(id, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || !isValidAzerbaijanMobile(normalizedPhone)) {
    return { ok: false, reason: 'Yanlış nömrə formatı' };
  }
  const db = getDb();
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!existing) return { ok: false, reason: 'Kontakt tapılmadı' };
  const conflict = db.prepare('SELECT * FROM contacts WHERE normalizedPhone = ? AND id != ?').get(normalizedPhone, id);
  if (conflict) return { ok: false, reason: `Bu nömrə artıq "${conflict.name}" kontaktında mövcuddur` };
  db.prepare('UPDATE contacts SET phone = ?, normalizedPhone = ?, updatedAt = ? WHERE id = ?')
    .run(formatPhone(normalizedPhone), normalizedPhone, new Date().toISOString(), id);
  return { ok: true, contact: getById(id) };
}

function remove(id) {
  const info = getDb().prepare('DELETE FROM contacts WHERE id = ?').run(id);
  return info.changes > 0;
}

function removeByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return false;
  const info = getDb().prepare('DELETE FROM contacts WHERE normalizedPhone = ?').run(normalizedPhone);
  return info.changes > 0;
}

function _reset() {
  getDb().prepare('DELETE FROM contacts').run();
}

module.exports = {
  upsert,
  getById,
  getByPhone,
  list,
  all,
  count,
  setWaStatus,
  updateName,
  updatePhone,
  remove,
  removeByPhone,
  _reset,
};
