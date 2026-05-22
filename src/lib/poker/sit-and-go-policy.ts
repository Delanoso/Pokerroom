import type { Prisma, PrismaClient } from "@prisma/client";
import { LedgerEntryType } from "@prisma/client";
type Db = PrismaClient | Prisma.TransactionClient;

/** True once the SnG is locked (full table) or any hand has been dealt. */
export async function isSitAndGoStarted(
  db: Db,
  tableId: string,
  maxSeats: number,
): Promise<boolean> {
  const [seated, completedHands, activeHand] = await Promise.all([
    db.tableSeat.count({ where: { tableId, userId: { not: null } } }),
    db.tableHand.count({ where: { tableId, complete: true } }),
    db.tableHand.findFirst({
      where: { tableId, complete: false },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);
  return seated >= maxSeats || completedHands >= 1 || activeHand !== null;
}

/** Lobby leave before start: return the Zar buy-in debited on sit (not table chip stack). */
export async function refundSitAndGoBuyIn(
  tx: Prisma.TransactionClient,
  opts: { userId: string; tableId: string; tableName: string; buyInZar: number },
): Promise<void> {
  if (opts.buyInZar <= 0) return;
  await tx.ledgerEntry.create({
    data: {
      userId: opts.userId,
      amountChips: opts.buyInZar,
      type: LedgerEntryType.TABLE_CASH_OUT,
      note: `Sit & Go lobby leave — buy-in refund (${opts.tableName})`,
    },
  });
}

export async function clearPlayerSeat(
  tx: Prisma.TransactionClient,
  tableId: string,
  userId: string,
): Promise<void> {
  await tx.tableSeat.updateMany({
    where: { tableId, userId },
    data: {
      userId: null,
      stackChips: 0,
      sittingOut: false,
      sitOutNextHand: false,
      waitingForNextHand: false,
    },
  });
}
