import { requireAdminOperator } from "@/lib/admin-operator";
import { prisma } from "@/lib/prisma";
import { getAvailableChipBalance, getChipBalance } from "@/lib/wallet";
import { LedgerEntryType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, numbers, and at most: _ . -"),
  password: z.string().min(8).max(128).optional(),
  startingChips: z.coerce.number().int().min(0).max(500_000_000).default(100_000),
});

export async function GET() {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  const bots = await prisma.user.findMany({
    where: { isBot: true },
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      email: true,
      blockedAt: true,
      createdAt: true,
    },
  });

  const botIds = bots.map((b) => b.id);

  const [groupRegs, tableRegs] = await Promise.all([
    botIds.length === 0
      ? []
      : prisma.tournamentGroupRegistration.findMany({
          where: { userId: { in: botIds } },
          select: { userId: true, groupId: true },
        }),
    botIds.length === 0
      ? []
      : prisma.tournamentRegistration.findMany({
          where: { userId: { in: botIds } },
          select: { userId: true, tableId: true },
        }),
  ]);

  const groupTables =
    groupRegs.length === 0
      ? []
      : await prisma.pokerTable.findMany({
          where: {
            tournamentGroupId: { in: [...new Set(groupRegs.map((r) => r.groupId))] },
            closedAt: null,
          },
          select: { id: true, tournamentGroupId: true },
          orderBy: { createdAt: "asc" },
        });
  const anchorByGroup = new Map<string, string>();
  for (const t of groupTables) {
    if (t.tournamentGroupId && !anchorByGroup.has(t.tournamentGroupId)) {
      anchorByGroup.set(t.tournamentGroupId, t.id);
    }
  }

  const registeredTableIdsByUser = new Map<string, Set<string>>();
  for (const r of groupRegs) {
    const anchor = anchorByGroup.get(r.groupId);
    if (!anchor) continue;
    const set = registeredTableIdsByUser.get(r.userId) ?? new Set();
    set.add(anchor);
    registeredTableIdsByUser.set(r.userId, set);
  }
  for (const r of tableRegs) {
    const set = registeredTableIdsByUser.get(r.userId) ?? new Set();
    set.add(r.tableId);
    registeredTableIdsByUser.set(r.userId, set);
  }

  const seats =
    botIds.length === 0
      ? []
      : await prisma.tableSeat.findMany({
          where: { userId: { in: botIds }, table: { closedAt: null } },
          select: {
            seatIndex: true,
            stackChips: true,
            userId: true,
            table: { select: { id: true, name: true, kind: true } },
          },
        });

  const seatsByUser = new Map<string, typeof seats>();
  for (const s of seats) {
    if (!s.userId) continue;
    const list = seatsByUser.get(s.userId) ?? [];
    list.push(s);
    seatsByUser.set(s.userId, list);
  }

  const rows = await Promise.all(
    bots.map(async (b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
      blockedAt: b.blockedAt?.toISOString() ?? null,
      bankrollChips: await getChipBalance(b.id),
      availableChips: await getAvailableChipBalance(b.id),
      seats: (seatsByUser.get(b.id) ?? []).map((s) => ({
        seatIndex: s.seatIndex,
        stackChips: s.stackChips,
        tableId: s.table.id,
        tableName: s.table.name,
        tableKind: s.table.kind,
      })),
      registeredTournamentTableIds: [...(registeredTableIdsByUser.get(b.id) ?? [])],
    })),
  );

  return NextResponse.json({ bots: rows });
}

export async function POST(request: Request) {
  const op = await requireAdminOperator();
  if ("error" in op) return op.error;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const usernameNorm = parsed.data.username.toLowerCase();
  const emailNorm = `${usernameNorm}@bots.local`;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: usernameNorm }, { email: emailNorm }] },
  });
  if (existing) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const plainPassword = parsed.data.password ?? randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(plainPassword, 12);

  const bot = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName: "Bot",
        lastName: usernameNorm,
        username: usernameNorm,
        displayUsername: parsed.data.username,
        email: emailNorm,
        passwordHash,
        isBot: true,
      },
      select: { id: true, username: true, email: true, createdAt: true },
    });

    if (parsed.data.startingChips > 0) {
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amountChips: parsed.data.startingChips,
          type: LedgerEntryType.ADMIN_ADJUSTMENT,
          note: "Operator created bot account",
          createdById: op.operatorId,
        },
      });
    }

    return user;
  });

  return NextResponse.json(
    {
      ok: true,
      bot: {
        id: bot.id,
        username: bot.username,
        email: bot.email,
        createdAt: bot.createdAt.toISOString(),
      },
      /** Shown once — use for BOT_LOGIN / BOT_PASSWORD when running bot-runner. */
      password: plainPassword,
    },
    { status: 201 },
  );
}
