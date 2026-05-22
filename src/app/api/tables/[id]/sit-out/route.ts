import { findActiveTableHand } from "@/lib/poker/hand-persist";
import { deserializeHandState } from "@/lib/poker/nlhe-engine";
import { tryAutoStartHand } from "@/lib/poker/try-auto-start-hand";
import { notifyTableChanged } from "@/lib/notify-table";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  sittingOut: z.boolean(),
});

/** Cash games only: sit at the table without being dealt until you sit back in. */
export async function POST(request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id: tableId } = await params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const { sittingOut: wantSitOut } = parsed.data;

  let tableOpen = false;
  let tableExists = false;
  try {
    const statusRows = await prisma.$queryRaw<{ id: string; closedAt: Date | null }[]>`
      SELECT "id", "closedAt" FROM "PokerTable" WHERE "id" = ${tableId} LIMIT 1
    `;
    const row = statusRows[0];
    tableExists = !!row;
    tableOpen = !!row && row.closedAt == null;
  } catch {
    try {
      const t = await prisma.pokerTable.findUnique({ where: { id: tableId }, select: { id: true, closedAt: true } });
      tableExists = !!t;
      tableOpen = !!t && !t.closedAt;
    } catch {
      const t2 = await prisma.pokerTable.findUnique({ where: { id: tableId }, select: { id: true } });
      tableExists = !!t2;
      tableOpen = !!t2;
    }
  }
  if (!tableExists) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (!tableOpen) {
    return NextResponse.json({ error: "Table closed" }, { status: 410 });
  }

  const meta = await fetchPokerTableTournamentMetaOne(tableId);
  if (meta.kind === "TOURNAMENT") {
    return NextResponse.json({ error: "Sit out is only available on cash tables" }, { status: 400 });
  }

  const seatRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "TableSeat" WHERE "tableId" = ${tableId} AND "userId" = ${gate.userId} LIMIT 1
  `;
  const seatId = seatRows[0]?.id;
  if (!seatId) {
    return NextResponse.json({ error: "You are not seated at this table" }, { status: 400 });
  }

  if (!wantSitOut) {
    await prisma.$executeRaw`
      UPDATE "TableSeat" SET
        "sittingOut" = 0,
        "sitOutSince" = NULL,
        "sitOutNextHand" = 0,
        "consecutiveIdleHands" = 0
      WHERE "id" = ${seatId}
    `;
    await tryAutoStartHand(prisma, tableId);
    void notifyTableChanged(tableId);
    return NextResponse.json({ ok: true });
  }

  const active = await findActiveTableHand(prisma, tableId);
  if (active) {
    const st = deserializeHandState(active.stateJson);
    const inThisHand = st.players.some((p) => p.userId === gate.userId);
    if (inThisHand) {
      await prisma.$executeRaw`
        UPDATE "TableSeat" SET "sitOutNextHand" = 1 WHERE "id" = ${seatId}
      `;
      await tryAutoStartHand(prisma, tableId);
      void notifyTableChanged(tableId);
      return NextResponse.json({ ok: true, pendingNextHand: true });
    }
  }

  await prisma.$executeRaw`
    UPDATE "TableSeat" SET
      "sittingOut" = 1,
      "sitOutSince" = ${new Date()},
      "sitOutNextHand" = 0
    WHERE "id" = ${seatId}
  `;
  await tryAutoStartHand(prisma, tableId);
  void notifyTableChanged(tableId);
  return NextResponse.json({ ok: true });
}
