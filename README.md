# WpMessenger OG — WhatsApp Web Management Panel

Deploy-first, production-ready WhatsApp Web Management Panel built with
**Next.js App Router** (Vercel/Netlify/serverless-friendly) + a **persistent
WhatsApp worker** that runs on Railway/VPS/Docker.

```
İstifadəçi → Login → WhatsApp qoşul (QR / Pair Code) → Kontakt əlavə et →
Mesaj/Media göndər → Real-time progress → Tarixçə
```

## Architecture

- **Web (Next.js)** — App Router UI + Route Handlers API. Runs on Vercel,
  Netlify, Railway, Render, Fly.io, Docker or any Node host.
  - Auth (cookie sessions), contacts, jobs, settings, history — all in
    **Firebase Realtime Database**.
  - WhatsApp commands are **proxied** to the worker over HTTPS with a shared
    bearer token. The web app NEVER opens a WhatsApp/WebSocket connection.
- **Worker (persistent)** — `worker/` Express + Baileys process. Runs on
  Railway/VPS/Docker. Owns the long-lived WhatsApp sessions, executes send
  jobs and pushes realtime events to the browser.
- **Storage + Realtime — Firebase Realtime Database (single source of truth)**:
  - `wpm/users`, `wpm/sessions`, `wpm/contacts`, `wpm/jobs`, `wpm/settings`,
    `wpm/wa/*` (WhatsApp auth state) — every piece of app data.
  - `wpm/events` — realtime event feed the SPA listens to with the
    Firebase JS SDK (no polling, no WebSocket infrastructure needed).
  - **No local database, no `./data` folder, no PostgreSQL, no persistent
    volume required** — deploys on serverless and any platform with network.

```
Browser ── HTTPS /api/* ──► Next.js (Vercel/Netlify) ── bearer token ──► Worker API ──► WhatsApp
Browser ── Firebase SDK ──► Firebase RTDB (wpm/events)  ◄── worker mirrors every event
```

## Quick start (local)

```bash
cp .env.example .env     # set WORKER_API_TOKEN (Firebase defaults are fine)
npm install              # web app deps
npm --prefix worker install
npm run build
# terminal 1 — worker
WORKER_API_TOKEN=... node worker/server.js
# terminal 2 — web
npm start
```

Open http://localhost:3000 → login → **WhatsApp Qoşul** → QR Code or Pair Code.

> Login is **password-only** — the default password is **`gasham1006`**
> (configurable via `ADMIN_PASSWORD`). Anyone with the password can sign in;
> no username is needed. The password is **never shown on the login page**.
> Change it from **Settings → Təhlükəsizlik** — changing it invalidates all
> active sessions and requires re-login.

### Forgotten admin credentials

Run the reset helper from anywhere that can reach Firebase:

```bash
ADMIN_PASSWORD=<new-password> npm run reset-admin
```

This resets the admin password in Firebase (`wpm/users/admin`) to
`ADMIN_PASSWORD` (default: `gasham1006`) and invalidates every active
session. Login is password-only — the username is not used.

## Deploy matrix

| Platform | Web (Next.js) | Worker (persistent) | Notes |
| --- | --- | --- | --- |
| **Vercel** | repo root | Railway/VPS | No config file needed. Set env vars below. No DB needed. |
| **Netlify** | repo root (`netlify.toml`) | Railway/VPS | `@netlify/plugin-nextjs` auto-installed. |
| **Railway** | repo root (`railway.toml`) | 2nd service, root dir `worker` | `worker/railway.toml` included. |
| **Render** | `render.yaml` (web service) | `render.yaml` (worker service) | No disks required. |
| **VPS / Docker** | `docker-compose.yml` | same compose file | No volumes — Firebase only. |
| **Fly.io** | `fly.toml` | `cd worker && fly launch` | No volume required. |

### Vercel / Netlify

1. Import the repo. No build config needed (Next auto-detected).
2. Deploy the worker on Railway/VPS (see below).
3. Set env vars:

```bash
ADMIN_USERNAME=gasham
ADMIN_PASSWORD=gasham1006   # change after first login from the admin panel
FIREBASE_DATABASE_URL=https://whatsbotog-default-rtdb.firebaseio.com  # optional — this is the default
WORKER_API_URL=https://your-worker.up.railway.app    # worker public URL
WORKER_API_TOKEN=<long-random-secret>                # SAME on web + worker
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app      # optional
```

4. Deploy → open the site → login → connect WhatsApp.

### Railway / VPS worker

```bash
# Railway: New → Empty Service → Root Directory: worker
# env: WORKER_API_TOKEN, PORT auto (Firebase defaults apply)
# VPS (Docker):
docker compose up -d --build
```

## Storage & Realtime (Firebase Realtime Database)

Firebase RTDB is the **only database** — there is no SQLite, no PostgreSQL,
no `./data` folder and no persistent volume anywhere in the stack.

- All data lives under `wpm/*`: users, sessions, contacts, jobs, settings,
  and the worker's WhatsApp auth state (`wpm/wa/state/{phone}`), session
  metadata (`wpm/wa/sessions`) and duplicate-send guard (`wpm/wa/recentSends`).
- Realtime events are pushed to `wpm/events` by the worker (mirroring every
  WebSocket hub broadcast) and by the web app (`contacts:changed`,
  `settings:changed`). The SPA subscribes with the Firebase JS SDK and every
  panel view updates live.
- The worker's WebSocket hub remains as a fallback channel for browsers that
  cannot reach Firebase.
- The event feed is pruned automatically (worker, REST transport).

> ⚠️ This integration uses the provided public client config over REST, so
> the Realtime Database rules must allow public read/write for `wpm/*`.
> If your rules are locked down, the app still works through the WebSocket
> fallback (realtime events) but data persistence requires open `wpm/*` rules
> or a Firebase Admin SDK setup.

## Environment variables

All configuration is env-driven — no hardcoded hosts, ports or URLs.
Firebase defaults to the `whatsbotog` project configuration.

| Variable | Where | Description |
| --- | --- | --- |
| `PORT` | web | HTTP port (default 3000; platform `PORT` used automatically) |
| `ADMIN_PASSWORD` | web | Login password (default `gasham1006`) — password-only auth |
| `FIREBASE_DATABASE_URL` (+ optional `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`) | web + worker | Firebase RTDB project (default `whatsbotog`) |
| `FIREBASE_ENABLED` | web + worker | `true` (default) — `false` disables the realtime event mirror |
| `WORKER_API_URL` | web | Worker public API URL (`https://worker.up.railway.app`) |
| `WORKER_API_TOKEN` | web + worker | Shared secret — **must match** |
| `WORKER_WS_URL` | web | Realtime WS fallback URL (auto-derived `wss://` from API URL) |
| `BROADCAST_DELAY_MIN_MS` / `BROADCAST_DELAY_MAX_MS` | both | Random delay between sends |
| `BROADCAST_MAX_RETRIES` | both | Per-recipient retry count |
| `DUPLICATE_SEND_TTL_MIN` | both | Cross-job duplicate guard TTL (0 disables) |
| `WA_PRESENCE_CHECK` / `WA_SKIP_UNREGISTERED` | both | Registration pre-check |
| `MAX_RECIPIENTS` / `MAX_MESSAGE_LENGTH` / `MAX_UPLOAD_BYTES` | both | Safety limits |
| `RATE_LIMIT_*` / `LOGIN_RATE_LIMIT_MAX` | web | Login/API rate limiting |

Settings page overrides (delay, retries, limits) are stored in Firebase and
honoured by the worker.

## Scripts

```bash
npm run dev        # next dev
npm run build      # next build (standalone output)
npm start          # production start (standalone-aware)
npm test           # node --test (unit + worker integration)
npm run reset-admin  # reset admin credentials in Firebase
npm run check      # config/syntax check
npm --prefix worker install   # install worker deps
```

## Testing

`npm test` covers phone normalization, the send queue, the Firebase-backed
storage layer (in-memory transport), and a real worker boot (health, bearer
auth, uploads, job execution against a shared local Firebase transport). A
full manual flow was verified:

`npm install → npm run build → npm start → login → contact create/dedupe →
text+media send → job pickup by worker → realtime events → history`.

WhatsApp QR/Pair linking and delivery require a real WhatsApp account and
are exercised through the same code path used by the previous production
version of the panel.

## Repository layout

```
app/            Next.js App Router pages + Route Handler API
lib/            Firebase client (rest/memory/file transports), repositories, auth, worker client
public/         SPA (spa.js/spa.css) + static assets
worker/         Persistent WhatsApp backend (Express + Baileys), own package
scripts/        reset-admin + standalone-aware start
test/           node:test suite
Dockerfile      Web image (Next standalone)
docker-compose.yml   Web + worker on one VPS (no volumes)
render.yaml / railway.toml / fly.toml / netlify.toml
```
