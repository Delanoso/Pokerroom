# Server: Hetzner vm247jvwf-docker

| Item | Value |
|------|--------|
| Public IP | `169.239.181.217` |
| Hostname | `vm247jvwf-docker.hcloud.app` |
| SSH user | `root` |
| SSH key | `erichvandenheuvel5@gmail.com` (on account) |

**Same IP as two other sites** — use **separate hostnames** (not paths on the same hostname unless you know the other vhosts):

- App: e.g. `poker.yourdomain.com` → `127.0.0.1:3000`
- Socket: e.g. `socket.poker.yourdomain.com` → `127.0.0.1:3001` (WebSocket proxy required)

Do **not** store root or database passwords in this repo. Set secrets only in `/path/to/pokerroom/.env` on the server.

## Quick deploy (on server)

```bash
git clone <your-repo-url> pokerroom && cd pokerroom
docker compose up -d
cp env.production.template .env   # edit domains + secrets
npx prisma db push && npm run db:seed
npm ci && NODE_ENV=production npm run build
npm run start:prod   # or PM2 — see HOSTING.md
```
