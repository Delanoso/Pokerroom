import { findActiveTableHand } from "@/lib/poker/hand-persist";
import {
  forceCompleteActiveHandForTableClose,
  reconcileAndPersistActiveHand,
} from "@/lib/poker/reconcile-active-hand";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { notifyTableChanged } from "@/lib/notify-table";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { syncSitAndGoAfterHand } from "@/lib/poker/sit-and-go-sync";
import {
  listFlightTableIds,
  loadFlightContext,
  syncTournamentFlightAfterHand,
} from "@/lib/tournament-flight";
import { LedgerEntryType, PokerTableKind } from "@prisma/client";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/** Operator: close table (no active hand), return all stacks to bankrolls, mark table closed. */
export async function POST(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Only operators can close tables" }, { status: 403 });
  }

  const { id: tableId } = await params;

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    include: { seats: true },
  });
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (table.closedAt) {
    return NextResponse.json({ error: "Table is already closed" }, { status: 400 });
  }

  const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;
  const reconcileOpts = { forceShowdown: true, skipAutoStart: true } as const;

  const tablesToReconcile =
    tableKind === PokerTableKind.TOURNAMENT
      ? await (async () => {
          const ctx = await loadFlightContext(prisma, tableId);
          return ctx ? await listFlightTableIds(prisma, ctx) : [tableId];
        })()
      : [tableId];

  for (let pass = 0; pass < 10; pass++) {
    for (const tid of tablesToReconcile) {
      await reconcileAndPersistActiveHand(prisma, tid, reconcileOpts);
    }
    if (tableKind === PokerTableKind.TOURNAMENT) {
      await syncTournamentFlightAfterHand(prisma, tableId);
    } else if (tableKind === PokerTableKind.SIT_AND_GO) {
      await syncSitAndGoAfterHand(prisma, tableId);
    }
    let anyActive = false;
    for (const tid of tablesToReconcile) {
      if (await findActiveTableHand(prisma, tid)) {
        anyActive = true;
        break;
      }
    }
    if (!anyActive) break;
  }

  for (const tid of tablesToReconcile) {
    if (await findActiveTableHand(prisma, tid)) {
      await forceCompleteActiveHandForTableClose(prisma, tid);
    }
  }

  if (tableKind === PokerTableKind.TOURNAMENT) {
    await syncTournamentFlightAfterHand(prisma, tableId);
  } else if (tableKind === PokerTableKind.SIT_AND_GO) {
    await syncSitAndGoAfterHand(prisma, tableId);
  }

  const tableAfterSync = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: { closedAt: true },
  });
  if (tableAfterSync?.closedAt) {
    void notifyTableChanged(tableId);
    return NextResponse.json({ ok: true, flightCompleted: true });
  }

  let active = await findActiveTableHand(prisma, tableId);
  if (!active && tableKind === PokerTableKind.TOURNAMENT) {
    for (const tid of tablesToReconcile) {
      active = await findActiveTableHand(prisma, tid);
      if (active) break;
    }
  }
  if (active) {
    return NextResponse.json(
      {
        error:
          "Wait for the current hand to finish before closing the table. If a player is busted (0 chips), refresh the table — the hand should end automatically.",
      },
      { status: 400 },
    );
  }

  const paysCashOutOnClose = table.kind === PokerTableKind.CASH;

  await prisma.$transaction(async (tx) => {
    for (const s of table.seats) {
      if (!s.userId) continue;
      const stack = s.stackChips;
      if (paysCashOutOnClose && stack > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId: s.userId,
            amountChips: stack,
            type: LedgerEntryType.TABLE_CASH_OUT,
            note: `Table closed: ${table.name}`,
          },
        });
      }
      await tx.tableSeat.update({
        where: { id: s.id },
        data: {
          userId: null,
          stackChips: 0,
          sittingOut: false,
          sitOutSince: null,
          sitOutNextHand: false,
          waitingForNextHand: false,
          consecutiveIdleHands: 0,
        },
      });
    }
    await tx.pokerTable.update({
      where: { id: tableId },
      data: { closedAt: new Date() },
    });
  });

  void notifyTableChanged(tableId);
  return NextResponse.json({ ok: true });
}
