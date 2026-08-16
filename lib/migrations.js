/**
 * Migrations — schema is applied idempotently on first storage access.
 * This module records the applied version and hosts future step-wise
 * migrations (add steps to MIGRATIONS for schema changes).
 */
const { storage, rawDb } = require('./storage');

const MIGRATIONS = [
  { version: 1, note: 'Initial schema (users, sessions, contacts, jobs, settings)' },
];

async function currentVersion() {
  const db = await storage();
  try {
    await db.run('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)');
  } catch {}
  const row = await db.get('SELECT MAX(version) AS v FROM _migrations');
  return row && row.v ? row.v : 0;
}

/** Apply migrations (idempotent). Schema itself is created in storage.init(). */
async function migrate() {
  await storage(); // ensure schema exists
  const version = await currentVersion();
  for (const m of MIGRATIONS) {
    if (m.version > version) {
      await storage().then((db) =>
        db.run('INSERT INTO _migrations (version, appliedAt) VALUES (?, ?)', [m.version, new Date().toISOString()])
      );
    }
  }
  return { current: Math.max(version, ...MIGRATIONS.map((m) => m.version)), dialect: (await storage()).dialect };
}

module.exports = { migrate, currentVersion, MIGRATIONS };
