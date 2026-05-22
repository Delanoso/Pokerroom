import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  findPendingDepositById,
  insertDepositCreditLedgerRow,
  markDepositApproved,
} from "@/lib/deposit-sql";
import { requireActiveSession } from "@/lib/require-active-session";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await prisma.$transaction(async (tx) => {
      const req = await findPendingDepositById(tx, id);
      if (!req) {
        throw new Error("NOT_FOUND");
      }

      await insertDepositCreditLedgerRow(tx, {
        userId: req.userId,
        amountChips: req.amountChips,
        requestId: req.id,
        createdById: gate.userId,
      });

      const updated = await markDepositApproved(tx, req.id, gate.userId);
      if (Number(updated) < 1) {
        throw new Error("NOT_FOUND");
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "NOT_FOUND") {
      return NextResponse.json({ error: "Request not found or already resolved" }, { status: 404 });
    }
    throw e;
  }
}
