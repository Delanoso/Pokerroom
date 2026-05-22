import { findActiveTableHand } from "@/lib/poker/hand-persist";
import { notifyTableChanged } from "@/lib/notify-table";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { LedgerEntryType } from "@prisma/client";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id: tableId } = await params;
  const userId = gate.userId;

  const activeHand = await findActiveTableHand(prisma, tableId);
  if (activeHand) {
    return NextResponse.json({ error: "Cannot tip while a hand is in progress" }, { status: 400 });
  }

  try {
    const tip = await prisma.$transaction(async (tx) => {
      const table = await tx.pokerTable.findUnique({
        where: { id: tableId },
        select: { id: true, closedAt: true, smallBlind: true, createdById: true },
      });
      if (!table) {
        throw new Error("NOT_FOUND");
      }
      if (table.closedAt) {
        throw new Error("CLOSED");
      }

      const sb = table.smallBlind;
      if (sb <= 0) {
        throw new Error("NO_SB");
      }

      const seat = await tx.tableSeat.findFirst({
        where: { tableId, userId },
      });
      if (!seat) {
        throw new Error("NOT_SEATED");
      }
      if (seat.stackChips < sb) {
        throw new Error("SHORT");
      }

      await tx.tableSeat.update({
        where: { id: seat.id },
        data: { stackChips: seat.stackChips - sb },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: table.createdById,
          amountChips: sb,
          type: LedgerEntryType.DEALER_TIP_RECEIVED,
          note: `Dealer tip from table ${tableId}`,
        },
      });

      return { tipped: sb };
    });

    void notifyTableChanged(tableId);
    return NextResponse.json({ ok: true, tipped: tip.tipped });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "NOT_FOUND") {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }
    if (code === "CLOSED") {
      return NextResponse.json({ error: "This table is closed" }, { status: 410 });
    }
    if (code === "NOT_SEATED") {
      return NextResponse.json({ error: "You are not seated at this table" }, { status: 400 });
    }
    if (code === "SHORT") {
      return NextResponse.json({ error: "Not enough chips in your stack for the small blind tip" }, { status: 400 });
    }
    if (code === "NO_SB") {
      return NextResponse.json({ error: "Table has no small blind configured" }, { status: 400 });
    }
    throw e;
  }
}
