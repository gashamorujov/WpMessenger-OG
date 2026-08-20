/* WpMessenger OG — SPA frontend (vanilla JS, no build step) */
(function () {
  'use strict';

  // Deploy config — served by the backend (/js/config.generated.js) or
  // generated at build time for Vercel/Netlify static deploys.
  const __CFG = window.__WPM_CONFIG__ || {};
  const API_BASE = String(__CFG.apiUrl || '').replace(/\/+$/, '');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const fmtDur = (a, b) => {
    if (!a || !b) return '—';
    const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
    if (s < 60) return s + ' san';
    return Math.floor(s / 60) + ' dəq ' + (s % 60) + ' san';
  };
  const stateLabel = {
    connected: 'Qoşuldu', connecting: 'Qoşulur...', reconnecting: 'Yenidən qoşulur...',
    disconnected: 'Bağlantı yoxdur', logged_out: 'Çıxış edilib', pending: 'Gözləyir',
    running: 'İşləyir', interrupted: 'Kəsilib', completed: 'Tamamlandı', cancelled: 'Dayandırılıb',
    sent: 'Göndərildi', failed: 'Xəta', skipped: 'Atlandı',
    yes: 'WhatsApp-da', no: 'WhatsApp-da deyil', unknown: 'Bilinmir',
  };
  const stateBadge = (s) => {
    const map = {
      connected: 'green', running: 'green', sent: 'green', completed: 'green', yes: 'green',
      connecting: 'amber', reconnecting: 'amber', pending: 'amber', interrupted: 'amber', unknown: 'gray',
      disconnected: 'red', logged_out: 'red', failed: 'red', cancelled: 'red', no: 'red', skipped: 'gray',
    };
    return (map[s] || 'gray');
  };

  const setLoading = (btn, on) => { if (!btn) return; btn.classList.toggle('loading', !!on); btn.disabled = !!on; };

  const svg = (body, size) =>
    `<svg class="ic-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    dash: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    wa: svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
    contacts: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    send: svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
    history: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    jobs: svg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    settings: svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
    logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
    sun: svg('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
    moon: svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
    plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    edit: svg('<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>'),
    trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    back: svg('<polyline points="15 18 9 12 15 6"/>'),
    forward: svg('<polyline points="9 18 15 12 9 6"/>'),
    go: svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
    refresh: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    check: svg('<polyline points="20 6 9 17 4 12"/>'),
    x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    warn: svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    clock: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    paperclip: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
    retry: svg('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
    list: svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
    globe: svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    phone: svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
    qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 20h1v1h-1z"/>'),
  };

  const App = {
    state: {
      authed: false,
      user: null,
      ws: null,
      wsState: 'offline',
      theme: localStorage.getItem('wpm_theme') || 'dark',
      route: 'dashboard',
      overview: null,
      settings: null,
      contacts: { items: [], total: 0, page: 1, pages: 1, q: '', waStatus: 'all' },
      contactsAll: [],
      jobs: {},           // id -> job snapshot
      jobList: { items: [], total: 0, page: 1, pages: 1 },
      history: { items: [], total: 0, page: 1, pages: 1, state: 'all', selectedIds: new Set() },
      send: { step: 1, mode: 'single', phone: '', numbers: '', contactIds: [], text: '', caption: '', file: null, messageType: '', jobId: null },
      connect: { tab: 'qr', pending: null, qr: null, pair: null },
      modal: null,
      _statsTimer: null,
    },

    /* ── bootstrap ── */
    async init() {
      document.documentElement.setAttribute('data-theme', this.state.theme);
      window.addEventListener('popstate', () => this.router());
      try {
        const me = await this.api('/auth/me');
        this.state.authed = true;
        this.state.user = { username: me.username };
        this.router();
        this.connectRealtime();
        this.fetchContactsAll().catch(() => {});
      } catch {
        this.state.authed = false;
        this.state.user = null;
        this.router();
      }
    },

    sessionExpired() {
      this.state.authed = false;
      this.state.user = null;
      this.state.overview = null;
      this.disconnectRealtime();
      this.router();
    },

    api: async (path, opts = {}) => {
      const headers = opts.headers || {};
      if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const res = await fetch(API_BASE + '/api' + path, { ...opts, headers, credentials: 'same-origin' });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.status === 401) {
        this.sessionExpired();
        throw new Error('Sessiya bitib — yenidən daxil olun');
      }
      if (!res.ok) throw new Error((data && data.error) || ('Xəta ' + res.status));
      return data;
    },

    /* ── realtime (Firebase RTDB primary, WebSocket fallback) ── */
    disconnectRealtime() {
      if (this._fbRef && this._fbOn) { try { this._fbRef.off('child_added', this._fbOn); } catch {} }
      this._fbRef = null;
      if (this.state.ws) { try { this.state.ws.close(); } catch {} }
      this.state.ws = null;
    },

    async connectRealtime() {
      this.disconnectRealtime();
      if (!this.state.authed) return;
      const cfg = window.__WPM_CONFIG__ || {};
      if (cfg.firebase && cfg.firebase.databaseURL && this._fbOk !== false) {
        const ok = await this.connectFirebase(cfg.firebase);
        if (ok) return;
      }
      await this.connectWS();
    },

    connectFirebase(cfg) {
      return new Promise((resolve) => {
        let tries = 0;
        const attempt = () => {
          tries += 1;
          const fb = window.firebase;
          if (fb && fb.initializeApp && fb.database) {
            try {
              if (!this._fbApp) this._fbApp = fb.initializeApp(cfg, 'wpm');
              const ref = fb.database(this._fbApp).ref('wpm/events').limitToLast(300);
              this._fbOn = (snap) => {
                const ev = snap.val();
                if (!ev || !ev.type) return;
                if (ev.ts && ev.ts < Date.now() - 10 * 60 * 1000) return; // ignore replays
                this.onWs({ type: ev.type, data: ev.data });
              };
              this._fbErr = () => {
                this._fbOk = false;
                this.state.wsState = 'offline';
                this.patchShell();
                this.connectWS();
              };
              ref.on('child_added', this._fbOn, this._fbErr);
              this._fbRef = ref;
              this.state.wsState = 'online';
              this.patchShell();
              resolve(true);
            } catch {
              this._fbOk = false;
              resolve(false);
            }
            return;
          }
          if (tries >= 40) { this._fbOk = false; resolve(false); }
          else setTimeout(attempt, 250);
        };
        attempt();
      });
    },

    /* ── websocket ── */
    async connectWS() {
      if (this.state.ws) { try { this.state.ws.close(); } catch {} }
      if (!this.state.authed) return;
      try {
        const t = await this.api('/wa/ws-ticket', { method: 'POST' });
        if (!t.url || !t.ticket) return;
        const wsUrl = String(t.url).replace(/\/+$/, '') + '/ws?ticket=' + encodeURIComponent(t.ticket);
        this.openWS(wsUrl);
      } catch {}
    },
    openWS(wsUrl) {
      const ws = new WebSocket(wsUrl);
      this.state.ws = ws;
      ws.onopen = () => { this.state.wsState = 'online'; this.patchShell(); };
      ws.onclose = () => {
        this.state.wsState = 'offline';
        this.state.ws = null;
        this.patchShell();
        setTimeout(() => this.connectWS(), 4000);
      };
      ws.onmessage = (ev) => {
        try { this.onWs(JSON.parse(ev.data)); } catch {}
      };
    },

    onWs(msg) {
      const { type, data } = msg;
      switch (type) {
        case 'wa:status':
          this.updateSession(data.phone, data.session);
          this.refreshOverview(true);
          break;
        case 'wa:qr':
          if (this.state.connect.tab === 'qr' && (!this.state.connect.pending || this.state.connect.pending === data.phone)) {
            this.state.connect.qr = data.qr;
          }
          if (this.state.route === 'connect') this.renderConnect();
          break;
        case 'wa:pair':
          if (this.state.connect.pending === data.phone) {
            this.state.connect.pair = data.code;
            if (this.state.route === 'connect') this.renderConnect();
          }
          break;
        case 'wa:error':
          this.toast((data && data.message) || 'WhatsApp xətası', 'err');
          break;
        case 'wa:connected':
          this.toast(`WhatsApp hesabı qoşuldu (${data.phone})`, 'ok');
          this.state.connect.qr = null;
          this.state.connect.pair = null;
          this.state.connect.pending = null;
          this.refreshOverview(true);
          if (this.state.route === 'connect') this.renderConnect();
          break;
        case 'job:new':
        case 'job:update':
          this.state.jobs[data.id] = data;
          this.patchJobViews(data);
          break;
        case 'job:done': {
          const prev = this.state.jobs[data.id];
          this.state.jobs[data.id] = data;
          this.patchJobViews(data);
          if (prev && prev.state !== data.state && ['completed', 'cancelled', 'interrupted'].includes(data.state)) {
            this.toast(
              data.state === 'completed' ? `İş tamamlandı — ${data.successCount} uğurlu` :
              data.state === 'cancelled' ? 'Göndəriş dayandırıldı' : 'Bağlantı kəsildi — iş bərpaya hazırdır',
              data.state === 'completed' ? 'ok' : 'warn'
            );
          }
          this.refreshOverview(true);
          break;
        }
        case 'stats':
          this.refreshOverview(true);
          break;
        case 'settings:changed':
          if (this.state.route === 'settings') this.loadSettings();
          break;
        case 'contacts:changed':
          this.refreshContacts();
          this.refreshOverview(true);
          break;
        case 'hello':
          this.state.wsState = 'online';
          this.patchShell();
          break;
      }
    },

    updateSession(phone, session) {
      const sessions = this.state.overview?.whatsapp?.sessions || [];
      const i = sessions.findIndex((s) => s.phone === phone);
      if (i >= 0) {
        if (session.status === 'logged_out') sessions.splice(i, 1);
        else sessions[i] = { ...sessions[i], ...session };
      } else if (session.status !== 'logged_out') {
        sessions.push(session);
      }
      if (!this.state.overview) this.state.overview = { whatsapp: { sessions: [] } };
      this.state.overview.whatsapp.sessions = sessions;
      this.state.overview.whatsapp.connected = sessions.filter((s) => s.status === 'connected').length;
      this.state.overview.whatsapp.status = this.state.overview.whatsapp.connected > 0 ? 'connected' : (sessions[0]?.status || 'disconnected');
    },

    /* ── data ── */
    async refreshOverview(silent) {
      if (!silent) this.renderLoading();
      try {
        this.state.overview = await this.api('/overview');
        if (this.state.route === 'dashboard') this.renderDashboard();
        if (this.state.route === 'connect') this.renderConnect();
        this.patchShell();
      } catch (e) {
        if (!silent) this.toast(e.message, 'err');
      }
    },

    async fetchContactsAll() {
      try {
        const res = await this.api('/contacts/all');
        this.state.contactsAll = res.items || [];
      } catch {}
    },

    async refreshContacts() {
      const c = this.state.contacts;
      try {
        const res = await this.api(`/contacts?q=${encodeURIComponent(c.q)}&waStatus=${encodeURIComponent(c.waStatus)}&page=${c.page}&pageSize=20`);
        this.state.contacts = { ...c, ...res };
        this.renderContacts();
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* ── routing (real paths: /, /connect, /contacts, /send, /history, /processes, /settings) ── */
    ROUTE_PATHS: {
      dashboard: '/', connect: '/connect', contacts: '/contacts',
      send: '/send', history: '/history', jobs: '/processes', settings: '/settings',
    },
    ROUTE_TITLES: {
      dashboard: 'Başlanğıc', connect: 'WhatsApp Qoşulma', contacts: 'Kontaktlar',
      send: 'Göndər', history: 'Tarixçə', jobs: 'Proseslər', settings: 'Parametrlər',
    },
    routeFromPath(path) {
      const p = String(path || location.pathname).replace(/\/+$/, '') || '/';
      if (p === '/') return 'dashboard';
      const key = p.replace(/^\//, '');
      return { connect: 'connect', contacts: 'contacts', send: 'send', history: 'history', processes: 'jobs', settings: 'settings' }[key] || 'dashboard';
    },
    pathFor(route) { return this.ROUTE_PATHS[route] || '/'; },
    navigateTo(path, replace) {
      const target = String(path || '/');
      if (location.pathname !== target) (replace ? history.replaceState : history.pushState).call(history, null, '', target);
      this.router();
    },
    router() {
      const raw = location.pathname.replace(/\/+$/, '') || '/';
      const route = this.routeFromPath(raw);
      if (raw !== this.pathFor(route)) history.replaceState(null, '', this.pathFor(route));
      if (!this.state.authed) {
        this.state.route = route;
        return this.renderLogin();
      }
      this.state.route = route;
      document.title = (this.ROUTE_TITLES[route] || 'Başlanğıc') + ' — WpMessenger OG';
      this.renderShell();
      const loaders = {
        dashboard: () => this.refreshOverview(),
        connect: () => this.renderConnect(),
        contacts: () => this.refreshContacts(),
        send: () => this.renderSend(),
        jobs: () => this.loadJobs(),
        history: () => this.loadHistory(),
        settings: () => this.loadSettings(),
      };
      const load = loaders[route];
      if (load) load();
    },

    /* ── shell ── */
    renderShell() {
      const wa = this.state.overview?.whatsapp || { status: 'disconnected', connected: 0, sessions: [] };
      const active = (this.state.overview?.activeCount) || 0;
      const title = { dashboard: 'Başlanğıc', connect: 'WhatsApp Qoşulma', contacts: 'Kontaktlar', send: 'Göndər', jobs: 'Proseslər', history: 'Tarixçə', settings: 'Parametrlər' }[this.state.route] || 'Başlanğıc';
      const wsDot = this.state.wsState === 'online' ? '<span class="dot ok"></span>Realtime' : '<span class="dot bad"></span>Offline';
      $('#app').innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand">
            <img class="logo" src="/icon.png" alt="WpMessenger OG" />
            <div><b>WpMessenger OG</b><small>WhatsApp Panel</small></div>
          </div>
          <nav class="nav">
            ${this.navItem('dashboard', 'dash', 'Başlanğıc')}
            ${this.navItem('connect', 'wa', 'WhatsApp Qoşul')}
            ${this.navItem('contacts', 'contacts', 'Kontaktlar')}
            ${this.navItem('send', 'send', 'Göndər')}
            ${this.navItem('history', 'history', 'Tarixçə')}
            ${this.navItem('jobs', 'jobs', 'Proseslər' + (active ? ' <span class="badge amber">' + active + '</span>' : ''))}
            ${this.navItem('settings', 'settings', 'Parametrlər')}
          </nav>
          <div class="foot">
            <div class="status-pill"><span class="dot ${wa.connected ? 'ok' : 'bad'}"></span>WhatsApp: ${esc(stateLabel[wa.status] || wa.status)}</div>
            <div class="status-pill" data-ws-pill>${wsDot}</div>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <h2>${esc(title)}</h2>
            <div class="wa-pill"><span class="dot ${wa.connected ? 'ok' : wa.status === 'connecting' || wa.status === 'reconnecting' ? 'warn' : 'bad'}"></span>${wa.connected ? 'Qoşuldu' : esc(stateLabel[wa.status] || 'Bağlantı yoxdur')}</div>
            <button class="icon-btn" data-action="theme" title="Dark/Light">${this.state.theme === 'dark' ? ICONS.sun : ICONS.moon}</button>
            <button class="icon-btn" data-action="logout" title="Çıxış">${ICONS.logout}</button>
          </header>
          <main class="content" id="view"></main>
        </div>
        <nav class="bottom-nav">
          ${this.navItem('dashboard', 'dash', 'Başlanğıc', true)}
          ${this.navItem('contacts', 'contacts', 'Kontaktlar', true)}
          ${this.navItem('send', 'send', 'Göndər', true)}
          ${this.navItem('history', 'history', 'Tarixçə', true)}
          ${this.navItem('jobs', 'jobs', 'Proseslər', true)}
        </nav>
      </div>`;
    },

    navItem(route, icon, label, mobile) {
      const active = this.state.route === route ? 'active' : '';
      return `<button class="nav-item ${active}" data-nav="${route}"><span class="ic">${ICONS[icon]}</span><span>${label}</span></button>`;
    },

    patchShell() {
      const wa = this.state.overview?.whatsapp || {};
      const pill = $('.topbar .wa-pill');
      if (pill) {
        const st = wa.status || 'disconnected';
        pill.innerHTML = `<span class="dot ${wa.connected ? 'ok' : st === 'connecting' || st === 'reconnecting' ? 'warn' : 'bad'}"></span>${wa.connected ? 'Qoşuldu' : esc(stateLabel[st] || st)}`;
      }
      const wsPill = $('[data-ws-pill]');
      if (wsPill) wsPill.innerHTML = this.state.wsState === 'online' ? '<span class="dot ok"></span>Realtime' : '<span class="dot bad"></span>Offline';
      const actives = $$('.nav-item[data-nav="jobs"]');
      const active = this.state.overview?.activeCount || 0;
      for (const el of actives) {
        const label = el.querySelector('span:last-child');
        if (label) label.innerHTML = active ? 'Proseslər <span class="badge amber">' + active + '</span>' : 'Proseslər';
      }
    },

    /* ── login ── */
    renderLogin() {
      $('#app').innerHTML = `
      <div class="login-wrap">
        <form class="login-card" data-form="login">
          <div class="login-logo"><img src="/icon.png" alt="WpMessenger OG" /></div>
          <h1>WpMessenger OG</h1>
          <p class="sub">WhatsApp Web Management Panel</p>
          <div class="field"><label>Şifrə</label><input class="input" type="password" name="password" autocomplete="current-password" placeholder="••••••••" required /></div>
          <button class="btn btn-primary btn-block btn-xl" type="submit">Daxil ol</button>
          <p class="muted" style="margin-top:14px;text-align:center">Şifrə gizlidir — yalnız səlahiyyətli istifadəçilər bilir</p>
        </form>
      </div>`;
      setTimeout(() => { const i = $('.login-card input[name="password"]'); if (i) i.focus(); }, 50);
    },

    /* ── dashboard ── */
    renderDashboard() {
      const ov = this.state.overview;
      if (!ov) { this.renderLoading(); return; }
      const wa = ov.whatsapp || {};
      const st = wa.status || 'disconnected';
      const sessionsHtml = (wa.sessions || []).map((s) =>
        `<div class="job-row"><div class="head"><b>${esc(s.name || s.phone)}</b><span class="badge ${stateBadge(s.status)}">${esc(stateLabel[s.status] || s.status)}</span><span class="mono muted">${esc(s.phone)}</span></div>` +
        `<div class="meta"><span>${s.status === 'connected' ? 'Bağlı' : ''}</span></div></div>`
      ).join('') || '<div class="empty">Heç bir WhatsApp hesabı qoşulmayıb</div>';
      const activeJobs = (ov.activeJobs || []).slice(0, 5).map((j) => this.jobCard(j)).join('') || '<div class="empty">Aktiv proses yoxdur</div>';

      $('#view').innerHTML = `
      <div class="grid grid-4">
        <div class="stat green"><div class="ic">${ICONS.wa}</div><div><div class="val">${wa.connected ? 'Qoşuldu' : esc(stateLabel[st] || st)}</div><div class="lbl">WhatsApp Status</div></div></div>
        <div class="stat blue"><div class="ic">${ICONS.contacts}</div><div><div class="val">${ov.contactsCount}</div><div class="lbl">Kontaktlar</div></div></div>
        <div class="stat amber"><div class="ic">${ICONS.send}</div><div><div class="val">${ov.today.recipients}</div><div class="lbl">Bu gün göndərilən</div></div></div>
        <div class="stat"><div class="ic">${ICONS.check}</div><div><div class="val">${ov.today.success}</div><div class="lbl">Uğurlu</div></div></div>
        <div class="stat red"><div class="ic">${ICONS.x}</div><div><div class="val">${ov.today.fail}</div><div class="lbl">Xəta</div></div></div>
        <div class="stat"><div class="ic">${ICONS.clock}</div><div><div class="val">${ov.today.jobs}</div><div class="lbl">Bugünkü göndərişlər</div></div></div>
      </div>

      <div class="card">
        <h3>${ICONS.wa} WhatsApp hesabları</h3>
        ${sessionsHtml}
        <div style="margin-top:14px"><button class="btn btn-primary" data-action="goto" data-href="/connect">${ICONS.wa} WhatsApp-a qoşul</button></div>
      </div>

      <div class="card">
        <h3>${ICONS.send} Əsas düymələr</h3>
        <div class="quick-actions">
          <button class="btn btn-primary" data-action="goto" data-href="/connect">${ICONS.wa} WhatsApp-a qoşul</button>
          <button class="btn" data-action="goto" data-href="/contacts">${ICONS.contacts} Kontaktlar</button>
          <button class="btn" data-action="open-add-contact">${ICONS.plus} Kontakt əlavə et</button>
          <button class="btn" data-action="goto" data-href="/send">${ICONS.send} Mesaj göndər</button>
          <button class="btn btn-ghost" data-action="goto" data-href="/history">${ICONS.history} Tarixçə</button>
        </div>
      </div>

      <div class="card">
        <div class="section-head"><h3 style="margin:0">${ICONS.jobs} Aktiv proseslər</h3><a href="/processes" data-action="goto" data-href="/processes">Hamısı ${ICONS.forward}</a></div>
        ${activeJobs}
      </div>`;
    },

    /* ── connect ── */
    renderConnect() {
      const sessions = this.state.overview?.whatsapp?.sessions || [];
      const conn = sessions.filter((s) => s.status === 'connected');
      const pend = this.state.connect.pending;
      let body = '';
      if (conn.length) {
        body = conn.map((s) => `
          <div class="job-row">
            <div class="head"><b>${esc(s.name || s.phone)}</b><span class="badge green">${esc(stateLabel.connected)}</span><span class="mono muted">${esc(s.phone)}</span></div>
            <div class="meta"><span>Qoşulma vaxtı: ${fmtDate(s.connectedAt)}</span></div>
            <div style="margin-top:10px"><button class="btn btn-danger btn-sm" data-action="wa-disconnect" data-phone="${esc(s.phone)}">${ICONS.logout} Çıxış et</button></div>
          </div>`).join('');
      } else {
        body = `<div class="card">
          <div class="tabs">
            <button class="tab ${this.state.connect.tab === 'qr' ? 'active' : ''}" data-action="conn-tab" data-tab="qr">QR Code</button>
            <button class="tab ${this.state.connect.tab === 'pair' ? 'active' : ''}" data-action="conn-tab" data-tab="pair">Pair Code</button>
          </div>
          ${this.state.connect.tab === 'qr' ? `
            <div class="qr-box">
              ${pend ? `<div class="spinner"></div><p class="hint">QR gözlənilir... Əgər gəlmirsə, səhifəni yeniləyin</p>` : `<button class="btn btn-primary btn-xl" data-action="wa-qr">${ICONS.wa} QR Code yarat</button><p class="hint">WhatsApp → Connected Devices → Link a Device → Scan</p>`}
              ${this.state.connect.qr ? `<div style="margin-top:18px"><img src="${this.state.connect.qr}" alt="WhatsApp QR" /><p class="hint">QR kodu WhatsApp ilə skan edin — qoşulma avtomatik təsdiqlənəcək</p></div>` : ''}
            </div>` : `
            <div>
              <div class="field"><label>Telefon nömrəsi (WhatsApp hesabı)</label><input class="input" id="pair-phone" placeholder="0501234567 / +994501234567 / +447911123456" /></div>
              ${this.state.connect.pair ? `
                <div class="pair-code">${esc(this.state.connect.pair)}</div>
                <p class="hint" style="text-align:center;margin-top:10px">WhatsApp → Linked Devices → Link with phone number → kodu daxil edin</p>
                <div style="text-align:center;margin-top:12px"><button class="btn btn-ghost btn-sm" data-action="copy-pair">${ICONS.copy} Kodu kopyala</button></div>` :
                pend ? `<div class="spinner"></div><p class="hint" style="text-align:center">Pair Code gözlənilir...</p>` :
                `<button class="btn btn-primary btn-xl btn-block" data-action="wa-pair">${ICONS.wa} Pair Code al</button>`}
            </div>`}
        </div>`;
      }
      $('#view').innerHTML = `
        <div class="card">
          <h3>${ICONS.wa} WhatsApp-a qoşul</h3>
          <p class="muted" style="margin-bottom:14px">Session avtomatik saxlanılır — server yenidən başlasa belə yenidən qoşulmaq lazım deyil.</p>
          ${body}
        </div>
        <div class="card"><h3>${ICONS.info} Bütün sessiyalar</h3>${sessions.map((s) => `<div class="job-row"><div class="head"><span class="badge ${stateBadge(s.status)}">${esc(stateLabel[s.status] || s.status)}</span><b>${esc(s.name || s.phone)}</b><span class="mono muted">${esc(s.phone)}</span></div></div>`).join('') || '<div class="empty">Sessiya yoxdur</div>'}</div>`;
    },

    /* ── contacts ── */
    renderContacts() {
      const c = this.state.contacts;
      const rows = c.items.map((ct) => `
        <tr>
          <td><b>${esc(ct.name)}</b></td>
          <td class="mono">${esc(ct.phone)}</td>
          <td><span class="badge ${stateBadge(ct.whatsappStatus)}">${esc(stateLabel[ct.whatsappStatus] || ct.whatsappStatus)}</span></td>
          <td><div class="actions">
            <button class="btn btn-ghost btn-sm" data-action="edit-contact" data-id="${ct.id}">${ICONS.edit} Düzəliş</button>
            <button class="btn btn-danger btn-sm" data-action="del-contact" data-id="${ct.id}" data-name="${esc(ct.name)}">${ICONS.trash} Sil</button>
            <button class="btn btn-sm" data-action="send-contact" data-id="${ct.id}">${ICONS.send} Mesaj</button>
          </div></td>
        </tr>`).join('') || `<tr><td colspan="4"><div class="empty">Kontakt tapılmadı</div></td></tr>`;

      $('#view').innerHTML = `
      <div class="section-head">
        <div class="filters">
          <input class="input" id="contact-q" placeholder="Ad və ya nömrə ilə axtar..." value="${esc(c.q)}" />
          <select class="select" id="contact-wa">
            <option value="all" ${c.waStatus === 'all' ? 'selected' : ''}>Bütün statuslar</option>
            <option value="yes" ${c.waStatus === 'yes' ? 'selected' : ''}>WhatsApp-da</option>
            <option value="no" ${c.waStatus === 'no' ? 'selected' : ''}>WhatsApp-da deyil</option>
            <option value="unknown" ${c.waStatus === 'unknown' ? 'selected' : ''}>Bilinmir</option>
          </select>
          <button class="btn btn-ghost" data-action="contacts-search">${ICONS.search} Axtar</button>
        </div>
        <button class="btn btn-primary" data-action="open-add-contact">${ICONS.plus} Kontakt əlavə et</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ad</th><th>Nömrə</th><th>WhatsApp</th><th>Əməliyyat</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="pager">
        <button class="btn btn-ghost btn-sm" data-action="contacts-page" data-page="${c.page - 1}" ${c.page <= 1 ? 'disabled' : ''}>${ICONS.back} Əvvəl</button>
        <span>${c.page} / ${c.pages} (${c.total} kontakt)</span>
        <button class="btn btn-ghost btn-sm" data-action="contacts-page" data-page="${c.page + 1}" ${c.page >= c.pages ? 'disabled' : ''}>Sonrakı ${ICONS.forward}</button>
      </div>`;
    },

    openContactModal(contact) {
      contact = contact || {};
      this.state.modal = { kind: 'contact', contact };
      $('#app').insertAdjacentHTML('beforeend', `
      <div class="modal-back" data-action="close-modal">
        <div class="modal" data-stop="1">
          <h3>${contact.id ? ICONS.edit + ' Kontaktı düzəliş et' : ICONS.plus + ' Kontakt əlavə et'}</h3>
          <form data-form="contact-save">
            <input type="hidden" name="id" value="${contact.id || ''}" />
            <div class="field"><label>Ad</label><input class="input" name="name" required maxlength="80" value="${esc(contact.name || '')}" /></div>
            <div class="field"><label>Telefon</label><input class="input" name="phone" required placeholder="0503482680 / +994503482680" value="${esc(contact.normalizedPhone || contact.phone || '')}" /></div>
            <div class="row">
              <button type="button" class="btn btn-ghost" data-action="close-modal">İmtina</button>
              <button type="submit" class="btn btn-primary">${ICONS.check} Yadda saxla</button>
            </div>
          </form>
        </div>
      </div>`);
      const inp = $('.modal input[name="name"]');
      if (inp) setTimeout(() => inp.focus(), 50);
    },

    confirmModal(title, text, action, params) {
      this.state.modal = { kind: 'confirm', action, params };
      $('#app').insertAdjacentHTML('beforeend', `
      <div class="modal-back" data-action="close-modal">
        <div class="modal" data-stop="1">
          <h3>${esc(title)}</h3>
          <p class="muted">${esc(text)}</p>
          <div class="row">
            <button class="btn btn-ghost" data-action="close-modal">İmtina</button>
            <button class="btn btn-danger" data-action="confirm-yes">${ICONS.check} Bəli</button>
          </div>
        </div>
      </div>`);
    },

    /* ── send ── */
    renderSend() {
      const s = this.state.send;
      if (s.step === 2) return this.renderSendPreview();
      if (s.step === 3) return this.renderSendProgress();
      const c = this.state.contactsAll;
      const contactRows = c.map((ct) => `
        <label><input type="checkbox" value="${ct.id}" ${s.contactIds.includes(ct.id) ? 'checked' : ''} />
          <span><b>${esc(ct.name)}</b> <span class="mono muted">${esc(ct.phone)}</span></span>
        </label>`).join('') || '<div class="empty">Kontakt yoxdur</div>';
      const selectedCount = s.mode === 'all' ? c.length : s.mode === 'contacts' ? s.contactIds.length : s.mode === 'single' ? (s.phone.trim() ? 1 : 0) : (s.numbers.match(/\d/g) ? s.numbers.split(/[\n,;]+/).filter((x) => x.trim() && /\d/.test(x)).length : 0);

      $('#view').innerHTML = `
      <div class="card">
        <div class="step-title"><span class="badge green">1</span> Alıcı seçimi <span class="muted">(${selectedCount} seçilib)</span></div>
        <div class="radio-cards">
          ${this.radioCard('single', ICONS.phone, 'Bir nömrə', 'Birbaşa nömrə daxil edin', s)}
          ${this.radioCard('list', ICONS.list, 'Bir neçə nömrə', 'Siyahı şəklində', s)}
          ${this.radioCard('contacts', ICONS.contacts, 'Kontaktlardan seç', 'Bazadan seçim', s)}
          ${this.radioCard('all', ICONS.globe, 'Bütün kontaktlar', `Hamısı (${c.length})`, s)}
        </div>

        <div class="field hidden" id="f-single"><label>Telefon nömrəsi</label><input class="input" id="send-phone" placeholder="0501234567 / +447911123456" value="${esc(s.phone)}" /></div>

        <div class="field hidden" id="f-list"><label>Nömrələr (hər sətirə bir — vergül/boşluq da olar)</label><textarea class="textarea" id="send-numbers" placeholder="0503482690
0503482691
0503482692">${esc(s.numbers)}</textarea></div>

        <div class="field hidden" id="f-contacts">
          <label>Kontakt seçin <span class="muted">(${s.contactIds.length} seçilib)</span></label>
          <div class="recipient-list" id="contact-list">${contactRows}</div>
        </div>

        <div class="divider"></div>

        <div class="step-title"><span class="badge green">2</span> Mesaj</div>
        <div class="field"><label>Mesaj mətni</label><textarea class="textarea" id="send-text" style="min-height:120px" placeholder="Mesajınızı yazın...">${esc(s.text)}</textarea></div>

        <div class="field">
          <label>Media (istəyə bağlı) — şəkil / video / audio / sənəd / PDF / fayl</label>
          <div class="drop-zone" id="drop-zone">${ICONS.plus} Fayl seçin və ya bura atın<br /><small class="muted">64 MB-a qədər</small></div>
          <input type="file" id="send-file" class="hidden" />
          <div id="file-chip"></div>
        </div>
        <div class="field hidden" id="f-caption"><label>Caption (media ilə birlikdə)</label><input class="input" id="send-caption" value="${esc(s.caption)}" /></div>

        <div class="steps" style="margin-top:20px">
          <button class="btn btn-primary btn-xl" data-action="send-preview">${ICONS.go} Preview</button>
        </div>
      </div>`;
      this.syncSendInputs();
    },

    radioCard(mode, ic, label, sub, s) {
      return `<div class="radio-card ${s.mode === mode ? 'selected' : ''}" data-action="send-mode" data-mode="${mode}"><div class="radio-ic">${ic}</div>${label}<small>${esc(sub)}</small></div>`;
    },

    syncSendInputs() {
      const s = this.state.send;
      $('#f-single').classList.toggle('hidden', s.mode !== 'single');
      $('#f-list').classList.toggle('hidden', s.mode !== 'list');
      $('#f-contacts').classList.toggle('hidden', s.mode !== 'contacts');
      if (s.mode === 'contacts') {
        const list = $('#contact-list');
        if (list) list.addEventListener('change', (e) => {
          if (e.target.matches('input[type="checkbox"]')) {
            const id = Number(e.target.value);
            const set = new Set(s.contactIds);
            if (e.target.checked) set.add(id); else set.delete(id);
            s.contactIds = Array.from(set);
            this.renderSend();
          }
        });
      }
    },

    async computeRecipients() {
      const s = this.state.send;
      let phones = [];
      let errors = [];
      if (s.mode === 'single') {
        const v = $('#send-phone')?.value || '';
        if (v.trim()) phones = [{ phone: v.trim() }];
      } else if (s.mode === 'list') {
        const nums = ($('#send-numbers')?.value || '').split(/[\n,;]+/).map((x) => x.trim()).filter((x) => x);
        phones = nums.map((n) => ({ phone: n }));
      } else if (s.mode === 'contacts') {
        phones = this.state.contactsAll.filter((c) => s.contactIds.includes(c.id)).map((c) => ({ phone: c.normalizedPhone, name: c.name }));
      } else if (s.mode === 'all') {
        phones = this.state.contactsAll.map((c) => ({ phone: c.normalizedPhone, name: c.name }));
      }
      // dedupe
      const seen = new Set();
      phones = phones.filter((p) => { const k = p.phone.replace(/\D/g, ''); if (!k || seen.has(k)) return false; seen.add(k); return true; });
      return { phones, errors };
    },

    renderSendPreview() {
      const s = this.state.send;
      const recs = s.previewPhones || [];
      const fileHtml = s.file ? `<div class="file-chip">${ICONS.paperclip} <b>${esc(s.file.name)}</b> <span class="muted">(${(s.file.size / 1024).toFixed(0)} KB)</span></div>` : '';
      const msgHtml = s.file ? fileHtml : `<div class="msg">${esc(s.text)}</div>`;
      $('#view').innerHTML = `
      <div class="card">
        <div class="step-title">${ICONS.send} Mesaj göndərilməyə hazırdır</div>
        <div class="preview-box">
          <div><b>Alıcılar: ${recs.length}</b></div>
          <div class="recs">${recs.map((r) => `<div>${esc(r.name || '')} ${esc(r.phone)}</div>`).join('')}</div>
          ${msgHtml}
          ${s.caption ? `<div class="msg muted">Caption: ${esc(s.caption)}</div>` : ''}
        </div>
        <div class="steps">
          <button class="btn btn-ghost" data-action="send-back">${ICONS.back} Geri</button>
          <button class="btn btn-primary btn-xl" data-action="send-go">${ICONS.go} MESAJI GÖNDƏR</button>
        </div>
      </div>`;
    },

    renderSendProgress() {
      const job = this.state.jobs[this.state.send.jobId];
      if (!job) { this.renderLoading(); return; }
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      const done = job.state === 'completed' || job.state === 'cancelled' || job.state === 'interrupted';
      const wait = job.total - job.done;
      $('#view').innerHTML = `
      <div class="card">
        <div class="step-title">${ICONS.send} Göndərilir... <span class="badge ${stateBadge(job.state)}">${esc(stateLabel[job.state] || job.state)}</span></div>
        <div style="font-size:22px;font-weight:800;margin-bottom:10px">${job.done} / ${job.total}</div>
        <div class="progress"><span style="width:${done ? 100 : pct}%"></span></div>
        <div class="counts">
          <span class="ok">Uğurlu: ${job.successCount}</span>
          <span class="bad">Xəta: ${job.failCount}</span>
          <span class="skp">Atlanılan: ${job.skipCount}</span>
          <span class="muted">Gözləyir: ${wait}</span>
        </div>
        ${!done ? `<div style="margin-top:18px"><button class="btn btn-danger btn-xl btn-block" data-action="job-cancel" data-id="${job.id}">${ICONS.stop} Göndərişi dayandır</button></div>`
        : `<div style="margin-top:18px" class="steps">
            ${job.failCount > 0 && job.state === 'completed' ? `<button class="btn" data-action="job-retry" data-id="${job.id}">${ICONS.retry} Uğursuzları təkrar göndər</button>` : ''}
            <button class="btn btn-ghost" data-action="goto" data-href="/history">${ICONS.history} Tarixçə</button>
            <button class="btn btn-primary" data-action="goto" data-href="/send">${ICONS.send} Yeni mesaj</button>
          </div>`}
      </div>`;
    },

    async sendGo() {
      const s = this.state.send;
      const btn = $('[data-action="send-go"]');
      if (btn) setLoading(btn, true);
      try {
        const fd = new FormData();
        fd.append('recipientsMode', s.mode);
        if (s.mode === 'single') fd.append('phone', s.phone);
        if (s.mode === 'list') fd.append('numbers', s.numbers);
        if (s.mode === 'contacts') fd.append('contactIds', JSON.stringify(s.contactIds));
        fd.append('text', s.text);
        if (s.caption) fd.append('caption', s.caption);
        if (s.file) {
          fd.append('file', s.file);
          if (s.messageType) fd.append('messageType', s.messageType);
        }
        const res = await this.api('/messages/send', { method: 'POST', body: fd });
        s.jobId = res.job.id;
        this.state.jobs[res.job.id] = res.job;
        s.step = 3;
        this.renderSend();
      } catch (e) {
        this.toast(e.message, 'err');
      } finally {
        if (btn) setLoading(btn, false);
      }
    },

    /* ── jobs ── */
    async loadJobs() {
      try {
        const res = await this.api('/jobs?state=active');
        for (const j of res.items) this.state.jobs[j.id] = j;
        this.renderJobs();
      } catch (e) { this.toast(e.message, 'err'); }
    },

    renderJobs() {
      const jobs = Object.values(this.state.jobs).filter((j) => ['running', 'interrupted'].includes(j.state));
      const html = jobs.length ? jobs.map((j) => this.jobCard(j, true)).join('') : '<div class="empty">Aktiv proses yoxdur</div>';
      $('#view').innerHTML = `
      <div class="section-head">
        <h3 style="margin:0">${ICONS.jobs} Aktiv göndərişlər (${jobs.length})</h3>
        ${jobs.length ? `<button class="btn btn-danger" data-action="jobs-cancel-all">${ICONS.stop} Hamısını dayandır</button>` : ''}
      </div>
      ${html}`;
    },

    jobCard(j, withActions) {
      const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
      const done = ['completed', 'cancelled', 'interrupted'].includes(j.state);
      const msgPreview = j.payload?.text ? (j.payload.text.length > 140 ? j.payload.text.slice(0, 140) + '…' : j.payload.text) : (j.payload?.fileName ? 'Fayl: ' + j.payload.fileName : (j.payload?.caption || 'Media mesajı'));
      const typeLabel = { text: 'Mətn', image: 'Şəkil', video: 'Video', audio: 'Audio', voice: 'Səs', document: 'Sənəd', sticker: 'Stiker', gif: 'GIF', contact: 'Kontakt', location: 'Məkan' }[j.type] || j.type;
      return `
      <div class="job-row">
        <div class="head">
          <span class="badge ${stateBadge(j.state)}">${esc(stateLabel[j.state] || j.state)}</span>
          <b>#${j.id.slice(0, 8)}</b>
          <span class="muted">${typeLabel}</span>
          <span class="muted">${fmtDate(j.createdAt)}</span>
          ${withActions && !done ? `<button class="btn btn-danger btn-sm" style="margin-left:auto" data-action="job-cancel" data-id="${j.id}">${ICONS.stop} Dayandır</button>` : ''}
        </div>
        <div class="progress ${done ? '' : ''}"><span style="width:${done ? 100 : pct}%"></span></div>
        <div class="counts">
          <span class="muted">${j.done}/${j.total}</span>
          <span class="ok">${j.successCount}</span>
          <span class="bad">${j.failCount}</span>
          <span class="skp">${j.skipCount}</span>
        </div>
        <div class="msg-preview">${esc(msgPreview)}</div>
        <div class="meta">
          <span>Müddət: ${fmtDur(j.startedAt, j.finishedAt || j.updatedAt)}</span>
          <a href="/history" data-action="goto" data-href="/history">Tarixçə ${ICONS.forward}</a>
        </div>
      </div>`;
    },

    /* ── history ── */
    async loadHistory() {
      const h = this.state.history;
      try {
        const res = await this.api(`/history?state=${encodeURIComponent(h.state)}&page=${h.page}&pageSize=15`);
        this.state.history = { ...h, ...res };
        this.renderHistory();
      } catch (e) { this.toast(e.message, 'err'); }
    },

    renderHistory() {
      const h = this.state.history;
      const sel = h.selectedIds;
      const allSelected = h.items.length > 0 && h.items.every((j) => sel.has(j.id));
      const rows = h.items.map((j) => {
        const typeLabel = { text: 'Mətn', image: 'Şəkil', video: 'Video', audio: 'Audio', voice: 'Səs', document: 'Sənəd', sticker: 'Stiker', gif: 'GIF' }[j.type] || 'Mesaj';
        const msgPreview = j.payload?.text ? (j.payload.text.length > 60 ? j.payload.text.slice(0, 60) + '…' : j.payload.text) : (j.payload?.fileName || 'Media');
        const checked = sel.has(j.id) ? 'checked' : '';
        return `<tr class="${sel.has(j.id) ? 'row-sel' : ''}">
          <td><input type="checkbox" class="hist-cb" data-id="${j.id}" ${checked} style="width:16px;height:16px;accent-color:var(--accent)" /></td>
          <td>${fmtDate(j.createdAt)}</td>
          <td>${typeLabel} ${esc(j.total)}</td>
          <td><span class="ok">${j.successCount}</span></td>
          <td><span class="bad">${j.failCount}</span></td>
          <td><span class="skp">${j.skipCount}</span></td>
          <td><span class="badge ${stateBadge(j.state)}">${esc(stateLabel[j.state] || j.state)}</span></td>
          <td class="mono" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(msgPreview)}</td>
          <td>
            <button class="btn btn-ghost btn-sm" data-action="job-detail" data-id="${j.id}">${ICONS.info} Ətraflı</button>
            <button class="btn btn-danger btn-sm" data-action="hist-delete-single" data-id="${j.id}" title="Sil">${ICONS.trash}</button>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="9"><div class="empty">Tarixçə boşdur</div></td></tr>';

      const delBtnHtml = sel.size > 0 ? `<button class="btn btn-danger btn-sm" data-action="hist-delete-selected">${ICONS.trash} Seçilənləri sil (${sel.size})</button>` : '';

      $('#view').innerHTML = `
      <div class="section-head">
        <div class="filters">
          <select class="select" id="hist-state">
            <option value="all" ${h.state === 'all' ? 'selected' : ''}>Bütün göndərişlər</option>
            <option value="completed" ${h.state === 'completed' ? 'selected' : ''}>Tamamlanan</option>
            <option value="cancelled" ${h.state === 'cancelled' ? 'selected' : ''}>Dayandırılan</option>
            <option value="interrupted" ${h.state === 'interrupted' ? 'selected' : ''}>Kəsilən</option>
          </select>
          <button class="btn btn-ghost" data-action="history-filter">${ICONS.refresh} Tətbiq et</button>
          ${delBtnHtml}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th style="width:36px"><input type="checkbox" id="hist-check-all" ${allSelected ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)" /></th><th>Tarix</th><th>Alıcı</th><th>Uğurlu</th><th>Xəta</th><th>Atlanılan</th><th>Status</th><th>Mesaj</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="pager">
        <button class="btn btn-ghost btn-sm" data-action="history-page" data-page="${h.page - 1}" ${h.page <= 1 ? 'disabled' : ''}>${ICONS.back} Əvvəl</button>
        <span>${h.page} / ${h.pages} (${h.total})</span>
        <button class="btn btn-ghost btn-sm" data-action="history-page" data-page="${h.page + 1}" ${h.page >= h.pages ? 'disabled' : ''}>Sonrakı ${ICONS.forward}</button>
      </div>`;
    },

    async jobDetail(id) {
      try {
        const job = await this.api('/jobs/' + id);
        this.state.modal = { kind: 'jobdetail', job };
        const sent = job.targets.filter((t) => t.status === 'sent');
        const failed = job.targets.filter((t) => t.status === 'failed');
        const skipped = job.targets.filter((t) => t.status === 'skipped');
        const list = (arr, label) => arr.length ? `<div style="margin-top:10px"><b>${label} (${arr.length})</b><div class="recipient-list">${arr.map((t) => `<div style="padding:6px 10px;font-size:13px"><b>${esc(t.name || t.phone)}</b> ${t.error ? `<span class="bad">— ${esc(t.error)}</span>` : ''}</div>`).join('')}</div></div>` : '';
        $('#app').insertAdjacentHTML('beforeend', `
        <div class="modal-back" data-action="close-modal">
          <div class="modal" data-stop="1">
            <h3>${ICONS.send} İş #${job.id.slice(0, 8)}</h3>
            <div class="counts">
              <span class="ok">${job.successCount}</span><span class="bad">${job.failCount}</span><span class="skp">${job.skipCount}</span>
            </div>
            <div class="preview-box" style="margin-top:12px">
              <div class="muted">${fmtDate(job.createdAt)} • ${job.total} alıcı</div>
              <div class="msg">${esc(job.payload?.text || job.payload?.fileName || job.payload?.caption || '')}</div>
            </div>
            ${list(failed, 'Xəta olanlar')}
            ${list(sent, 'Göndərilənlər')}
            ${list(skipped, 'Atlanılanlar')}
            <div class="row">
              ${job.failCount > 0 && job.state === 'completed' ? `<button class="btn" data-action="job-retry" data-id="${job.id}">${ICONS.retry} Uğursuzları təkrar</button>` : ''}
              <button class="btn btn-ghost" data-action="close-modal">Bağla</button>
            </div>
          </div>
        </div>`);
      } catch (e) { this.toast(e.message, 'err'); }
    },

    /* ── settings ── */
    async loadSettings() {
      try {
        this.state.settings = await this.api('/settings');
        this.renderSettings();
      } catch (e) { this.toast(e.message, 'err'); }
    },

    renderSettings() {
      const st = this.state.settings;
      if (!st) { this.renderLoading(); return; }
      const ef = st.effective;
      $('#view').innerHTML = `
      <div class="card">
        <h3>${ICONS.settings} Göndərmə parametrləri</h3>
        <form data-form="settings-save">
          <div class="grid grid-2">
            <div class="field"><label>Göndərmələr arası min gecikmə (ms)</label><input class="input" type="number" name="broadcastDelayMinMs" value="${ef.delayMinMs}" min="0" max="600000" /></div>
            <div class="field"><label>Göndərmələr arası max gecikmə (ms)</label><input class="input" type="number" name="broadcastDelayMaxMs" value="${ef.delayMaxMs}" min="0" max="600000" /></div>
            <div class="field"><label>Maksimum retry sayı</label><input class="input" type="number" name="broadcastMaxRetries" value="${ef.maxRetries}" min="0" max="20" /></div>
            <div class="field"><label>Duplicate qoruyucu TTL (dəqiqə)</label><input class="input" type="number" name="duplicateSendTtlMin" value="${ef.duplicateTtlMin}" min="0" max="1440" /></div>
            <div class="field"><label>Maksimum alıcı sayı</label><input class="input" type="number" name="maxRecipients" value="${ef.maxRecipients}" min="1" max="100000" /></div>
            <div class="field"><label>Maksimum mesaj uzunluğu (simvol)</label><input class="input" type="number" name="maxMessageLength" value="${ef.maxMessageLength}" min="1" max="1000000" /></div>
            <label class="field"><input type="checkbox" name="waPresenceCheck" ${ef.waPresenceCheck ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent);vertical-align:-3px;margin-right:8px" />WhatsApp qeydiyyat yoxlaması</label>
            <label class="field"><input type="checkbox" name="waSkipUnregistered" ${ef.waSkipUnregistered ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent);vertical-align:-3px;margin-right:8px" />Qeydiyyatsız nömrələri atla</label>
          </div>
          <button class="btn btn-primary" type="submit">${ICONS.check} Saxla</button>
        </form>
      </div>
      <div class="card">
        <h3>${ICONS.settings} Təhlükəsizlik — giriş məlumatları</h3>
        <form data-form="security-save">
          <div class="grid grid-2">
            <div class="field"><label>Cari şifrə</label><input class="input" type="password" name="currentPassword" autocomplete="current-password" required /></div>
            <div class="field"><label>Yeni şifrə</label><input class="input" type="password" name="newPassword" minlength="6" autocomplete="new-password" required /></div>
            <div class="field"><label>Yeni şifrə (təkrar)</label><input class="input" type="password" name="newPassword2" minlength="6" autocomplete="new-password" required /></div>
          </div>
          <p class="muted" style="margin-top:-6px;margin-bottom:12px">Şifrə dəyişdirildikdə bütün aktiv sessiyalar bağlanır və yenidən giriş tələb olunur.</p>
          <button class="btn btn-primary" type="submit">${ICONS.check} Yadda saxla</button>
        </form>
      </div>
      <div class="card">
        <h3>${ICONS.info} Sistem</h3>
        <div class="meta" style="display:flex;flex-direction:column;gap:6px;font-size:13.5px">
          <span>Versiya: <b>v${esc(st.version)}</b></span>
          <span>API_URL: <span class="mono">${esc(st.env.apiUrl || '—')}</span></span>
          <span>WS_URL: <span class="mono">${esc(st.env.wsUrl || '—')}</span></span>
          <span>Storage: <span class="mono">${esc(st.env.storage || '—')}</span></span>
          <span>Firebase DB: <span class="mono">${esc(st.env.firebaseDb || '—')}</span></span>
        </div>
      </div>`;
    },

    /* ── shared ── */
    renderLoading() {
      $('#view').innerHTML = '<div class="spinner"></div>';
    },

    toast(msg, kind) {
      const root = $('#toast-root');
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.textContent = msg;
      root.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 4200);
    },

    /* ── global events ── */
    bind() {
      document.addEventListener('click', async (e) => {
        const a = e.target.closest('a[href]');
        if (a && !a.closest('[data-action]') && a.target !== '_blank' && !a.hasAttribute('download') && !a.hasAttribute('data-href')) {
          const href = a.getAttribute('href');
          const internal = href && (href === '/' || Object.values(this.ROUTE_PATHS).includes(href));
          if (internal) { e.preventDefault(); this.navigateTo(href); return; }
        }
        const backdrop = e.target.closest('.modal-back');
        if (backdrop && !e.target.closest('.modal')) {
          this.closeModal();
          return;
        }
        const el = e.target.closest('[data-action], [data-nav]');
        if (!el) return;
        const action = el.dataset.action || el.dataset.nav;
        if (action) e.preventDefault();
        try { await this.handleAction(action, el, e); } catch (err) { console.error(err); }
      });

      document.addEventListener('submit', async (e) => {
        const form = e.target.closest('[data-form]');
        if (!form) return;
        e.preventDefault();
        try { await this.handleForm(form.dataset.form, form); } catch (err) { this.toast(err.message, 'err'); }
      });

      document.addEventListener('change', (e) => {
        const zone = e.target.closest('#send-file');
        if (zone) this.handleFileSelect(zone);
      });

      document.addEventListener('dragover', (e) => {
        const z = e.target.closest('#drop-zone');
        if (z) { e.preventDefault(); z.classList.add('drag'); }
      });
      document.addEventListener('dragleave', (e) => {
        const z = e.target.closest('#drop-zone');
        if (z) z.classList.remove('drag');
      });
      document.addEventListener('drop', (e) => {
        const z = e.target.closest('#drop-zone');
        if (z && e.dataTransfer.files.length) {
          e.preventDefault();
          this.state.send.file = e.dataTransfer.files[0];
          this.updateFileChip();
        }
      });

      document.addEventListener('input', (e) => {
        const id = e.target.id;
        const s = this.state.send;
        if (id === 'send-phone') s.phone = e.target.value;
        else if (id === 'send-numbers') s.numbers = e.target.value;
        else if (id === 'send-text') s.text = e.target.value;
        else if (id === 'send-caption') s.caption = e.target.value;
      });
    },

    updateFileChip() {
      const chip = $('#file-chip');
      const f = this.state.send.file;
      if (!chip) return;
      chip.innerHTML = f ? `<div class="file-chip">${ICONS.paperclip} <b>${esc(f.name)}</b> <span class="muted">(${(f.size / 1024).toFixed(0)} KB)</span> <button class="btn btn-ghost btn-sm" data-action="file-clear" style="margin-left:auto">${ICONS.x}</button></div>` : '';
      $('#f-caption').classList.toggle('hidden', !f);
      if (f) {
        const mt = f.type || '';
        this.state.send.messageType = mt.startsWith('image/') ? 'image' : mt.startsWith('video/') ? 'video' : mt.startsWith('audio/') ? (mt.includes('ogg') ? 'voice' : 'audio') : 'document';
      }
    },

    handleFileSelect(input) {
      if (input.files.length) {
        this.state.send.file = input.files[0];
        this.updateFileChip();
      }
    },

    async handleAction(action, el) {
      switch (action) {
        case 'nav': this.navigateTo(this.pathFor(el.dataset.nav)); break;
        case 'goto': this.navigateTo(el.dataset.href); break;
        case 'logout':
          try { await this.api('/auth/logout', { method: 'POST' }); } catch {}
          this.state.authed = false;
          this.state.user = null;
          this.disconnectRealtime();
          this.router();
          break;
        case 'theme':
          this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', this.state.theme);
          localStorage.setItem('wpm_theme', this.state.theme);
          const tb = $('.topbar .icon-btn[data-action="theme"]');
          if (tb) tb.innerHTML = this.state.theme === 'dark' ? ICONS.sun : ICONS.moon;
          break;
        case 'conn-tab': this.state.connect.tab = el.dataset.tab; this.renderConnect(); break;
        case 'wa-qr':
          this.state.connect.pending = 'main';
          this.state.connect.qr = null;
          this.renderConnect();
          try {
            await this.api('/wa/connect', { method: 'POST', body: JSON.stringify({ method: 'qr' }) });
            this.pollPending('main', 'qr');
          } catch (e) { this.state.connect.pending = null; this.toast(e.message, 'err'); this.renderConnect(); }
          break;
        case 'wa-pair': {
          const phone = $('#pair-phone')?.value || '';
          this.state.connect.pending = phone.replace(/\D/g, '');
          this.state.connect.pair = null;
          this.renderConnect();
          try {
            await this.api('/wa/connect', { method: 'POST', body: JSON.stringify({ phone, method: 'pair' }) });
            this.pollPending(this.state.connect.pending, 'pair');
          } catch (e) { this.state.connect.pending = null; this.toast(e.message, 'err'); this.renderConnect(); }
          break;
        }
        case 'copy-pair': {
          const code = this.state.connect.pair;
          const btn = el.dataset.action === 'copy-pair' ? el : null;
          if (code) {
            try { await navigator.clipboard.writeText(code); } catch {}
            this.toast('Kod kopyalandı', 'ok');
            if (btn) {
              btn.classList.add('is-success');
              setTimeout(() => btn.classList.remove('is-success'), 1600);
            }
          }
          break;
        }
        case 'wa-disconnect':
          this.confirmModal('WhatsApp çıxışı', el.dataset.phone + ' hesabından çıxış edilsin? Session silinəcək.', 'wa-disconnect-yes', { phone: el.dataset.phone });
          break;
        case 'wa-disconnect-yes':
          try {
            await this.api('/wa/disconnect', { method: 'POST', body: JSON.stringify({ phone: this.state.modal?.params?.phone }) });
            this.closeModal();
            this.toast('Çıxış edildi', 'ok');
            this.refreshOverview(true);
          } catch (e) { this.toast(e.message, 'err'); }
          break;
        case 'open-add-contact':
          this.state.send = { ...this.state.send }; this.fetchContactsAll().then(() => this.openContactModal());
          break;
        case 'edit-contact': this.openContactModal(this.state.contacts.items.find((c) => String(c.id) === String(el.dataset.id))); break;
        case 'del-contact':
          this.confirmModal('Kontaktı sil', el.dataset.name + ' kontaktı silinsin?', 'del-contact-yes', { id: el.dataset.id });
          break;
        case 'del-contact-yes':
          try {
            await this.api('/contacts/' + this.state.modal?.params?.id, { method: 'DELETE' });
            this.closeModal();
            this.toast('Kontakt silindi', 'ok');
            this.fetchContactsAll().then(() => this.refreshContacts());
          } catch (e) { this.toast(e.message, 'err'); }
          break;
        case 'send-contact':
          this.state.send = { ...this.state.send, step: 1, mode: 'contacts', contactIds: [Number(el.dataset.id)] };
          this.navigateTo('/send');
          break;
        case 'contacts-search':
          this.state.contacts.q = $('#contact-q')?.value || '';
          this.state.contacts.waStatus = $('#contact-wa')?.value || 'all';
          this.state.contacts.page = 1;
          this.refreshContacts();
          break;
        case 'contacts-page':
          this.state.contacts.page = Number(el.dataset.page);
          this.refreshContacts();
          break;
        case 'send-mode':
          this.state.send.mode = el.dataset.mode;
          this.renderSend();
          break;
        case 'send-preview': {
          const s = this.state.send;
          s.phone = $('#send-phone')?.value || s.phone;
          s.numbers = $('#send-numbers')?.value || s.numbers;
          s.text = $('#send-text')?.value || s.text;
          s.caption = $('#send-caption')?.value || s.caption;
          const { phones } = await this.computeRecipients();
          if (!phones.length) return this.toast('Alıcı seçin', 'warn');
          s.previewPhones = phones;
          s.step = 2;
          this.renderSend();
          break;
        }
        case 'send-back': this.state.send.step = 1; this.renderSend(); break;
        case 'send-go': this.sendGo(); break;
        case 'file-clear': this.state.send.file = null; this.state.send.messageType = ''; this.updateFileChip(); break;
        case 'job-cancel':
          try {
            await this.api('/jobs/' + el.dataset.id + '/cancel', { method: 'POST' });
            this.toast('Göndəriş dayandırıldı', 'warn');
            this.loadJobs();
            if (this.state.send.step === 3) { const job = await this.api('/jobs/' + el.dataset.id); this.state.jobs[job.id] = job; this.renderSend(); }
          } catch (e) { this.toast(e.message, 'err'); }
          break;
        case 'jobs-cancel-all':
          try {
            const res = await this.api('/jobs/cancel-all', { method: 'POST' });
            this.toast(res.cancelled + ' göndəriş dayandırıldı', 'warn');
            this.loadJobs();
          } catch (e) { this.toast(e.message, 'err'); }
          break;
        case 'job-retry':
          try {
            const res = await this.api('/jobs/' + el.dataset.id + '/retry-failed', { method: 'POST' });
            this.state.jobs[res.job.id] = res.job;
            this.state.send.jobId = res.job.id;
            this.state.send.step = 3;
            this.closeModal();
            this.renderSend();
            this.toast('Yenidən göndərmə başladı', 'ok');
          } catch (e) { this.toast(e.message, 'err'); }
          break;
        case 'job-detail': this.jobDetail(el.dataset.id); break;
        case 'history-filter': this.state.history.state = $('#hist-state')?.value || 'all'; this.state.history.page = 1; this.loadHistory(); break;
        case 'history-page': this.state.history.page = Number(el.dataset.page); this.loadHistory(); break;
        case 'hist-delete-single': {
          const id = el.dataset.id;
          this.confirmModal('Tarixçəni sil', 'Bu qeyd silinsin?', 'hist-delete-confirm', { ids: [id] });
          break;
        }
        case 'hist-delete-selected': {
          const ids = [...this.state.history.selectedIds];
          if (ids.length === 0) break;
          this.confirmModal('Tarixçəni sil', ids.length + ' qeyd silinsin?', 'hist-delete-confirm', { ids });
          break;
        }
        case 'hist-delete-confirm': {
          const ids = this.state.modal?.params?.ids || [];
          if (ids.length === 0) { this.closeModal(); break; }
          try {
            await this.api('/history/delete', { method: 'POST', body: JSON.stringify({ ids }) });
            this.state.history.selectedIds = new Set();
            this.closeModal();
            this.toast(ids.length + ' qeyd silindi', 'ok');
            this.loadHistory();
          } catch (e) { this.toast(e.message, 'err'); this.closeModal(); }
          break;
        }
        case 'close-modal': this.closeModal(); break;
        case 'confirm-yes':
          if (this.state.modal?.action) this.handleAction(this.state.modal.action, { dataset: {} });
          break;
      }
    },

    async handleForm(kind, form) {
      if (kind === 'login') {
        const data = Object.fromEntries(new FormData(form));
        const btn = form.querySelector('button[type="submit"]');
        setLoading(btn, true);
        try {
          const res = await this.api('/auth/login', { method: 'POST', body: JSON.stringify({ password: data.password }) });
          this.state.authed = true;
          this.state.user = { username: res.username || 'admin' };
          this.connectRealtime();
          this.navigateTo(this.pathFor(this.state.route || 'dashboard'));
        } catch (e) { setLoading(btn, false); throw e; }
        return;
      }
      if (kind === 'contact-save') {
        const data = Object.fromEntries(new FormData(form));
        const id = data.id;
        delete data.id;
        const body = JSON.stringify({ name: data.name, phone: data.phone });
        if (id) await this.api('/contacts/' + id, { method: 'PUT', body });
        else await this.api('/contacts', { method: 'POST', body });
        this.closeModal();
        this.toast('Kontakt yadda saxlanıldı', 'ok');
        this.fetchContactsAll().then(() => this.refreshContacts());
        this.refreshOverview(true);
        return;
      }
      if (kind === 'security-save') {
        const data = Object.fromEntries(new FormData(form));
        if (data.newPassword !== data.newPassword2) {
          this.toast('Yeni şifrələr uyğun gəlmir', 'err');
          return;
        }
        try {
          await this.api('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
          });
          this.toast('Şifrə dəyişdirildi — yenidən daxil olun', 'ok');
          this.sessionExpired();
        } catch (e) { this.toast(e.message, 'err'); }
        return;
      }
      if (kind === 'settings-save') {
        const data = Object.fromEntries(new FormData(form));
        const overrides = {};
        for (const k of ['broadcastDelayMinMs', 'broadcastDelayMaxMs', 'broadcastMaxRetries', 'duplicateSendTtlMin', 'maxRecipients', 'maxMessageLength']) {
          if (data[k] !== undefined && data[k] !== '') overrides[k] = parseInt(data[k], 10);
        }
        overrides.waPresenceCheck = data.waPresenceCheck === 'on';
        overrides.waSkipUnregistered = data.waSkipUnregistered === 'on';
        const res = await this.api('/settings', { method: 'PUT', body: JSON.stringify({ overrides }) });
        this.state.settings = { ...this.state.settings, effective: res.effective, overrides: res.overrides };
        this.toast('Parametrlər saxlanıldı', 'ok');
        this.renderSettings();
      }
    },

    closeModal() {
      const back = $('.modal-back');
      if (back) back.remove();
      this.state.modal = null;
    },

    pollPending(phone, kind) {
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        try {
          if (kind === 'qr') {
            const res = await this.api('/wa/qr/' + encodeURIComponent(phone));
            if (res.qr) { this.state.connect.qr = res.qr; this.renderConnect(); clearInterval(iv); return; }
          } else {
            const res = await this.api('/wa/pair/' + encodeURIComponent(phone));
            if (res.code) { this.state.connect.pair = res.code; this.renderConnect(); clearInterval(iv); return; }
          }
        } catch {}
        if (tries > 48) clearInterval(iv); // ~2 min
      }, 2500);
    },

    patchJobViews(data) {
      const route = this.state.route;
      if (route === 'jobs') this.loadJobs();
      else if (route === 'send' && this.state.send.step === 3 && this.state.send.jobId === data.id) this.renderSend();
      else if (route === 'dashboard') this.renderDashboard();
    },
  };

  /* wiring */
  App.bind();
  App.init();
})();
