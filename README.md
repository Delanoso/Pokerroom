# Pokerroom

Private NLHE club: cash games, Sit & Go, and scheduled tournaments. Play-money bankrolls; operators create player accounts and adjust balances.

## Local development

```bash
npm install
cp .env.example .env   # edit AUTH_SECRET, SEED_ADMIN_* as needed
docker compose up -d   # PostgreSQL on localhost:5433 (avoids local Postgres on 5432)

# Before deploying to a server:
.\scripts\hosting-prep.ps1   # Windows — Docker, prisma, production build
# Copy `env.production.template` → server `.env` and fill domain + secrets (see HOSTING.md)
npx prisma db push
npx prisma generate
npm run db:seed        # optional admin from SEED_ADMIN_* in .env
npm run dev            # Next + socket + table worker + bot fleet
```

Open [http://localhost:3000](http://localhost:3000).

## Production hosting

See **[HOSTING.md](./HOSTING.md)** for Postgres, env vars, Cloudflare, reverse proxy, and the pre-event checklist.

```bash
npm run build
npm run start:prod   # web :3000 + socket :3001 + table worker (no bots)
```

## Operator workflow

1. Sign in as admin.
2. **Operator → Players** — create username; copy the one-time 10-digit password and send it to the player.
3. **Adjust balance** to load chips.
4. **Tables** — create cash or tournament tables.

Public registration and the cashier page are disabled until you add them back.
