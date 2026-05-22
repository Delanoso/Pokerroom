import { prisma } from "@/lib/prisma";
import { isSitAndGoStarted } from "@/lib/poker/sit-and-go-policy";
import { isUserEliminatedFromSitAndGo } from "@/lib/poker/sit-and-go-sync";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { PokerTableKind } from "@prisma/client";
import { requireActiveSession } from "@/lib/require-active-session";
import { getAvailableChipBalance } from "@/lib/wallet";
import { getTournamentViewerSnapshot, userMayViewPrivateTournament } from "@/lib/tournament-policy";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const table = await prisma.pokerTable.findUnique({
    where: { id },
    include: {
      seats: {
        orderBy: { seatIndex: "asc" },
        include: {
          user: {
            select: { id: true, username: true, displayUsername: true, firstName: true, lastName: true },
          },
        },
      },
      createdBy: { select: { username: true } },
    },
  });

  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (table.closedAt) {
    return NextResponse.json({ error: "Table closed" }, { status: 410 });
  }

  const mayView = await userMayViewPrivateTournament(
    prisma,
    table.id,
    table.kind,
    table.tournamentListingVisibility,
    gate.userId,
    table.createdById,
    gate.role,
  );
  if (!mayView) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }

  const tournamentMeta = await fetchPokerTableTournamentMetaOne(id);
  const viewerBalance = await getAvailableChipBalance(gate.userId);
  const mySeat = table.seats.find((s) => s.userId === gate.userId);

  const viewerCanDeal = gate.role === "ADMIN" || table.createdById === gate.userId;
  const isSiteAdmin = gate.role === "ADMIN";

  const viewerEliminatedFromSnG =
    table.kind === PokerTableKind.SIT_AND_GO
      ? await isUserEliminatedFromSitAndGo(prisma, id, gate.userId)
      : false;
  const sitAndGoStarted =
    table.kind === PokerTableKind.SIT_AND_GO
      ? await isSitAndGoStarted(prisma, id, table.maxSeats)
      : false;

  const tournament = await getTournamentViewerSnapshot(
    prisma,
    {
      id: table.id,
      kind: table.kind,
      startsAt: table.startsAt,
      createdAt: table.createdAt,
      tournamentListingVisibility: table.tournamentListingVisibility,
      tournamentGroupId: table.tournamentGroupId,
      maxSeats: table.maxSeats,
      tournamentEntryFeeChips: table.tournamentEntryFeeChips,
      tournamentStartingStackChips: table.tournamentStartingStackChips,
      tournamentPrize1stZar: table.tournamentPrize1stZar,
      tournamentPrize2ndZar: table.tournamentPrize2ndZar,
      tournamentPrize3rdZar: table.tournamentPrize3rdZar,
      tournamentMinPlayersToStart: table.tournamentMinPlayersToStart,
      tournamentFlightStatus: table.tournamentFlightStatus,
      tournamentEscalatingBlinds: table.tournamentEscalatingBlinds,
      tournamentBlindLevel: table.tournamentBlindLevel,
      tournamentBlindLevelEndsAt: table.tournamentBlindLevelEndsAt,
      tournamentBlindLevelMinutes: table.tournamentBlindLevelMinutes,
      tournamentBlindLevelMultiplierBps: table.tournamentBlindLevelMultiplierBps,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
    },
    gate.userId,
    new Date(),
  );

  return NextResponse.json({
    table: {
      id: table.id,
      name: table.name,
      kind: tournamentMeta.kind,
      startsAt: tournamentMeta.startsAt?.toISOString() ?? null,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      maxSeats: table.maxSeats,
      minBuyIn: table.minBuyIn,
      maxBuyIn: table.maxBuyIn,
      hostUsername: table.createdBy.username,
      seats: table.seats.map((s) => ({
        seatIndex: s.seatIndex,
        stackChips: s.stackChips,
        sittingOut: s.sittingOut,
        sitOutNextHand: s.sitOutNextHand,
        waitingForNextHand: s.waitingForNextHand,
        user: s.user
          ? {
              id: s.user.id,
              username: s.user.username,
              usernameDisplay: s.user.displayUsername ?? s.user.username,
              displayName: `${s.user.firstName} ${s.user.lastName}`,
            }
          : null,
      })),
    },
    viewerBalance,
    mySeatIndex: mySeat?.seatIndex ?? null,
    viewerCanDeal,
    isSiteAdmin,
    viewerEliminatedFromSnG,
    sitAndGoStarted,
    tournament,
  });
}
