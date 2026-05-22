import type { PrismaClient } from "@prisma/client";
import { PokerTableKind, TournamentFlightStatus, TournamentListingVisibility } from "@prisma/client";
import {
  countGroupRegistrations,
  groupRegistrationCapacity,
  hasGroupRegistration,
  listGroupTableIds,
  siblingTableIdsInGroup,
} from "@/lib/tournament-group";
import { desiredTournamentTableCount } from "@/lib/tournament-table-scale";
import { tournamentPrizesFromTable, type TournamentPrizes } from "@/lib/tournament-prizes";
import { formatBlindMultiplierLabel } from "@/lib/tournament-blind-escalation";
import {
  REGISTRATION_LEAD_MS,
  SITTING_LEAD_MS,
  UNREGISTER_CUTOFF_MS,
} from "@/lib/tournament-constants";

export { REGISTRATION_LEAD_MS, SITTING_LEAD_MS, UNREGISTER_CUTOFF_MS } from "@/lib/tournament-constants";

export function registrationOpensAt(createdAt: Date, startsAt: Date): Date {
  return new Date(Math.max(createdAt.getTime(), startsAt.getTime() - REGISTRATION_LEAD_MS));
}

export function sittingOpensAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - SITTING_LEAD_MS);
}

/** True until 30 seconds before scheduled start (and after registration opens). */
export function unregisterWindowOpen(now: Date, startsAt: Date): boolean {
  return now.getTime() < startsAt.getTime() - UNREGISTER_CUTOFF_MS;
}

/** True between registration open time and the unregister cutoff. */
export function registrationWindowOpen(now: Date, createdAt: Date, startsAt: Date): boolean {
  if (!unregisterWindowOpen(now, startsAt)) return false;
  if (now.getTime() >= startsAt.getTime()) return false;
  return now.getTime() >= registrationOpensAt(createdAt, startsAt).getTime();
}

/** True from 10 minutes before scheduled start onward. */
export function sittingWindowOpen(now: Date, startsAt: Date): boolean {
  return now.getTime() >= sittingOpensAt(startsAt).getTime();
}

export function isPrivateTournamentListing(
  kind: PokerTableKind,
  visibility: TournamentListingVisibility | null | undefined,
): boolean {
  return kind === PokerTableKind.TOURNAMENT && visibility === TournamentListingVisibility.PRIVATE;
}

export async function userMayViewPrivateTournament(
  prisma: PrismaClient,
  tableId: string,
  kind: PokerTableKind,
  visibility: TournamentListingVisibility | null | undefined,
  userId: string,
  hostUserId: string,
  role: string,
): Promise<boolean> {
  if (!isPrivateTournamentListing(kind, visibility)) return true;
  if (role === "ADMIN") return true;
  if (userId === hostUserId) return true;
  const row = await prisma.tournamentInvite.findUnique({
    where: { tableId_userId: { tableId, userId } },
    select: { id: true },
  });
  return !!row;
}

export async function filterOpenTablesForLobby<
  T extends {
    id: string;
    kind: PokerTableKind;
    tournamentListingVisibility: TournamentListingVisibility | null;
    tournamentGroupId: string | null;
    createdById: string;
  },
>(prisma: PrismaClient, tables: T[], userId: string, role: string): Promise<T[]> {
  const privateIds = tables
    .filter((t) => isPrivateTournamentListing(t.kind, t.tournamentListingVisibility))
    .map((t) => t.id);
  if (privateIds.length === 0) return tables;
  if (role === "ADMIN") return tables;
  const invites = await prisma.tournamentInvite.findMany({
    where: { tableId: { in: privateIds }, userId },
    select: { tableId: true },
  });
  const invitedSet = new Set(invites.map((i) => i.tableId));
  return tables.filter((t) => {
    if (!isPrivateTournamentListing(t.kind, t.tournamentListingVisibility)) return true;
    if (t.createdById === userId) return true;
    return invitedSet.has(t.id);
  });
}

export type TournamentViewerSnapshot = {
  listingVisibility: TournamentListingVisibility | null;
  registrationCount: number;
  registrationCap: number;
  tournamentGroupId: string | null;
  siblingTableIds: string[];
  viewerRegistered: boolean;
  registrationOpensAt: string;
  sittingOpensAt: string;
  registrationWindowOpen: boolean;
  unregisterWindowOpen: boolean;
  sittingWindowOpen: boolean;
  registrationFeeZar: number;
  startingStackChips: number;
  prizes: TournamentPrizes;
  activeTableCount: number;
  desiredTableCount: number;
  minPlayersToStart: number;
  flightStatus: TournamentFlightStatus | null;
  escalatingBlinds: boolean;
  blindLevel: number;
  currentSmallBlind: number;
  currentBigBlind: number;
  nextBlindLevelAt: string | null;
  blindLevelMinutes: number;
  blindMultiplierLabel: string;
};

export async function getTournamentViewerSnapshot(
  prisma: PrismaClient,
  table: {
    id: string;
    kind: PokerTableKind;
    startsAt: Date | null;
    createdAt: Date;
    tournamentListingVisibility: TournamentListingVisibility | null;
    tournamentGroupId: string | null;
    maxSeats: number;
    tournamentEntryFeeChips?: number;
    tournamentStartingStackChips?: number;
    tournamentPrize1stZar?: number;
    tournamentPrize2ndZar?: number;
    tournamentPrize3rdZar?: number;
    tournamentMinPlayersToStart?: number;
    tournamentFlightStatus?: TournamentFlightStatus | null;
    tournamentEscalatingBlinds?: boolean;
    tournamentBlindLevel?: number;
    tournamentBlindLevelEndsAt?: Date | null;
    tournamentBlindLevelMinutes?: number;
    tournamentBlindLevelMultiplierBps?: number;
    smallBlind?: number;
    bigBlind?: number;
  },
  userId: string,
  now: Date = new Date(),
): Promise<TournamentViewerSnapshot | null> {
  if (table.kind !== PokerTableKind.TOURNAMENT || !table.startsAt) return null;

  let registrationCount: number;
  let viewerRegistered: boolean;
  let registrationCap: number;
  let siblingTableIds: string[] = [];

  if (table.tournamentGroupId) {
    registrationCap = await groupRegistrationCapacity(prisma, table.tournamentGroupId);
    registrationCount = await countGroupRegistrations(prisma, table.tournamentGroupId);
    viewerRegistered = await hasGroupRegistration(prisma, table.tournamentGroupId, userId);
    siblingTableIds = await siblingTableIdsInGroup(prisma, table.tournamentGroupId, table.id);
  } else {
    registrationCap = table.maxSeats;
    const [rc, vr] = await Promise.all([
      prisma.tournamentRegistration.count({ where: { tableId: table.id } }),
      prisma.tournamentRegistration.findUnique({
        where: { tableId_userId: { tableId: table.id, userId } },
        select: { id: true },
      }),
    ]);
    registrationCount = rc;
    viewerRegistered = !!vr;
  }

  const activeTableCount = table.tournamentGroupId
    ? (await listGroupTableIds(prisma, table.tournamentGroupId)).length
    : 1;

  return {
    listingVisibility: table.tournamentListingVisibility,
    registrationCount,
    registrationCap,
    tournamentGroupId: table.tournamentGroupId,
    siblingTableIds,
    viewerRegistered,
    registrationOpensAt: registrationOpensAt(table.createdAt, table.startsAt).toISOString(),
    sittingOpensAt: sittingOpensAt(table.startsAt).toISOString(),
    registrationWindowOpen: registrationWindowOpen(now, table.createdAt, table.startsAt),
    unregisterWindowOpen: unregisterWindowOpen(now, table.startsAt),
    sittingWindowOpen: sittingWindowOpen(now, table.startsAt),
    registrationFeeZar: table.tournamentEntryFeeChips ?? 0,
    startingStackChips: table.tournamentStartingStackChips ?? 0,
    prizes: tournamentPrizesFromTable(table),
    activeTableCount,
    desiredTableCount: desiredTournamentTableCount(registrationCount),
    minPlayersToStart: Math.max(2, table.tournamentMinPlayersToStart ?? 2),
    flightStatus: table.tournamentFlightStatus ?? null,
    escalatingBlinds: table.tournamentEscalatingBlinds ?? false,
    blindLevel: Math.max(1, table.tournamentBlindLevel ?? 1),
    currentSmallBlind: table.smallBlind ?? 0,
    currentBigBlind: table.bigBlind ?? 0,
    nextBlindLevelAt: table.tournamentBlindLevelEndsAt?.toISOString() ?? null,
    blindLevelMinutes: Math.max(1, table.tournamentBlindLevelMinutes ?? 10),
    blindMultiplierLabel: formatBlindMultiplierLabel(table.tournamentBlindLevelMultiplierBps ?? 20_000),
  };
}
