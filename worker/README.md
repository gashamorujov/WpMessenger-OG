# WpMessenger OG — Worker

Persistent WhatsApp backend (Express + Baileys) for WpMessenger OG.

- Runs on Railway / VPS / Docker (long-lived host required for WhatsApp).
- **All data lives in Firebase Realtime Database** (`wpm/*`) — no local
  database, no `./data` folder, no PostgreSQL, no persistent volume.
- Baileys auth state, session metadata and the duplicate-send guard are
  persisted in Firebase (`wpm/wa/state`, `wpm/wa/sessions`,
  `wpm/wa/recentSends`).
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
| `FIREBASE_DATABASE_URL` | Firebase RTDB URL (default `whatsbotog` project) |
| `FIREBASE_ENABLED` | `true` (default) |
| `WA_PRESENCE_CHECK` / `WA_SKIP_UNREGISTERED` | Registration pre-check |
| `DUPLICATE_SEND_TTL_MIN` | Duplicate-send guard TTL (minutes) |
| `UPLOAD_TTL_MS` | Media upload lifetime (default 30 min) |
| `BROADCAST_DELAY_MIN_MS` / `BROADCAST_DELAY_MAX_MS` | Pacing |
| `BROADCAST_MAX_RETRIES` | Per-recipient retries |
