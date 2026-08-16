#!/usr/bin/env node
/**
 * `npm run migrate` — apply database migrations.
 * `npm run check` — syntax/config check without touching the database.
 */
const { migrate } = require('../lib/migrations');
const config = require('../lib/config');

if (process.argv.includes('--check')) {
  console.log(`[check] config OK (database: ${config.isPostgres ? 'PostgreSQL' : 'SQLite'})`);
  console.log(`[check] workerApiUrl: ${config.workerApiUrl || '(not set — degraded mode)'}`);
  process.exit(0);
}

migrate()
  .then((r) => {
    console.log(`[migrate] done — schema v${r.current} on ${r.dialect}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[migrate] FAILED:', e.message);
    process.exit(1);
  });
