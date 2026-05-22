import { notifyTableChanged } from "@/lib/notify-table";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { listGroupTableIds } from "@/lib/tournament-group";
import { PokerTableKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tournamentPrize1stZar: z.coerce.number().int().min(0).max(1_000_000_000),
  tournamentPrize2ndZar: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  tournamentPrize3rdZar: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

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

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: {
      id: true,
      closedAt: true,
      kind: true,
      startsAt: true,
      tournamentGroupId: true,
    },
  });

  if (!table || table.closedAt) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }
  if (table.kind !== PokerTableKind.TOURNAMENT || !table.startsAt) {
    return NextResponse.json({ error: "Not a scheduled tournament" }, { status: 400 });
  }
  if (table.startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Cannot change prizes after the tournament has started" }, { status: 400 });
  }

  const prize2 = parsed.data.tournamentPrize2ndZar ?? 0;
  const prize3 = parsed.data.tournamentPrize3rdZar ?? 0;

  const data = {
    tournamentPrize1stZar: parsed.data.tournamentPrize1stZar,
    tournamentPrize2ndZar: prize2,
    tournamentPrize3rdZar: prize3,
  };

  if (table.tournamentGroupId) {
    await prisma.pokerTable.updateMany({
      where: { tournamentGroupId: table.tournamentGroupId, closedAt: null },
      data,
    });
    const ids = await listGroupTableIds(prisma, table.tournamentGroupId);
    for (const tid of ids) void notifyTableChanged(tid);
  } else {
    await prisma.pokerTable.update({ where: { id: tableId }, data });
    void notifyTableChanged(tableId);
  }

  return NextResponse.json({ ok: true, ...data });
}
