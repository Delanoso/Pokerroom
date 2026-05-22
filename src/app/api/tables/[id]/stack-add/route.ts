import { findActiveTableHand } from "@/lib/poker/hand-persist";
import { notifyTableChanged } from "@/lib/notify-table";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { getAvailableChipBalanceTx } from "@/lib/wallet";
import { isSitAndGo, isScheduledTournament } from "@/lib/table-kind";
import { LedgerEntryType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  amountChips: z.coerce.number().int().min(1),
});

export async function POST(request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id: tableId } = await params;
  const userId = gate.userId;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { amountChips } = parsed.data;

  const activeHand = await findActiveTableHand(prisma, tableId);
  if (activeHand) {
    return NextResponse.json({ error: "Cannot add chips while a hand is in progress" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const table = await tx.pokerTable.findUnique({ where: { id: tableId } });
      if (!table) {
        throw new Error("NOT_FOUND");
      }
      if (table.closedAt) {
        throw new Error("CLOSED");
      }
      if (isScheduledTournament(table.kind) || isSitAndGo(table.kind)) {
        throw new Error("NO_RELOAD");
      }

      const seat = await tx.tableSeat.findFirst({
        where: { tableId, userId },
      });
      if (!seat) {
        throw new Error("NOT_SEATED");
      }

      const newStack = seat.stackChips + amountChips;
      if (newStack > table.maxBuyIn) {
        throw new Error("OVER_CAP");
      }

      const available = await getAvailableChipBalanceTx(tx, userId);
      if (available < amountChips) {
        throw new Error("INSUFFICIENT");
      }

      await tx.ledgerEntry.create({
        data: {
          userId,
          amountChips: -amountChips,
          type: LedgerEntryType.TABLE_STACK_RELOAD,
          note: `Add chips table ${tableId}`,
        },
      });

      await tx.tableSeat.update({
        where: { id: seat.id },
        data: { stackChips: newStack },
      });
    });

    void notifyTableChanged(tableId);
    return NextResponse.json({ ok: true });
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
    if (code === "OVER_CAP") {
      return NextResponse.json({ error: "Stack cannot exceed this table's max buy-in" }, { status: 400 });
    }
    if (code === "INSUFFICIENT") {
      return NextResponse.json({ error: "Not enough chips in your bankroll" }, { status: 400 });
    }
    if (code === "NO_RELOAD") {
      return NextResponse.json({ error: "Cannot add chips at this table type" }, { status: 400 });
    }
    throw e;
  }
}
