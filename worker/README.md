# WpMessenger OG — WhatsApp Worker

Persistent WhatsApp backend (Baileys). The Next.js web app (Vercel/Netlify)
never opens WhatsApp connections — it proxies every WhatsApp command to this
worker over HTTPS with a shared bearer token.

## Run locally

```bash
cp .env.example .env   # set WORKER_API_TOKEN (and DATABASE_URL for Postgres)
npm install
npm start
```

## Deploy

- **Railway**: new service → root directory `worker` (uses `worker/railway.toml`).
- **Docker**: `docker build -f worker/Dockerfile -t wp-worker .`
- **VPS/compose**: `docker compose up -d --build` (web + worker together, shared volume).

## Env vars

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | HTTP port (platform `PORT` used automatically). Default `3100`. |
| `WORKER_API_TOKEN` | **yes** | Shared secret — must equal the web app's `WORKER_API_TOKEN`. |
| `DATABASE_URL` | no | SQLite file (default `./data/app.db`) or PostgreSQL URL. Must be the SAME database as the web app. |
| `DATA_DIR` / `SESSION_PATH` | no | Runtime data (uploads, jobs) and Baileys session storage. |

## API (bearer token required)

- `GET /api/health` — open healthcheck
- `GET /api/status` — WhatsApp sessions
- `POST /api/connect` `{phone, method: 'qr'|'pair'}`
- `POST /api/disconnect` `{phone}`
- `GET /api/qr/:key`, `GET /api/pair/:phone`
- `POST /api/ws-ticket` — realtime WebSocket ticket
- `POST /api/upload` — media upload (raw body + `X-Filename`/`X-Mimetype`)
- `POST /api/jobs` `{jobId}` — execute a job from the shared database
- `POST /api/jobs/:id/cancel`
- `POST /api/contact-mirror`, `POST /api/check-registered`
