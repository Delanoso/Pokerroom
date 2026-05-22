import type { PrismaClient } from "@prisma/client";
import { creditHouseRakeCashPot } from "@/lib/house-fees";
import { syncSitAndGoAfterHand } from "@/lib/poker/sit-and-go-sync";
import { syncTournamentFlightAfterHand } from "@/lib/tournament-flight";
import type { NlheHandState } from "./types";
import { serializeHandState } from "./nlhe-engine";

export { findActiveTableHand } from "./active-hand";

export function nextDealerButton(occupiedSeatIndices: number[], current: number): number {
  const sorted = [...occupiedSeatIndices].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = sorted.indexOf(current);
  if (idx === -1) return sorted[0]!;
  return sorted[(idx + 1) % sorted.length]!;
}

export async function finalizeCompletedHand(
  prisma: PrismaClient,
  tableId: string,
  handId: string,
  state: NlheHandState,
  dealerButtonSeat: number,
  tableKind: "CASH" | "TOURNAMENT" | "SIT_AND_GO",
): Promise<void> {
  if (state.street !== "COMPLETE") return;

  const occupied = await prisma.tableSeat.findMany({
    where: { tableId, userId: { not: null } },
    select: { seatIndex: true },
  });
  const indices = occupied.map((s) => s.seatIndex);
  const nextBtn = nextDealerButton(indices, dealerButtonSeat);

  const rakeChips = state.rakeChips ?? 0;

  await prisma.$transaction(async (tx) => {
    if (tableKind === "CASH" && rakeChips > 0) {
      const table = await tx.pokerTable.findUnique({
        where: { id: tableId },
        select: { createdById: true },
      });
      if (table) {
        await creditHouseRakeCashPot(tx, table.createdById, rakeChips, tableId, handId);
      }
    }

    await tx.tableHand.update({
      where: { id: handId },
      data: { complete: true, stateJson: serializeHandState(state) },
    });
    for (const pl of state.players) {
      await tx.tableSeat.updateMany({
        where: { tableId, seatIndex: pl.seatIndex },
        data: { stackChips: pl.stack },
      });
    }
    await tx.pokerTable.update({
      where: { id: tableId },
      data: { dealerButtonSeat: nextBtn },
    });

    await tx.tableSeat.updateMany({
      where: { tableId, waitingForNextHand: true },
      data: { waitingForNextHand: false },
    });

    if (tableKind === "CASH") {
      const pendingSitOut = await tx.tableSeat.findMany({
        where: { tableId, sitOutNextHand: true },
      });
      for (const s of pendingSitOut) {
        await tx.tableSeat.update({
          where: { id: s.id },
          data: {
            sitOutNextHand: false,
            sittingOut: true,
            sitOutSince: new Date(),
          },
        });
      }

      const playerIds = state.players.map((pl) => pl.userId);
      const botRows =
        playerIds.length > 0
          ? await tx.user.findMany({
              where: { id: { in: playerIds }, isBot: true },
              select: { id: true },
            })
          : [];
      const botUserIds = new Set(botRows.map((u) => u.id));

      for (const pl of state.players) {
        const timeouts = state.timeoutActionsByUser?.[pl.userId] ?? 0;
        const manual = state.manualActionsByUser?.[pl.userId] ?? 0;
        const seat = await tx.tableSeat.findFirst({
          where: { tableId, userId: pl.userId },
        });
        if (!seat) continue;
        if (manual > 0) {
          await tx.tableSeat.update({
            where: { id: seat.id },
            data: { consecutiveIdleHands: 0 },
          });
        } else if (timeouts > 0 && !botUserIds.has(pl.userId)) {
          const next = seat.consecutiveIdleHands + 1;
          if (next >= 3) {
            await tx.tableSeat.update({
              where: { id: seat.id },
              data: {
                consecutiveIdleHands: next,
                sittingOut: true,
                sitOutSince: seat.sitOutSince ?? new Date(),
              },
            });
          } else {
            await tx.tableSeat.update({
              where: { id: seat.id },
              data: { consecutiveIdleHands: next },
            });
          }
        }
      }
    }
  });

  if (tableKind === "TOURNAMENT") {
    await syncTournamentFlightAfterHand(prisma, tableId);
  } else if (tableKind === "SIT_AND_GO") {
    await syncSitAndGoAfterHand(prisma, tableId);
  }
}
