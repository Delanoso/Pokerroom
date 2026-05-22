import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { prisma } from "@/lib/prisma";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { getTournamentViewerSnapshot, userMayViewPrivateTournament } from "@/lib/tournament-policy";
import { getAvailableChipBalance } from "@/lib/wallet";
import { LOBBY_WINDOW_TARGET } from "@/lib/poker/open-table-window";
import { notFound, redirect } from "next/navigation";
import { isUserEliminatedFromSitAndGo } from "@/lib/poker/sit-and-go-sync";
import { TablePagePortraitShell } from "@/components/table-page-portrait-shell";
import { TableRoomClient, type TableRoomInitial } from "./table-room-client";
import { PokerTableKind } from "@prisma/client";

type Props = { params: Promise<{ id: string }> };

export default async function TablePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

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
    notFound();
  }
  if (table.closedAt) {
    notFound();
  }

  const mayView = await userMayViewPrivateTournament(
    prisma,
    table.id,
    table.kind,
    table.tournamentListingVisibility,
    session.user.id,
    table.createdById,
    session.user.role,
  );
  if (!mayView) {
    notFound();
  }

  const tournamentMeta = await fetchPokerTableTournamentMetaOne(id);
  const viewerBalance = await getAvailableChipBalance(session.user.id);
  const mySeat = table.seats.find((s) => s.userId === session.user.id);

  const serverNow = new Date();
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
    session.user.id,
    serverNow,
  );

  const initial: TableRoomInitial = {
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
      tournamentEntryFeeZar: table.tournamentEntryFeeChips,
      tournamentStartingStackChips: table.tournamentStartingStackChips,
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
    viewerUserId: session.user.id,
    viewerBalance,
    mySeatIndex: mySeat?.seatIndex ?? null,
    viewerCanDeal: session.user.role === "ADMIN" || table.createdById === session.user.id,
    isSiteAdmin: session.user.role === "ADMIN",
    tournament,
    viewerEliminatedFromSnG:
      table.kind === PokerTableKind.SIT_AND_GO
        ? await isUserEliminatedFromSitAndGo(prisma, table.id, session.user.id)
        : false,
    serverNowMs: serverNow.getTime(),
  };

  return (
    <TablePagePortraitShell>
      <div
        className="flex h-dvh max-h-dvh w-full flex-col overflow-hidden px-0.5 py-0.5 shadow-[inset_0_0_80px_rgba(0,0,0,0.5)] sm:px-1"
        style={{
          backgroundColor: "#120c09",
          backgroundImage: [
            "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, transparent 40%, rgba(0,0,0,0.35) 100%)",
            "url(/images/table-room-wood-bg.png)",
          ].join(","),
          backgroundSize: "auto, cover",
          backgroundPosition: "center, center",
          backgroundRepeat: "no-repeat, no-repeat",
        }}
      >
        <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <a
              href="/tables"
              target={LOBBY_WINDOW_TARGET}
              rel="noopener noreferrer"
              className="py-0.5 text-[10px] leading-none text-amber-200/90 hover:text-amber-100"
            >
              ← Tables (lobby)
            </a>
            <SignOutButton className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100" />
          </div>
          <TableRoomClient className="min-h-0 flex-1" tableId={id} initial={initial} />
        </div>
      </div>
    </TablePagePortraitShell>
  );
}
