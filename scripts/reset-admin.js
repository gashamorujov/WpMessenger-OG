#!/usr/bin/env node
/**
 * `npm run reset-admin` — guaranteed admin recovery.
 *
 * Resets the admin user in Firebase RTDB (wpm/users/admin) to
 * ADMIN_USERNAME / ADMIN_PASSWORD (defaults: gasham / gasham1006) and
 * invalidates every active session. Credentials are never printed.
 */
const crypto = require('crypto');
const config = require('../lib/config');
const fb = require('../lib/firebase');

(async () => {
  try {
    const username = config.adminUsername;
    const password = config.adminPassword;
    if (!username || !password) throw new Error('ADMIN_USERNAME/ADMIN_PASSWORD təyin edilməyib');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    await fb.set('wpm/users/admin', { username, passwordHash: `${salt}:${hash}`, createdAt: new Date().toISOString() });
    await fb.remove('wpm/sessions');
    console.log('[reset-admin] Administrator sıfırlandı. Bütün sessiyalar bağlandı.');
    console.log('[reset-admin] Giriş: ADMIN_USERNAME/ADMIN_PASSWORD env dəyişənləri (defolt: gasham / gasham1006).');
  } catch (e) {
    console.error('[reset-admin] FAILED:', e.message);
    process.exit(1);
  }
})();
