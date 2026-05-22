import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import {
  findPendingWithdrawalById,
  insertWithdrawalPayoutLedgerRow,
  markWithdrawalApproved,
  sumLedgerChipsSql,
} from "@/lib/withdrawal-sql";

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
      const req = await findPendingWithdrawalById(tx, id);
      if (!req) {
        throw new Error("NOT_FOUND");
      }

      const total = await sumLedgerChipsSql(tx, req.userId);
      if (total < req.amountChips) {
        throw new Error("INSUFFICIENT_LEDGER");
      }

      await insertWithdrawalPayoutLedgerRow(tx, {
        userId: req.userId,
        amountChips: req.amountChips,
        requestId: req.id,
        createdById: gate.userId,
      });

      const updated = await markWithdrawalApproved(tx, req.id, gate.userId);
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
    if (code === "INSUFFICIENT_LEDGER") {
      return NextResponse.json(
        { error: "Player no longer has enough chips on ledger to honour this withdrawal" },
        { status: 400 },
      );
    }
    throw e;
  }
}
