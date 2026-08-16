# ─── WpMessenger OG — Persistent WhatsApp Worker ───
# Runs on Railway/VPS/Docker. Shares the database with the web app.
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . .
ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "server.js"]
