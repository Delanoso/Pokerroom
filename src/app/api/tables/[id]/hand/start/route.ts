import { notifyTableChanged } from "@/lib/notify-table";
import { findActiveTableHand } from "@/lib/poker/hand-persist";
import { serializeHandState, startNlheHand } from "@/lib/poker/nlhe-engine";
import { toPublicHandState } from "@/lib/poker/public-state";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { PokerTableKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/** Optional manual deal (host/operator). Cash games normally auto-deal via GET /hand polling. */
export async function POST(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id: tableId } = await params;

  const existing = await findActiveTableHand(prisma, tableId);
  if (existing) {
    return NextResponse.json({ error: "A hand is already in progress" }, { status: 400 });
  }

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    include: {
      seats: { orderBy: { seatIndex: "asc" } },
    },
  });
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (table.closedAt) {
    return NextResponse.json({ error: "Table closed" }, { status: 410 });
  }

  const canDeal = gate.role === "ADMIN" || table.createdById === gate.userId;
  if (!canDeal) {
    return NextResponse.json(
      { error: "Only the table host or an operator can start a hand" },
      { status: 403 },
    );
  }

  const tournamentMeta = await fetchPokerTableTournamentMetaOne(tableId);
  /** Manual POST can start a tournament before the clock (house decision). Auto-deal cannot. */
  const blockEarlyTournament =
    tournamentMeta.kind === "TOURNAMENT" &&
    tournamentMeta.startsAt &&
    tournamentMeta.startsAt.getTime() > Date.now();
  if (blockEarlyTournament && gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Tournament has not started yet" }, { status: 400 });
  }

  const seatsForHand = table.seats
    .filter(
      (s) =>
        s.userId !== null &&
        s.stackChips > 0 &&
        !s.sittingOut &&
        !s.sitOutNextHand &&
        !s.waitingForNextHand,
    )
    .map((s) => ({
      seatIndex: s.seatIndex,
      userId: s.userId!,
      stackChips: s.stackChips,
    }));

  const dealerButtonSeat = table.dealerButtonSeat ?? 0;

  const started = startNlheHand({
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    dealerButtonSeat,
    seats: seatsForHand,
    ...(table.kind === PokerTableKind.CASH && table.rakePercentBps > 0
      ? { rakePercentBps: table.rakePercentBps, rakeCapChips: table.rakeCapChips }
      : {}),
  });
  if (started.error || !started.state) {
    return NextResponse.json({ error: started.error ?? "Cannot start hand" }, { status: 400 });
  }

  let row: { id: string };
  try {
    row = await prisma.tableHand.create({
      data: {
        tableId,
        complete: false,
        stateJson: serializeHandState(started.state),
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not save the hand to the database. If you recently pulled code, run `npx prisma db push` and restart the dev server.",
      },
      { status: 500 },
    );
  }

  void notifyTableChanged(tableId);
  return NextResponse.json({
    handId: row.id,
    hand: toPublicHandState(started.state, gate.userId),
  });
}
