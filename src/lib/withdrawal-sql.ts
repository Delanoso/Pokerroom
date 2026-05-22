/**
 * Withdrawal persistence via $queryRaw / $executeRaw so the app keeps working when the
 * generated Prisma delegate `withdrawalRequest` is missing (e.g. `prisma generate` failed on Windows EPERM).
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Same values as Prisma `WithdrawalRequestStatus`; literals so a stale/missing generated client never breaks this module. */
const WR_PENDING = "PENDING" as const;
const WR_APPROVED = "APPROVED" as const;
const WR_DECLINED = "DECLINED" as const;

/** Matches `LedgerEntryType` in schema; literal for stale `prisma generate`. */
const LEDGER_WITHDRAWAL_PAYOUT = "WITHDRAWAL_PAYOUT" as const;

export type WithdrawalSqlClient = Prisma.TransactionClient | PrismaClient;

function toInt(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") return Math.trunc(Number(v));
  return 0;
}

export async function sumPendingWithdrawalHoldSql(db: WithdrawalSqlClient, userId: string): Promise<number> {
  const rows = await db.$queryRaw<[{ s: unknown }]>`
    SELECT COALESCE(SUM("amountChips"), 0) AS s
    FROM "WithdrawalRequest"
    WHERE "userId" = ${userId} AND "status"::text = ${WR_PENDING}
  `;
  return toInt(rows[0]?.s ?? 0);
}

export type WithdrawalListRow = {
  id: string;
  amountChips: number;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
};

export async function listRecentWithdrawalsForUser(userId: string, take: number): Promise<WithdrawalListRow[]> {
  return prisma.$queryRaw<WithdrawalListRow[]>`
    SELECT "id", "amountChips", "status", "createdAt", "resolvedAt"
    FROM "WithdrawalRequest"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
    LIMIT ${take}
  `;
}

export type AdminPendingWithdrawalRow = {
  id: string;
  amountChips: number;
  createdAt: Date;
  username: string;
  email: string;
};

export async function listPendingWithdrawalsForAdmin(): Promise<AdminPendingWithdrawalRow[]> {
  return prisma.$queryRaw<AdminPendingWithdrawalRow[]>`
    SELECT wr."id", wr."amountChips", wr."createdAt", u."username", u."email"
    FROM "WithdrawalRequest" wr
    INNER JOIN "User" u ON u."id" = wr."userId"
    WHERE wr."status"::text = ${WR_PENDING}
    ORDER BY wr."createdAt" ASC
  `;
}

export type PendingWithdrawalLockRow = {
  id: string;
  userId: string;
  amountChips: number;
};

export async function findPendingWithdrawalById(
  db: WithdrawalSqlClient,
  id: string,
): Promise<PendingWithdrawalLockRow | null> {
  const rows = await db.$queryRaw<PendingWithdrawalLockRow[]>`
    SELECT "id", "userId", "amountChips"
    FROM "WithdrawalRequest"
    WHERE "id" = ${id} AND "status"::text = ${WR_PENDING}
  `;
  return rows[0] ?? null;
}

export async function insertWithdrawalRequest(
  tx: Prisma.TransactionClient,
  userId: string,
  amountChips: number,
): Promise<void> {
  const id = randomUUID();
  const now = new Date();
  await tx.$executeRaw`
    INSERT INTO "WithdrawalRequest" ("id", "userId", "amountChips", "status", "createdAt")
    VALUES (${id}, ${userId}, ${amountChips}, CAST(${WR_PENDING} AS "WithdrawalRequestStatus"), ${now})
  `;
}

export async function markWithdrawalApproved(
  tx: Prisma.TransactionClient,
  id: string,
  resolvedById: string,
): Promise<number> {
  const now = new Date();
  return tx.$executeRaw`
    UPDATE "WithdrawalRequest"
    SET "status" = CAST(${WR_APPROVED} AS "WithdrawalRequestStatus"),
        "resolvedAt" = ${now},
        "resolvedById" = ${resolvedById}
    WHERE "id" = ${id} AND "status"::text = ${WR_PENDING}
  `;
}

export async function markWithdrawalDeclined(db: WithdrawalSqlClient, id: string, resolvedById: string): Promise<number> {
  const now = new Date();
  return db.$executeRaw`
    UPDATE "WithdrawalRequest"
    SET "status" = CAST(${WR_DECLINED} AS "WithdrawalRequestStatus"),
        "resolvedAt" = ${now},
        "resolvedById" = ${resolvedById}
    WHERE "id" = ${id} AND "status"::text = ${WR_PENDING}
  `;
}

/** Negative `amountChips` row: removes chips from the player ledger on approved withdrawal. */
export async function insertWithdrawalPayoutLedgerRow(
  tx: Prisma.TransactionClient,
  opts: { userId: string; amountChips: number; requestId: string; createdById: string },
): Promise<void> {
  const id = randomUUID();
  const now = new Date();
  const delta = -opts.amountChips;
  const note = `Withdrawal approved (request ${opts.requestId})`;
  await tx.$executeRaw`
    INSERT INTO "LedgerEntry" ("id", "userId", "amountChips", "type", "note", "createdById", "createdAt")
    VALUES (${id}, ${opts.userId}, ${delta}, CAST(${LEDGER_WITHDRAWAL_PAYOUT} AS "LedgerEntryType"), ${note}, ${opts.createdById}, ${now})
  `;
}

/** Ledger total for a user (same as sum of `LedgerEntry.amountChips`). */
export async function sumLedgerChipsSql(db: WithdrawalSqlClient, userId: string): Promise<number> {
  const rows = await db.$queryRaw<[{ s: unknown }]>`
    SELECT COALESCE(SUM("amountChips"), 0) AS s
    FROM "LedgerEntry"
    WHERE "userId" = ${userId}
  `;
  return toInt(rows[0]?.s ?? 0);
}
