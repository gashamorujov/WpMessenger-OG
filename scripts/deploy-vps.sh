#!/usr/bin/env bash
set -e

# WpMessenger OG — VPS deployment (Docker)
# Usage: REPO_URL=git@github.com:USER/WpMessenger-OG.git bash scripts/deploy-vps.sh
REPO_URL="${REPO_URL:-https://github.com/gashamorujov/WpMessenger-OG.git}"
DIR="${DIR:-WpMessengerOG}"

echo "=== WpMessenger OG — VPS Deployment ==="
command -v docker >/dev/null 2>&1 || { echo "Docker required: https://docs.docker.com/engine/install/"; exit 1; }
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || { echo "docker compose v2 required"; exit 1; }

if [ -d "$DIR" ]; then
  cd "$DIR" && git pull
else
  git clone "$REPO_URL" "$DIR" && cd "$DIR"
fi

# İlk işə salmada ADMIN_PASSWORD verilməsə təsadüfi şifrə yaradılır (loqlarda görünür)
docker compose up -d --build

echo ""
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "✅ WpMessenger OG hazırdır → http://${IP:-<server-ip>}:3000"
echo "   Login: env-dakı ADMIN_USERNAME / ADMIN_PASSWORD (boşdursa ilk loqa baxın)"
echo "   Data: ./data (kontaktlar, DB, işlər) və ./sessions (WhatsApp sessionları)"
