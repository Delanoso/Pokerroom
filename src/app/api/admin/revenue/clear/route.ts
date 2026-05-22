import { requireAdminOperator } from "@/lib/admin-operator";
import { clearHouseRevenueLedgerSql } from "@/lib/house-fees-sql";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  const deleted = await clearHouseRevenueLedgerSql(prisma);
  return NextResponse.json({ ok: true, deleted });
}
