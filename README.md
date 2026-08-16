# WpMessenger OG — WhatsApp Web Management Panel

Deploy-first, production-ready WhatsApp Web Management Panel built with
**Next.js App Router** (Vercel/Netlify-friendly) + a **persistent WhatsApp
worker** that runs on Railway/VPS/Docker.

```
İstifadəçi → Login → WhatsApp qoşul (QR / Pair Code) → Kontakt əlavə et →
Mesaj/Media göndər → Real-time progress → Tarixçə
```

## Architecture

- **Web (Next.js)** — App Router UI + Route Handlers API. Runs on Vercel,
  Netlify, Railway, Render, Fly.io, Docker or any Node host.
  - Auth (cookie sessions), contacts, jobs, settings, history — all in the database.
  - WhatsApp commands are **proxied** to the worker over HTTPS with a shared
    bearer token. The web app NEVER opens a WhatsApp/WebSocket connection.
- **Worker (persistent)** — `worker/` Express + Baileys process. Runs on
  Railway/VPS/Docker. Owns the long-lived WhatsApp sessions, executes send
  jobs and pushes realtime events (`wss://…/ws?ticket=…`) to the browser.
- **Database** — shared between web and worker:
  - Local dev: SQLite (`DATABASE_URL=./data/app.db`)
  - Production: PostgreSQL (Neon/Supabase/Railway) — `DATABASE_URL=postgresql://…`
  - Jobs are created by the web app and executed by the worker against the
    same DB; progress is written back so the UI always reflects reality.

```
Browser ── HTTPS /api/* ──► Next.js (Vercel/Netlify) ── bearer token ──► Worker API ──► WhatsApp
Browser ── wss://…/ws?ticket=… ──► Worker WebSocket (realtime events)
```

## Quick start (local)

```bash
cp .env.example .env     # set ADMIN_USERNAME, ADMIN_PASSWORD, WORKER_API_TOKEN
npm install              # web app deps
npm --prefix worker install
npm run build
# terminal 1 — worker
WORKER_API_TOKEN=... DATABASE_URL=./data/app.db node worker/server.js
# terminal 2 — web
npm start
```

Open http://localhost:3000 → login → **WhatsApp Qoşul** → QR Code or Pair Code.

> `ADMIN_PASSWORD` is required on first login. Missing env vars never crash
> the app — they produce clear, managed error messages.

## Deploy matrix

| Platform | Web (Next.js) | Worker (persistent) | Notes |
| --- | --- | --- | --- |
| **Vercel** | repo root | Railway/VPS | No config file needed. Set env vars below. Use PostgreSQL. |
| **Netlify** | repo root (`netlify.toml`) | Railway/VPS | `@netlify/plugin-nextjs` auto-installed. |
| **Railway** | repo root (`railway.toml`) | 2nd service, root dir `worker` | `worker/railway.toml` included. |
| **Render** | `render.yaml` (web service) | `render.yaml` (worker service) | Persistent disks mounted at `/data`. |
| **VPS / Docker** | `docker-compose.yml` | same compose file | Shared `wpm-data` volume (SQLite + sessions). |
| **Fly.io** | `fly.toml` | `cd worker && fly launch` | Persistent volume for `/data`. |

### Vercel / Netlify

1. Import the repo. No build config needed (Next auto-detected).
2. Add a PostgreSQL database (Neon/Supabase/Railway) and deploy the worker
   on Railway/VPS (see below).
3. Set env vars:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-password>
DATABASE_URL=postgresql://user:pass@host:5432/wpm   # production DB
WORKER_API_URL=https://your-worker.up.railway.app    # worker public URL
WORKER_API_TOKEN=<long-random-secret>                # SAME on web + worker
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app      # optional
```

4. Deploy → open the site → login → connect WhatsApp.

### Railway / VPS worker

```bash
# Railway: New → Empty Service → Root Directory: worker
# env: WORKER_API_TOKEN, DATABASE_URL (same DB), PORT auto
# VPS (Docker):
docker compose up -d --build
```

## Environment variables

All configuration is env-driven — no hardcoded hosts, ports or URLs.
URLs are auto-derived from platform env vars (`RAILWAY_PUBLIC_DOMAIN`,
`RENDER_EXTERNAL_URL`, `VERCEL_URL`, `FLY_APP_NAME`) when not set.

| Variable | Where | Description |
| --- | --- | --- |
| `PORT` | web | HTTP port (default 3000; platform `PORT` used automatically) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | web | First-login credentials (required) |
| `WORKER_API_URL` | web | Worker public API URL (`https://worker.up.railway.app`) |
| `WORKER_API_TOKEN` | web + worker | Shared secret — **must match** |
| `WORKER_WS_URL` | web | Realtime WS URL (auto-derived `wss://` from API URL) |
| `DATABASE_URL` | web + worker | SQLite file or PostgreSQL URL — **same value on both** |
| `DATA_DIR` / `SESSION_PATH` | worker | Runtime data + Baileys sessions |
| `BROADCAST_DELAY_MIN_MS` / `BROADCAST_DELAY_MAX_MS` | both | Random delay between sends |
| `BROADCAST_MAX_RETRIES` | both | Per-recipient retry count |
| `DUPLICATE_SEND_TTL_MIN` | both | Cross-job duplicate guard TTL (0 disables) |
| `WA_PRESENCE_CHECK` / `WA_SKIP_UNREGISTERED` | both | Registration pre-check |
| `MAX_RECIPIENTS` / `MAX_MESSAGE_LENGTH` / `MAX_UPLOAD_BYTES` | both | Safety limits |
| `RATE_LIMIT_*` / `LOGIN_RATE_LIMIT_MAX` | web | Login/API rate limiting |

Settings page overrides (delay, retries, limits) are stored in the shared
database and honoured by the worker.

## Scripts

```bash
npm run dev        # next dev
npm run build      # next build (standalone output)
npm start          # production start (standalone-aware)
npm test           # node --test (unit + worker integration)
npm run migrate    # apply DB migrations
npm run check      # config/syntax check
npm --prefix worker install   # install worker deps
```

## Testing

`npm test` covers phone normalization, the send queue, the shared storage
layer (SQLite), and a real worker boot (health, bearer auth, uploads,
job execution against the shared DB). A full manual flow was verified:

`npm install → npm run build → npm start → login → contact create/dedupe →
text+media send → job pickup by worker → realtime ticket → history`.

WhatsApp QR/Pair linking and delivery require a real WhatsApp account and
are exercised through the same code path used by the previous production
version of the panel.

## Repository layout

```
app/            Next.js App Router pages + Route Handler API
lib/            Web config, storage (SQLite/PostgreSQL), repositories, auth, worker client
public/         SPA (spa.js/spa.css) + static assets
worker/         Persistent WhatsApp backend (Express + Baileys), own package
scripts/        migrate + standalone-aware start
test/           node:test suite
Dockerfile      Web image (Next standalone)
docker-compose.yml   Web + worker on one VPS
render.yaml / railway.toml / fly.toml / Procfile / netlify.toml
```
