import { fetchLastCompletedHandResult } from "@/lib/poker/last-completed-hand-result";
import { handSyncOnGetEnabled, readTableHandState, syncTableHandServer } from "@/lib/poker/sync-table-hand";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id: tableId } = await params;
  const table = await prisma.pokerTable.findUnique({ where: { id: tableId } });
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (table.closedAt) {
    return NextResponse.json({ error: "Table closed" }, { status: 410 });
  }

  const snapshot = handSyncOnGetEnabled()
    ? await syncTableHandServer(prisma, tableId, { viewerUserId: gate.userId })
    : await readTableHandState(prisma, tableId, gate.userId);

  const lastCompletedHand = await fetchLastCompletedHandResult(prisma, tableId);

  return NextResponse.json({
    handId: snapshot.handId,
    hand: snapshot.hand,
    lastCompletedHand,
  });
}
