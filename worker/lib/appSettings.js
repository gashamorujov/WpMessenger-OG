/**
 * appSettings — synchronous view of the shared `settings` table.
 *
 * The worker and the web app share one database. Settings overrides made
 * in the web panel are read by the worker through this small sync cache,
 * refreshed on boot and periodically so pacing/limits stay in sync.
 */
const { settingsRepo } = require('./repositories');

let cache = {};
let refreshing = null;

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = settingsRepo
    .getAll()
    .then((all) => {
      cache = all || {};
      return cache;
    })
    .catch(() => cache)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function get(key) {
  return cache[key];
}

function getAll() {
  return cache;
}

module.exports = { get, getAll, refresh };
