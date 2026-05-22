import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { insertDepositRequest, listRecentDepositsForUser } from "@/lib/deposit-sql";
import { requireActiveSession } from "@/lib/require-active-session";

const bodySchema = z.object({
  amountChips: z.coerce.number().int().min(1),
});

export async function GET() {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const rows = await listRecentDepositsForUser(gate.userId, 40);

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

  await prisma.$transaction(async (tx) => {
    await insertDepositRequest(tx, gate.userId, amountChips);
  });

  return NextResponse.json({ ok: true });
}
