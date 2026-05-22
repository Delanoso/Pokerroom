import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";

export type ActiveSession =
  | { ok: true; session: Session; userId: string; role: "USER" | "ADMIN" }
  | { ok: false; response: NextResponse };

/**
 * Authenticated user who is not blocked (DB check). Use on API routes that must reject suspended accounts.
 */
export async function requireActiveSession(): Promise<ActiveSession> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const row = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { blockedAt: true },
  });
  if (!row) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (row.blockedAt) {
    return { ok: false, response: NextResponse.json({ error: "Account suspended" }, { status: 403 }) };
  }
  return { ok: true, session, userId: session.user.id, role: session.user.role };
}
