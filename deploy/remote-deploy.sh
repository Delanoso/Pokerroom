#!/usr/bin/env bash
set -euo pipefail
cd /opt/pokerroom

DB_PASS=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -base64 32)
SOCKET_SECRET=$(openssl rand -base64 32)
ADMIN_PASS=$(openssl rand -base64 12 | tr -d '/+=' | head -c 16)

sed -i "s/POSTGRES_PASSWORD: pokerroom_dev/POSTGRES_PASSWORD: ${DB_PASS}/" docker-compose.yml

cat > .env << ENVFILE
DATABASE_URL="postgresql://pokerroom:${DB_PASS}@127.0.0.1:5433/pokerroom?schema=public"

AUTH_SECRET="${AUTH_SECRET}"
AUTH_URL="http://169.239.181.217:8088"

NEXT_PUBLIC_APP_URL="http://169.239.181.217:8088"
NEXT_PUBLIC_SOCKET_URL="http://169.239.181.217:8089"
SOCKET_SERVER_URL="http://127.0.0.1:3001"
SOCKET_PORT=3001
SOCKET_INTERNAL_SECRET="${SOCKET_SECRET}"

TABLE_WORKER_POLL_MS=350
TABLE_WORKER_CONCURRENCY=8
TABLE_HAND_ADVANCE_ON_GET=false

NEXT_PUBLIC_HAND_POLL_MS=2500
NEXT_PUBLIC_HAND_POLL_BACKGROUND_MS=6000

SEED_ADMIN_EMAIL="admin@pokerroom.local"
SEED_ADMIN_PASSWORD="${ADMIN_PASS}"
SEED_ADMIN_USERNAME="house_admin"
SEED_ADMIN_FIRST_NAME="House"
SEED_ADMIN_LAST_NAME="Admin"

NODE_ENV=production
ENVFILE

echo "$ADMIN_PASS" > /root/pokerroom-admin-password.txt
chmod 600 /root/pokerroom-admin-password.txt

docker compose up -d
echo "Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U pokerroom >/dev/null 2>&1; then break; fi
  sleep 1
done

npm ci
npx prisma db push --accept-data-loss
npm run db:seed
NODE_ENV=production npm run build

pm2 delete pokerroom 2>/dev/null || true
pm2 start npm --name pokerroom -- run start:prod
pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root || true

echo "DEPLOY_PHASE1_OK"
