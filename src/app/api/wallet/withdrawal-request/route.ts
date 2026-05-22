import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { getAvailableChipBalanceTx } from "@/lib/wallet";
import { insertWithdrawalRequest, listRecentWithdrawalsForUser } from "@/lib/withdrawal-sql";

const bodySchema = z.object({
  amountChips: z.coerce.number().int().min(1),
});

export async function GET() {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const rows = await listRecentWithdrawalsForUser(gate.userId, 40);

  return NextResponse.json({ requests: rows });
}

export async function POST(request: Request) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

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
  const userId = gate.userId;

  try {
    await prisma.$transaction(async (tx) => {
      const available = await getAvailableChipBalanceTx(tx, userId);
      if (amountChips > available) {
        throw new Error("INSUFFICIENT");
      }
      await insertWithdrawalRequest(tx, userId, amountChips);
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT") {
      return NextResponse.json(
        { error: "Not enough playable chips (pending withdrawals reduce what you can use)" },
        { status: 400 },
      );
    }
    throw e;
  }
}
