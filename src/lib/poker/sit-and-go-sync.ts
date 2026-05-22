import type { Prisma, PrismaClient } from "@prisma/client";
import { PokerTableKind } from "@prisma/client";
import {
  LEDGER_TOURNAMENT_PRIZE_EXPENSE,
  LEDGER_TOURNAMENT_PRIZE_PAID,
  insertLedgerEntrySql,
} from "@/lib/house-fees-sql";
import { notifyTableChanged } from "@/lib/notify-table";
import { findActiveTableHand } from "@/lib/poker/active-hand";
import { recordTournamentElimination } from "@/lib/tournament-flight";

/** SnG uses table id as flight key (same pattern as single-table MTT). */
export function sitAndGoFlightKey(tableId: string): string {
  return tableId;
}

type SnGDb = PrismaClient | Prisma.TransactionClient;

export async function isUserEliminatedFromSitAndGo(
  prisma: SnGDb,
  tableId: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.tournamentElimination.findUnique({
    where: { flightKey_userId: { flightKey: sitAndGoFlightKey(tableId), userId } },
    select: { id: true },
  });
  return row !== null;
}

async function payFirstPlacePrize(
  tx: Prisma.TransactionClient,
  hostUserId: string,
  playerUserId: string,
  amount: number,
  tableName: string,
): Promise<void> {
  if (amount <= 0) return;
  await insertLedgerEntrySql(tx, {
    userId: playerUserId,
    amountChips: amount,
    type: LEDGER_TOURNAMENT_PRIZE_PAID,
    note: `Sit & Go 1st place — ${tableName}`,
  });
  await insertLedgerEntrySql(tx, {
    userId: hostUserId,
    amountChips: -amount,
    type: LEDGER_TOURNAMENT_PRIZE_EXPENSE,
    note: `Sit & Go 1st place prize — ${tableName}`,
  });
}

async function recordFirstPlace(
  tx: Prisma.TransactionClient,
  flightKey: string,
  userId: string,
  prizeZar: number,
): Promise<void> {
  const paidAt = prizeZar > 0 ? new Date() : new Date();
  await tx.tournamentPlacement.upsert({
    where: { flightKey_place: { flightKey, place: 1 } },
    create: { flightKey, place: 1, userId, prizeZar, paidAt },
    update: { userId, prizeZar, paidAt },
  });
}

/**
 * Sit & Go: after at least one hand has been played, when one player has all chips,
 * pay 1st-place prize (Zar) and close the table. Skips the lobby phase (one player seated).
 */
export async function syncSitAndGoAfterHand(prisma: PrismaClient, tableId: string): Promise<boolean> {
  const activeHand = await findActiveTableHand(prisma, tableId);
  if (activeHand) return false;

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: {
      id: true,
      name: true,
      kind: true,
      closedAt: true,
      createdById: true,
      tournamentPrize1stZar: true,
    },
  });
  if (!table || table.closedAt || table.kind !== PokerTableKind.SIT_AND_GO) {
    return false;
  }

  const completedHands = await prisma.tableHand.count({
    where: { tableId, complete: true },
  });
  if (completedHands < 1) {
    return false;
  }

  const busted = await prisma.tableSeat.findMany({
    where: { tableId, userId: { not: null }, stackChips: 0 },
    select: { userId: true },
  });
  const flightKey = sitAndGoFlightKey(tableId);
  for (const s of busted) {
    if (!s.userId) continue;
    await recordTournamentElimination(prisma, flightKey, s.userId);
    await prisma.tableSeat.updateMany({
      where: { tableId, userId: s.userId },
      data: {
        userId: null,
        stackChips: 0,
        sittingOut: false,
        sitOutNextHand: false,
        waitingForNextHand: false,
      },
    });
  }

  const winnerSeat = await prisma.tableSeat.findFirst({
    where: { tableId, userId: { not: null }, stackChips: { gt: 0 } },
    select: { userId: true },
  });
  if (!winnerSeat?.userId) return false;

  const withChips = await prisma.tableSeat.count({
    where: { tableId, userId: { not: null }, stackChips: { gt: 0 } },
  });
  if (withChips !== 1) return false;

  const prizeZar = table.tournamentPrize1stZar ?? 0;
  const winnerId = winnerSeat.userId;

  await prisma.$transaction(async (tx) => {
    await payFirstPlacePrize(tx, table.createdById, winnerId, prizeZar, table.name);
    await recordFirstPlace(tx, table.id, winnerId, prizeZar);
    await tx.tableSeat.updateMany({
      where: { tableId },
      data: {
        userId: null,
        stackChips: 0,
        sittingOut: false,
        sitOutNextHand: false,
        waitingForNextHand: false,
      },
    });
    await tx.pokerTable.update({
      where: { id: tableId },
      data: { closedAt: new Date() },
    });
  });

  void notifyTableChanged(tableId);
  console.log(`[sit-and-go] completed ${tableId} — winner ${winnerId} paid ${prizeZar} Zar`);
  return true;
}
