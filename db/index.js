/**
 * SQLite database bootstrap + migrations.
 *
 * Uses better-sqlite3 (synchronous, zero-config). Migrations run
 * automatically at startup and are tracked with PRAGMA user_version so
 * existing installations upgrade cleanly.
 */
const fs = require('fs-extra');
const path = require('path');
const Database = require('better-sqlite3');
const settings = require('../settings');
const { makeLogger } = require('../lib/logger');

const LOG = makeLogger('DB');

let db = null;

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        normalizedPhone TEXT NOT NULL UNIQUE,
        waStatus TEXT NOT NULL DEFAULT 'unknown',
        waCheckedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'running',
        type TEXT NOT NULL DEFAULT 'text',
        payloadSpec TEXT NOT NULL DEFAULT '{}',
        targets TEXT NOT NULL DEFAULT '[]',
        successCount INTEGER NOT NULL DEFAULT 0,
        failCount INTEGER NOT NULL DEFAULT 0,
        skipCount INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        startedAt TEXT,
        finishedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL,
        userAgent TEXT,
        ip TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_createdAt ON jobs(createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
    `,
  },
];

function connect() {
  if (db) return db;
  fs.ensureDirSync(path.dirname(settings.dbFile));
  db = new Database(settings.dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrate() {
  const conn = connect();
  const current = conn.pragma('user_version', { simple: true });
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      LOG.info(`Applying migration v${m.version}...`);
      conn.exec('BEGIN');
      try {
        conn.exec(m.sql);
        conn.pragma(`user_version = ${m.version}`);
        conn.exec('COMMIT');
      } catch (e) {
        conn.exec('ROLLBACK');
        throw e;
      }
    }
  }
  LOG.info(`Database ready (${settings.dbFile}), schema v${Math.max(current, ...MIGRATIONS.map((m) => m.version))}`);
  return conn;
}

function getDb() {
  return connect();
}

function close() {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
}

module.exports = { connect, migrate, getDb, close, MIGRATIONS };
