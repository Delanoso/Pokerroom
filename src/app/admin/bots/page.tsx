import { prisma } from "@/lib/prisma";
import { PokerTableKind } from "@prisma/client";
import { AdminBotsPanel, type OpenTableOption } from "../admin-bots-panel";

export default async function AdminBotsPage() {
  const openTablesRaw = await prisma.pokerTable.findMany({
    where: { closedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      minBuyIn: true,
      maxBuyIn: true,
      maxSeats: true,
      startsAt: true,
      tournamentGroupId: true,
      tournamentEntryFeeChips: true,
      tournamentFlightStatus: true,
      seats: { select: { seatIndex: true, userId: true } },
    },
  });

  const seenGroups = new Set<string>();
  const openTablesForBots: OpenTableOption[] = [];

  for (const t of openTablesRaw) {
    if (t.kind === PokerTableKind.TOURNAMENT) {
      if (t.tournamentFlightStatus === "CANCELLED" || t.tournamentFlightStatus === "COMPLETED") {
        continue;
      }
      if (t.tournamentGroupId) {
        if (seenGroups.has(t.tournamentGroupId)) continue;
        seenGroups.add(t.tournamentGroupId);
      }
    }

    openTablesForBots.push({
      id: t.id,
      name: t.name,
      kind: t.kind,
      minBuyIn: t.minBuyIn,
      maxBuyIn: t.maxBuyIn,
      maxSeats: t.maxSeats,
      emptySeats: t.seats.filter((s) => s.userId === null).map((s) => s.seatIndex),
      startsAt: t.startsAt?.toISOString() ?? null,
      tournamentGroupId: t.tournamentGroupId,
      tournamentEntryFeeZar: t.kind === PokerTableKind.TOURNAMENT ? t.tournamentEntryFeeChips : 0,
      tournamentFlightStatus: t.tournamentFlightStatus,
    });
  }

  return <AdminBotsPanel openTables={openTablesForBots} />;
}
