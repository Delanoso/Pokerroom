# Hosting Pokerroom

This app is **not** a single Next.js process. For live play you must run **three** services (four if you want house bots on cash tables).

| Service | Dev | Production |
|---------|-----|------------|
| Web (Next.js) | `next dev -p 3000` | `next start -p 3000` (after `npm run build`) |
| Socket (Socket.io) | `tsx watch server/socket-server.ts` | `npm run start:socket` |
| Table worker | `tsx watch scripts/table-worker.ts` | `npm run start:worker` |
| Bot fleet (optional) | `npm run bot:fleet` | `npm run bot:fleet` |

Quick start all required processes:

```bash
npm run build
npm run start:prod
```

Use **PM2**, **systemd**, or a process manager on your VPS so these restart on reboot.

---

## 1. Database (PostgreSQL)

The repo uses **PostgreSQL** (`prisma/schema.prisma`). On the server:

1. Start Postgres (Docker on the server):

   ```bash
   docker compose up -d
   ```

2. In `.env` on the server (change the password for production):

   ```env
   DATABASE_URL="postgresql://pokerroom:STRONG_PASSWORD@127.0.0.1:5433/pokerroom?schema=public"
   ```

   Dev Docker maps **5433→5432** so it does not clash with another Postgres on the host’s 5432.

3. Apply schema and generate client (stop any running `npm run dev` first on Windows):

   ```bash
   npx prisma db push
   npx prisma generate
   ```

4. Create your operator account once:

   ```env
   SEED_ADMIN_EMAIL="you@yourdomain.com"
   SEED_ADMIN_PASSWORD="your-strong-admin-password"
   SEED_ADMIN_USERNAME="house_admin"
   ```

   ```bash
   npm run db:seed
   ```

   After that, **players are created only** in **Operator → Players** (10-digit password shown once). Public sign-up is disabled.

---

## 2. Environment variables (production)

Copy `.env.example` to `.env` on the server and set:

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | `https://poker.yourdomain.com` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://socket.poker.yourdomain.com` (or same-origin proxy) |
| `SOCKET_SERVER_URL` | `http://127.0.0.1:3001` (internal) |
| `SOCKET_INTERNAL_SECRET` | long random string |
| `SOCKET_PORT` | `3001` |
| `TABLE_HAND_ADVANCE_ON_GET` | `false` (table-worker must stay running; if it exits, hands freeze) |

Do **not** commit `.env` to git.

---

## 3. Same server / same IP as another site

One public IP is fine. Use **different hostnames** and a reverse proxy (Caddy or nginx):

- `poker.yourdomain.com` → `http://127.0.0.1:3000`
- `socket.poker.yourdomain.com` → `http://127.0.0.1:3001` (enable **WebSocket** proxying)

Set `NEXT_PUBLIC_SOCKET_URL` to the public socket URL players use in the browser.

---

## 4. Cloudflare

You can add the domain in Cloudflare **before** the app is live (DNS only). Point records (or a **Tunnel**) at your server once processes are running.

- SSL: **Full (strict)** when origin has HTTPS
- Proxied orange-cloud hostnames support WebSockets

---

## 5. Build and run

```bash
npm ci
# NODE_ENV must be production (or unset) for `next build` — not "development"
npm run build
npm run start:prod
```

**Windows (before deploy):** run `.\scripts\hosting-prep.ps1` from the repo root (Docker + schema + build).

Verify:

1. `https://poker.yourdomain.com` loads and login works (admin seed or operator account).
2. **Operator → Players** → create a test player; copy username + 10-digit password; sign in in a private window.
3. Create a **tournament** (optional: increasing blinds).
4. Register **at least 2** players; both sit; table stays open and deals.
5. Play one hand; confirm cards/actions update without constant refresh.

---

## 6. Operator day-of checklist

- [ ] Postgres up, schema applied, `AUTH_SECRET` set
- [ ] Web + socket + table worker running (and monitored)
- [ ] Admin can sign in
- [ ] Create each player in **Operator → Players**; send credentials privately
- [ ] Load chips via **Adjust balance** on Players page
- [ ] Create tournament(s) from **Tables** (admin)
- [ ] Do **not** rely on `/register` (disabled)
- [ ] Bot fleet off unless you want test bots on cash tables

---

## 7. Optional: PM2

```bash
npm run build
pm2 start npm --name poker-web -- run start
pm2 start npm --name poker-socket -- run start:socket
pm2 start npm --name poker-worker -- run start:worker
pm2 save
```

Or one PM2 ecosystem file that runs `start:prod` (web + socket + worker only).
