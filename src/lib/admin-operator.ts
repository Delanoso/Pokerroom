import { requireActiveSession } from "@/lib/require-active-session";
import { NextResponse } from "next/server";

export async function requireAdminOperator() {
  const gate = await requireActiveSession();
  if (!gate.ok) return { error: gate.response } as const;
  if (gate.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { operatorId: gate.userId } as const;
}
