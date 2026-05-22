import type { Prisma, PrismaClient } from "@prisma/client";
import { PokerTableKind, TournamentFlightStatus } from "@prisma/client";
import { refundTournamentEntryFee } from "@/lib/house-fees";
import {
  LEDGER_TOURNAMENT_PRIZE_EXPENSE,
  LEDGER_TOURNAMENT_PRIZE_PAID,
  insertLedgerEntrySql,
} from "@/lib/house-fees-sql";
import { notifyTableChanged } from "@/lib/notify-table";
import { initializeTournamentBlindSchedule } from "@/lib/tournament-blind-escalation";
import { findActiveTableHand } from "@/lib/poker/active-hand";
import {
  countGroupRegistrations,
  listGroupTableIds,
} from "@/lib/tournament-group";
import { tournamentPrizesFromTable } from "@/lib/tournament-prizes";

export type FlightContext = {
  anchorTableId: string;
  flightKey: string;
  isGroup: boolean;
  hostUserId: string;
  tableName: string;
  entryFeeZar: number;
  minPlayers: number;
  status: TournamentFlightStatus | null;
  prizes: ReturnType<typeof tournamentPrizesFromTable>;
};

export function resolveFlightKey(table: { id: string; tournamentGroupId: string | null }): string {
  return table.tournamentGroupId ?? table.id;
}

export async function loadFlightContext(
  prisma: PrismaClient,
  tableId: string,
): Promise<FlightContext | null> {
  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: {
      id: true,
      name: true,
      kind: true,
      closedAt: true,
      createdById: true,
      tournamentGroupId: true,
      tournamentEntryFeeChips: true,
      tournamentMinPlayersToStart: true,
      tournamentFlightStatus: true,
      tournamentPrize1stZar: true,
      tournamentPrize2ndZar: true,
      tournamentPrize3rdZar: true,
    },
  });
  if (!table || table.closedAt || table.kind !== PokerTableKind.TOURNAMENT) return null;

  return {
    anchorTableId: table.id,
    flightKey: resolveFlightKey(table),
    isGroup: !!table.tournamentGroupId,
    hostUserId: table.createdById,
    tableName: table.name,
    entryFeeZar: table.tournamentEntryFeeChips ?? 0,
    minPlayers: Math.max(2, table.tournamentMinPlayersToStart ?? 2),
    status: table.tournamentFlightStatus,
    prizes: tournamentPrizesFromTable(table),
  };
}

export async function countFlightRegistrations(prisma: PrismaClient, ctx: FlightContext): Promise<number> {
  if (ctx.isGroup) {
    return countGroupRegistrations(prisma, ctx.flightKey);
  }
  return prisma.tournamentRegistration.count({ where: { tableId: ctx.anchorTableId } });
}

export async function listFlightTableIds(prisma: PrismaClient, ctx: FlightContext): Promise<string[]> {
  if (ctx.isGroup) return listGroupTableIds(prisma, ctx.flightKey);
  return [ctx.anchorTableId];
}

async function setFlightStatus(
  prisma: PrismaClient,
  ctx: FlightContext,
  status: TournamentFlightStatus,
): Promise<void> {
  if (ctx.isGroup) {
    await prisma.pokerTable.updateMany({
      where: { tournamentGroupId: ctx.flightKey, closedAt: null },
      data: { tournamentFlightStatus: status },
    });
  } else {
    await prisma.pokerTable.update({
      where: { id: ctx.anchorTableId },
      data: { tournamentFlightStatus: status },
    });
  }
  if (status === TournamentFlightStatus.RUNNING) {
    await initializeTournamentBlindSchedule(prisma, ctx.anchorTableId);
  }
}

async function listRegistrantUserIds(prisma: PrismaClient, ctx: FlightContext): Promise<string[]> {
  if (ctx.isGroup) {
    const rows = await prisma.tournamentGroupRegistration.findMany({
      where: { groupId: ctx.flightKey },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
  const rows = await prisma.tournamentRegistration.findMany({
    where: { tableId: ctx.anchorTableId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function countPlayersWithChips(prisma: PrismaClient, ctx: FlightContext): Promise<number> {
  const tableIds = await listFlightTableIds(prisma, ctx);
  const seats = await prisma.tableSeat.findMany({
    where: { tableId: { in: tableIds }, userId: { not: null }, stackChips: { gt: 0 } },
    select: { userId: true },
  });
  return new Set(seats.map((s) => s.userId!)).size;
}

/**
 * Prize / bust / close logic only after the field can play or eliminations have started.
 * Prevents closing the flight when a single player sits before others join.
 */
async function shouldRunTournamentPrizeSync(
  prisma: PrismaClient,
  ctx: FlightContext,
): Promise<boolean> {
  const [withChips, elimCount, activeHand] = await Promise.all([
    countPlayersWithChips(prisma, ctx),
    prisma.tournamentElimination.count({ where: { flightKey: ctx.flightKey } }),
    anyActiveHandInFlight(prisma, ctx),
  ]);
  return activeHand || elimCount > 0 || withChips >= 2;
}

/** Registered players who have not been eliminated (may still be unseated). */
async function countActiveRegistrantsInFlight(
  prisma: PrismaClient,
  ctx: FlightContext,
): Promise<number> {
  const userIds = await listRegistrantUserIds(prisma, ctx);
  if (userIds.length === 0) return 0;
  const eliminated = await prisma.tournamentElimination.findMany({
    where: { flightKey: ctx.flightKey, userId: { in: userIds } },
    select: { userId: true },
  });
  const eliminatedSet = new Set(eliminated.map((e) => e.userId));
  return userIds.filter((id) => !eliminatedSet.has(id)).length;
}

async function solePlayerWithChips(
  prisma: PrismaClient,
  ctx: FlightContext,
): Promise<string | null> {
  const tableIds = await listFlightTableIds(prisma, ctx);
  const seats = await prisma.tableSeat.findMany({
    where: { tableId: { in: tableIds }, userId: { not: null }, stackChips: { gt: 0 } },
    select: { userId: true },
  });
  const ids = [...new Set(seats.map((s) => s.userId!))];
  return ids.length === 1 ? ids[0]! : null;
}

async function getPaidPlaces(prisma: PrismaClient, flightKey: string): Promise<Set<number>> {
  const rows = await prisma.tournamentPlacement.findMany({
    where: { flightKey, paidAt: { not: null } },
    select: { place: true },
  });
  return new Set(rows.map((r) => r.place));
}

async function getPlacedUserIds(prisma: PrismaClient, flightKey: string): Promise<Set<string>> {
  const rows = await prisma.tournamentPlacement.findMany({
    where: { flightKey },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/** Most recently eliminated player not yet assigned a prize place. */
async function latestUnplacedElimination(
  prisma: PrismaClient,
  flightKey: string,
  excludeUserIds: Set<string>,
): Promise<string | null> {
  const eliminations = await prisma.tournamentElimination.findMany({
    where: { flightKey },
    orderBy: { bustOrder: "desc" },
    select: { userId: true },
  });
  for (const e of eliminations) {
    if (!excludeUserIds.has(e.userId)) return e.userId;
  }
  return null;
}

async function payPlacePrize(
  tx: Prisma.TransactionClient,
  hostUserId: string,
  playerUserId: string,
  amount: number,
  tableName: string,
  placeLabel: string,
): Promise<void> {
  if (amount <= 0) return;
  await insertLedgerEntrySql(tx, {
    userId: playerUserId,
    amountChips: amount,
    type: LEDGER_TOURNAMENT_PRIZE_PAID,
    note: `Tournament ${placeLabel} place — ${tableName}`,
  });
  await insertLedgerEntrySql(tx, {
    userId: hostUserId,
    amountChips: -amount,
    type: LEDGER_TOURNAMENT_PRIZE_EXPENSE,
    note: `Tournament ${placeLabel} place prize — ${tableName}`,
  });
}

async function recordPlacement(
  tx: Prisma.TransactionClient,
  flightKey: string,
  place: number,
  userId: string,
  prizeZar: number,
  paid: boolean,
): Promise<void> {
  const paidAt = paid && prizeZar > 0 ? new Date() : paid ? new Date() : null;
  await tx.tournamentPlacement.upsert({
    where: { flightKey_place: { flightKey, place } },
    create: { flightKey, place, userId, prizeZar, paidAt },
    update: { userId, prizeZar, paidAt: paidAt ?? undefined },
  });
}

async function archiveTournamentFlight(
  prisma: PrismaClient,
  ctx: FlightContext,
  status: TournamentFlightStatus,
  registrationCount: number,
  winnerId: string | null,
): Promise<void> {
  const existing = await prisma.tournamentFlightArchive.findUnique({
    where: { flightKey: ctx.flightKey },
    select: { id: true },
  });
  if (existing) return;
  const eliminations = await prisma.tournamentElimination.findMany({
    where: { flightKey: ctx.flightKey },
    orderBy: { bustOrder: "desc" },
    select: { userId: true, bustOrder: true },
  });

  const existingPlacements = await prisma.tournamentPlacement.findMany({
    where: { flightKey: ctx.flightKey },
    select: { place: true, userId: true, prizeZar: true, paidAt: true },
  });

  const finishOrder: string[] = [];
  if (winnerId) finishOrder.push(winnerId);
  for (const e of eliminations) {
    if (!finishOrder.includes(e.userId)) finishOrder.push(e.userId);
  }

  await prisma.$transaction(async (tx) => {
    const archive = await tx.tournamentFlightArchive.create({
      data: {
        flightKey: ctx.flightKey,
        anchorTableId: ctx.anchorTableId,
        tableName: ctx.tableName,
        hostUserId: ctx.hostUserId,
        entryFeeZar: ctx.entryFeeZar,
        prize1stZar: ctx.prizes.firstZar,
        prize2ndZar: ctx.prizes.secondZar,
        prize3rdZar: ctx.prizes.thirdZar,
        registrationCount,
        status,
      },
    });

    for (let place = 1; place <= 5; place++) {
      const userId = finishOrder[place - 1];
      if (!userId) break;

      const existingRow = existingPlacements.find((p) => p.place === place);
      let prizeZar = existingRow?.prizeZar ?? 0;
      if (!existingRow) {
        if (place === 1) prizeZar = ctx.prizes.firstZar;
        else if (place === 2) prizeZar = ctx.prizes.secondZar;
        else if (place === 3) prizeZar = ctx.prizes.thirdZar;
      }

      await tx.tournamentPlacement.upsert({
        where: { flightKey_place: { flightKey: ctx.flightKey, place } },
        create: {
          flightKey: ctx.flightKey,
          archiveId: archive.id,
          place,
          userId,
          prizeZar,
          paidAt: existingRow?.paidAt ?? null,
        },
        update: {
          archiveId: archive.id,
          userId,
          prizeZar,
        },
      });
    }
  });
}

async function closeTournamentFlight(
  prisma: PrismaClient,
  ctx: FlightContext,
  winnerId: string,
): Promise<void> {
  const tableIds = await listFlightTableIds(prisma, ctx);
  const regCount = await countFlightRegistrations(prisma, ctx);

  await archiveTournamentFlight(prisma, ctx, TournamentFlightStatus.COMPLETED, regCount, winnerId);

  await prisma.$transaction(async (tx) => {
    for (const tableId of tableIds) {
      await tx.tableSeat.updateMany({
        where: { tableId },
        data: { userId: null, stackChips: 0 },
      });
      await tx.pokerTable.update({
        where: { id: tableId },
        data: {
          closedAt: new Date(),
          tournamentFlightStatus: TournamentFlightStatus.COMPLETED,
        },
      });
    }

    if (ctx.isGroup) {
      await tx.tournamentGroupRegistration.deleteMany({ where: { groupId: ctx.flightKey } });
    } else {
      await tx.tournamentRegistration.deleteMany({ where: { tableId: ctx.anchorTableId } });
    }
  });

  for (const tableId of tableIds) void notifyTableChanged(tableId);
  console.log(`[tournament] completed ${ctx.flightKey}`);
}

/**
 * Pay 3rd when 2 remain, 2nd when 1 remains, 1st to winner, then close.
 * Last three in the field play out; each elimination triggers the matching prize.
 */
async function processIncrementalPrizes(
  prisma: PrismaClient,
  ctx: FlightContext,
): Promise<boolean> {
  if (ctx.status === TournamentFlightStatus.COMPLETED || ctx.status === TournamentFlightStatus.CANCELLED) {
    return false;
  }

  const withChips = await countPlayersWithChips(prisma, ctx);
  const elimCount = await prisma.tournamentElimination.count({
    where: { flightKey: ctx.flightKey },
  });
  if (withChips < 2 && elimCount === 0) {
    return false;
  }

  const paid = await getPaidPlaces(prisma, ctx.flightKey);
  const placedUsers = await getPlacedUserIds(prisma, ctx.flightKey);
  const { prizes } = ctx;

  const regCount = await countFlightRegistrations(prisma, ctx);
  if (withChips === 2 && !paid.has(3) && regCount >= 3) {
    const thirdId = await latestUnplacedElimination(prisma, ctx.flightKey, placedUsers);
    if (thirdId) {
      await prisma.$transaction(async (tx) => {
        await payPlacePrize(tx, ctx.hostUserId, thirdId, prizes.thirdZar, ctx.tableName, "3rd");
        await recordPlacement(tx, ctx.flightKey, 3, thirdId, prizes.thirdZar, true);
      });
      placedUsers.add(thirdId);
      paid.add(3);
      console.log(`[tournament] ${ctx.flightKey} paid 3rd to ${thirdId}`);
    }
  }

  if (withChips === 1) {
    const activeRegs = await countActiveRegistrantsInFlight(prisma, ctx);
    // One seated player before others sit is not a win — wait until the field is down to one.
    if (activeRegs > 1) return false;

    const winnerId = await solePlayerWithChips(prisma, ctx);
    if (!winnerId) return false;

    const eliminations = await prisma.tournamentElimination.findMany({
      where: { flightKey: ctx.flightKey },
      orderBy: { bustOrder: "desc" },
      select: { userId: true },
    });
    let unpaidElims = eliminations
      .map((e) => e.userId)
      .filter((id) => id !== winnerId && !placedUsers.has(id));

    let paidNow = await getPaidPlaces(prisma, ctx.flightKey);

    if (!paidNow.has(3) && unpaidElims.length >= 2 && prizes.thirdZar > 0) {
      const thirdId = unpaidElims[unpaidElims.length - 1]!;
      await prisma.$transaction(async (tx) => {
        await payPlacePrize(tx, ctx.hostUserId, thirdId, prizes.thirdZar, ctx.tableName, "3rd");
        await recordPlacement(tx, ctx.flightKey, 3, thirdId, prizes.thirdZar, true);
      });
      placedUsers.add(thirdId);
      unpaidElims = unpaidElims.filter((id) => id !== thirdId);
      paidNow = await getPaidPlaces(prisma, ctx.flightKey);
      console.log(`[tournament] ${ctx.flightKey} paid 3rd to ${thirdId}`);
    }

    if (!paidNow.has(2) && unpaidElims.length >= 1 && prizes.secondZar > 0) {
      const secondId = unpaidElims[0]!;
      await prisma.$transaction(async (tx) => {
        await payPlacePrize(tx, ctx.hostUserId, secondId, prizes.secondZar, ctx.tableName, "2nd");
        await recordPlacement(tx, ctx.flightKey, 2, secondId, prizes.secondZar, true);
      });
      console.log(`[tournament] ${ctx.flightKey} paid 2nd to ${secondId}`);
      paidNow = await getPaidPlaces(prisma, ctx.flightKey);
    }

    if (!paidNow.has(1)) {
      await prisma.$transaction(async (tx) => {
        await payPlacePrize(tx, ctx.hostUserId, winnerId, prizes.firstZar, ctx.tableName, "1st");
        await recordPlacement(tx, ctx.flightKey, 1, winnerId, prizes.firstZar, true);
      });
      console.log(`[tournament] ${ctx.flightKey} paid 1st to ${winnerId}`);
    }

    await closeTournamentFlight(prisma, ctx, winnerId);
    return true;
  }

  return false;
}

/** Refund entry fees, clear seats, close tables, mark CANCELLED. */
export async function cancelTournamentFlight(
  prisma: PrismaClient,
  ctx: FlightContext,
  reason: string,
): Promise<void> {
  if (ctx.status === TournamentFlightStatus.CANCELLED || ctx.status === TournamentFlightStatus.COMPLETED) {
    return;
  }

  const userIds = await listRegistrantUserIds(prisma, ctx);
  const tableIds = await listFlightTableIds(prisma, ctx);
  const regCount = userIds.length;

  await prisma.$transaction(async (tx) => {
    for (const userId of userIds) {
      if (ctx.entryFeeZar > 0) {
        await refundTournamentEntryFee(tx, userId, ctx.hostUserId, ctx.entryFeeZar, ctx.tableName);
      }
    }

    if (ctx.isGroup) {
      await tx.tournamentGroupRegistration.deleteMany({ where: { groupId: ctx.flightKey } });
    } else {
      await tx.tournamentRegistration.deleteMany({ where: { tableId: ctx.anchorTableId } });
    }

    await tx.tournamentElimination.deleteMany({ where: { flightKey: ctx.flightKey } });

    for (const tableId of tableIds) {
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
        data: {
          closedAt: new Date(),
          tournamentFlightStatus: TournamentFlightStatus.CANCELLED,
        },
      });
    }
  });

  await archiveTournamentFlight(prisma, ctx, TournamentFlightStatus.CANCELLED, regCount, null);

  for (const tableId of tableIds) void notifyTableChanged(tableId);
  console.log(`[tournament] cancelled flight ${ctx.flightKey}: ${reason}`);
}

export async function recordTournamentElimination(
  prisma: PrismaClient,
  flightKey: string,
  userId: string,
): Promise<void> {
  const existing = await prisma.tournamentElimination.findUnique({
    where: { flightKey_userId: { flightKey, userId } },
    select: { id: true },
  });
  if (existing) return;

  const max = await prisma.tournamentElimination.aggregate({
    where: { flightKey },
    _max: { bustOrder: true },
  });
  const bustOrder = (max._max.bustOrder ?? 0) + 1;

  await prisma.tournamentElimination.create({
    data: { flightKey, userId, bustOrder },
  });
}

/** Voluntary leave: out of the flight, chips forfeited, no entry-fee refund. */
export async function forfeitPlayerFromTournament(
  prisma: PrismaClient,
  ctx: FlightContext,
  userId: string,
): Promise<void> {
  await recordTournamentElimination(prisma, ctx.flightKey, userId);

  if (ctx.isGroup) {
    await prisma.tournamentGroupRegistration.deleteMany({
      where: { groupId: ctx.flightKey, userId },
    });
  } else {
    await prisma.tournamentRegistration.deleteMany({
      where: { tableId: ctx.anchorTableId, userId },
    });
  }

  await clearPlayerFromFlight(prisma, ctx, userId, false);
}

export async function isUserActiveInFlight(
  prisma: PrismaClient,
  ctx: FlightContext,
  userId: string,
): Promise<boolean> {
  const eliminated = await prisma.tournamentElimination.findUnique({
    where: { flightKey_userId: { flightKey: ctx.flightKey, userId } },
    select: { id: true },
  });
  if (eliminated) return false;

  if (ctx.isGroup) {
    const reg = await prisma.tournamentGroupRegistration.findUnique({
      where: { groupId_userId: { groupId: ctx.flightKey, userId } },
      select: { id: true },
    });
    return !!reg;
  }
  const reg = await prisma.tournamentRegistration.findUnique({
    where: { tableId_userId: { tableId: ctx.anchorTableId, userId } },
    select: { id: true },
  });
  return !!reg;
}

/** Clear busted player from seats (no Zar cash-out). Registration stays until bust flow removes it. */
export async function clearPlayerFromFlight(
  prisma: PrismaClient,
  ctx: FlightContext,
  userId: string,
  recordElimination: boolean,
): Promise<void> {
  const tableIds = await listFlightTableIds(prisma, ctx);
  if (recordElimination) {
    await recordTournamentElimination(prisma, ctx.flightKey, userId);
  }

  for (const tableId of tableIds) {
    await prisma.tableSeat.updateMany({
      where: { tableId, userId },
      data: {
        userId: null,
        stackChips: 0,
        sittingOut: false,
        sitOutNextHand: false,
        waitingForNextHand: false,
      },
    });
    void notifyTableChanged(tableId);
  }
}

/** @deprecated Use processIncrementalPrizes via syncTournamentFlightAfterHand */
export async function completeTournamentFlightAndPayPrizes(
  prisma: PrismaClient,
  ctx: FlightContext,
): Promise<boolean> {
  return processIncrementalPrizes(prisma, ctx);
}

export { syncSitAndGoAfterHand } from "@/lib/poker/sit-and-go-sync";

/** After a hand or seat change: bust zero stacks, then pay prizes / close when appropriate. */
export async function syncTournamentFlightAfterHand(
  prisma: PrismaClient,
  tableId: string,
): Promise<void> {
  const ctx = await loadFlightContext(prisma, tableId);
  if (!ctx) return;
  if (
    ctx.status === TournamentFlightStatus.CANCELLED ||
    ctx.status === TournamentFlightStatus.COMPLETED
  ) {
    return;
  }

  if (ctx.status === TournamentFlightStatus.SCHEDULED || ctx.status === null) {
    await setFlightStatus(prisma, ctx, TournamentFlightStatus.RUNNING);
  }

  if (!(await shouldRunTournamentPrizeSync(prisma, ctx))) {
    return;
  }

  const tableIds = await listFlightTableIds(prisma, ctx);
  const busted = await prisma.tableSeat.findMany({
    where: { tableId: { in: tableIds }, userId: { not: null }, stackChips: 0 },
    select: { userId: true },
  });

  for (const s of busted) {
    if (!s.userId) continue;
    await clearPlayerFromFlight(prisma, ctx, s.userId, true);
  }

  if (await anyActiveHandInFlight(prisma, ctx)) {
    return;
  }

  await processIncrementalPrizes(prisma, ctx);
}

/** At scheduled start: cancel if under min players, otherwise mark running. */
export async function ensureTournamentStartOrCancel(
  prisma: PrismaClient,
  tableId: string,
): Promise<"cancelled" | "inactive" | "ready"> {
  const ctx = await loadFlightContext(prisma, tableId);
  if (!ctx) return "inactive";
  if (
    ctx.status === TournamentFlightStatus.CANCELLED ||
    ctx.status === TournamentFlightStatus.COMPLETED
  ) {
    return "inactive";
  }

  if (ctx.status === TournamentFlightStatus.RUNNING) {
    return "ready";
  }

  const regCount = await countFlightRegistrations(prisma, ctx);
  if (regCount < ctx.minPlayers) {
    await cancelTournamentFlight(
      prisma,
      ctx,
      `Only ${regCount} registered; need ${ctx.minPlayers} to start`,
    );
    return "cancelled";
  }

  await setFlightStatus(prisma, ctx, TournamentFlightStatus.RUNNING);
  return "ready";
}

export async function anyActiveHandInFlight(prisma: PrismaClient, ctx: FlightContext): Promise<boolean> {
  const tableIds = await listFlightTableIds(prisma, ctx);
  for (const tid of tableIds) {
    const h = await findActiveTableHand(prisma, tid);
    if (h) return true;
  }
  return false;
}
