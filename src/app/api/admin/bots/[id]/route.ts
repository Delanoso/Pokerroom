import { adminLeaveBotFromTables } from "@/lib/admin-bot-seat";
import { requireAdminOperator } from "@/lib/admin-operator";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  const { id } = await params;

  const bot = await prisma.user.findUnique({
    where: { id },
    select: { id: true, isBot: true, username: true },
  });
  if (!bot) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  if (!bot.isBot) {
    return NextResponse.json({ error: "Not a bot account" }, { status: 400 });
  }

  const leave = await adminLeaveBotFromTables(prisma, id);
  if (!leave.ok && leave.code === "HAND_IN_PROGRESS") {
    return NextResponse.json(
      { error: "Bot is in an active hand. Wait for the hand to finish, then delete again." },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.updateMany({ where: { createdById: id }, data: { createdById: null } });
    await tx.pokerTable.deleteMany({ where: { createdById: id } });
    await tx.user.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
