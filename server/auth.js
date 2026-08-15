/**
 * Authentication — scrypt password hashing + persistent token sessions.
 *
 * On first boot the admin user is created from ADMIN_USERNAME /
 * ADMIN_PASSWORD. If no password is provided a random one is generated and
 * printed to the logs exactly once — never stored in the repository.
 */
const crypto = require('crypto');
const { getDb } = require('../db');
const sessions = require('../db/sessions');
const settings = require('../settings');
const { makeLogger } = require('../lib/logger');

const LOG = makeLogger('AUTH');

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function createUserIfNeeded() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return null;

  let password = settings.adminPassword;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.prepare('INSERT INTO users (username, passwordHash, createdAt) VALUES (?, ?, ?)')
    .run(settings.adminUsername, `${salt}:${hash}`, new Date().toISOString());

  const msg = `Web panel login → ${settings.adminUsername} / ${password}`;
  if (generated) LOG.info(`[ADMIN CREDENTIALS] ${msg}`);
  else LOG.info('Admin user created from environment (ADMIN_USERNAME/ADMIN_PASSWORD).');
  return { username: settings.adminUsername, password: generated ? password : null, generated };
}

function verify(username, password) {
  const row = getDb().prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!row) return false;
  const [salt, hash] = String(row.passwordHash).split(':');
  if (!salt || !hash) return false;
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function login(username, password, userAgent, ip) {
  if (!verify(username, password)) return null;
  return sessions.create(userAgent, ip);
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.headers.cookie || '';
  const m = cookie.match(new RegExp(`${settings.cookieName}=([^;]+)`));
  if (m) return decodeURIComponent(m[1]);
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token || !sessions.isValid(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.sessionToken = token;
  next();
}

module.exports = { createUserIfNeeded, verify, login, extractToken, requireAuth, hashPassword };
