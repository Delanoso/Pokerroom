import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getChipBalance, getPendingWithdrawalHold } from "@/lib/wallet";
import { LedgerEntryType } from "@prisma/client";
import { requireActiveSession } from "@/lib/require-active-session";

const bodySchema = z.object({
  userId: z.string().min(1),
  amountChips: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, "Amount must be non-zero"),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { userId, amountChips, note } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const current = await getChipBalance(userId);
  const hold = await getPendingWithdrawalHold(userId);
  if (amountChips < 0 && current + amountChips < hold) {
    return NextResponse.json(
      { error: "Adjustment would leave the ledger below pending withdrawal holds" },
      { status: 400 },
    );
  }
  if (current + amountChips < 0) {
    return NextResponse.json(
      { error: "Adjustment would make the balance negative" },
      { status: 400 },
    );
  }

  await prisma.ledgerEntry.create({
    data: {
      userId,
      amountChips,
      type: LedgerEntryType.ADMIN_ADJUSTMENT,
      note: note ?? null,
      createdById: gate.userId,
    },
  });

  const newBalance = current + amountChips;
  return NextResponse.json({ ok: true, newBalance });
}
