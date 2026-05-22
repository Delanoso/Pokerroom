import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createPokerTableRow } from "@/lib/poker-table-create";
import { listOpenTableIds } from "@/lib/open-table-ids";
import { fetchPokerTableTournamentMeta } from "@/lib/poker-table-tournament-meta";
import { requireActiveSession } from "@/lib/require-active-session";
import { filterOpenTablesForLobby } from "@/lib/tournament-policy";
import { PokerTableKind, TournamentFlightStatus, TournamentListingVisibility } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.nativeEnum(PokerTableKind).default(PokerTableKind.CASH),
    /** ISO 8601; required when kind is TOURNAMENT */
    startsAt: z.string().optional(),
    smallBlind: z.coerce.number().int().min(1).max(1_000_000),
    bigBlind: z.coerce.number().int().min(1).max(1_000_000),
    maxSeats: z.coerce.number().int().min(2).max(9),
    minBuyIn: z.coerce.number().int().min(1).max(1_000_000_000),
    maxBuyIn: z.coerce.number().int().min(1).max(1_000_000_000),
    /** Tournaments only; default public. */
    tournamentListingVisibility: z.nativeEnum(TournamentListingVisibility).optional(),
    /** Tournaments only: starting stack (play chips) for every entrant. */
    tournamentStartingStackChips: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
    tournamentPrize1stZar: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    tournamentPrize2ndZar: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    tournamentPrize3rdZar: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    /** For private tournaments: extra invited player ids (host is always included). */
    invitedUserIds: z.array(z.string().min(1)).max(500).optional(),
    /** Cash only: rake in basis points (500 = 5%). 0 disables. */
    rakePercentBps: z.coerce.number().int().min(0).max(10_000).optional(),
    /** Cash only: max rake chips per pot; 0 = no cap. */
    rakeCapChips: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    /** Tournament only: extra bankroll fee to host when a player sits (besides stack buy-in). */
    tournamentEntryFeeChips: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    /** Minimum registrations required or the flight is cancelled at start time. */
    tournamentMinPlayersToStart: z.coerce.number().int().min(2).max(500).optional(),
    /** Tournaments only: timed blind level increases after the flight starts. */
    tournamentEscalatingBlinds: z.boolean().optional(),
    /** Minutes per blind level when escalating blinds are enabled. */
    tournamentBlindLevelMinutes: z.coerce.number().int().min(1).max(240).optional(),
    /** Per-level multiplier in basis points (20000 = double). */
    tournamentBlindLevelMultiplierBps: z.coerce.number().int().min(10_000).max(50_000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === PokerTableKind.TOURNAMENT) {
      if (!data.startsAt?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tournament start time is required", path: ["startsAt"] });
        return;
      }
      const t = new Date(data.startsAt);
      if (Number.isNaN(t.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid start time", path: ["startsAt"] });
      }
    } else if (data.startsAt?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start time applies to scheduled tournaments only",
        path: ["startsAt"],
      });
    }

    if (data.kind !== PokerTableKind.TOURNAMENT) {
      if (data.tournamentListingVisibility != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Listing visibility applies to scheduled tournaments only",
          path: ["tournamentListingVisibility"],
        });
      }
      if (data.invitedUserIds && data.invitedUserIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invites apply to scheduled tournaments only",
          path: ["invitedUserIds"],
        });
      }
      if ((data.tournamentEntryFeeChips ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Entry fee applies to scheduled tournaments only",
          path: ["tournamentEntryFeeChips"],
        });
      }
      if ((data.tournamentMinPlayersToStart ?? 2) !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Minimum players applies to scheduled tournaments only",
          path: ["tournamentMinPlayersToStart"],
        });
      }
      if (data.tournamentEscalatingBlinds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Escalating blinds apply to scheduled tournaments only",
          path: ["tournamentEscalatingBlinds"],
        });
      }
    }

    if (
      data.kind === PokerTableKind.TOURNAMENT &&
      data.tournamentEscalatingBlinds &&
      (data.tournamentBlindLevelMinutes ?? 0) < 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Level length (minutes) is required when escalating blinds are enabled",
        path: ["tournamentBlindLevelMinutes"],
      });
    }

    if (data.kind === PokerTableKind.TOURNAMENT || data.kind === PokerTableKind.SIT_AND_GO) {
      if ((data.rakePercentBps ?? 0) > 0 || (data.rakeCapChips ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Rake applies to cash games only",
          path: ["rakePercentBps"],
        });
      }
      if (!data.tournamentStartingStackChips || data.tournamentStartingStackChips < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Starting stack (chips) is required",
          path: ["tournamentStartingStackChips"],
        });
      }
    }

    if (data.kind === PokerTableKind.CASH) {
      if (
        (data.tournamentStartingStackChips ?? 0) > 0 ||
        (data.tournamentPrize1stZar ?? 0) > 0 ||
        (data.tournamentPrize2ndZar ?? 0) > 0 ||
        (data.tournamentPrize3rdZar ?? 0) > 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Starting stack and prizes do not apply to cash games",
          path: ["tournamentStartingStackChips"],
        });
      }
    }

    if (data.kind === PokerTableKind.SIT_AND_GO) {
      if (data.minBuyIn !== data.maxBuyIn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sit & Go buy-in must be a single fixed amount (min and max must match)",
          path: ["maxBuyIn"],
        });
      }
      if ((data.tournamentPrize1stZar ?? 0) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "1st place prize must be zero or positive",
          path: ["tournamentPrize1stZar"],
        });
      }
      if (
        (data.tournamentPrize2ndZar ?? 0) > 0 ||
        (data.tournamentPrize3rdZar ?? 0) > 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Only 1st place prize applies to Sit & Go",
          path: ["tournamentPrize2ndZar"],
        });
      }
    }

    if (
      data.kind === PokerTableKind.TOURNAMENT &&
      data.tournamentListingVisibility === TournamentListingVisibility.PRIVATE &&
      data.invitedUserIds &&
      data.invitedUserIds.length > 500
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Too many invites", path: ["invitedUserIds"] });
    }
  });

export async function GET() {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const openIds = await listOpenTableIds();
  const tablesRaw =
    openIds.length === 0
      ? []
      : await prisma.pokerTable.findMany({
          where: { id: { in: openIds } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            kind: true,
            startsAt: true,
            tournamentListingVisibility: true,
            tournamentGroupId: true,
            createdById: true,
            smallBlind: true,
            bigBlind: true,
            maxSeats: true,
            minBuyIn: true,
            maxBuyIn: true,
            createdAt: true,
            createdBy: { select: { username: true } },
            seats: {
              select: { userId: true },
            },
          },
        });

  const tables = await filterOpenTablesForLobby(prisma, tablesRaw, gate.userId, gate.role);
  const metaById = await fetchPokerTableTournamentMeta(tables.map((t) => t.id));

  const regCounts =
    tables.length === 0
      ? []
      : await prisma.tournamentRegistration.groupBy({
          by: ["tableId"],
          where: { tableId: { in: tables.map((t) => t.id) } },
          _count: { id: true },
        });
  const regByTable = new Map(regCounts.map((r) => [r.tableId, r._count.id]));

  const groupIds = [...new Set(tables.map((t) => t.tournamentGroupId).filter((g): g is string => !!g))];
  const groupRegCounts =
    groupIds.length === 0
      ? []
      : await prisma.tournamentGroupRegistration.groupBy({
          by: ["groupId"],
          where: { groupId: { in: groupIds } },
          _count: { id: true },
        });
  const regByGroup = new Map(groupRegCounts.map((r) => [r.groupId, r._count.id]));

  const seatCapByGroup = new Map<string, number>();
  for (const t of tables) {
    if (t.tournamentGroupId) {
      seatCapByGroup.set(
        t.tournamentGroupId,
        (seatCapByGroup.get(t.tournamentGroupId) ?? 0) + t.maxSeats,
      );
    }
  }

  const payload = tables.map((t) => {
    const meta = metaById.get(t.id);
    const kind = meta?.kind ?? t.kind;
    return {
      id: t.id,
      name: t.name,
      kind,
      startsAt: (meta?.startsAt ?? t.startsAt)?.toISOString() ?? null,
      tournamentListingVisibility: kind === PokerTableKind.TOURNAMENT ? t.tournamentListingVisibility : null,
      tournamentGroupId: t.tournamentGroupId,
      smallBlind: t.smallBlind,
      bigBlind: t.bigBlind,
      maxSeats: t.maxSeats,
      minBuyIn: t.minBuyIn,
      maxBuyIn: t.maxBuyIn,
      createdAt: t.createdAt.toISOString(),
      hostUsername: t.createdBy.username,
      seatedCount: t.seats.filter((s) => s.userId !== null).length,
      registrationCount:
        t.kind === PokerTableKind.TOURNAMENT
          ? t.tournamentGroupId
            ? (regByGroup.get(t.tournamentGroupId) ?? 0)
            : (regByTable.get(t.id) ?? 0)
          : 0,
      registrationCap:
        t.kind === PokerTableKind.TOURNAMENT
          ? t.tournamentGroupId
            ? (seatCapByGroup.get(t.tournamentGroupId) ?? t.maxSeats)
            : t.maxSeats
          : 0,
    };
  });

  return NextResponse.json({ tables: payload });
}

export async function POST(request: Request) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;
  if (gate.role !== "ADMIN") {
    return NextResponse.json({ error: "Only operators can create tables" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const {
    name,
    kind,
    startsAt,
    smallBlind,
    bigBlind,
    maxSeats,
    minBuyIn,
    maxBuyIn,
    tournamentListingVisibility: listingIn,
    invitedUserIds,
    rakePercentBps: rakeBpsIn,
    rakeCapChips: rakeCapIn,
    tournamentEntryFeeChips: entryFeeIn,
    tournamentStartingStackChips: startingStackIn,
    tournamentPrize1stZar: prize1stIn,
    tournamentPrize2ndZar: prize2ndIn,
    tournamentPrize3rdZar: prize3rdIn,
    tournamentMinPlayersToStart: minPlayersIn,
    tournamentEscalatingBlinds: escalatingBlindsIn,
    tournamentBlindLevelMinutes: blindLevelMinutesIn,
    tournamentBlindLevelMultiplierBps: blindMultiplierBpsIn,
  } = parsed.data;
  const rakePercentBps = kind === PokerTableKind.CASH ? (rakeBpsIn ?? 0) : 0;
  const rakeCapChips = kind === PokerTableKind.CASH ? (rakeCapIn ?? 0) : 0;
  const tournamentEntryFeeChips = kind === PokerTableKind.TOURNAMENT ? (entryFeeIn ?? 0) : 0;
  if (bigBlind < smallBlind) {
    return NextResponse.json({ error: "Big blind must be >= small blind" }, { status: 400 });
  }
  if (maxBuyIn < minBuyIn) {
    return NextResponse.json({ error: "Max buy-in must be >= min buy-in" }, { status: 400 });
  }

  const startsAtDate =
    kind === PokerTableKind.TOURNAMENT && startsAt?.trim() ? new Date(startsAt.trim()) : null;
  if (kind === PokerTableKind.TOURNAMENT && (!startsAtDate || Number.isNaN(startsAtDate.getTime()))) {
    return NextResponse.json({ error: "Invalid tournament start time" }, { status: 400 });
  }

  const listing: TournamentListingVisibility | null =
    kind === PokerTableKind.TOURNAMENT
      ? (listingIn ?? TournamentListingVisibility.PUBLIC)
      : null;

  const tournamentGroupId = kind === PokerTableKind.TOURNAMENT ? randomUUID() : null;
  const tournamentStartingStackChips =
    kind === PokerTableKind.TOURNAMENT || kind === PokerTableKind.SIT_AND_GO
      ? (startingStackIn ?? minBuyIn)
      : 0;
  const tournamentPrize1stZar =
    kind === PokerTableKind.TOURNAMENT || kind === PokerTableKind.SIT_AND_GO ? (prize1stIn ?? 0) : 0;
  const tournamentPrize2ndZar = kind === PokerTableKind.TOURNAMENT ? (prize2ndIn ?? 0) : 0;
  const tournamentPrize3rdZar = kind === PokerTableKind.TOURNAMENT ? (prize3rdIn ?? 0) : 0;
  const tournamentMinPlayersToStart =
    kind === PokerTableKind.TOURNAMENT ? Math.max(2, minPlayersIn ?? 2) : 2;
  const tournamentEscalatingBlinds =
    kind === PokerTableKind.TOURNAMENT ? (escalatingBlindsIn ?? false) : false;
  const tournamentBlindLevelMinutes =
    kind === PokerTableKind.TOURNAMENT && tournamentEscalatingBlinds
      ? Math.max(1, blindLevelMinutesIn ?? 10)
      : 10;
  const tournamentBlindLevelMultiplierBps =
    kind === PokerTableKind.TOURNAMENT && tournamentEscalatingBlinds
      ? Math.max(10_000, blindMultiplierBpsIn ?? 20_000)
      : 20_000;
  const effectiveMinBuyIn =
    kind === PokerTableKind.TOURNAMENT ? tournamentStartingStackChips : minBuyIn;
  const effectiveMaxBuyIn =
    kind === PokerTableKind.TOURNAMENT ? tournamentStartingStackChips : maxBuyIn;

  try {
    const createdIds = await prisma.$transaction(async (tx) => {
      const t = await createPokerTableRow(tx, {
          name,
          kind,
          startsAt: startsAtDate,
          tournamentListingVisibility: listing,
          tournamentGroupId,
          smallBlind,
          bigBlind,
          maxSeats,
          minBuyIn: effectiveMinBuyIn,
          maxBuyIn: effectiveMaxBuyIn,
          rakePercentBps,
          rakeCapChips,
          tournamentEntryFeeChips,
          tournamentStartingStackChips,
          tournamentPrize1stZar,
          tournamentPrize2ndZar,
          tournamentPrize3rdZar,
          tournamentMinPlayersToStart,
          tournamentEscalatingBlinds,
          tournamentBlindLevelMinutes,
          tournamentBlindLevelMultiplierBps,
          tournamentFlightStatus:
            kind === PokerTableKind.TOURNAMENT ? TournamentFlightStatus.SCHEDULED : null,
          createdById: gate.userId,
      });
      await tx.tableSeat.createMany({
        data: Array.from({ length: maxSeats }, (_, seatIndex) => ({
          tableId: t.id,
          seatIndex,
          stackChips: 0,
        })),
      });

      if (kind === PokerTableKind.TOURNAMENT && listing === TournamentListingVisibility.PRIVATE) {
        const inviteIds = [...new Set([gate.userId, ...(invitedUserIds ?? [])])];
        const found = await tx.user.findMany({
          where: { id: { in: inviteIds } },
          select: { id: true },
        });
        if (found.length !== inviteIds.length) {
          throw new Error("BAD_INVITES");
        }
        await tx.tournamentInvite.createMany({
          data: inviteIds.map((userId) => ({ tableId: t.id, userId })),
        });
      }
      return [t.id];
    });

    return NextResponse.json({ id: createdIds[0], tableIds: createdIds, tournamentGroupId }, { status: 201 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "BAD_INVITES") {
      return NextResponse.json({ error: "One or more invited user ids are invalid" }, { status: 400 });
    }
    throw e;
  }
}
