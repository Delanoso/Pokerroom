import type { PrismaClient } from "@prisma/client";
import { notifyTableChanged } from "@/lib/notify-table";
import { advanceActiveHandState, type AdvanceHandOptions } from "./advance-hand-state";
import { resolveShowdownWhenRevealElapsed } from "./resolve-showdown-when-reveal-elapsed";
import { awardPotFromState } from "./apply-pot-rake";
import { finalizeCompletedHand, findActiveTableHand } from "./hand-persist";
import { assignHandResultMessage, snapshotStacks } from "./hand-result-message";
import { deserializeHandState, runShowdown, serializeHandState } from "./nlhe-engine";
import type { NlheHandState } from "./types";
import { tryAutoStartHand } from "./try-auto-start-hand";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";

export type ReconcileActiveHandOptions = AdvanceHandOptions & {
  /** Do not deal the next hand after finalizing (admin close / end of SnG). */
  skipAutoStart?: boolean;
};

function alivePlayers(state: NlheHandState) {
  return state.players.filter((p) => !p.folded);
}

function handComplete(state: NlheHandState): boolean {
  return state.street === "COMPLETE";
}

function completeHandAsSingleWinner(state: NlheHandState): void {
  const before = snapshotStacks(state);
  awardPotFromState(state);
  state.street = "COMPLETE";
  state.toAct = null;
  state.turnDeadlineIso = undefined;
  state.showdownRevealUntilIso = undefined;
  assignHandResultMessage(state, before);
}

/**
 * Fixes in-progress hands when players left the table, too few seats remain,
 * or SHOWDOWN is waiting past the reveal window but nothing polled finalize.
 */
export function reconcileHandWithTableSeats(
  state: NlheHandState,
  seatedUserIds: Set<string>,
  eligibleSeatedCount: number,
  seatStackByUserId?: Map<string, number>,
  options?: AdvanceHandOptions,
): NlheHandState {
  if (state.street === "COMPLETE") return state;

  for (const p of state.players) {
    if (!p.folded && !seatedUserIds.has(p.userId)) {
      p.folded = true;
    }
    const seatStack = seatStackByUserId?.get(p.userId);
    if (!p.folded && seatStack !== undefined && seatStack <= 0) {
      p.folded = true;
    }
  }

  let alive = alivePlayers(state);
  if (alive.length === 1) {
    completeHandAsSingleWinner(state);
    return state;
  }

  if (state.street === "SHOWDOWN") {
    if (options?.forceShowdown) {
      delete state.showdownRevealUntilIso;
      runShowdown(state);
    } else {
      resolveShowdownWhenRevealElapsed(state, Date.now());
    }
    if (state.street === "SHOWDOWN") {
      alive = alivePlayers(state);
      if (alive.length === 1) {
        completeHandAsSingleWinner(state);
      }
    }
  }

  if (handComplete(state)) return state;

  if (eligibleSeatedCount < 2) {
    alive = alivePlayers(state);
    if (alive.length > 1 && seatStackByUserId) {
      for (const p of state.players) {
        if (!p.folded && (seatStackByUserId.get(p.userId) ?? 0) <= 0) {
          p.folded = true;
        }
      }
      alive = alivePlayers(state);
    }
    if (alive.length <= 1) {
      if (alive.length === 1) {
        completeHandAsSingleWinner(state);
      } else {
        state.street = "COMPLETE";
        state.toAct = null;
        state.turnDeadlineIso = undefined;
        state.showdownRevealUntilIso = undefined;
      }
    }
  }

  return state;
}

/**
 * Loads the active hand (if any), reconciles vs current seats, persists or finalizes.
 * Returns true when the hand row changed or was completed.
 */
/**
 * Last-resort: force the open hand to COMPLETE and persist seat stacks.
 * Used when admin close still sees an incomplete hand after reconcile passes.
 */
export async function forceCompleteActiveHandForTableClose(
  prisma: PrismaClient,
  tableId: string,
): Promise<boolean> {
  const row = await findActiveTableHand(prisma, tableId);
  if (!row) return false;

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: { dealerButtonSeat: true, closedAt: true },
  });
  if (!table || table.closedAt) return false;

  const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;
  const seats = await prisma.tableSeat.findMany({
    where: { tableId, userId: { not: null } },
    select: { userId: true, stackChips: true },
  });
  const seatStackByUserId = new Map(seats.map((s) => [s.userId!, s.stackChips] as const));

  const state = deserializeHandState(row.stateJson);
  advanceActiveHandState(state, Date.now(), { forceShowdown: true });
  reconcileHandWithTableSeats(
    state,
    new Set(seats.map((s) => s.userId!)),
    seats.filter((s) => s.stackChips > 0).length,
    seatStackByUserId,
    { forceShowdown: true },
  );
  advanceActiveHandState(state, Date.now(), { forceShowdown: true });

  if (state.street !== "COMPLETE") {
    const alive = state.players.filter((p) => !p.folded);
    if (alive.length === 1) {
      completeHandAsSingleWinner(state);
    } else if (alive.length === 0) {
      state.street = "COMPLETE";
      state.toAct = null;
      state.turnDeadlineIso = undefined;
      state.showdownRevealUntilIso = undefined;
    } else {
      const bySeatStack = [...alive].sort(
        (a, b) => (seatStackByUserId.get(b.userId) ?? b.stack) - (seatStackByUserId.get(a.userId) ?? a.stack),
      );
      for (const p of state.players) {
        if (p.userId !== bySeatStack[0]!.userId) p.folded = true;
      }
      completeHandAsSingleWinner(state);
    }
  }

  await finalizeCompletedHand(
    prisma,
    tableId,
    row.id,
    state,
    table.dealerButtonSeat ?? 0,
    tableKind,
  );
  void notifyTableChanged(tableId);
  return true;
}

export async function reconcileAndPersistActiveHand(
  prisma: PrismaClient,
  tableId: string,
  options?: ReconcileActiveHandOptions,
): Promise<boolean> {
  const row = await findActiveTableHand(prisma, tableId);
  if (!row) return false;

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: { dealerButtonSeat: true, closedAt: true },
  });
  if (!table || table.closedAt) return false;

  const seats = await prisma.tableSeat.findMany({
    where: { tableId, userId: { not: null } },
    select: {
      userId: true,
      stackChips: true,
      sittingOut: true,
      sitOutNextHand: true,
      waitingForNextHand: true,
    },
  });

  const seatedUserIds = new Set(seats.map((s) => s.userId!));
  const seatStackByUserId = new Map(seats.map((s) => [s.userId!, s.stackChips] as const));
  /** Seats that can be dealt in next hand — excludes sitting out, not sit-out-next-hand (still in current hand). */
  const eligibleSeatedCount = seats.filter(
    (s) => s.stackChips > 0 && !s.sittingOut && !s.waitingForNextHand,
  ).length;

  const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;
  const state = deserializeHandState(row.stateJson);
  advanceActiveHandState(state, Date.now(), options);

  if (state.street === "COMPLETE") {
    await finalizeCompletedHand(
      prisma,
      tableId,
      row.id,
      state,
      table.dealerButtonSeat ?? 0,
      tableKind,
    );
    if (!options?.skipAutoStart && tableKind !== "SIT_AND_GO") {
      await tryAutoStartHand(prisma, tableId);
    }
    void notifyTableChanged(tableId);
    return true;
  }

  const next = reconcileHandWithTableSeats(
    state,
    seatedUserIds,
    eligibleSeatedCount,
    seatStackByUserId,
    options,
  );
  advanceActiveHandState(next, Date.now(), options);
  const nextJson = serializeHandState(next);

  if (nextJson === row.stateJson) return false;

  if (next.street === "COMPLETE") {
    await finalizeCompletedHand(
      prisma,
      tableId,
      row.id,
      next,
      table.dealerButtonSeat ?? 0,
      tableKind,
    );
    if (!options?.skipAutoStart && tableKind !== "SIT_AND_GO") {
      await tryAutoStartHand(prisma, tableId);
    }
    void notifyTableChanged(tableId);
    return true;
  }

  await prisma.tableHand.update({
    where: { id: row.id },
    data: { stateJson: nextJson },
  });
  void notifyTableChanged(tableId);
  return true;
}
