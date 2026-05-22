import { auth } from "@/auth";
import { PlayerTopNav } from "@/components/player-top-nav";
import { PokerChrome } from "@/components/poker-chrome";
import { prisma } from "@/lib/prisma";
import { listOpenTableIds } from "@/lib/open-table-ids";
import { fetchPokerTableTournamentMeta } from "@/lib/poker-table-tournament-meta";
import {
  filterOpenTablesForLobby,
  registrationWindowOpen,
  unregisterWindowOpen,
} from "@/lib/tournament-policy";
import { tournamentPrizesFromTable } from "@/lib/tournament-prizes";
import { getAvailableChipBalance } from "@/lib/wallet";
import { PokerTableKind } from "@prisma/client";
import { redirect } from "next/navigation";
import { TablesClient } from "./tables-client";

export default async function TablesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const openIds = await listOpenTableIds();
  const tablesRaw =
    openIds.length === 0
      ? []
      : await prisma.pokerTable.findMany({
          where: { id: { in: openIds } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            kind: true,
            startsAt: true,
            tournamentListingVisibility: true,
            tournamentGroupId: true,
            createdById: true,
            smallBlind: true,
            bigBlind: true,
            maxSeats: true,
            minBuyIn: true,
            maxBuyIn: true,
            tournamentEntryFeeChips: true,
            tournamentStartingStackChips: true,
            tournamentPrize1stZar: true,
            tournamentPrize2ndZar: true,
            tournamentPrize3rdZar: true,
            tournamentMinPlayersToStart: true,
            tournamentFlightStatus: true,
            tournamentEscalatingBlinds: true,
            createdAt: true,
            createdBy: { select: { username: true } },
            seats: { select: { userId: true } },
          },
        });

  const tablesFiltered = await filterOpenTablesForLobby(prisma, tablesRaw, session.user.id, session.user.role);
  const seenGroups = new Set<string>();
  const tables = [...tablesFiltered]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .filter((t) => {
      if (t.kind === PokerTableKind.TOURNAMENT && t.tournamentFlightStatus === "CANCELLED") {
        return false;
      }
      if (!t.tournamentGroupId) return true;
      if (seenGroups.has(t.tournamentGroupId)) return false;
      seenGroups.add(t.tournamentGroupId);
      return true;
    });
  const metaById = await fetchPokerTableTournamentMeta(tables.map((t) => t.id));

  const regCounts =
    tables.length === 0
      ? []
      : await prisma.tournamentRegistration.groupBy({
          by: ["tableId"],
          where: { tableId: { in: tables.map((t) => t.id) } },
          _count: { id: true },
        });
  const regByTable = new Map(regCounts.map((r) => [r.tableId, r._count.id]));

  const groupIds = [...new Set(tables.map((t) => t.tournamentGroupId).filter((g): g is string => !!g))];
  const groupRegCounts =
    groupIds.length === 0
      ? []
      : await prisma.tournamentGroupRegistration.groupBy({
          by: ["groupId"],
          where: { groupId: { in: groupIds } },
          _count: { id: true },
        });
  const regByGroup = new Map(groupRegCounts.map((r) => [r.groupId, r._count.id]));

  const seatCapByGroup = new Map<string, number>();
  for (const t of tables) {
    if (t.tournamentGroupId) {
      seatCapByGroup.set(
        t.tournamentGroupId,
        (seatCapByGroup.get(t.tournamentGroupId) ?? 0) + t.maxSeats,
      );
    }
  }

  const viewerGroupRegs =
    groupIds.length === 0
      ? []
      : await prisma.tournamentGroupRegistration.findMany({
          where: { groupId: { in: groupIds }, userId: session.user.id },
          select: { groupId: true },
        });
  const viewerRegGroups = new Set(viewerGroupRegs.map((r) => r.groupId));

  const tournamentTableIds = tables.filter((t) => t.kind === PokerTableKind.TOURNAMENT).map((t) => t.id);
  const viewerTableRegs =
    tournamentTableIds.length === 0
      ? []
      : await prisma.tournamentRegistration.findMany({
          where: { tableId: { in: tournamentTableIds }, userId: session.user.id },
          select: { tableId: true },
        });
  const viewerRegTables = new Set(viewerTableRegs.map((r) => r.tableId));

  const now = new Date();

  const initialTables = tables.map((t) => {
    const meta = metaById.get(t.id);
    return {
      id: t.id,
      name: t.name,
      kind: meta?.kind ?? t.kind,
      startsAt: (meta?.startsAt ?? t.startsAt)?.toISOString() ?? null,
      tournamentListingVisibility:
        (meta?.kind ?? t.kind) === PokerTableKind.TOURNAMENT ? t.tournamentListingVisibility : null,
      tournamentGroupId: t.tournamentGroupId,
      smallBlind: t.smallBlind,
      bigBlind: t.bigBlind,
      maxSeats: t.maxSeats,
      minBuyIn: t.minBuyIn,
      maxBuyIn: t.maxBuyIn,
      createdAt: t.createdAt.toISOString(),
      hostUsername: t.createdBy.username,
      seatedCount: t.seats.filter((s) => s.userId !== null).length,
      registrationCount:
        t.kind === PokerTableKind.TOURNAMENT
          ? t.tournamentGroupId
            ? (regByGroup.get(t.tournamentGroupId) ?? 0)
            : (regByTable.get(t.id) ?? 0)
          : 0,
      registrationCap:
        t.kind === PokerTableKind.TOURNAMENT
          ? t.tournamentGroupId
            ? (seatCapByGroup.get(t.tournamentGroupId) ?? t.maxSeats)
            : t.maxSeats
          : 0,
      tournamentEntryFeeZar:
        t.kind === PokerTableKind.TOURNAMENT ? t.tournamentEntryFeeChips : 0,
      tournamentStartingStackChips:
        t.kind === PokerTableKind.TOURNAMENT || t.kind === PokerTableKind.SIT_AND_GO
          ? t.tournamentStartingStackChips
          : 0,
      tournamentPrizes:
        t.kind === PokerTableKind.TOURNAMENT
          ? tournamentPrizesFromTable(t)
          : t.kind === PokerTableKind.SIT_AND_GO
            ? {
                firstZar: t.tournamentPrize1stZar ?? 0,
                secondZar: 0,
                thirdZar: 0,
              }
            : { firstZar: 0, secondZar: 0, thirdZar: 0 },
      viewerRegistered:
        t.kind === PokerTableKind.TOURNAMENT
          ? t.tournamentGroupId
            ? viewerRegGroups.has(t.tournamentGroupId)
            : viewerRegTables.has(t.id)
          : false,
      registrationWindowOpen:
        t.kind === PokerTableKind.TOURNAMENT && t.startsAt
          ? registrationWindowOpen(now, t.createdAt, t.startsAt)
          : false,
      unregisterWindowOpen:
        t.kind === PokerTableKind.TOURNAMENT && t.startsAt
          ? unregisterWindowOpen(now, t.startsAt)
          : false,
      tournamentMinPlayersToStart:
        t.kind === PokerTableKind.TOURNAMENT ? Math.max(2, t.tournamentMinPlayersToStart ?? 2) : 2,
      tournamentFlightStatus:
        t.kind === PokerTableKind.TOURNAMENT ? t.tournamentFlightStatus : null,
      tournamentEscalatingBlinds:
        t.kind === PokerTableKind.TOURNAMENT ? t.tournamentEscalatingBlinds : false,
    };
  });

  const isAdmin = session.user.role === "ADMIN";
  const viewerAvailableBalance = await getAvailableChipBalance(session.user.id);

  const inviteUserOptions = isAdmin
    ? await prisma.user.findMany({
        select: { id: true, username: true, displayUsername: true },
        orderBy: { username: "asc" },
        take: 500,
      })
    : [];

  const navRight = <PlayerTopNav isAdmin={isAdmin} showLobby active="tables" />;

  return (
    <PokerChrome navRight={navRight}>
      <TablesClient
        initialTables={initialTables}
        inviteUserOptions={inviteUserOptions}
        isAdmin={isAdmin}
        serverNowMs={now.getTime()}
        viewerAvailableBalance={viewerAvailableBalance}
      />
    </PokerChrome>
  );
}
