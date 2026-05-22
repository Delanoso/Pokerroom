import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type TournamentMeta = { kind: "CASH" | "TOURNAMENT" | "SIT_AND_GO"; startsAt: Date | null };

function normalizeKind(k: string | null | undefined): TournamentMeta["kind"] {
  if (k === "TOURNAMENT") return "TOURNAMENT";
  if (k === "SIT_AND_GO") return "SIT_AND_GO";
  return "CASH";
}

/**
 * Reads `kind` / `startsAt` with raw SQL so the app still works if `npx prisma generate`
 * has not run after a schema change (common Windows EPERM while Next dev is running).
 */
export async function fetchPokerTableTournamentMeta(
  tableIds: string[],
): Promise<Map<string, TournamentMeta>> {
  const out = new Map<string, TournamentMeta>();
  if (tableIds.length === 0) return out;

  try {
    const rows = await prisma.$queryRaw<{ id: string; kind: string; startsAt: Date | null }[]>`
      SELECT "id", "kind", "startsAt" FROM "PokerTable" WHERE "id" IN (${Prisma.join(tableIds)})
    `;
    for (const r of rows) {
      out.set(r.id, { kind: normalizeKind(r.kind), startsAt: r.startsAt });
    }
  } catch {
    /* column missing or wrong provider — fall through */
  }

  for (const id of tableIds) {
    if (!out.has(id)) {
      out.set(id, { kind: "CASH", startsAt: null });
    }
  }
  return out;
}

export async function fetchPokerTableTournamentMetaOne(tableId: string): Promise<TournamentMeta> {
  const m = await fetchPokerTableTournamentMeta([tableId]);
  return m.get(tableId) ?? { kind: "CASH", startsAt: null };
}
