/**
 * waClient — server-to-server client for the persistent WhatsApp worker.
 *
 * The Next.js app (Vercel/Netlify serverless) NEVER opens WhatsApp/WebSocket
 * connections itself. All WhatsApp operations are proxied to the worker
 * (Railway/VPS/Docker) over HTTPS with a shared bearer token.
 */
const config = require('./config');

class WorkerError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function isConfigured() {
  return !!(config.workerApiUrl && config.workerApiToken);
}

async function request(path, { method = 'GET', body, raw, headers } = {}) {
  if (!isConfigured()) {
    throw new WorkerError(
      'WhatsApp worker konfiqurasiya olunmayıb. WORKER_API_URL və WORKER_API_TOKEN env dəyişənlərini təyin edin.',
      503
    );
  }
  const h = { Authorization: `Bearer ${config.workerApiToken}`, ...(headers || {}) };
  let payload;
  if (raw !== undefined) {
    h['Content-Type'] = 'application/octet-stream';
    payload = raw;
  } else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(config.workerApiUrl + path, {
      method,
      headers: h,
      body: payload,
      signal: AbortSignal.timeout(config.workerTimeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    throw new WorkerError(`WhatsApp worker-a çatılmadı (${config.workerApiUrl}): ${e.message}`, 502);
  }
  if (!res.ok) {
    let msg = `Worker xətası (${res.status})`;
    try { const d = await res.json(); if (d && d.error) msg = d.error; } catch {}
    throw new WorkerError(msg, res.status === 401 ? 503 : 502);
  }
  return res.json().catch(() => null);
}

/** Never throws — used for dashboard status pills. */
async function workerStatus() {
  try {
    const d = await request('/api/status');
    return { reachable: true, sessions: (d && d.sessions) || [] };
  } catch (e) {
    return { reachable: false, sessions: [], error: e.message };
  }
}

module.exports = {
  WorkerError,
  request,
  isConfigured,
  workerStatus,
  status: () => request('/api/status'),
  connect: (body) => request('/api/connect', { method: 'POST', body }),
  disconnect: (body) => request('/api/disconnect', { method: 'POST', body }),
  qr: (key) => request(`/api/qr/${encodeURIComponent(key)}`),
  pair: (phone) => request(`/api/pair/${encodeURIComponent(phone)}`),
  wsTicket: () => request('/api/ws-ticket', { method: 'POST' }),
  upload: (buf, filename, mimetype) =>
    request('/api/upload', { method: 'POST', raw: Buffer.isBuffer(buf) ? buf : Buffer.from(buf), headers: { 'X-Filename': encodeURIComponent(filename || 'file'), 'X-Mimetype': encodeURIComponent(mimetype || 'application/octet-stream') } }),
  notifyJob: (jobId) => request('/api/jobs', { method: 'POST', body: { jobId } }),
  cancelJob: (jobId) => request(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
};
