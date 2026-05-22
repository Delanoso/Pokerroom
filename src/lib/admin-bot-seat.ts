import { findActiveTableHand } from "@/lib/poker/hand-persist";
import { finalizePlayerLeaveTable } from "@/lib/poker/table-leave";
import { tryAutoStartHand } from "@/lib/poker/try-auto-start-hand";
import { notifyTableChanged } from "@/lib/notify-table";
import { recordTournamentEntryFee } from "@/lib/house-fees";
import { isUserEliminatedFromSitAndGo } from "@/lib/poker/sit-and-go-sync";
import { sittingWindowOpen } from "@/lib/tournament-policy";
import { usesBankrollBuyInOnSit, usesFixedStartingStack } from "@/lib/table-kind";
import { getAvailableChipBalanceTx } from "@/lib/wallet";
import type { PrismaClient } from "@prisma/client";
import { LedgerEntryType, PokerTableKind } from "@prisma/client";

export type AdminBotSeatError =
  | "NOT_FOUND"
  | "CLOSED"
  | "SEAT_RANGE"
  | "ALREADY_SEATED"
  | "SEAT_TAKEN"
  | "BUYIN_RANGE"
  | "INSUFFICIENT"
  | "SIT_TOO_EARLY"
  | "NOT_REGISTERED"
  | "HAND_IN_PROGRESS"
  | "NOT_BOT"
  | "NOT_SEATED"
  | "ELIMINATED"
  | "TABLE_FULL";

export function adminBotSeatErrorMessage(code: AdminBotSeatError): string {
  const messages: Record<AdminBotSeatError, string> = {
    NOT_FOUND: "Table not found",
    CLOSED: "This table is closed",
    SEAT_RANGE: "Invalid seat",
    ALREADY_SEATED: "Bot already has a seat at this table",
    SEAT_TAKEN: "Seat is not available",
    BUYIN_RANGE: "Buy-in outside table limits",
    INSUFFICIENT: "Bot bankroll is too low for this buy-in",
    SIT_TOO_EARLY: "Tournament seats open 10 minutes before start",
    NOT_REGISTERED: "Register the bot for this tournament before seating",
    HAND_IN_PROGRESS: "Cannot leave while a hand is in progress",
    NOT_BOT: "User is not a bot account",
    NOT_SEATED: "Bot is not seated at this table",
    ELIMINATED: "Bot was eliminated from this Sit & Go",
    TABLE_FULL: "This Sit & Go table is full",
  };
  return messages[code];
}

export async function adminSeatBotAtTable(
  prisma: PrismaClient,
  userId: string,
  tableId: string,
  seatIndex: number,
  buyInChips: number,
): Promise<{ ok: true } | { ok: false; code: AdminBotSeatError }> {
  const bot = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBot: true },
  });
  if (!bot?.isBot) return { ok: false, code: "NOT_BOT" };

  const activeHand = await findActiveTableHand(prisma, tableId);
  const joinMidHand = Boolean(activeHand);

  try {
    await prisma.$transaction(async (tx) => {
      const table = await tx.pokerTable.findUnique({ where: { id: tableId } });
      if (!table) throw new Error("NOT_FOUND");
      if (table.closedAt) throw new Error("CLOSED");
      if (seatIndex >= table.maxSeats) throw new Error("SEAT_RANGE");

      if (table.kind === PokerTableKind.SIT_AND_GO) {
        if (await isUserEliminatedFromSitAndGo(tx, tableId, userId)) {
          throw new Error("ELIMINATED");
        }
        const seated = await tx.tableSeat.count({
          where: { tableId, userId: { not: null } },
        });
        if (seated >= table.maxSeats) throw new Error("TABLE_FULL");
      }

      if (table.kind === PokerTableKind.TOURNAMENT && table.startsAt) {
        if (!sittingWindowOpen(new Date(), table.startsAt)) throw new Error("SIT_TOO_EARLY");
        if (table.tournamentGroupId) {
          const reg = await tx.tournamentGroupRegistration.findUnique({
            where: { groupId_userId: { groupId: table.tournamentGroupId, userId } },
          });
          if (!reg) throw new Error("NOT_REGISTERED");
        } else {
          const reg = await tx.tournamentRegistration.findUnique({
            where: { tableId_userId: { tableId, userId } },
          });
          if (!reg) throw new Error("NOT_REGISTERED");
        }
      }

      const alreadyHere = table.tournamentGroupId
        ? await tx.tableSeat.findFirst({
            where: {
              userId,
              table: { tournamentGroupId: table.tournamentGroupId, closedAt: null },
            },
          })
        : await tx.tableSeat.findFirst({ where: { tableId, userId } });
      if (alreadyHere) throw new Error("ALREADY_SEATED");

      const seat = await tx.tableSeat.findUnique({
        where: { tableId_seatIndex: { tableId, seatIndex } },
      });
      if (!seat || seat.userId !== null) throw new Error("SEAT_TAKEN");

      const bankrollBuyIn = usesBankrollBuyInOnSit(table.kind);
      const fixedStack = usesFixedStartingStack(table.kind);
      let stackChips = buyInChips;

      if (fixedStack) {
        const startStack = table.tournamentStartingStackChips || table.minBuyIn;
        if (startStack < 1) throw new Error("NO_START_STACK");
        stackChips = startStack;
      }

      if (bankrollBuyIn) {
        if (buyInChips < table.minBuyIn || buyInChips > table.maxBuyIn) {
          throw new Error("BUYIN_RANGE");
        }
      }

      const entryFee =
        table.kind === PokerTableKind.TOURNAMENT ? (table.tournamentEntryFeeChips ?? 0) : 0;
      const ledgerDebit = bankrollBuyIn ? buyInChips : 0;
      const totalDebit = ledgerDebit + entryFee;
      if (totalDebit > 0) {
        const available = await getAvailableChipBalanceTx(tx, userId);
        if (available < totalDebit) throw new Error("INSUFFICIENT");
      }

      if (ledgerDebit > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId,
            amountChips: -ledgerDebit,
            type: LedgerEntryType.TABLE_BUY_IN,
            note: `Admin seated bot @ table ${table.name}`,
          },
        });
      }

      if (entryFee > 0) {
        await recordTournamentEntryFee(tx, userId, table.createdById, entryFee, table.name);
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
    });

    if (!joinMidHand) {
      await tryAutoStartHand(prisma, tableId);
    }
    void notifyTableChanged(tableId);
    return { ok: true };
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (
      code === "NOT_FOUND" ||
      code === "CLOSED" ||
      code === "SEAT_RANGE" ||
      code === "ALREADY_SEATED" ||
      code === "SEAT_TAKEN" ||
      code === "BUYIN_RANGE" ||
      code === "INSUFFICIENT" ||
      code === "SIT_TOO_EARLY" ||
      code === "NOT_REGISTERED" ||
      code === "ELIMINATED" ||
      code === "TABLE_FULL" ||
      code === "NO_START_STACK"
    ) {
      return { ok: false, code: code as AdminBotSeatError };
    }
    throw e;
  }
}

/** Cash out stack and clear seat(s). When tableId omitted, leaves every open table. */
export async function adminLeaveBotFromTables(
  prisma: PrismaClient,
  userId: string,
  tableId?: string,
): Promise<{ ok: true; left: string[] } | { ok: false; code: AdminBotSeatError }> {
  const bot = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBot: true },
  });
  if (!bot?.isBot) return { ok: false, code: "NOT_BOT" };

  const seats = await prisma.tableSeat.findMany({
    where: {
      userId,
      ...(tableId ? { tableId } : { table: { closedAt: null } }),
    },
    select: { id: true, tableId: true },
  });

  if (seats.length === 0) {
    return tableId ? { ok: false, code: "NOT_SEATED" } : { ok: true, left: [] };
  }

  const left: string[] = [];
  for (const seat of seats) {
    const activeHand = await findActiveTableHand(prisma, seat.tableId);
    if (activeHand) {
      return { ok: false, code: "HAND_IN_PROGRESS" };
    }

    const table = await prisma.pokerTable.findUnique({
      where: { id: seat.tableId },
      select: { kind: true, name: true, minBuyIn: true, maxSeats: true },
    });
    if (!table) continue;

    const leaveResult = await finalizePlayerLeaveTable(prisma, seat.tableId, userId, table);
    if (leaveResult === "not_seated") continue;

    left.push(seat.tableId);
    void notifyTableChanged(seat.tableId);
    await tryAutoStartHand(prisma, seat.tableId);
  }

  return { ok: true, left };
}
