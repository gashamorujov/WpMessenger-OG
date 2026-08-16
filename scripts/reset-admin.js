#!/usr/bin/env node
/**
 * `npm run reset-admin` — guaranteed admin recovery.
 *
 * Resets the admin user to ADMIN_USERNAME / ADMIN_PASSWORD (defaults:
 * gasham / gasham1006) and invalidates every active session. Use this when
 * credentials are lost or a previous deployment left an unknown user in the
 * database. Credentials are never printed.
 */
const crypto = require('crypto');
const config = require('../lib/config');
const { storage } = require('../lib/storage');
const { sessionsRepo } = require('../lib/repositories');

(async () => {
  try {
    const db = await storage();
    const username = config.adminUsername;
    const password = config.adminPassword;
    if (!username || !password) throw new Error('ADMIN_USERNAME/ADMIN_PASSWORD təyin edilməyib');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    await db.run('DELETE FROM users');
    await db.run('INSERT INTO users (username, passwordHash, createdAt) VALUES (?, ?, ?)', [username, `${salt}:${hash}`, new Date().toISOString()]);
    await sessionsRepo.destroyAll();
    console.log('[reset-admin] Administrator sıfırlandı. Bütün sessiyalar bağlandı.');
    console.log('[reset-admin] Giriş: ADMIN_USERNAME/ADMIN_PASSWORD env dəyişənləri (defolt: gasham / gasham1006).');
  } catch (e) {
    console.error('[reset-admin] FAILED:', e.message);
    process.exit(1);
  }
})();
