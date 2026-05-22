import {
  applyForcedLeaveFromHand,
  deserializeHandState,
  serializeHandState,
} from "@/lib/poker/nlhe-engine";
import { finalizeCompletedHand, findActiveTableHand } from "@/lib/poker/hand-persist";
import { finalizePlayerLeaveTable } from "@/lib/poker/table-leave";
import { tryAutoStartHand } from "@/lib/poker/try-auto-start-hand";
import { syncSitAndGoAfterHand } from "@/lib/poker/sit-and-go-sync";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { syncTournamentFlightAfterHand } from "@/lib/tournament-flight";
import { listGroupTableIds, syncTournamentGroupTables } from "@/lib/tournament-group";
import { notifyTableChanged } from "@/lib/notify-table";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { PokerTableKind } from "@prisma/client";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id: tableId } = await params;
  const userId = gate.userId;

  let midHandLeave = false;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const b = (await request.json()) as { midHandLeave?: boolean };
      midHandLeave = !!b.midHandLeave;
    }
  } catch {
    /* empty or invalid body */
  }

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: { id: true, name: true, kind: true, closedAt: true, minBuyIn: true, maxSeats: true, dealerButtonSeat: true, tournamentGroupId: true },
  });
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (table.closedAt) {
    return NextResponse.json({ error: "Table closed" }, { status: 410 });
  }

  const activeHand = await findActiveTableHand(prisma, tableId);
  if (activeHand) {
    const state = deserializeHandState(activeHand.stateJson);
    const inHand = state.players.some((p) => p.userId === userId);
    if (inHand && !midHandLeave) {
      const isTournament = table.kind === PokerTableKind.TOURNAMENT;
      const isSitAndGo = table.kind === PokerTableKind.SIT_AND_GO;
      const isCash = table.kind === PokerTableKind.CASH;
      return NextResponse.json(
        {
          error:
            isTournament || isSitAndGo
              ? "You are still in this hand. If you leave, you will fold, forfeit your chips, and cannot re-enter. Confirm to continue."
              : isCash
                ? "You are still in this hand. Leaving now will fold you out; chips already in the pot may be lost. Confirm to continue."
                : "You are still in this hand. Leaving now will fold you out; chips already in the pot may be lost. Confirm to continue.",
          code: "MID_HAND_LEAVE_CONFIRM",
        },
        { status: 409 },
      );
    }

    if (inHand && midHandLeave) {
      const out = applyForcedLeaveFromHand(state, userId);
      if (out.error) {
        return NextResponse.json({ error: out.error }, { status: 400 });
      }
      const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;
      const nextJson = serializeHandState(out.state);

      if (out.state.street === "COMPLETE") {
        await finalizeCompletedHand(
          prisma,
          tableId,
          activeHand.id,
          out.state,
          table.dealerButtonSeat ?? 0,
          tableKind,
        );
      } else {
        await prisma.tableHand.update({
          where: { id: activeHand.id },
          data: { stateJson: nextJson },
        });
      }

      const pl = out.state.players.find((p) => p.userId === userId);
      if (pl && out.state.street !== "COMPLETE") {
        await prisma.tableSeat.updateMany({
          where: { tableId, seatIndex: pl.seatIndex },
          data: { stackChips: pl.stack },
        });
      }
      void notifyTableChanged(tableId);
    }
  }

  try {
    const result = await finalizePlayerLeaveTable(prisma, tableId, userId, table);
    if (result === "not_seated") {
      return NextResponse.json({ error: "You are not seated at this table" }, { status: 400 });
    }

    void notifyTableChanged(tableId);
    if (table.kind === PokerTableKind.TOURNAMENT) {
      await syncTournamentFlightAfterHand(prisma, tableId);
    } else if (table.kind === PokerTableKind.SIT_AND_GO) {
      await syncSitAndGoAfterHand(prisma, tableId);
    }
    await tryAutoStartHand(prisma, tableId);
    if (table.kind === PokerTableKind.TOURNAMENT && table.tournamentGroupId) {
      await syncTournamentGroupTables(prisma, table.tournamentGroupId);
      const gIds = await listGroupTableIds(prisma, table.tournamentGroupId);
      for (const tid of gIds) {
        await tryAutoStartHand(prisma, tid);
        await syncTournamentFlightAfterHand(prisma, tid);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    throw e;
  }
}
