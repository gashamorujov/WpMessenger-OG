/**
 * Worker auth — shared bearer token between the Next.js web app and worker.
 *
 * Requests without the token (or when WORKER_API_TOKEN is not configured)
 * fail with a clear, managed error — never a crash.
 */
const config = require('./lib/config');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const alt = req.headers['x-worker-token'];
  if (alt) return String(alt).trim();
  return '';
}

function requireWorkerAuth(req, res, next) {
  if (!config.workerApiToken) {
    return res.status(503).json({ error: 'WORKER_API_TOKEN env dəyişəni təyin edilməyib — worker istifadə edilə bilməz' });
  }
  const token = extractToken(req);
  if (!token || token !== config.workerApiToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireWorkerAuth, extractToken };
