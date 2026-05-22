# Local hosting prep — run from repo root before deploying to a server.
# Usage: .\scripts\hosting-prep.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "==> Docker Postgres"
docker compose up -d
Start-Sleep -Seconds 4
docker compose ps

Write-Host "==> Prisma schema"
npx prisma db push
npx prisma generate

Write-Host "==> Production build (NODE_ENV=production)"
$env:NODE_ENV = "production"
npm run build

Write-Host ""
Write-Host "Hosting prep done locally."
Write-Host "Next on the SERVER:"
Write-Host "  1. Clone/copy this repo"
Write-Host "  2. Copy env.production.template to .env and fill in secrets + domain"
Write-Host "  3. docker compose up -d"
Write-Host "  4. npx prisma db push && npm run db:seed"
Write-Host "  5. npm ci && npm run build && npm run start:prod  (or PM2)"
Write-Host "  6. Reverse proxy + Cloudflare — see HOSTING.md"
