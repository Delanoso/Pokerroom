import { prisma } from "@/lib/prisma";
import { requireActiveSession } from "@/lib/require-active-session";
import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

async function requireOperator() {
  const gate = await requireActiveSession();
  if (!gate.ok) return { error: gate.response } as const;
  if (gate.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { operatorId: gate.userId };
}

export async function PATCH(request: Request, { params }: Params) {
  const op = await requireOperator();
  if ("error" in op) return op.error;

  const { id } = await params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = z.object({ blocked: z.boolean() }).safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.id === op.operatorId) {
    return NextResponse.json({ error: "You cannot suspend your own account here" }, { status: 400 });
  }

  if (parsed.data.blocked && target.role === Role.ADMIN) {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: Role.ADMIN, blockedAt: null, id: { not: id } },
    });
    if (otherActiveAdmins < 1) {
      return NextResponse.json(
        { error: "Cannot block the only active operator. Add or unblock another admin first." },
        { status: 400 },
      );
    }
  }

  await prisma.user.update({
    where: { id },
    data: { blockedAt: parsed.data.blocked ? new Date() : null },
  });

  return NextResponse.json({ ok: true, blocked: parsed.data.blocked });
}

export async function DELETE(_request: Request, { params }: Params) {
  const op = await requireOperator();
  if ("error" in op) return op.error;

  const { id } = await params;
  if (id === op.operatorId) {
    return NextResponse.json({ error: "You cannot remove your own account" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role === Role.ADMIN) {
    const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
    if (adminCount <= 1) {
      return NextResponse.json({ error: "Cannot remove the last operator account" }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.updateMany({ where: { createdById: id }, data: { createdById: null } });
    await tx.pokerTable.deleteMany({ where: { createdById: id } });
    await tx.user.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
