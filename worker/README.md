# WpMessenger OG — Worker

Persistent WhatsApp backend (Express + Baileys) for WpMessenger OG.

- Runs on Railway / VPS / Docker (long-lived host required for WhatsApp).
- **WhatsApp auth sessions are stored on disk** (`sessions/` directory)
  using Baileys `useMultiFileAuthState` — the same proven approach as
  `WpFastMesenger-v6`. Mount a persistent volume for `sessions/` in Docker.
- App data (users, contacts, jobs, settings) lives in Firebase RTDB.
- Every realtime event is mirrored to `wpm/events` for the browser.

## Run

```bash
cp .env.example .env   # set WORKER_API_TOKEN (Firebase defaults are fine)
npm install
node server.js         # PORT=3100 default
```

## Environment

| Variable | Description |
| --- | --- |
| `PORT` | HTTP/WS port (default 3100) |
| `WORKER_API_TOKEN` | Shared secret — **same as the web app** |
| `FIREBASE_DATABASE_URL` | Firebase RTDB URL (for app data + events) |
| `FIREBASE_ENABLED` | `true` (default) |
| `sessions/` dir | WhatsApp auth state (Baileys file-based) — needs persistent volume |
| `WA_PRESENCE_CHECK` / `WA_SKIP_UNREGISTERED` | Registration pre-check |
| `DUPLICATE_SEND_TTL_MIN` | Duplicate-send guard TTL (minutes) |
| `UPLOAD_TTL_MS` | Media upload lifetime (default 30 min) |
| `BROADCAST_DELAY_MIN_MS` / `BROADCAST_DELAY_MAX_MS` | Pacing |
| `BROADCAST_MAX_RETRIES` | Per-recipient retries |
