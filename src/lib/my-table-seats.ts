import type { PrismaClient } from "@prisma/client";
import { findActiveTableHand } from "@/lib/poker/hand-persist";
import { deserializeHandState } from "@/lib/poker/nlhe-engine";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
export type MyTableSeatSummary = {
  tableId: string;
  tableName: string;
  kind: "CASH" | "TOURNAMENT" | "SIT_AND_GO";
  seatIndex: number;
  stackChips: number;
  waitingForNextHand: boolean;
  sittingOut: boolean;
  needsAction: boolean;
  street: string | null;
  handId: string | null;
};

export async function listMyTableSeats(
  prisma: PrismaClient,
  userId: string,
): Promise<MyTableSeatSummary[]> {
  const seats = await prisma.tableSeat.findMany({
    where: { userId, table: { closedAt: null } },
    include: {
      table: {
        select: {
          id: true,
          name: true,
          kind: true,
          startsAt: true,
          createdAt: true,
          tournamentListingVisibility: true,
          tournamentGroupId: true,
          maxSeats: true,
        },
      },
    },
    orderBy: { table: { name: "asc" } },
  });

  const out: MyTableSeatSummary[] = [];
  for (const seat of seats) {
    const meta = await fetchPokerTableTournamentMetaOne(seat.tableId);
    const handRow = await findActiveTableHand(prisma, seat.tableId);
    let needsAction = false;
    let street: string | null = null;
    let handId: string | null = null;

    if (handRow && !seat.waitingForNextHand && !seat.sittingOut) {
      handId = handRow.id;
      const state = deserializeHandState(handRow.stateJson);
      street = state.street;
      const me = state.players.find((p) => p.userId === userId);
      if (
        me &&
        !me.folded &&
        state.toAct === me.seatIndex &&
        state.street !== "COMPLETE" &&
        state.street !== "SHOWDOWN"
      ) {
        needsAction = true;
      }
    }

    out.push({
      tableId: seat.tableId,
      tableName: seat.table.name,
      kind: meta.kind,
      seatIndex: seat.seatIndex,
      stackChips: seat.stackChips,
      waitingForNextHand: seat.waitingForNextHand,
      sittingOut: seat.sittingOut,
      needsAction,
      street,
      handId,
    });
  }

  return out;
}
