import type { PrismaClient } from "@prisma/client";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { notifyTableChanged } from "@/lib/notify-table";
import { seatTournamentRegistrants } from "@/lib/tournament-auto-seat";
import { syncTournamentBlindEscalation } from "@/lib/tournament-blind-escalation";
import { BETWEEN_HANDS_DEAL_DELAY_MS } from "./action-timeout";
import { serializeHandState, startNlheHand } from "./nlhe-engine";

/** SQLite `$queryRaw` may return bigint; NLHE state must JSON-serialize. */
function n(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
}

/**
 * Starts a new hand when the table is open, no incomplete hand exists, start rules
 * pass (tournament clock for MTT), and at least two seats are eligible (chips, not sitting out).
 *
 * Uses `$queryRaw` for seat eligibility so a stale Prisma Client (missing generated sit-out fields)
 * does not break auto-deal.
 */
export async function tryAutoStartHand(prisma: PrismaClient, tableId: string): Promise<boolean> {
  const meta = await fetchPokerTableTournamentMetaOne(tableId);
  if (meta.kind === "TOURNAMENT" && meta.startsAt && meta.startsAt.getTime() <= Date.now()) {
    await seatTournamentRegistrants(prisma, tableId);
    await syncTournamentBlindEscalation(prisma, tableId);
  }
  try {
    const started = await prisma.$transaction(async (tx) => {
      const dup = await tx.tableHand.findFirst({
        where: { tableId, complete: false },
        orderBy: { createdAt: "desc" },
      });
      if (dup) return false;

      const lastComplete = await tx.tableHand.findFirst({
        where: { tableId, complete: true },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      });
      if (
        lastComplete &&
        Date.now() - lastComplete.updatedAt.getTime() < BETWEEN_HANDS_DEAL_DELAY_MS
      ) {
        return false;
      }

      const tableRows = await tx.$queryRaw<
        {
          smallBlind: number;
          bigBlind: number;
          maxSeats: number;
          dealerButtonSeat: number | null;
          closedAt: Date | null;
          rakePercentBps: number | null;
          rakeCapChips: number | null;
        }[]
      >`
        SELECT "smallBlind", "bigBlind", "maxSeats", "dealerButtonSeat", "closedAt",
          COALESCE("rakePercentBps", 0) AS "rakePercentBps",
          COALESCE("rakeCapChips", 0) AS "rakeCapChips"
        FROM "PokerTable" WHERE "id" = ${tableId} LIMIT 1
      `;
      const t = tableRows[0];
      if (!t || t.closedAt != null) return false;

      if (meta.kind === "TOURNAMENT" && meta.startsAt && meta.startsAt.getTime() > Date.now()) {
        return false;
      }

      const seatRows = await tx.$queryRaw<
        {
          seatIndex: number;
          userId: string | null;
          stackChips: number;
          sittingOut: boolean;
          sitOutNextHand: boolean;
          waitingForNextHand: boolean;
        }[]
      >`
        SELECT "seatIndex", "userId", "stackChips",
          COALESCE("sittingOut", false) AS "sittingOut",
          COALESCE("sitOutNextHand", false) AS "sitOutNextHand",
          COALESCE("waitingForNextHand", false) AS "waitingForNextHand"
        FROM "TableSeat"
        WHERE "tableId" = ${tableId}
        ORDER BY "seatIndex" ASC
      `;

      const occupiedSeats = seatRows.filter((s) => s.userId != null).length;
      const maxSeats = n(t.maxSeats);
      if (meta.kind === "SIT_AND_GO" && occupiedSeats < maxSeats) {
        return false;
      }

      const eligible = seatRows.filter(
        (s) =>
          s.userId != null &&
          n(s.stackChips) > 0 &&
          !s.sittingOut &&
          !s.sitOutNextHand &&
          !s.waitingForNextHand,
      );
      if (eligible.length < 2) return false;

      const rakeBps = n(t.rakePercentBps);
      const rakeCap = n(t.rakeCapChips);
      const out = startNlheHand({
        smallBlind: n(t.smallBlind),
        bigBlind: n(t.bigBlind),
        dealerButtonSeat: n(t.dealerButtonSeat),
        seats: eligible.map((s) => ({
          seatIndex: n(s.seatIndex),
          userId: s.userId!,
          stackChips: n(s.stackChips),
        })),
        ...(meta.kind === "CASH" && rakeBps > 0
          ? { rakePercentBps: rakeBps, rakeCapChips: rakeCap }
          : {}),
      });
      if (out.error || !out.state) return false;

      await tx.tableHand.create({
        data: {
          tableId,
          complete: false,
          stateJson: serializeHandState(out.state),
        },
      });
      return true;
    });

    if (started) void notifyTableChanged(tableId);
    return started;
  } catch {
    return false;
  }
}
