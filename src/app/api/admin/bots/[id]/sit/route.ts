import { adminBotSeatErrorMessage, adminSeatBotAtTable } from "@/lib/admin-bot-seat";
import { requireAdminOperator } from "@/lib/admin-operator";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tableId: z.string().min(1),
  seatIndex: z.coerce.number().int().min(0).max(8),
  buyInChips: z.coerce.number().int().min(1),
});

export async function POST(request: Request, { params }: Params) {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  const { id: userId } = await params;

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

  const { tableId, seatIndex, buyInChips } = parsed.data;
  const result = await adminSeatBotAtTable(prisma, userId, tableId, seatIndex, buyInChips);

  if (!result.ok) {
    return NextResponse.json({ error: adminBotSeatErrorMessage(result.code) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
