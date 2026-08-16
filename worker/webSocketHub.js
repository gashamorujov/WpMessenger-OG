/**
 * WebSocketHub — realtime push channel from the worker to the frontend.
 *
 * The browser connects directly to the worker (wss://...) after obtaining a
 * short-lived ticket from the Next.js web API (which forwards the worker's
 * /api/ws-ticket response). Events:
 *   { type: 'wa:status' | 'wa:qr' | 'wa:pair' | 'wa:error' | 'job:new' |
 *          'job:update' | 'job:done' | 'contacts:changed' | 'stats', data: {...} }
 */
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const config = require('./lib/config');
const { makeLogger } = require('./lib/logger');

const LOG = makeLogger('WS');

class WebSocketHub {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.tickets = new Map();
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
      ws.send(JSON.stringify({ type: 'hello', data: { version: config.version, ts: Date.now() } }));
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
    LOG.info('WebSocket hub listening on /ws (ticket auth)');
  }

  /** Issue a short-lived ticket the browser exchanges for a WS connection. */
  createTicket() {
    const ticket = crypto.randomBytes(24).toString('hex');
    this.tickets.set(ticket, Date.now() + config.wsTicketTtlSec * 1000);
    // Opportunistic cleanup of expired tickets.
    const now = Date.now();
    for (const [t, exp] of this.tickets) {
      if (exp < now) this.tickets.delete(t);
    }
    return { ticket, ttl: config.wsTicketTtlSec };
  }

  _isAuthed(req) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const ticket = url.searchParams.get('ticket');
      if (!ticket) return false;
      const exp = this.tickets.get(ticket);
      if (!exp || exp < Date.now()) return false;
      this.tickets.delete(ticket); // one-time use
      return true;
    } catch {
      return false;
    }
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
    this.tickets.clear();
    if (this.wss) { try { this.wss.close(); } catch {} this.wss = null; }
  }
}

module.exports = new WebSocketHub();
