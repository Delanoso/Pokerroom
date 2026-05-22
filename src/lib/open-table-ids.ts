import { prisma } from "@/lib/prisma";

/**
 * IDs of tables that are not closed, newest first (max 50).
 * Uses raw SQL so this works even when `npx prisma generate` has not run after adding `closedAt`.
 */
export async function listOpenTableIds(): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "PokerTable"
      WHERE "closedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 50
    `;
    return rows.map((r) => r.id);
  } catch {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "PokerTable"
      ORDER BY "createdAt" DESC
      LIMIT 50
    `;
    return rows.map((r) => r.id);
  }
}
