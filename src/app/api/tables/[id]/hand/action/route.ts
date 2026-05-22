import { notifyTableChanged } from "@/lib/notify-table";
import { finalizeCompletedHand, findActiveTableHand } from "@/lib/poker/hand-persist";
import { applyNlheAction, deserializeHandState, serializeHandState, type ActionPayload } from "@/lib/poker/nlhe-engine";
import { toPublicHandState } from "@/lib/poker/public-state";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FOLD") }),
  z.object({ type: z.literal("CHECK") }),
  z.object({ type: z.literal("CALL") }),
  z.object({ type: z.literal("RAISE"), raiseTo: z.coerce.number().int().min(0) }),
]);

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
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const row = await findActiveTableHand(prisma, tableId);
  if (!row) {
    return NextResponse.json({ error: "No active hand" }, { status: 404 });
  }

  const table = await prisma.pokerTable.findUnique({ where: { id: tableId } });
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (table.closedAt) {
    return NextResponse.json({ error: "Table closed" }, { status: 410 });
  }

  const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;

  const state = deserializeHandState(row.stateJson);
  const mySeat = state.players.find((p) => p.userId === gate.userId);
  if (!mySeat) {
    return NextResponse.json({ error: "You are not in this hand" }, { status: 403 });
  }

  const action = parsed.data as ActionPayload;
  const out = applyNlheAction(state, mySeat.seatIndex, gate.userId, action, { source: "manual" });
  if (out.error) {
    return NextResponse.json({ error: out.error }, { status: 400 });
  }

  if (out.state.street === "COMPLETE") {
    const hand = toPublicHandState(out.state, gate.userId);
    await finalizeCompletedHand(prisma, tableId, row.id, out.state, table.dealerButtonSeat ?? 0, tableKind);
    void notifyTableChanged(tableId);
    return NextResponse.json({ handId: row.id, hand });
  }

  await prisma.tableHand.update({
    where: { id: row.id },
    data: { stateJson: serializeHandState(out.state) },
  });

  void notifyTableChanged(tableId);
  return NextResponse.json({
    handId: row.id,
    hand: toPublicHandState(out.state, gate.userId),
  });
}
