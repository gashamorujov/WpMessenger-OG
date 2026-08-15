/**
 * WebSocketHub — realtime push channel to the frontend.
 *
 * All WhatsApp/auth/job events are broadcast as JSON messages:
 *   { type: 'wa:status' | 'wa:qr' | 'wa:pair' | 'wa:error' | 'job:new' |
 *          'job:update' | 'job:done' | 'contacts:changed' | 'stats', data: {...} }
 *
 * Clients authenticate with ?token= (or the wpm_session cookie) during the
 * WebSocket upgrade. A heartbeat keeps connections alive through proxies.
 */
const { WebSocketServer } = require('ws');
const sessions = require('../db/sessions');
const { makeLogger } = require('../lib/logger');
const settings = require('../settings');

const LOG = makeLogger('WS');

class WebSocketHub {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this._heartbeat = null;
  }

  attach(server) {
    if (this.wss) return;
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      if (!this._isAuthed(req)) {
        ws.close(4001, 'unauthorized');
        return;
      }
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('error', () => {});
      ws.on('close', () => this.clients.delete(ws));
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', data: { version: settings.version, ts: Date.now() } }));
    });

    this._heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
      }
    }, 30000);
    this._heartbeat.unref && this._heartbeat.unref();
    LOG.info('WebSocket hub listening on /ws');
  }

  _isAuthed(req) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const qToken = url.searchParams.get('token');
      if (qToken && sessions.isValid(qToken)) return true;
      const cookie = req.headers.cookie || '';
      const m = cookie.match(new RegExp(`${settings.cookieName}=([^;]+)`));
      if (m && sessions.isValid(decodeURIComponent(m[1]))) return true;
    } catch {}
    return false;
  }

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  get size() {
    return this.clients.size;
  }

  shutdown() {
    if (this._heartbeat) clearInterval(this._heartbeat);
    for (const ws of this.clients) {
      try { ws.close(1001, 'shutdown'); } catch {}
    }
    this.clients.clear();
    if (this.wss) { try { this.wss.close(); } catch {} this.wss = null; }
  }
}

module.exports = new WebSocketHub();
