import { requireAdminOperator } from "@/lib/admin-operator";
import { prisma } from "@/lib/prisma";
import { registerUserForTournament } from "@/lib/tournament-register-user";
import { getAvailableChipBalance } from "@/lib/wallet";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tableId: z.string().min(1),
});

export async function POST(request: Request, { params }: Params) {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  const { id: userId } = await params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const bot = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBot: true, username: true },
  });
  if (!bot?.isBot) {
    return NextResponse.json({ error: "Not a bot account" }, { status: 400 });
  }

  const result = await registerUserForTournament(prisma, parsed.data.tableId, userId, {
    role: "ADMIN",
    skipPrivateCheck: true,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const viewerBalance = await getAvailableChipBalance(userId);
  return NextResponse.json({
    ok: true,
    already: result.already ?? false,
    viewerBalance,
  });
}
