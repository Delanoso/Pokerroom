/**
 * Advances hand clocks (action timeouts, showdown reveal) for all active tables.
 * Run alongside Next.js and the socket server in production.
 *
 *   npm run table-worker
 *   # or included in: npm run dev
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { listTableIdsForHandWorker, syncTableHandServer } from "@/lib/poker/sync-table-hand";

const prisma = new PrismaClient();

const POLL_MS = Math.max(150, Number(process.env.TABLE_WORKER_POLL_MS ?? 350));
const CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.TABLE_WORKER_CONCURRENCY ?? 8)));

let stopping = false;
let tickInFlight = false;

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && !stopping) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

async function tickAllTables(): Promise<void> {
  if (tickInFlight || stopping) return;
  tickInFlight = true;
  try {
    const tableIds = await listTableIdsForHandWorker(prisma);
    await runWithConcurrency(tableIds, CONCURRENCY, async (tableId) => {
      try {
        await syncTableHandServer(prisma, tableId, { viewerUserId: null });
      } catch (e) {
        console.error(`[table-worker] sync failed table=${tableId}`, e);
      }
    });
  } catch (e) {
    // Never exit the process — a transient DB outage used to kill the worker and freeze all tables.
    console.error("[table-worker] tick failed (will retry)", e);
  } finally {
    tickInFlight = false;
  }
}

function shutdown(): void {
  stopping = true;
  console.log("[table-worker] shutting down…");
  void prisma.$disconnect().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[table-worker] poll=${POLL_MS}ms concurrency=${CONCURRENCY}`);
void tickAllTables();
setInterval(() => void tickAllTables(), POLL_MS);
