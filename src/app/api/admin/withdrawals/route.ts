import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/require-active-session";
import { listPendingWithdrawalsForAdmin } from "@/lib/withdrawal-sql";

export async function GET() {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await listPendingWithdrawalsForAdmin();
  const pending = rows.map((r) => ({
    id: r.id,
    amountChips: r.amountChips,
    createdAt: r.createdAt,
    user: {
      username: r.username,
      email: r.email,
    },
  }));

  return NextResponse.json({ pending });
}
