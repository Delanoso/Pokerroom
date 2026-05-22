import { adminBotSeatErrorMessage, adminLeaveBotFromTables } from "@/lib/admin-bot-seat";
import { requireAdminOperator } from "@/lib/admin-operator";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tableId: z.string().min(1).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  const { id: userId } = await params;

  let tableId: string | undefined;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const json = await request.json();
      const parsed = bodySchema.safeParse(json);
      if (parsed.success) tableId = parsed.data.tableId;
    }
  } catch {
    /* empty body */
  }

  const result = await adminLeaveBotFromTables(prisma, userId, tableId);

  if (!result.ok) {
    const status = result.code === "HAND_IN_PROGRESS" ? 409 : 400;
    return NextResponse.json({ error: adminBotSeatErrorMessage(result.code) }, { status });
  }

  return NextResponse.json({ ok: true, left: result.left });
}
