import { getUserLedgerHistory } from "@/lib/ledger-history";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const history = await getUserLedgerHistory(prisma, id);
  if (!history) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user: history.user,
    currentBalance: history.currentBalance,
    entries: history.entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      amountChips: e.amountChips,
      type: e.type,
      typeLabel: e.typeLabel,
      category: e.category,
      note: e.note,
      createdByUsername: e.createdByUsername,
      balanceAfter: e.balanceAfter,
    })),
  });
}
