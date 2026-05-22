import { PokerTableKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { groupRegistrationCapacity, countGroupRegistrations } from "@/lib/tournament-group";
import { tournamentPrizesFromTable, type TournamentPrizes } from "@/lib/tournament-prizes";

export type OpenTournamentFlightRow = {
  representativeTableId: string;
  tournamentGroupId: string | null;
  name: string;
  hostUsername: string;
  entryFeeZar: number;
  registeredCount: number;
  registrationCap: number;
  entryPoolZar: number;
  startsAt: string | null;
  prizes: TournamentPrizes;
};

/** One row per open tournament flight (deduped by group). */
export async function listOpenTournamentFlights(): Promise<OpenTournamentFlightRow[]> {
  const tables = await prisma.pokerTable.findMany({
    where: { closedAt: null, kind: PokerTableKind.TOURNAMENT },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      startsAt: true,
      tournamentGroupId: true,
      tournamentEntryFeeChips: true,
      tournamentPrize1stZar: true,
      tournamentPrize2ndZar: true,
      tournamentPrize3rdZar: true,
      maxSeats: true,
      createdBy: { select: { username: true } },
    },
  });

  const seenGroups = new Set<string>();
  const rows: OpenTournamentFlightRow[] = [];

  for (const t of tables) {
    if (t.tournamentGroupId && seenGroups.has(t.tournamentGroupId)) continue;
    if (t.tournamentGroupId) seenGroups.add(t.tournamentGroupId);

    let registeredCount: number;
    let registrationCap: number;
    if (t.tournamentGroupId) {
      registeredCount = await countGroupRegistrations(prisma, t.tournamentGroupId);
      registrationCap = await groupRegistrationCapacity(prisma, t.tournamentGroupId);
    } else {
      registeredCount = await prisma.tournamentRegistration.count({ where: { tableId: t.id } });
      registrationCap = t.maxSeats;
    }

    const entryFeeZar = t.tournamentEntryFeeChips ?? 0;
    rows.push({
      representativeTableId: t.id,
      tournamentGroupId: t.tournamentGroupId,
      name: t.name.replace(/ — Table \d+\/\d+$/, "").trim() || t.name,
      hostUsername: t.createdBy.username,
      entryFeeZar,
      registeredCount,
      registrationCap,
      entryPoolZar: registeredCount * entryFeeZar,
      startsAt: t.startsAt?.toISOString() ?? null,
      prizes: tournamentPrizesFromTable(t),
    });
  }

  return rows;
}
