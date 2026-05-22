import type { PrismaClient } from "@prisma/client";
import { recordTournamentEntryFee } from "@/lib/house-fees";
import { notifyTableChanged } from "@/lib/notify-table";
import {
  countGroupRegistrations,
  groupRegistrationCapacity,
  listGroupTableIds,
  syncTournamentGroupTables,
} from "@/lib/tournament-group";
import { registrationWindowOpen, userMayViewPrivateTournament } from "@/lib/tournament-policy";
import { getAvailableChipBalanceTx } from "@/lib/wallet";
import { PokerTableKind } from "@prisma/client";

export type RegisterTournamentResult =
  | { ok: true; already?: boolean }
  | { ok: false; error: string; status: number };

export async function registerUserForTournament(
  prisma: PrismaClient,
  tableId: string,
  userId: string,
  opts?: { role?: string; skipPrivateCheck?: boolean },
): Promise<RegisterTournamentResult> {
  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: {
      id: true,
      name: true,
      closedAt: true,
      kind: true,
      startsAt: true,
      createdAt: true,
      createdById: true,
      maxSeats: true,
      tournamentListingVisibility: true,
      tournamentGroupId: true,
      tournamentEntryFeeChips: true,
      tournamentFlightStatus: true,
    },
  });

  if (!table || table.closedAt) {
    return { ok: false, error: "Table not found", status: 404 };
  }
  if (table.kind !== PokerTableKind.TOURNAMENT || !table.startsAt) {
    return { ok: false, error: "Registration is only for scheduled tournaments", status: 400 };
  }
  if (table.tournamentFlightStatus === "CANCELLED") {
    return { ok: false, error: "This tournament was cancelled", status: 400 };
  }
  if (table.tournamentFlightStatus === "COMPLETED") {
    return { ok: false, error: "This tournament has already finished", status: 400 };
  }

  if (!opts?.skipPrivateCheck) {
    const mayView = await userMayViewPrivateTournament(
      prisma,
      table.id,
      table.kind,
      table.tournamentListingVisibility,
      userId,
      table.createdById,
      opts?.role ?? "USER",
    );
    if (!mayView) {
      return { ok: false, error: "Table not found", status: 404 };
    }
  }

  const now = new Date();
  if (!registrationWindowOpen(now, table.createdAt, table.startsAt)) {
    return { ok: false, error: "Registration is not open for this tournament right now", status: 400 };
  }

  const entryFee = table.tournamentEntryFeeChips ?? 0;

  if (table.tournamentGroupId) {
    const existing = await prisma.tournamentGroupRegistration.findUnique({
      where: { groupId_userId: { groupId: table.tournamentGroupId, userId } },
      select: { id: true },
    });
    if (existing) return { ok: true, already: true };

    const count = await countGroupRegistrations(prisma, table.tournamentGroupId);
    const cap = await groupRegistrationCapacity(prisma, table.tournamentGroupId);
    if (count >= cap) {
      return {
        ok: false,
        error: "This tournament is full — registration matches total seats across all tables in the flight",
        status: 400,
      };
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (entryFee > 0) {
          const available = await getAvailableChipBalanceTx(tx, userId);
          if (available < entryFee) throw new Error("INSUFFICIENT");
          await recordTournamentEntryFee(tx, userId, table.createdById, entryFee, table.name);
        }
        await tx.tournamentGroupRegistration.create({
          data: { groupId: table.tournamentGroupId!, userId },
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "INSUFFICIENT") {
        return {
          ok: false,
          error: `Not enough Zar in your available balance (registration fee is ${entryFee.toLocaleString()} Zar)`,
          status: 400,
        };
      }
      throw e;
    }

    await syncTournamentGroupTables(prisma, table.tournamentGroupId);
    const ids = await listGroupTableIds(prisma, table.tournamentGroupId);
    for (const tid of ids) void notifyTableChanged(tid);
    return { ok: true };
  }

  const regCount = await prisma.tournamentRegistration.count({ where: { tableId } });
  if (regCount >= table.maxSeats) {
    return {
      ok: false,
      error: "This tournament is full — registration matches available seats",
      status: 400,
    };
  }

  const existing = await prisma.tournamentRegistration.findUnique({
    where: { tableId_userId: { tableId, userId } },
    select: { id: true },
  });
  if (existing) return { ok: true, already: true };

  try {
    await prisma.$transaction(async (tx) => {
      if (entryFee > 0) {
        const available = await getAvailableChipBalanceTx(tx, userId);
        if (available < entryFee) throw new Error("INSUFFICIENT");
        await recordTournamentEntryFee(tx, userId, table.createdById, entryFee, table.name);
      }
      await tx.tournamentRegistration.create({ data: { tableId, userId } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT") {
      return {
        ok: false,
        error: `Not enough Zar in your available balance (registration fee is ${entryFee.toLocaleString()} Zar)`,
        status: 400,
      };
    }
    throw e;
  }

  void notifyTableChanged(tableId);
  return { ok: true };
}
