FROM node:20-slim

# better-sqlite3 native build tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Statik frontend konfiqurasiyasını da yaradır (backend həm də dinamik verir)
RUN npm run build

RUN mkdir -p data sessions data/temp

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

VOLUME ["/data", "/app/sessions"]

# Railway/Render/Fly volume-ları ilə /data mount edin (DB + sessionlar üçün)
CMD ["node", "index.js"]
