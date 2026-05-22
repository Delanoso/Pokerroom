import type { PrismaClient } from "@prisma/client";
import { LedgerEntryType } from "@prisma/client";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { notifyTableChanged } from "@/lib/notify-table";

const SIT_OUT_REMOVE_AFTER_MS = 3 * 60 * 1000;

/** Cash only: remove players who sat out for longer than the limit (frees the seat, returns stack to bank). */
export async function removeCashSittersPastSitOutLimit(prisma: PrismaClient, tableId: string): Promise<boolean> {
  try {
    const meta = await fetchPokerTableTournamentMetaOne(tableId);
    if (meta.kind !== "CASH") return false;

    const cutoff = new Date(Date.now() - SIT_OUT_REMOVE_AFTER_MS);
    const victims = await prisma.$queryRaw<
      { id: string; userId: string; stackChips: number }[]
    >`
      SELECT s."id" AS "id", s."userId" AS "userId", s."stackChips" AS "stackChips"
      FROM "TableSeat" s
      WHERE s."tableId" = ${tableId}
        AND s."userId" IS NOT NULL
        AND s."sittingOut" = true
        AND s."sitOutSince" IS NOT NULL
        AND s."sitOutSince" <= ${cutoff}
    `;
    if (victims.length === 0) return false;

    for (const s of victims) {
      await prisma.$transaction(async (tx) => {
        const seat = await tx.$queryRaw<{ userId: string | null; stackChips: number }[]>`
          SELECT "userId", "stackChips" FROM "TableSeat" WHERE "id" = ${s.id} LIMIT 1
        `;
        const row = seat[0];
        if (!row?.userId) return;
        const stack = row.stackChips;
        if (stack > 0) {
          await tx.ledgerEntry.create({
            data: {
              userId: row.userId,
              amountChips: stack,
              type: LedgerEntryType.TABLE_CASH_OUT,
              note: `Removed after long sit-out table ${tableId}`,
            },
          });
        }
        await tx.$executeRaw`
          UPDATE "TableSeat" SET
            "userId" = NULL,
            "stackChips" = 0,
            "sittingOut" = 0,
            "sitOutSince" = NULL,
            "sitOutNextHand" = 0,
            "waitingForNextHand" = 0,
            "consecutiveIdleHands" = 0
          WHERE "id" = ${s.id}
        `;
      });
    }

    void notifyTableChanged(tableId);
    return true;
  } catch {
    return false;
  }
}
