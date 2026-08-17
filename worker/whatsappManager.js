/**
 * WhatsAppManager — Baileys socket lifecycle (WpFastMesenger-v6 proven logic).
 *
 * Uses useMultiFileAuthState (file-based) — the same approach that powers
 * the production WhatsApp bot in gashamorujov/WpFastMesenger-v6.
 * No Firebase for WhatsApp auth state — files in worker/sessions/.
 *
 * The Next.js web app never opens WhatsApp connections. It proxies commands
 * here over HTTPS with a shared bearer token.
 */
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const NodeCache = require('node-cache');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./lib/config');
const { sleep } = require('./lib/myfunc');
const { makeLogger } = require('./lib/logger');

const LOG = makeLogger('WA');

// ─── Sessions persistence (file-based, same as WpFastMesenger-v6) ───

const SESSIONS_DIR = path.join(__dirname, 'sessions');
const SESSION_DATA_FILE = path.join(SESSIONS_DIR, 'sessions.json');

fs.ensureDirSync(SESSIONS_DIR);

let sessionsData = {};
try {
  if (fs.existsSync(SESSION_DATA_FILE)) {
    sessionsData = JSON.parse(fs.readFileSync(SESSION_DATA_FILE, 'utf-8'));
  }
} catch { sessionsData = {}; }

let sessionsSaveTimer = null;
function saveSessionsData() {
  clearTimeout(sessionsSaveTimer);
  sessionsSaveTimer = setTimeout(() => {
    sessionsSaveTimer = null;
    try { fs.writeFileSync(SESSION_DATA_FILE, JSON.stringify(sessionsData, null, 2)); }
    catch (e) { LOG.error('saveSessionsData:', e.message); }
  }, 400);
}

// ─── Event system ───

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const activeConnections = {};

const pendingQr = new Map();
const pendingPair = new Map();

const connectedHooks = [];

function onConnected(cb) { if (typeof cb === 'function') connectedHooks.push(cb); }

function fireConnectedHooks(phone, sock) {
  for (const cb of connectedHooks) {
    try { Promise.resolve(cb(phone, sock)).catch((e) => LOG.error('Connected hook error:', e.message)); }
    catch (e) { LOG.error('Connected hook error:', e.message); }
  }
}

const fmtPhone = (n) => String(n || '').replace(/[^0-9]/g, '');

function emit(type, payload) {
  try { emitter.emit(type, payload); } catch (e) { LOG.error('emit error:', e.message); }
}

function setStatus(phone, session) {
  sessionsData[phone] = { ...(sessionsData[phone] || {}), ...session };
  saveSessionsData();
  emit('status', { phone, session: { ...sessionsData[phone] } });
}

const sessDir = (p) => path.join(SESSIONS_DIR, p);

/** No-op: sessions are loaded from disk at module load time. */
async function init() {}

// ─── Connect (Pair or QR) ───

async function connectWithPhone(phone, method = 'pair') {
  phone = fmtPhone(phone);
  if (method === 'qr' && !phone) phone = 'main';
  if (!phone || (phone !== 'main' && (phone.length < 7 || phone.length > 15))) {
    return { ok: false, error: 'Yanlış nömrə formatı. Düzgün format: 994501234567' };
  }

  if (sessionsData[phone]?.status === 'connected' && activeConnections[phone]) {
    return { ok: false, error: `+${phone} artıq bağlıdır` };
  }

  pendingQr.delete(phone);
  pendingPair.delete(phone);
  setStatus(phone, { phone, status: 'connecting', method, connectedAt: null, name: '', jid: '' });

  try {
    // File-based auth state — proven in WpFastMesenger-v6 production
    const dir = sessDir(phone);
    fs.ensureDirSync(dir);
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();
    const msgCache = new NodeCache();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['WpMessenger OG', 'Chrome', '20.0.04'],
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
      },
      markOnlineOnConnect: true,
      msgRetryCounterCache: msgCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      syncFullHistory: true,
    });

    let qrEmitted = false;
    let pairRequested = false;
    let connOpen = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    sock.ev.on('connection.update', async (s) => {
      const { connection, lastDisconnect, qr } = s;

      // QR Code received
      if (qr && !connOpen) {
        qrEmitted = true;
        pendingQr.set(phone, { qr, ts: Date.now() });
        try {
          const buf = await QRCode.toBuffer(qr, { type: 'png', margin: 2, scale: 8 });
          const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
          pendingQr.set(phone, { qr: dataUrl, ts: Date.now() });
          emit('qr', { phone, qr: dataUrl });
        } catch (err) {
          LOG.error('QR gen error:', err.message);
          emit('error', { phone, message: 'QR yaradılması xətası: ' + err.message });
        }

        // If this is a Pair Code request, wait for socket to be ready then request pair code
        if (method === 'pair' && !pairRequested) {
          pairRequested = true;
          LOG.info(`Socket ready, requesting pairing code for ${phone}`);
          requestPairingCodeWithRetry(sock, phone).catch((e) => {
            LOG.error(`Pair request failed for ${phone}:`, e.message);
          });
        }
      }

      // Connected
      if (connection === 'open') {
        connOpen = true;
        reconnectAttempts = 0;
        LOG.info('Connected +' + phone);
        const session = {
          phone,
          status: 'connected',
          connectedAt: new Date().toISOString(),
          name: sock.user?.name || phone,
          jid: sock.user?.id || '',
          method,
        };
        setStatus(phone, session);
        activeConnections[phone] = sock;
        pendingQr.delete(phone);
        pendingPair.delete(phone);
        emit('connected', { phone, session });
        fireConnectedHooks(phone, sock);
      }

      // Disconnected
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const errMsg = lastDisconnect?.error?.message || '';
        LOG.info('Connection closed for +' + phone, 'code:', code, 'msg:', errMsg);
        delete activeConnections[phone];

        if (code === DisconnectReason.loggedOut || code === 401) {
          pendingQr.delete(phone);
          pendingPair.delete(phone);
          try { fs.removeSync(sessDir(phone)); } catch {}
          delete sessionsData[phone];
          saveSessionsData();
          emit('status', { phone, session: { phone, status: 'logged_out' } });
          return;
        }

        if (sessionsData[phone]) sessionsData[phone].status = 'reconnecting';
        else sessionsData[phone] = { phone, status: 'reconnecting', method };
        saveSessionsData();
        emit('status', { phone, session: { ...sessionsData[phone] } });

        if (reconnectAttempts < MAX_RECONNECT) {
          const delay = Math.min(3000 * Math.pow(2, reconnectAttempts), 60000);
          reconnectAttempts++;
          LOG.info(`[AutoReconnect] +${phone} attempt ${reconnectAttempts}/${MAX_RECONNECT} in ${delay / 1000}s`);
          setTimeout(async () => {
            if (!activeConnections[phone]) {
              try { await connectWithPhone(phone, method); }
              catch (e) { LOG.error(`[AutoReconnect] +${phone} reconnect failed:`, e.message); }
            }
          }, delay);
        } else {
          LOG.info(`[AutoReconnect] +${phone} max attempts reached, waiting for watchdog`);
          if (sessionsData[phone]) sessionsData[phone].status = 'disconnected';
          saveSessionsData();
          emit('status', { phone, session: { ...sessionsData[phone] } });
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
    activeConnections[phone] = sock;

    // QR timeout: if no QR after 30s, kill the socket
    if (method === 'qr') {
      setTimeout(() => {
        if (!connOpen && !qrEmitted) {
          emit('error', { phone, message: 'QR yaradılmadı (timeout).' });
          if (activeConnections[phone]) { activeConnections[phone].end(new Error('qr timeout')); delete activeConnections[phone]; }
          if (sessionsData[phone]) sessionsData[phone].status = 'disconnected';
          saveSessionsData();
          emit('status', { phone, session: { phone, status: 'disconnected' } });
        }
      }, 30000);

      setTimeout(() => {
        if (!connOpen) {
          emit('error', { phone, message: 'QR scan timeout.' });
          if (activeConnections[phone]) { activeConnections[phone].end(new Error('qr scan timeout')); delete activeConnections[phone]; }
          if (sessionsData[phone]?.status !== 'logged_out') {
            sessionsData[phone].status = 'disconnected';
            saveSessionsData();
            emit('status', { phone, session: { ...sessionsData[phone] } });
          }
        }
      }, 120000);
    }

    return { ok: true, phone };
  } catch (err) {
    LOG.error('Connection error +' + phone, err.message);
    if (sessionsData[phone]) sessionsData[phone].status = 'disconnected';
    saveSessionsData();
    emit('status', { phone, session: { phone, status: 'disconnected' } });
    return { ok: false, error: err.message };
  }
}

// ─── Pair Code with retry (proven in WpFastMesenger-v6) ───

async function requestPairingCodeWithRetry(sock, phone, maxRetries = 15) {
  for (let i = 0; i < maxRetries; i++) {
    if (sessionsData[phone]?.status === 'connected') return;
    if (!activeConnections[phone]) return;
    try {
      LOG.info(`Requesting pairing code for ${phone} (attempt ${i + 1}/${maxRetries})`);
      let code = await sock.requestPairingCode(phone);
      code = code?.match(/.{1,4}/g)?.join('-') || code;
      LOG.info(`Pairing code for ${phone}: ${code}`);
      pendingPair.set(phone, { code, ts: Date.now() });
      emit('pair', { phone, code });
      return;
    } catch (err) {
      const msg = err.message || '';
      LOG.info(`Pairing attempt ${i + 1} failed:`, msg.slice(0, 80));

      if (msg.includes('not authorized') || msg.includes('401') || msg.includes('conflict')) {
        emit('error', { phone, message: `Pairing failed: ${msg}. QR Code metodunu sınayın.` });
        if (activeConnections[phone]) { activeConnections[phone].end(new Error('Pair failed')); delete activeConnections[phone]; }
        if (sessionsData[phone]) sessionsData[phone].status = 'disconnected';
        saveSessionsData();
        emit('status', { phone, session: { ...sessionsData[phone] } });
        return;
      }

      if (msg.includes('Connection Closed') || msg.includes('not open') || msg.includes('timedOut')) {
        await sleep(2000);
        continue;
      }

      await sleep(1500);
    }
  }
}

// ─── Disconnect ───

async function disconnectSession(phone) {
  phone = fmtPhone(phone);
  if (activeConnections[phone]) {
    try { activeConnections[phone].end(new Error('User logout')); } catch {}
    delete activeConnections[phone];
  }
  try { fs.removeSync(sessDir(phone)); } catch {}
  pendingQr.delete(phone);
  pendingPair.delete(phone);
  delete sessionsData[phone];
  saveSessionsData();
  emit('status', { phone, session: { phone, status: 'logged_out' } });
  return true;
}

// ─── Watchdog ───

let watchdogStarted = false;
function startConnectionWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  LOG.info('Connection watchdog started (every 2 minutes)');
  setInterval(() => {
    for (const [phone, session] of Object.entries(sessionsData)) {
      if ((session.status === 'disconnected' || session.status === 'reconnecting') && !activeConnections[phone]) {
        LOG.info(`[Watchdog] +${phone} is ${session.status}, attempting reconnect...`);
        connectWithPhone(phone, session.method || 'pair').catch((e) => {
          LOG.error(`[Watchdog] +${phone} reconnect failed:`, e.message);
        });
      }
      if (session.status === 'connected' && !activeConnections[phone]) {
        LOG.info(`[Watchdog] +${phone} marked connected but no active connection. Reconnecting...`);
        sessionsData[phone].status = 'reconnecting';
        saveSessionsData();
        connectWithPhone(phone, session.method || 'pair').catch((e) => {
          LOG.error(`[Watchdog] +${phone} reconnect failed:`, e.message);
        });
      }
    }
  }, 120000);
}

// ─── Auto-reconnect at boot (proven in WpFastMesenger-v6) ───

async function autoReconnectAll() {
  let reconnected = 0;
  for (const [phone, session] of Object.entries(sessionsData)) {
    if (['connected', 'reconnecting', 'disconnected'].includes(session.status)) {
      LOG.info(`Auto-reconnecting to +${phone}...`);
      try {
        await connectWithPhone(phone, session.method || 'pair');
        reconnected++;
      } catch (e) {
        LOG.error(`Reconnect failed for +${phone}:`, e.message);
      }
    }
  }

  // Also scan sessions/ directory for orphaned auth files
  try {
    if (fs.existsSync(SESSIONS_DIR)) {
      const dirs = fs.readdirSync(SESSIONS_DIR);
      for (const dir of dirs) {
        if (dir === 'sessions.json' || dir.startsWith('.')) continue;
        const authPath = path.join(SESSIONS_DIR, dir, 'creds.json');
        if (fs.existsSync(authPath)) {
          const phone = dir.replace(/[^0-9]/g, '');
          if (phone && (!sessionsData[phone] || sessionsData[phone]?.status !== 'connected')) {
            if (!sessionsData[phone]) sessionsData[phone] = { phone, status: 'reconnecting' };
            else sessionsData[phone].status = 'reconnecting';
            LOG.info(`Found stored auth for ${dir}, reconnecting...`);
            try {
              await connectWithPhone(phone, 'pair');
              reconnected++;
            } catch (e) {
              LOG.error(`Reconnect failed for ${dir}:`, e.message);
            }
          }
        }
      }
    }
  } catch (e) {
    LOG.warn('Session directory scan:', e.message);
  }

  if (reconnected === 0) LOG.info('No previous WhatsApp sessions found.');
  return reconnected;
}

// ─── Helpers ───

function getSenderSocket() {
  for (const [phone, session] of Object.entries(sessionsData)) {
    if (session.status === 'connected' && activeConnections[phone]) {
      return { sock: activeConnections[phone], phone };
    }
  }
  return null;
}

function getSessions() {
  return Object.values(sessionsData).map((s) => ({
    phone: s.phone,
    status: s.status,
    method: s.method || 'pair',
    name: s.name || '',
    connectedAt: s.connectedAt || null,
  }));
}

function getPendingQr(phone) {
  const key = pendingQr.has(String(phone)) ? String(phone) : fmtPhone(phone);
  const p = pendingQr.get(key);
  if (!p) return null;
  return { phone: key, qr: p.qr, ts: p.ts };
}

function getPendingPair(phone) {
  const p = pendingPair.get(fmtPhone(phone));
  if (!p) return null;
  return { phone: fmtPhone(phone), code: p.code, ts: p.ts };
}

module.exports = {
  emitter,
  init,
  connectWithPhone,
  disconnectSession,
  startConnectionWatchdog,
  autoReconnectAll,
  getSenderSocket,
  getSessions,
  getPendingQr,
  getPendingPair,
  onConnected,
  activeConnections,
  sessionsData,
  saveSessionsData,
};
