import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { markWithdrawalDeclined } from "@/lib/withdrawal-sql";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const updated = await markWithdrawalDeclined(prisma, id, gate.userId);
  if (Number(updated) < 1) {
    return NextResponse.json({ error: "Request not found or already resolved" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
