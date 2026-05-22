import type { PrismaClient } from "@prisma/client";
import { PokerTableKind, TournamentFlightStatus } from "@prisma/client";
import { notifyTableChanged } from "@/lib/notify-table";
import { tryAutoStartHand } from "@/lib/poker/try-auto-start-hand";
import { listGroupTableIds } from "@/lib/tournament-group";
import { ensureTournamentStartOrCancel, isUserActiveInFlight, loadFlightContext } from "@/lib/tournament-flight";

async function seatUserOnTable(
  prisma: PrismaClient,
  tableId: string,
  userId: string,
  stackChips: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const seat = await tx.tableSeat.findFirst({
      where: { tableId, userId: null },
      orderBy: { seatIndex: "asc" },
    });
    if (!seat) return false;

    await tx.tableSeat.update({
      where: { id: seat.id },
      data: {
        userId,
        stackChips,
        sittingOut: false,
        sitOutNextHand: false,
        waitingForNextHand: false,
      },
    });
    return true;
  });
}

async function pickTableWithOpenSeat(prisma: PrismaClient, tableIds: string[]): Promise<string | null> {
  let best: { tableId: string; seated: number } | null = null;
  for (const tableId of tableIds) {
    const [seated, hasEmpty] = await Promise.all([
      prisma.tableSeat.count({ where: { tableId, userId: { not: null } } }),
      prisma.tableSeat.findFirst({
        where: { tableId, userId: null },
        select: { id: true },
      }),
    ]);
    if (!hasEmpty) continue;
    if (!best || seated < best.seated) {
      best = { tableId, seated };
    }
  }
  return best?.tableId ?? null;
}

async function seatGroupRegistrants(
  prisma: PrismaClient,
  groupId: string,
  stackChips: number,
): Promise<number> {
  const tableIds = await listGroupTableIds(prisma, groupId);
  if (tableIds.length === 0) return 0;

  const [registrations, seatedRows] = await Promise.all([
    prisma.tournamentGroupRegistration.findMany({
      where: { groupId },
      select: { userId: true },
    }),
    prisma.tableSeat.findMany({
      where: { tableId: { in: tableIds }, userId: { not: null } },
      select: { userId: true },
    }),
  ]);

  const seated = new Set(seatedRows.map((s) => s.userId!));
  let count = 0;

  const ctx = await loadFlightContext(prisma, tableIds[0]!);
  if (!ctx) return 0;

  for (const { userId } of registrations) {
    if (seated.has(userId)) continue;
    if (!(await isUserActiveInFlight(prisma, ctx, userId))) continue;
    const tableId = await pickTableWithOpenSeat(prisma, tableIds);
    if (!tableId) break;
    const ok = await seatUserOnTable(prisma, tableId, userId, stackChips);
    if (ok) {
      seated.add(userId);
      count += 1;
      void notifyTableChanged(tableId);
    }
  }

  return count;
}

async function seatTableRegistrants(
  prisma: PrismaClient,
  tableId: string,
  stackChips: number,
): Promise<number> {
  const [registrations, seatedRows] = await Promise.all([
    prisma.tournamentRegistration.findMany({
      where: { tableId },
      select: { userId: true },
    }),
    prisma.tableSeat.findMany({
      where: { tableId, userId: { not: null } },
      select: { userId: true },
    }),
  ]);

  const seated = new Set(seatedRows.map((s) => s.userId!));
  let count = 0;

  const ctx = await loadFlightContext(prisma, tableId);
  if (!ctx) return 0;

  for (const { userId } of registrations) {
    if (seated.has(userId)) continue;
    if (!(await isUserActiveInFlight(prisma, ctx, userId))) continue;
    const ok = await seatUserOnTable(prisma, tableId, userId, stackChips);
    if (ok) {
      seated.add(userId);
      count += 1;
    }
  }

  if (count > 0) void notifyTableChanged(tableId);
  return count;
}

/**
 * Seats all registered players who are not yet seated once the scheduled start time has passed.
 * Does not require players to be online.
 */
export async function seatTournamentRegistrants(
  prisma: PrismaClient,
  tableId: string,
): Promise<number> {
  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: {
      id: true,
      kind: true,
      closedAt: true,
      startsAt: true,
      tournamentGroupId: true,
      tournamentStartingStackChips: true,
      tournamentFlightStatus: true,
      minBuyIn: true,
    },
  });

  if (!table || table.closedAt || table.kind !== PokerTableKind.TOURNAMENT || !table.startsAt) {
    return 0;
  }
  if (
    table.tournamentFlightStatus === TournamentFlightStatus.CANCELLED ||
    table.tournamentFlightStatus === TournamentFlightStatus.COMPLETED
  ) {
    return 0;
  }
  if (table.startsAt.getTime() > Date.now()) return 0;

  const stackChips = table.tournamentStartingStackChips || table.minBuyIn;
  if (stackChips < 1) return 0;

  if (table.tournamentGroupId) {
    return seatGroupRegistrants(prisma, table.tournamentGroupId, stackChips);
  }
  return seatTableRegistrants(prisma, table.id, stackChips);
}

const TOURNAMENT_TICK_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Poll hook: seat late registrants and try to deal for tournaments at or past start time. */
export async function tickTournamentsReadyToStart(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const lookback = new Date(now.getTime() - TOURNAMENT_TICK_LOOKBACK_MS);

  const dueTables = await prisma.pokerTable.findMany({
    where: {
      kind: PokerTableKind.TOURNAMENT,
      closedAt: null,
      startsAt: { lte: now, gte: lookback },
    },
    select: { id: true, tournamentGroupId: true },
    orderBy: { createdAt: "asc" },
  });

  const seenGroups = new Set<string>();
  const anchorTableIds: string[] = [];

  for (const t of dueTables) {
    if (t.tournamentGroupId) {
      if (seenGroups.has(t.tournamentGroupId)) continue;
      seenGroups.add(t.tournamentGroupId);
    }
    anchorTableIds.push(t.id);
  }

  for (const anchorId of anchorTableIds) {
    const anchor = dueTables.find((t) => t.id === anchorId);
    if (!anchor) continue;

    const start = await ensureTournamentStartOrCancel(prisma, anchorId);
    if (start === "cancelled" || start === "inactive") continue;

    await seatTournamentRegistrants(prisma, anchorId);

    const tableIds = anchor.tournamentGroupId
      ? await listGroupTableIds(prisma, anchor.tournamentGroupId)
      : [anchorId];

    for (const tid of tableIds) {
      await tryAutoStartHand(prisma, tid);
    }
  }
}
