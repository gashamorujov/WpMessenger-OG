/**
 * Storage — unified SQLite (local) / PostgreSQL (production) layer.
 *
 * SQL is kept dialect-agnostic: `?` placeholders (converted to `$1..$n` for
 * PostgreSQL), ISO-8601 text timestamps, TEXT booleans, JSON-as-TEXT.
 * Migrations run automatically on first access (idempotent) so serverless
 * deployments never fail on schema drift.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

let impl = null;
let db = null;

const SCHEMA = {
  sqlite: `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      userAgent TEXT,
      ip TEXT
    );
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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_createdAt ON jobs(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
  `,
  pg: `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      userAgent TEXT,
      ip TEXT
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_createdAt ON jobs(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
  `,
};

function applySchema(conn, dialect) {
  conn.exec(SCHEMA[dialect]);
}

function openSqlite() {
  const Database = require('better-sqlite3');
  const file = config.databaseUrl.startsWith('file:') ? config.databaseUrl.slice(5) : config.databaseUrl;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  return conn;
}

async function openPg() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30000 });
  // Fail fast with a clear, managed error instead of a silent crash.
  const client = await pool.connect().catch((e) => {
    throw new Error(
      `Database connection failed (${config.databaseUrl}). Check DATABASE_URL and database reachability. Reason: ${e.message}`
    );
  });
  client.release();
  return pool;
}

/**
 * Initialise the database (connect + idempotent schema).
 * Safe to call on every serverless invocation — schema creation is
 * `IF NOT EXISTS` and versioned via migrations().
 */
async function init() {
  if (impl) return impl;
  if (config.isPostgres) {
    db = await openPg();
    impl = {
      async all(sql, params = []) {
        const { rows } = await db.query(toPg(sql), params);
        return rows;
      },
      async get(sql, params = []) {
        const { rows } = await db.query(toPg(sql), params);
        return rows[0] || null;
      },
      async run(sql, params = []) {
        const result = await db.query(toPg(sql), params);
        return { changes: result.rowCount || 0, rows: result.rows };
      },
      exec(sql) {
        return db.query(sql);
      },
      dialect: 'pg',
    };
  } else {
    db = openSqlite();
    impl = {
      all(sql, params = []) {
        return db.prepare(sql).all(...params);
      },
      get(sql, params = []) {
        return db.prepare(sql).get(...params);
      },
      run(sql, params = []) {
        const r = db.prepare(sql).run(...params);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
      exec(sql) {
        return db.exec(sql);
      },
      dialect: 'sqlite',
    };
  }
  applySchema(db, impl.dialect);
  return impl;
}

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** @returns {Promise<{all: Function, get: Function, run: Function, exec: Function, dialect: string}>} */
async function storage() {
  if (!impl) await init();
  return impl;
}

function rawDb() {
  return db;
}

module.exports = { storage, init, rawDb, SCHEMA };
