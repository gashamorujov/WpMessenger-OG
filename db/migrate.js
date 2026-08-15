#!/usr/bin/env node
/**
 * CLI migration runner: `npm run migrate`
 */
const { migrate, close } = require('./index');

try {
  migrate();
  console.log('Migrations applied successfully.');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exitCode = 1;
} finally {
  close();
}
