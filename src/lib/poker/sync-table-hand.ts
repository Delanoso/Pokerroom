import type { PrismaClient } from "@prisma/client";
import { notifyTableChanged } from "@/lib/notify-table";
import { removeCashSittersPastSitOutLimit } from "@/lib/poker/cash-long-sit-out-kick";
import { finalizeCompletedHand, findActiveTableHand } from "@/lib/poker/hand-persist";
import { advanceActiveHandState } from "@/lib/poker/advance-hand-state";
import { deserializeHandState, serializeHandState } from "@/lib/poker/nlhe-engine";
import { toPublicHandState, type PublicHandState } from "@/lib/poker/public-state";
import { reconcileAndPersistActiveHand } from "@/lib/poker/reconcile-active-hand";
import { tryAutoStartHand } from "@/lib/poker/try-auto-start-hand";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { syncSitAndGoAfterHand } from "@/lib/poker/sit-and-go-sync";
import { syncTournamentFlightAfterHand } from "@/lib/tournament-flight";

export type SyncTableHandResult = {
  handId: string | null;
  hand: PublicHandState | null;
  tableKind: "CASH" | "TOURNAMENT" | "SIT_AND_GO";
};

export type SyncTableHandOptions = {
  /** Viewer for hole cards / legal actions. Use null for system worker. */
  viewerUserId?: string | null;
  /**
   * When true, only load persisted state (no timers, reconcile, or auto-start).
   * Used by GET /hand when the table worker advances game clocks.
   */
  readOnly?: boolean;
};

/** Open tables that need worker ticks (seated players and/or incomplete hand). */
export async function listTableIdsForHandWorker(prisma: PrismaClient): Promise<string[]> {
  const [seated, activeHands] = await Promise.all([
    prisma.tableSeat.findMany({
      where: { userId: { not: null }, table: { closedAt: null } },
      distinct: ["tableId"],
      select: { tableId: true },
    }),
    prisma.tableHand.findMany({
      where: { complete: false, table: { closedAt: null } },
      distinct: ["tableId"],
      select: { tableId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const s of seated) ids.add(s.tableId);
  for (const h of activeHands) ids.add(h.tableId);
  return [...ids];
}

async function syncTournamentMetaAfterHand(
  prisma: PrismaClient,
  tableId: string,
  tableKind: "CASH" | "TOURNAMENT" | "SIT_AND_GO",
): Promise<boolean> {
  if (tableKind === "TOURNAMENT") {
    await syncTournamentFlightAfterHand(prisma, tableId);
  } else if (tableKind === "SIT_AND_GO") {
    await syncSitAndGoAfterHand(prisma, tableId);
  }
  const closed = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: { closedAt: true },
  });
  return Boolean(closed?.closedAt);
}

/**
 * Read current hand for a viewer without advancing clocks (expects table worker to run elsewhere).
 */
export async function readTableHandState(
  prisma: PrismaClient,
  tableId: string,
  viewerUserId: string | null,
): Promise<SyncTableHandResult> {
  const table = await prisma.pokerTable.findUnique({ where: { id: tableId } });
  if (!table || table.closedAt) {
    return { handId: null, hand: null, tableKind: "CASH" };
  }
  const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;
  const row = await findActiveTableHand(prisma, tableId);
  if (!row) {
    return { handId: null, hand: null, tableKind };
  }
  const state = deserializeHandState(row.stateJson);
  return {
    handId: row.id,
    hand: toPublicHandState(state, viewerUserId),
    tableKind,
  };
}

/**
 * Advances server-side clocks (timeouts, showdown reveal), reconciles seats, persists,
 * and auto-starts the next hand when appropriate. Same logic as the legacy GET /hand loop.
 */
export async function syncTableHandServer(
  prisma: PrismaClient,
  tableId: string,
  options: SyncTableHandOptions = {},
): Promise<SyncTableHandResult> {
  const viewerUserId = options.viewerUserId ?? null;
  if (options.readOnly) {
    return readTableHandState(prisma, tableId, viewerUserId);
  }

  const table = await prisma.pokerTable.findUnique({ where: { id: tableId } });
  if (!table || table.closedAt) {
    return { handId: null, hand: null, tableKind: "CASH" };
  }

  const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;

  await removeCashSittersPastSitOutLimit(prisma, tableId);
  await reconcileAndPersistActiveHand(prisma, tableId);

  if (tableKind === "TOURNAMENT" || tableKind === "SIT_AND_GO") {
    if (await syncTournamentMetaAfterHand(prisma, tableId, tableKind)) {
      return { handId: null, hand: null, tableKind };
    }
    await reconcileAndPersistActiveHand(prisma, tableId);
  }

  for (let pass = 0; pass < 12; pass++) {
    let row = await findActiveTableHand(prisma, tableId);
    if (!row) {
      if (tableKind === "TOURNAMENT" || tableKind === "SIT_AND_GO") {
        if (await syncTournamentMetaAfterHand(prisma, tableId, tableKind)) {
          return { handId: null, hand: null, tableKind };
        }
      }
      await tryAutoStartHand(prisma, tableId);
      row = await findActiveTableHand(prisma, tableId);
      if (!row) {
        return { handId: null, hand: null, tableKind };
      }
    }

    const state = deserializeHandState(row.stateJson);
    advanceActiveHandState(state, Date.now());
    const nextJson = serializeHandState(state);

    if (nextJson === row.stateJson) {
      return {
        handId: row.id,
        hand: toPublicHandState(state, viewerUserId),
        tableKind,
      };
    }

    if (state.street === "COMPLETE") {
      if (nextJson !== row.stateJson) {
        await prisma.tableHand.update({
          where: { id: row.id },
          data: { stateJson: nextJson },
        });
      }
      const hand = toPublicHandState(state, viewerUserId);
      await finalizeCompletedHand(
        prisma,
        tableId,
        row.id,
        state,
        table.dealerButtonSeat ?? 0,
        tableKind,
      );
      void notifyTableChanged(tableId);
      return { handId: row.id, hand, tableKind };
    }

    await prisma.tableHand.update({
      where: { id: row.id },
      data: { stateJson: nextJson },
    });
    void notifyTableChanged(tableId);
    return {
      handId: row.id,
      hand: toPublicHandState(state, viewerUserId),
      tableKind,
    };
  }

  throw new Error("Hand processing exceeded safety limit");
}

/** Explicit opt-in: GET /hand runs full sync even when a table worker is running. */
export function handAdvanceOnGetEnabled(): boolean {
  const v = process.env.TABLE_HAND_ADVANCE_ON_GET?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Whether GET /hand advances clocks (vs read-only).
 * Production: only when TABLE_HAND_ADVANCE_ON_GET=true (normally the worker handles this).
 * Development: always sync on poll so a crashed worker does not freeze tables mid-hand.
 */
export function handSyncOnGetEnabled(): boolean {
  if (handAdvanceOnGetEnabled()) return true;
  // Advance on browser poll unless explicitly production (Next may omit NODE_ENV in some scripts).
  return process.env.NODE_ENV !== "production";
}
