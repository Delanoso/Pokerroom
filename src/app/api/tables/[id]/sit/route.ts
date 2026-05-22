import { findActiveTableHand } from "@/lib/poker/hand-persist";
import { requireActiveSession } from "@/lib/require-active-session";
import { tryAutoStartHand } from "@/lib/poker/try-auto-start-hand";
import { notifyTableChanged } from "@/lib/notify-table";
import { prisma } from "@/lib/prisma";
import { getAvailableChipBalanceTx } from "@/lib/wallet";
import { isUserEliminatedFromSitAndGo } from "@/lib/poker/sit-and-go-sync";
import { isUserActiveInFlight, loadFlightContext } from "@/lib/tournament-flight";
import { sittingWindowOpen } from "@/lib/tournament-policy";
import { usesBankrollBuyInOnSit, usesFixedStartingStack } from "@/lib/table-kind";
import { LedgerEntryType, PokerTableKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  seatIndex: z.coerce.number().int().min(0).max(8),
  buyInChips: z.coerce.number().int().min(1),
});

export async function POST(request: Request, { params }: Params) {
  const gate = await requireActiveSession();
  if (!gate.ok) return gate.response;

  const { id: tableId } = await params;

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

  const { seatIndex, buyInChips } = parsed.data;
  const userId = gate.userId;

  const activeHand = await findActiveTableHand(prisma, tableId);
  const joinMidHand = Boolean(activeHand);

  const flightCtx = await loadFlightContext(prisma, tableId);
  if (flightCtx && !(await isUserActiveInFlight(prisma, flightCtx, userId))) {
    return NextResponse.json({ error: "You are eliminated from this tournament" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const table = await tx.pokerTable.findUnique({
        where: { id: tableId },
      });
      if (!table) {
        throw new Error("NOT_FOUND");
      }
      if (table.closedAt) {
        throw new Error("CLOSED");
      }
      if (seatIndex >= table.maxSeats) {
        throw new Error("SEAT_RANGE");
      }

      if (table.kind === PokerTableKind.SIT_AND_GO) {
        if (await isUserEliminatedFromSitAndGo(tx, tableId, userId)) {
          throw new Error("ELIMINATED");
        }
        const seated = await tx.tableSeat.count({
          where: { tableId, userId: { not: null } },
        });
        if (seated >= table.maxSeats) {
          throw new Error("TABLE_FULL");
        }
      }

      if (table.kind === PokerTableKind.TOURNAMENT && table.startsAt) {
        if (!sittingWindowOpen(new Date(), table.startsAt)) {
          throw new Error("SIT_TOO_EARLY");
        }
        if (table.tournamentGroupId) {
          const reg = await tx.tournamentGroupRegistration.findUnique({
            where: { groupId_userId: { groupId: table.tournamentGroupId, userId } },
            select: { id: true },
          });
          if (!reg) {
            throw new Error("NOT_REGISTERED");
          }
        } else {
          const reg = await tx.tournamentRegistration.findUnique({
            where: { tableId_userId: { tableId, userId } },
            select: { id: true },
          });
          if (!reg) {
            throw new Error("NOT_REGISTERED");
          }
        }
      }

      const alreadyHere = table.tournamentGroupId
        ? await tx.tableSeat.findFirst({
            where: {
              userId,
              table: { tournamentGroupId: table.tournamentGroupId, closedAt: null },
            },
          })
        : await tx.tableSeat.findFirst({
            where: { tableId, userId },
          });
      if (alreadyHere) {
        throw new Error("ALREADY_SEATED");
      }

      const seat = await tx.tableSeat.findUnique({
        where: { tableId_seatIndex: { tableId, seatIndex } },
      });
      if (!seat || seat.userId !== null) {
        throw new Error("SEAT_TAKEN");
      }

      const bankrollBuyIn = usesBankrollBuyInOnSit(table.kind);
      const fixedStack = usesFixedStartingStack(table.kind);
      let stackChips = buyInChips;

      if (fixedStack) {
        const startStack = table.tournamentStartingStackChips || table.minBuyIn;
        if (startStack < 1) {
          throw new Error("NO_START_STACK");
        }
        stackChips = startStack;
      }

      if (bankrollBuyIn) {
        if (buyInChips < table.minBuyIn || buyInChips > table.maxBuyIn) {
          throw new Error("BUYIN_RANGE");
        }
        const available = await getAvailableChipBalanceTx(tx, userId);
        if (available < buyInChips) {
          throw new Error("INSUFFICIENT");
        }
        await tx.ledgerEntry.create({
          data: {
            userId,
            amountChips: -buyInChips,
            type: LedgerEntryType.TABLE_BUY_IN,
            note: `Buy-in table ${table.name}`,
          },
        });
      }

      await tx.tableSeat.update({
        where: { id: seat.id },
        data: {
          userId,
          stackChips,
          waitingForNextHand: joinMidHand,
          sittingOut: false,
          sitOutNextHand: false,
        },
      });

      return { ok: true as const, waitingForNextHand: joinMidHand };
    });

    if (result.ok) {
      if (!joinMidHand) {
        await tryAutoStartHand(prisma, tableId);
      }
      void notifyTableChanged(tableId);
    }
    return NextResponse.json({ ok: true, waitingForNextHand: result.waitingForNextHand });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "NOT_FOUND") {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }
    if (code === "CLOSED") {
      return NextResponse.json({ error: "This table is closed" }, { status: 410 });
    }
    if (code === "SEAT_RANGE") {
      return NextResponse.json({ error: "Invalid seat" }, { status: 400 });
    }
    if (code === "ALREADY_SEATED") {
      return NextResponse.json({ error: "You already have a seat at this table" }, { status: 400 });
    }
    if (code === "SEAT_TAKEN") {
      return NextResponse.json({ error: "Seat is not available" }, { status: 400 });
    }
    if (code === "BUYIN_RANGE") {
      return NextResponse.json({ error: "Buy-in outside table limits" }, { status: 400 });
    }
    if (code === "INSUFFICIENT") {
      return NextResponse.json({ error: "Not enough Zar in your account" }, { status: 400 });
    }
    if (code === "NO_START_STACK") {
      return NextResponse.json({ error: "Tournament starting stack is not configured" }, { status: 400 });
    }
    if (code === "SIT_TOO_EARLY") {
      return NextResponse.json(
        { error: "Tournament seats open 10 minutes before the scheduled start" },
        { status: 400 },
      );
    }
    if (code === "NOT_REGISTERED") {
      return NextResponse.json({ error: "Register for this tournament before taking a seat" }, { status: 400 });
    }
    if (code === "TABLE_FULL") {
      return NextResponse.json({ error: "This Sit & Go table is full" }, { status: 400 });
    }
    if (code === "ELIMINATED") {
      return NextResponse.json(
        { error: "You were eliminated from this Sit & Go and cannot re-enter" },
        { status: 400 },
      );
    }
    throw e;
  }
}
