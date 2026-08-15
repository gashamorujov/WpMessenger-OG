# WpMessenger OG — WhatsApp Web Management Panel

Telegram bot deyil — **tam web tətbiq**. Sayta daxil ol → WhatsApp hesabını QR və ya Pair Code ilə qoş → kontaktları saxla → istənilən nömrəyə mesaj/media göndər → real-time progressi izlə → tarixçəyə bax.

Bu layihə `WpFastMesenger-v6` (Telegram-ilə-idarə olunan WhatsApp botu) əsasında tam yenidən qurulub: Telegram idarəetməsi web panelə köçürülüb, bütün əsas funksiyalar qorunub və professional REST API + WebSocket arxitekturasına keçirilib.

---

## ✨ Xüsusiyyətlər

- 🔐 **Auth** — scrypt parol hash, persistent token session, rate limiting, input validation
- 📱 **WhatsApp qoşulma** — QR Code və ya Pair Code; session persistence (server restartda yenidən qoşulma tələb olunmur)
- 👥 **Kontakt sistemi** — SQLite (persistent), Azərbaycan nömrə normalizasiyası, duplicate qorunması
  - `0503482680`, `9940503482680`, `+994503482680` → eyni kontakt
  - Kontakt yaradılanda WhatsApp kontaktlarına avtomatik əlavə olunur (Linked Devices contactAction)
  - WhatsApp qeydiyyat statusu (USync `onWhatsApp`) avtomatik yoxlanılır
- ✉️ **Mesaj göndərmə** — mətn, şəkil, video, audio, səs, sənəd, PDF, fayl
  - Alıcı seçimi: bir nömrə / siyahı / kontaktlardan / bütün kontaktlar
  - Göndərmədən əvvəl **Preview** mərhələsi
  - Canlı **progress** (WebSocket): done/total, uğurlu/xəta/atlanan, faiz barı
  - 🛑 Dayandır düyməsi — queue düzgün bağlanır, bərpa olunmur
  - Bir nömrədə xəta bütün göndərişi dayandırmır
- 📦 **Job sistemi** — persistent jobs (SQLite), crash-recovery (interrupted → avtomatik resume), failed retry, ACK tracking, duplicate-send guard
- 🕘 **Tarixçə** — hər göndəriş üçün tarix, alıcı sayı, mesaj, uğur/xəta, ətraflı baxış + uğursuzları təkrar göndər
- ⚡ **Real-time** — WebSocket (`/ws`) ilə WhatsApp status, QR, Pair Code, göndərmə progressi, aktiv job statusu səhifəni refresh etmədən yenilənir
- 🎨 **Modern UI/UX** — tam responsive; desktop sidebar, mobil bottom navigation, dark/light mode
- 🚀 **Deploy** — VPS / Railway / Render / Fly.io / Docker; frontend Vercel / Netlify / Cloudflare Pages

---

## 🏗 Arxitektura

```
frontend/            statik SPA (vanilla JS — build tələb olunmur)
  index.html
  css/styles.css
  js/app.js
  vercel.json / netlify.toml

index.js             server bootstrap (Express + WebSocket + static)
server/
  whatsappManager.js Baileys socket lifecycle (QR/Pair, reconnect, watchdog)
  broadcastService.js global serialized queue, progress, resume, cancel
  webSocketHub.js    realtime push (ws)
  auth.js            login, scrypt, sessions
  routes.js          REST API
db/
  index.js           SQLite + migration sistemi (PRAGMA user_version)
  contacts.js        kontaktlar
  jobs.js            göndəriş işləri / tarixçə
  sessions.js        auth tokenlər
  appSettings.js     panel settings
lib/
  phone.js / azPhone.js  nömrə normalizasiyası (Azərbaycan)
  broadcast.js       real WhatsApp göndərmə mühərriki
  queue.js           FIFO worker (rate-limit)
  waPresence.js      onWhatsApp yoxlaması + kontakt əlavə etmə
  recentSends.js     duplicate guard
  rateLimit.js       rate limiting
```

Frontend heç vaxt WhatsApp socket-ə birbaşa qoşulmur — bütün WhatsApp əməliyyatları backend tərəfindən idarə olunur.

---

## 🚀 Quickstart (lokal)

```bash
cp .env.example .env      # ADMIN_PASSWORD dəyişdirin
npm install
npm start
```

İlk işə salmada DB avtomatik yaradılır və migration işləyir. `ADMIN_PASSWORD` boşdursa təsadüfi şifrə yaradılır və **loqlarda çap olunur**.

Açın: http://localhost:3000 → login → **WhatsApp-a qoşul** (QR / Pair Code).

---

## ☁️ Deploy

> **Avtomatik konfiqurasiya:** `PORT`, `API_URL`, `WS_URL`, `FRONTEND_URL` və CORS
> platforma environment variable-larından (`RAILWAY_PUBLIC_DOMAIN`,
> `RENDER_EXTERNAL_URL`, `VERCEL_URL`, `FLY_APP_NAME` və s.) **avtomatik təyin
> olunur** — heç bir hard-code edilmiş URL yoxdur. Yalnız `ADMIN_PASSWORD`
> təyin etmək vacibdir (boşdursa random yaradılır və loqa yazılır).

### Arxitektura: iki variant

**A) Tək deploy (tövsiyə olunur)** — backend paneli də servis edir:
Railway / Render / Fly.io / VPS / Docker. Əlavə konfiqurasiya yoxdur.

**B) Ayrı frontend + backend** — statik frontend Vercel / Netlify /
Cloudflare Pages-də, persistent WhatsApp backend Railway / VPS / Docker-də.

```
┌──────────────┐   HTTPS (CORS)   ┌─────────────────────────┐
│ Vercel/Netlify│ ───────────────▶ │ Railway/VPS (backend)    │
│  frontend/    │  REST + WebSocket│  WhatsApp sessions + DB  │
└──────────────┘                  └─────────────────────────┘
```

### Railway (tək deploy)
1. Reponu Railway-ə qoşun — `Dockerfile` avtomatik istifadə olunur.
2. Env: `ADMIN_USERNAME`, `ADMIN_PASSWORD` (məcburi); `PORT` Railway təyin edir.
3. Persistent volume əlavə edin və `/data`-ya mount edin (DB + sessionlar).
   Railway → Deployments → Volume → `data` → mount path `/data`.
4. Public domain avtomatik olaraq `API_URL`/`WS_URL` kimi istifadə olunur.

### Render
Repo kökündəki `render.yaml` blueprint hazırdır: "New → Blueprint" seçin.
Disk (`/data`) və `ADMIN_PASSWORD` (sync: false) avtomatik yaradılır.

### Fly.io
```bash
fly launch --no-deploy
fly volumes create wpm_data --size 1
fly deploy
```
`fly.toml` artıq konfiqurasiya olunub (volume mount `/data`, health check).

### VPS (Docker)
```bash
REPO_URL=https://github.com/gashamorujov/WpMessenger-OG.git bash scripts/deploy-vps.sh
```
Data `./data` volume-da persistent saxlanılır; panel `http://<server-ip>:3000`.

### Vercel / Netlify — yalnız frontend (B variantı)
Backend ilk olaraq Railway/Render/VPS-də deploy edin, sonra:

1. Vercel-də repo → root directory: `frontend`.
2. Env vars: `API_URL=https://wpm.up.railway.app` (və istəsəniz `WS_URL`).
   `npm run build` `frontend/js/config.generated.js`-i yaradır; frontend
   `API_URL`-ə və törədilmiş `WS_URL`-ə (wss://) qoşulur.
3. Netlify üçün eyni: build `npm run build`, publish `.`, env `API_URL`.

> Vercel/Netlify **serverless məhdudiyyəti** var: WhatsApp WebSocket/session
> daimi işləyən proses tələb edir. Bu platformalarda backend deploy etməyə
> çalışmayın — backend üçün Railway/VPS/Render/Docker istifadə edin.

### Docker (lokal / istənilən server)
```bash
docker build -t wp-messenger-og .
docker run -p 3000:3000 -e ADMIN_PASSWORD=changeme -v $(pwd)/data:/data wp-messenger-og
```
`docker-compose.yml` hazırdır: `docker compose up -d --build`.

---

## 🔐 Təhlükəsizlik

- Login + token session (httpOnly cookie + Authorization header)
- Parollar scrypt ilə hashlənir (heç vaxt düz mətndə saxlanılmır)
- Rate limiting (login: 10/dəq/IP; API: 240/dəq/IP)
- Input validation (nömrə formatı, ad uzunluğu, mesaj uzunluğu, max alıcı)
- Nömrə məlumatları və session məlumatları yalnız autentifikasiya olunmuş istifadəçiyə verilir
- Heç bir secret repo-da saxlanılmır — yalnız environment variables

---

## 📡 API Endpoints

| Metod | Endpoint | İzah |
|---|---|---|
| POST | `/api/auth/login` | Login → token |
| POST | `/api/auth/logout` | Çıxış |
| GET | `/api/auth/me` | Sessiya yoxlaması |
| GET | `/api/overview` | Dashboard statistikası |
| GET/POST | `/api/contacts` | Kontakt siyahısı / əlavə et |
| POST | `/api/contacts/import` | Toplu import |
| GET/PUT/DELETE | `/api/contacts/:id` | Kontakt əməliyyatları |
| GET | `/api/contacts/all` | Bütün kontaktlar (minimal) |
| POST | `/api/wa/connect` | QR/Pair qoşulma |
| GET | `/api/wa/status` | Sessiya statusları |
| GET | `/api/wa/qr/:key`, `/api/wa/pair/:phone` | Polling fallback |
| POST | `/api/wa/disconnect` | Çıxış |
| POST | `/api/messages/send` | Mesaj/media göndər (multipart) |
| GET | `/api/jobs` | Job siyahısı (`?state=active`) |
| GET | `/api/jobs/:id` | Job detalı |
| POST | `/api/jobs/:id/cancel` | Dayandır |
| POST | `/api/jobs/:id/retry-failed` | Uğursuzları təkrar |
| POST | `/api/jobs/cancel-all` | Hamısını dayandır |
| GET | `/api/history` | Tarixçə |
| GET/PUT | `/api/settings` | Panel parametrləri |
| GET | `/api/health` | Health check |

---

## 🗄 Database & Deploy

- **Lokal/sadə deploy**: SQLite (`DATABASE_URL=./data/app.db`) — heç nə konfiqurasiya tələb etmir.
- **Production**: persistent storage vacibdir (kontaktlar, işlər, sessionlar itməməlidir):
  - Railway/Render/Fly: persistent volume `/data` üzərində
    (`DATA_DIR=/data`, `SESSION_PATH=/data/sessions`, `DATABASE_URL=/data/app.db`
    — `render.yaml`, `fly.toml` və `docker-compose.yml` bunu artıq edir).
  - Migration sistemi var: `npm run migrate` və ya avtomatik (startda).

---

## 📦 Environment Variables

| Dəyişən | Məcburi | Default | İzah |
|---|---|---|---|
| `PORT` | ❌ | 3000 | HTTP port |
| `ADMIN_USERNAME` | ❌ | admin | Panel login |
| `ADMIN_PASSWORD` | ❌ | (random) | Panel şifrəsi — boşdursa random yaradılır |
| `DATABASE_URL` | ❌ | ./data/app.db | SQLite faylı |
| `DATA_DIR` | ❌ | ./data | Persistent data |
| `SESSION_PATH` | ❌ | ./sessions | WhatsApp sessionlar |
| `FRONTEND_URL` | ❌ | auto | Panelin public URL-i (platformadan törəyir) |
| `API_URL` / `BACKEND_URL` | ❌ | auto | Backend origin (Railway/Render/...) |
| `WS_URL` | ❌ | auto | WebSocket base (API_URL-dən törəyir, wss://) |
| `CORS_ORIGIN` | ❌ | * (hamısı) | Vergüllə ayrılmış icazəli origin-lər |
| `TRUST_PROXY` | ❌ | true | Proxy arxasında düzgün IP |
| `RAILWAY_PUBLIC_DOMAIN` | ❌ | — | Railway avtomatik verir |
| `RENDER_EXTERNAL_URL` | ❌ | — | Render avtomatik verir |
| `VERCEL_URL` | ❌ | — | Vercel avtomatik verir |
| `BROADCAST_DELAY_MIN_MS` | ❌ | 3000 | Göndərmələr arası min gecikmə |
| `BROADCAST_DELAY_MAX_MS` | ❌ | 7000 | Göndərmələr arası max gecikmə |
| `BROADCAST_MAX_RETRIES` | ❌ | 2 | Retry sayı |
| `DUPLICATE_SEND_TTL_MIN` | ❌ | 10 | Duplicate qoruyucu |
| `WA_PRESENCE_CHECK` | ❌ | true | WhatsApp qeydiyyat yoxlaması |
| `WA_SKIP_UNREGISTERED` | ❌ | true | Qeydiyyatsızları atla |
| `MAX_RECIPIENTS` | ❌ | 10000 | Max alıcı |
| `FRONTEND_URL` / `API_URL` / `WS_URL` | ❌ | — | Ayrı frontend deploy üçün |

---

## 🧪 Test

```bash
npm test
```

---

## ℹ️ Qeyd

Bu layihə WhatsApp-ın rəsmi **Linked Devices / WhatsApp Web** protokolundan (Baileys) istifadə edir. Hesabın ban riskini azaltmaq üçün göndərmə limitləri (gecikmələr, max alıcı) konfiqurasiya oluna bilər. Böyük həcmli göndərişlərdən əvvəl limitləri aşağı salın.
