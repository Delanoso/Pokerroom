/**
 * House fee reads/writes via $queryRaw / $executeRaw so admin and rake flows work when
 * `prisma generate` is stale (new `LedgerEntryType` values not in the generated client).
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const LEDGER_HOUSE_RAKE_CASH_POT = "HOUSE_RAKE_CASH_POT" as const;
export const LEDGER_TOURNAMENT_ENTRY_FEE_PAID = "TOURNAMENT_ENTRY_FEE_PAID" as const;
export const LEDGER_TOURNAMENT_FEE_RECEIVED = "TOURNAMENT_FEE_RECEIVED" as const;
export const LEDGER_DEALER_TIP_RECEIVED = "DEALER_TIP_RECEIVED" as const;
export const LEDGER_TOURNAMENT_PRIZE_PAID = "TOURNAMENT_PRIZE_PAID" as const;
export const LEDGER_TOURNAMENT_PRIZE_EXPENSE = "TOURNAMENT_PRIZE_EXPENSE" as const;

export const HOUSE_REVENUE_LEDGER_TYPES = [
  LEDGER_HOUSE_RAKE_CASH_POT,
  LEDGER_TOURNAMENT_FEE_RECEIVED,
  LEDGER_DEALER_TIP_RECEIVED,
] as const;

/** Ledger types cleared from the House revenue admin screen (host credits + paired entry-fee debits). */
export const HOUSE_REVENUE_CLEAR_LEDGER_TYPES = [
  ...HOUSE_REVENUE_LEDGER_TYPES,
  LEDGER_TOURNAMENT_ENTRY_FEE_PAID,
] as const;

export type HouseFeesSqlClient = Prisma.TransactionClient | PrismaClient;

function toInt(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") return Math.trunc(Number(v));
  return 0;
}

export type LedgerTypeAgg = { sumChips: number; count: number };

export async function aggregateLedgerByTypeSql(
  db: HouseFeesSqlClient,
  type: string,
): Promise<LedgerTypeAgg> {
  const rows = await db.$queryRaw<[{ sumChips: unknown; count: unknown }]>`
    SELECT COALESCE(SUM("amountChips"), 0) AS "sumChips", COUNT("id") AS "count"
    FROM "LedgerEntry"
    WHERE "type"::text = ${type}
  `;
  return { sumChips: toInt(rows[0]?.sumChips ?? 0), count: toInt(rows[0]?.count ?? 0) };
}

export type LedgerByUserRow = { userId: string; sumChips: number; count: number };

export async function groupLedgerByUserSql(db: HouseFeesSqlClient, type: string): Promise<LedgerByUserRow[]> {
  const rows = await db.$queryRaw<{ userId: string; sumChips: unknown; count: unknown }[]>`
    SELECT "userId", COALESCE(SUM("amountChips"), 0) AS "sumChips", COUNT("id") AS "count"
    FROM "LedgerEntry"
    WHERE "type"::text = ${type}
    GROUP BY "userId"
  `;
  return rows.map((r) => ({
    userId: r.userId,
    sumChips: toInt(r.sumChips),
    count: toInt(r.count),
  }));
}

export type RecentHouseLedgerRow = {
  id: string;
  type: string;
  amountChips: number;
  note: string | null;
  createdAt: Date;
  username: string;
};

export async function listRecentHouseRevenueEntriesSql(take: number): Promise<RecentHouseLedgerRow[]> {
  const rows = await prisma.$queryRaw<RecentHouseLedgerRow[]>`
    SELECT le."id", le."type", le."amountChips", le."note", le."createdAt", u."username"
    FROM "LedgerEntry" le
    INNER JOIN "User" u ON u."id" = le."userId"
    WHERE le."type"::text IN (${LEDGER_HOUSE_RAKE_CASH_POT}, ${LEDGER_TOURNAMENT_FEE_RECEIVED}, ${LEDGER_DEALER_TIP_RECEIVED})
    ORDER BY le."createdAt" DESC
    LIMIT ${take}
  `;
  return rows.map((r) => ({ ...r, amountChips: toInt(r.amountChips) }));
}

export type OpenTableFeesRow = {
  id: string;
  name: string;
  kind: string;
  smallBlind: number;
  bigBlind: number;
  rakePercentBps: number;
  rakeCapChips: number;
  tournamentEntryFeeChips: number;
  hostUsername: string;
};

export async function listOpenTablesWithFeesSql(take: number): Promise<OpenTableFeesRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string;
      kind: string;
      smallBlind: unknown;
      bigBlind: unknown;
      rakePercentBps: unknown;
      rakeCapChips: unknown;
      tournamentEntryFeeChips: unknown;
      hostUsername: string;
    }[]
  >`
    SELECT t."id", t."name", t."kind", t."smallBlind", t."bigBlind",
      COALESCE(t."rakePercentBps", 0) AS "rakePercentBps",
      COALESCE(t."rakeCapChips", 0) AS "rakeCapChips",
      COALESCE(t."tournamentEntryFeeChips", 0) AS "tournamentEntryFeeChips",
      u."username" AS "hostUsername"
    FROM "PokerTable" t
    INNER JOIN "User" u ON u."id" = t."createdById"
    WHERE t."closedAt" IS NULL
    ORDER BY t."createdAt" DESC
    LIMIT ${take}
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    smallBlind: toInt(r.smallBlind),
    bigBlind: toInt(r.bigBlind),
    rakePercentBps: toInt(r.rakePercentBps),
    rakeCapChips: toInt(r.rakeCapChips),
    tournamentEntryFeeChips: toInt(r.tournamentEntryFeeChips),
    hostUsername: r.hostUsername,
  }));
}

export async function clearHouseRevenueLedgerSql(db: HouseFeesSqlClient): Promise<number> {
  const types = [...HOUSE_REVENUE_CLEAR_LEDGER_TYPES];
  const rows = await db.$queryRaw<[{ count: unknown }]>`
    SELECT COUNT("id") AS "count"
    FROM "LedgerEntry"
    WHERE "type"::text IN (${types[0]}, ${types[1]}, ${types[2]}, ${types[3]})
  `;
  const count = toInt(rows[0]?.count ?? 0);
  if (count === 0) return 0;
  await db.$executeRaw`
    DELETE FROM "LedgerEntry"
    WHERE "type"::text IN (${types[0]}, ${types[1]}, ${types[2]}, ${types[3]})
  `;
  return count;
}

export async function insertLedgerEntrySql(
  tx: Prisma.TransactionClient,
  opts: { userId: string; amountChips: number; type: string; note: string },
): Promise<void> {
  const id = randomUUID();
  const now = new Date();
  await tx.$executeRaw`
    INSERT INTO "LedgerEntry" ("id", "userId", "amountChips", "type", "note", "createdAt")
    VALUES (${id}, ${opts.userId}, ${opts.amountChips}, CAST(${opts.type} AS "LedgerEntryType"), ${opts.note}, ${now})
  `;
}

export async function creditHouseRakeCashPotSql(
  tx: Prisma.TransactionClient,
  hostUserId: string,
  amountChips: number,
  tableId: string,
  handId: string,
): Promise<void> {
  if (amountChips <= 0) return;
  await insertLedgerEntrySql(tx, {
    userId: hostUserId,
    amountChips,
    type: LEDGER_HOUSE_RAKE_CASH_POT,
    note: `Cash rake table ${tableId} hand ${handId}`,
  });
}

export async function recordTournamentEntryFeeSql(
  tx: Prisma.TransactionClient,
  playerUserId: string,
  hostUserId: string,
  amountChips: number,
  tableName: string,
): Promise<void> {
  if (amountChips <= 0) return;
  await insertLedgerEntrySql(tx, {
    userId: playerUserId,
    amountChips: -amountChips,
    type: LEDGER_TOURNAMENT_ENTRY_FEE_PAID,
    note: `Tournament entry fee — ${tableName}`,
  });
  await insertLedgerEntrySql(tx, {
    userId: hostUserId,
    amountChips,
    type: LEDGER_TOURNAMENT_FEE_RECEIVED,
    note: `Tournament entry fee — ${tableName}`,
  });
}

export async function refundTournamentEntryFeeSql(
  tx: Prisma.TransactionClient,
  playerUserId: string,
  hostUserId: string,
  amountChips: number,
  tableName: string,
): Promise<void> {
  if (amountChips <= 0) return;
  await insertLedgerEntrySql(tx, {
    userId: playerUserId,
    amountChips,
    type: LEDGER_TOURNAMENT_ENTRY_FEE_PAID,
    note: `Tournament registration refund — ${tableName}`,
  });
  await insertLedgerEntrySql(tx, {
    userId: hostUserId,
    amountChips: -amountChips,
    type: LEDGER_TOURNAMENT_FEE_RECEIVED,
    note: `Tournament registration refund — ${tableName}`,
  });
}
