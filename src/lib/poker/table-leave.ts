import type { Prisma, PrismaClient } from "@prisma/client";
import { LedgerEntryType, PokerTableKind } from "@prisma/client";
import {
  clearPlayerSeat,
  isSitAndGoStarted,
  refundSitAndGoBuyIn,
} from "@/lib/poker/sit-and-go-policy";
import { sitAndGoFlightKey } from "@/lib/poker/sit-and-go-sync";
import {
  forfeitPlayerFromTournament,
  loadFlightContext,
  recordTournamentElimination,
} from "@/lib/tournament-flight";

/** Cash table: return remaining stack chips to bankroll (1 chip = 1 Zar). */
export async function cashOutSeatStack(
  tx: Prisma.TransactionClient,
  opts: { userId: string; tableId: string; stackChips: number },
): Promise<void> {
  if (opts.stackChips <= 0) return;
  await tx.ledgerEntry.create({
    data: {
      userId: opts.userId,
      amountChips: opts.stackChips,
      type: LedgerEntryType.TABLE_CASH_OUT,
      note: `Leave table ${opts.tableId}`,
    },
  });
}

export type LeaveTableResult = "ok" | "not_seated";

/**
 * Stand up / leave after any mid-hand fold handling is done.
 * SnG lobby → refund buy-in; SnG started → forfeit; MTT → forfeit flight; cash → cash out stack.
 */
export async function finalizePlayerLeaveTable(
  prisma: PrismaClient,
  tableId: string,
  userId: string,
  table: { kind: PokerTableKind; name: string; minBuyIn: number; maxSeats: number },
): Promise<LeaveTableResult> {
  const seat = await prisma.tableSeat.findFirst({
    where: { tableId, userId },
    select: { id: true, stackChips: true },
  });
  if (!seat) return "not_seated";

  if (table.kind === PokerTableKind.TOURNAMENT) {
    const ctx = await loadFlightContext(prisma, tableId);
    if (ctx) {
      await forfeitPlayerFromTournament(prisma, ctx, userId);
    }
    return "ok";
  }

  if (table.kind === PokerTableKind.SIT_AND_GO) {
    const started = await isSitAndGoStarted(prisma, tableId, table.maxSeats);
    if (started) {
      await recordTournamentElimination(prisma, sitAndGoFlightKey(tableId), userId);
      await prisma.$transaction(async (tx) => {
        await clearPlayerSeat(tx, tableId, userId);
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await refundSitAndGoBuyIn(tx, {
          userId,
          tableId,
          tableName: table.name,
          buyInZar: table.minBuyIn,
        });
        await clearPlayerSeat(tx, tableId, userId);
      });
    }
    return "ok";
  }

  await prisma.$transaction(async (tx) => {
    await cashOutSeatStack(tx, { userId, tableId, stackChips: seat.stackChips });
    await clearPlayerSeat(tx, tableId, userId);
  });
  return "ok";
}
