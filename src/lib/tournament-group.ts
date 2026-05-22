import type { Prisma, PrismaClient } from "@prisma/client";
import { findActiveTableHand } from "@/lib/poker/active-hand";
import { notifyTableChanged } from "@/lib/notify-table";
import { desiredTournamentTableCount } from "@/lib/tournament-table-scale";
import { createPokerTableRow } from "@/lib/poker-table-create";

export async function groupRegistrationCapacity(prisma: PrismaClient, groupId: string): Promise<number> {
  const rows = await prisma.pokerTable.findMany({
    where: { tournamentGroupId: groupId, closedAt: null },
    select: { maxSeats: true },
  });
  return rows.reduce((s, r) => s + r.maxSeats, 0);
}

export async function countGroupRegistrations(prisma: PrismaClient, groupId: string): Promise<number> {
  return prisma.tournamentGroupRegistration.count({ where: { groupId } });
}

export async function hasGroupRegistration(prisma: PrismaClient, groupId: string, userId: string): Promise<boolean> {
  const r = await prisma.tournamentGroupRegistration.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true },
  });
  return !!r;
}

export async function listGroupTableIds(prisma: PrismaClient, groupId: string): Promise<string[]> {
  const rows = await prisma.pokerTable.findMany({
    where: { tournamentGroupId: groupId, closedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.id);
}

export async function siblingTableIdsInGroup(
  prisma: PrismaClient,
  groupId: string,
  excludeTableId: string,
): Promise<string[]> {
  const ids = await listGroupTableIds(prisma, groupId);
  return ids.filter((id) => id !== excludeTableId);
}

export async function userSeatedInGroup(prisma: PrismaClient, groupId: string, userId: string): Promise<boolean> {
  const ids = await listGroupTableIds(prisma, groupId);
  if (ids.length === 0) return false;
  return !!(await prisma.tableSeat.findFirst({
    where: { tableId: { in: ids }, userId },
    select: { id: true },
  }));
}

export async function anyActiveHandInGroup(prisma: PrismaClient, groupId: string): Promise<boolean> {
  const ids = await listGroupTableIds(prisma, groupId);
  for (const tid of ids) {
    const h = await findActiveTableHand(prisma, tid);
    if (h) return true;
  }
  return false;
}

/**
 * When one table is fuller than another by 2+ seated players, move one player (same stack)
 * to an empty seat on the lightest table. Skips if any table in the group has an active hand.
 */
export async function tryRebalanceTournamentGroup(prisma: PrismaClient, groupId: string): Promise<boolean> {
  if (await anyActiveHandInGroup(prisma, groupId)) return false;

  const tables = await prisma.pokerTable.findMany({
    where: { tournamentGroupId: groupId, closedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (tables.length < 2) return false;

  const counts = await Promise.all(
    tables.map(async (t) => {
      const seated = await prisma.tableSeat.count({ where: { tableId: t.id, userId: { not: null } } });
      return { tableId: t.id, seated };
    }),
  );

  const maxC = Math.max(...counts.map((c) => c.seated));
  const minC = Math.min(...counts.map((c) => c.seated));
  if (maxC - minC <= 1) return false;

  const hi = counts.reduce((a, b) => (b.seated > a.seated ? b : a));
  const lo = counts.reduce((a, b) => (b.seated < a.seated ? b : a));
  if (hi.tableId === lo.tableId) return false;

  const moved = await prisma.$transaction(async (tx) => {
    const occupied = await tx.tableSeat.findMany({
      where: { tableId: hi.tableId, userId: { not: null } },
      orderBy: { seatIndex: "asc" },
    });
    const victim = occupied[0];
    if (!victim?.userId) return false;

    const dest = await tx.tableSeat.findFirst({
      where: { tableId: lo.tableId, userId: null },
      orderBy: { seatIndex: "asc" },
    });
    if (!dest) return false;

    await tx.tableSeat.update({
      where: { id: victim.id },
      data: {
        userId: null,
        stackChips: 0,
        sittingOut: false,
        sitOutSince: null,
        sitOutNextHand: false,
        waitingForNextHand: false,
        consecutiveIdleHands: 0,
      },
    });
    await tx.tableSeat.update({
      where: { id: dest.id },
      data: {
        userId: victim.userId,
        stackChips: victim.stackChips,
        sittingOut: false,
        sitOutSince: null,
        sitOutNextHand: false,
        waitingForNextHand: false,
        consecutiveIdleHands: 0,
      },
    });
    return true;
  });

  if (moved) {
    void notifyTableChanged(hi.tableId);
    void notifyTableChanged(lo.tableId);
    return true;
  }
  return false;
}

export async function rebalanceTournamentGroupFully(prisma: PrismaClient, groupId: string, maxSteps = 16): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const moved = await tryRebalanceTournamentGroup(prisma, groupId);
    if (!moved) break;
  }
}

function tournamentBaseName(tableName: string): string {
  return tableName.replace(/ — Table \d+\/\d+$/, "").trim() || tableName;
}

async function countSeatedPlayers(prisma: PrismaClient, tableId: string): Promise<number> {
  return prisma.tableSeat.count({ where: { tableId, userId: { not: null } } });
}

async function closeEmptyTableIfPossible(prisma: PrismaClient, tableId: string): Promise<boolean> {
  if ((await countSeatedPlayers(prisma, tableId)) > 0) return false;
  if (await findActiveTableHand(prisma, tableId)) return false;
  await prisma.pokerTable.update({ where: { id: tableId }, data: { closedAt: new Date() } });
  return true;
}

/**
 * Adds or closes tables in a flight based on registration count.
 * Empty tables (no seated players, no active hand) are closed when scaling down.
 */
export async function syncTournamentGroupTables(prisma: PrismaClient, groupId: string): Promise<void> {
  const regCount = await countGroupRegistrations(prisma, groupId);
  const desired = desiredTournamentTableCount(regCount);

  let openTables = await prisma.pokerTable.findMany({
    where: { tournamentGroupId: groupId, closedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (openTables.length === 0) return;

  const template = openTables[0]!;
  const baseName = tournamentBaseName(template.name);

  while (openTables.length < desired) {
    const nextIndex = openTables.length + 1;
    const newId = await prisma.$transaction(async (tx) => {
      const displayName = desired > 1 ? `${baseName} — Table ${nextIndex}/${desired}` : baseName;
      const t = await createPokerTableRow(tx, {
        name: displayName,
        kind: template.kind,
        startsAt: template.startsAt,
        tournamentListingVisibility: template.tournamentListingVisibility,
        tournamentGroupId: groupId,
        smallBlind: template.smallBlind,
        bigBlind: template.bigBlind,
        maxSeats: template.maxSeats,
        minBuyIn: template.minBuyIn,
        maxBuyIn: template.maxBuyIn,
        tournamentEntryFeeChips: template.tournamentEntryFeeChips,
        tournamentStartingStackChips: template.tournamentStartingStackChips,
        tournamentPrize1stZar: template.tournamentPrize1stZar,
        tournamentPrize2ndZar: template.tournamentPrize2ndZar,
        tournamentPrize3rdZar: template.tournamentPrize3rdZar,
        tournamentMinPlayersToStart: template.tournamentMinPlayersToStart,
        tournamentFlightStatus: template.tournamentFlightStatus,
        tournamentEscalatingBlinds: template.tournamentEscalatingBlinds,
        tournamentBlindLevelMinutes: template.tournamentBlindLevelMinutes,
        tournamentBlindLevelMultiplierBps: template.tournamentBlindLevelMultiplierBps,
        tournamentBlindLevel: template.tournamentBlindLevel,
        tournamentBlindLevelEndsAt: template.tournamentBlindLevelEndsAt,
        tournamentBlindBaseSmallBlind: template.tournamentBlindBaseSmallBlind,
        tournamentBlindBaseBigBlind: template.tournamentBlindBaseBigBlind,
        createdById: template.createdById,
      });
      await tx.tableSeat.createMany({
        data: Array.from({ length: template.maxSeats }, (_, seatIndex) => ({
          tableId: t.id,
          seatIndex,
          stackChips: 0,
        })),
      });
      const firstTableId = openTables[0]!.id;
      const invites = await tx.tournamentInvite.findMany({
        where: { tableId: firstTableId },
        select: { userId: true },
      });
      for (const inv of invites) {
        await tx.tournamentInvite.upsert({
          where: { tableId_userId: { tableId: t.id, userId: inv.userId } },
          create: { tableId: t.id, userId: inv.userId },
          update: {},
        });
      }
      return t.id;
    });
    void notifyTableChanged(newId);
    openTables = await prisma.pokerTable.findMany({
      where: { tournamentGroupId: groupId, closedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  while (openTables.length > desired) {
    const excess = openTables[openTables.length - 1]!;
    const closed = await closeEmptyTableIfPossible(prisma, excess.id);
    if (!closed) break;
    void notifyTableChanged(excess.id);
    openTables = openTables.slice(0, -1);
  }

  if (openTables.length > 1) {
    for (let i = 0; i < openTables.length; i++) {
      const wantName = `${baseName} — Table ${i + 1}/${openTables.length}`;
      if (openTables[i]!.name !== wantName) {
        await prisma.pokerTable.update({ where: { id: openTables[i]!.id }, data: { name: wantName } });
      }
    }
  }

  await rebalanceTournamentGroupFully(prisma, groupId);
  const ids = await listGroupTableIds(prisma, groupId);
  for (const tid of ids) void notifyTableChanged(tid);
}
