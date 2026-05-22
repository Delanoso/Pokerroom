import type { Prisma, PrismaClient } from "@prisma/client";
import { PokerTableKind, TournamentFlightStatus } from "@prisma/client";
import { notifyTableChanged } from "@/lib/notify-table";
import { listGroupTableIds } from "@/lib/tournament-group";

export type TournamentBlindConfig = {
  escalating: boolean;
  levelMinutes: number;
  multiplierBps: number;
  level: number;
  levelEndsAt: Date | null;
  baseSmallBlind: number;
  baseBigBlind: number;
  smallBlind: number;
  bigBlind: number;
  flightStatus: TournamentFlightStatus | null;
  tournamentGroupId: string | null;
};

/** Blinds for blind level `level` (1 = base). */
export function blindsForLevel(
  baseSmallBlind: number,
  baseBigBlind: number,
  level: number,
  multiplierBps: number,
): { smallBlind: number; bigBlind: number } {
  if (level <= 1) {
    return { smallBlind: baseSmallBlind, bigBlind: baseBigBlind };
  }
  const mult = multiplierBps / 10_000;
  const factor = Math.pow(mult, level - 1);
  return {
    smallBlind: Math.max(1, Math.round(baseSmallBlind * factor)),
    bigBlind: Math.max(1, Math.round(baseBigBlind * factor)),
  };
}

export function formatBlindLevelCountdown(nextBlindLevelAtIso: string, nowMs: number): string {
  const ms = new Date(nextBlindLevelAtIso).getTime() - nowMs;
  if (ms <= 0) return "soon";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBlindMultiplierLabel(multiplierBps: number): string {
  const x = multiplierBps / 10_000;
  if (Math.abs(x - Math.round(x)) < 0.01) return `${Math.round(x)}×`;
  return `${(multiplierBps / 10_000).toFixed(1)}×`;
}

async function listFlightTableIdsForTable(
  prisma: PrismaClient,
  tableId: string,
  groupId: string | null,
): Promise<string[]> {
  if (groupId) return listGroupTableIds(prisma, groupId);
  return [tableId];
}

async function loadBlindTable(
  prisma: PrismaClient,
  tableId: string,
): Promise<TournamentBlindConfig | null> {
  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: {
      kind: true,
      closedAt: true,
      tournamentEscalatingBlinds: true,
      tournamentBlindLevelMinutes: true,
      tournamentBlindLevelMultiplierBps: true,
      tournamentBlindLevel: true,
      tournamentBlindLevelEndsAt: true,
      tournamentBlindBaseSmallBlind: true,
      tournamentBlindBaseBigBlind: true,
      smallBlind: true,
      bigBlind: true,
      tournamentFlightStatus: true,
      tournamentGroupId: true,
    },
  });
  if (!table || table.closedAt || table.kind !== PokerTableKind.TOURNAMENT) return null;

  const baseSmallBlind = table.tournamentBlindBaseSmallBlind || table.smallBlind;
  const baseBigBlind = table.tournamentBlindBaseBigBlind || table.bigBlind;

  return {
    escalating: table.tournamentEscalatingBlinds,
    levelMinutes: Math.max(1, table.tournamentBlindLevelMinutes),
    multiplierBps: Math.max(10_000, table.tournamentBlindLevelMultiplierBps),
    level: Math.max(1, table.tournamentBlindLevel),
    levelEndsAt: table.tournamentBlindLevelEndsAt,
    baseSmallBlind,
    baseBigBlind,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    flightStatus: table.tournamentFlightStatus,
    tournamentGroupId: table.tournamentGroupId,
  };
}

type BlindScheduleUpdate = {
  level: number;
  levelEndsAt: Date;
  baseSmallBlind: number;
  baseBigBlind: number;
  smallBlind: number;
  bigBlind: number;
};

function buildScheduleUpdate(cfg: TournamentBlindConfig, now: Date): BlindScheduleUpdate {
  const baseSmallBlind = cfg.baseSmallBlind;
  const baseBigBlind = cfg.baseBigBlind;
  const level = 1;
  const { smallBlind, bigBlind } = blindsForLevel(baseSmallBlind, baseBigBlind, level, cfg.multiplierBps);
  const levelEndsAt = new Date(now.getTime() + cfg.levelMinutes * 60_000);
  return {
    level,
    levelEndsAt,
    baseSmallBlind,
    baseBigBlind,
    smallBlind,
    bigBlind,
  };
}

async function applyBlindScheduleToFlight(
  prisma: PrismaClient,
  tableIds: string[],
  groupId: string | null,
  anchorTableId: string,
  update: BlindScheduleUpdate,
): Promise<void> {
  const data: Prisma.PokerTableUpdateManyMutationInput = {
    tournamentBlindLevel: update.level,
    tournamentBlindLevelEndsAt: update.levelEndsAt,
    tournamentBlindBaseSmallBlind: update.baseSmallBlind,
    tournamentBlindBaseBigBlind: update.baseBigBlind,
    smallBlind: update.smallBlind,
    bigBlind: update.bigBlind,
  };

  if (groupId) {
    await prisma.pokerTable.updateMany({
      where: { tournamentGroupId: groupId, closedAt: null },
      data,
    });
  } else {
    await prisma.pokerTable.update({
      where: { id: anchorTableId },
      data,
    });
  }

  for (const tid of tableIds) {
    void notifyTableChanged(tid);
  }
}

/** Start blind level 1 when a tournament flight begins (idempotent). */
export async function initializeTournamentBlindSchedule(
  prisma: PrismaClient,
  tableId: string,
  now: Date = new Date(),
): Promise<void> {
  const cfg = await loadBlindTable(prisma, tableId);
  if (!cfg?.escalating) return;
  if (cfg.flightStatus !== TournamentFlightStatus.RUNNING) {
    return;
  }
  if (cfg.levelEndsAt) return;

  const tableIds = await listFlightTableIdsForTable(prisma, tableId, cfg.tournamentGroupId);
  const update = buildScheduleUpdate(cfg, now);
  await applyBlindScheduleToFlight(prisma, tableIds, cfg.tournamentGroupId, tableId, update);
}

/**
 * Advance blind levels when the level timer has elapsed. Active hands keep their
 * posted blinds; the next deal uses updated table blinds.
 */
export async function syncTournamentBlindEscalation(
  prisma: PrismaClient,
  tableId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const cfg = await loadBlindTable(prisma, tableId);
  if (!cfg?.escalating) return false;
  if (cfg.flightStatus !== TournamentFlightStatus.RUNNING) return false;

  if (!cfg.levelEndsAt) {
    await initializeTournamentBlindSchedule(prisma, tableId, now);
    return false;
  }

  if (now.getTime() < cfg.levelEndsAt.getTime()) return false;

  let level = cfg.level;
  let levelEndsAt = cfg.levelEndsAt;
  const levelMs = cfg.levelMinutes * 60_000;

  while (levelEndsAt && now.getTime() >= levelEndsAt.getTime()) {
    level += 1;
    levelEndsAt = new Date(levelEndsAt.getTime() + levelMs);
  }

  if (level === cfg.level) return false;

  const { smallBlind, bigBlind } = blindsForLevel(
    cfg.baseSmallBlind,
    cfg.baseBigBlind,
    level,
    cfg.multiplierBps,
  );

  const tableIds = await listFlightTableIdsForTable(prisma, tableId, cfg.tournamentGroupId);
  await applyBlindScheduleToFlight(prisma, tableIds, cfg.tournamentGroupId, tableId, {
    level,
    levelEndsAt: levelEndsAt!,
    baseSmallBlind: cfg.baseSmallBlind,
    baseBigBlind: cfg.baseBigBlind,
    smallBlind,
    bigBlind,
  });

  return true;
}
