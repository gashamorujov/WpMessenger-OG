#!/usr/bin/env node
/**
 * Worker DB migration runner: `npm --prefix worker run migrate`
 * Applies the same idempotent schema the web app uses (shared database).
 */
const { migrate } = require('../lib/migrations');

migrate()
  .then((r) => {
    console.log(`[worker:migrate] done — schema v${r.current} on ${r.dialect}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[worker:migrate] FAILED:', e.message);
    process.exit(1);
  });
