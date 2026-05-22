/**
 * Deposit persistence via raw SQL (same pattern as withdrawal-sql).
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DR_PENDING = "PENDING" as const;
const DR_APPROVED = "APPROVED" as const;
const DR_DECLINED = "DECLINED" as const;

const LEDGER_DEPOSIT_CREDIT = "DEPOSIT_CREDIT" as const;

export type DepositSqlClient = Prisma.TransactionClient | PrismaClient;

function toInt(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") return Math.trunc(Number(v));
  return 0;
}

export type DepositListRow = {
  id: string;
  amountChips: number;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
};

export async function listRecentDepositsForUser(userId: string, take: number): Promise<DepositListRow[]> {
  return prisma.$queryRaw<DepositListRow[]>`
    SELECT "id", "amountChips", "status", "createdAt", "resolvedAt"
    FROM "DepositRequest"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
    LIMIT ${take}
  `;
}

export type AdminPendingDepositRow = {
  id: string;
  amountChips: number;
  createdAt: Date;
  username: string;
  email: string;
};

export async function listPendingDepositsForAdmin(): Promise<AdminPendingDepositRow[]> {
  return prisma.$queryRaw<AdminPendingDepositRow[]>`
    SELECT dr."id", dr."amountChips", dr."createdAt", u."username", u."email"
    FROM "DepositRequest" dr
    INNER JOIN "User" u ON u."id" = dr."userId"
    WHERE dr."status"::text = ${DR_PENDING}
    ORDER BY dr."createdAt" ASC
  `;
}

export type PendingDepositLockRow = {
  id: string;
  userId: string;
  amountChips: number;
};

export async function findPendingDepositById(
  db: DepositSqlClient,
  id: string,
): Promise<PendingDepositLockRow | null> {
  const rows = await db.$queryRaw<PendingDepositLockRow[]>`
    SELECT "id", "userId", "amountChips"
    FROM "DepositRequest"
    WHERE "id" = ${id} AND "status"::text = ${DR_PENDING}
  `;
  return rows[0] ?? null;
}

export async function insertDepositRequest(
  tx: Prisma.TransactionClient,
  userId: string,
  amountChips: number,
): Promise<void> {
  const id = randomUUID();
  const now = new Date();
  await tx.$executeRaw`
    INSERT INTO "DepositRequest" ("id", "userId", "amountChips", "status", "createdAt")
    VALUES (${id}, ${userId}, ${amountChips}, CAST(${DR_PENDING} AS "WithdrawalRequestStatus"), ${now})
  `;
}

export async function markDepositApproved(
  tx: Prisma.TransactionClient,
  id: string,
  resolvedById: string,
): Promise<number> {
  const now = new Date();
  return tx.$executeRaw`
    UPDATE "DepositRequest"
    SET "status" = CAST(${DR_APPROVED} AS "WithdrawalRequestStatus"),
        "resolvedAt" = ${now},
        "resolvedById" = ${resolvedById}
    WHERE "id" = ${id} AND "status"::text = ${DR_PENDING}
  `;
}

export async function markDepositDeclined(db: DepositSqlClient, id: string, resolvedById: string): Promise<number> {
  const now = new Date();
  return db.$executeRaw`
    UPDATE "DepositRequest"
    SET "status" = CAST(${DR_DECLINED} AS "WithdrawalRequestStatus"),
        "resolvedAt" = ${now},
        "resolvedById" = ${resolvedById}
    WHERE "id" = ${id} AND "status"::text = ${DR_PENDING}
  `;
}

export async function insertDepositCreditLedgerRow(
  tx: Prisma.TransactionClient,
  opts: { userId: string; amountChips: number; requestId: string; createdById: string },
): Promise<void> {
  const id = randomUUID();
  const now = new Date();
  const note = `Deposit approved (request ${opts.requestId})`;
  await tx.$executeRaw`
    INSERT INTO "LedgerEntry" ("id", "userId", "amountChips", "type", "note", "createdById", "createdAt")
    VALUES (${id}, ${opts.userId}, ${opts.amountChips}, CAST(${LEDGER_DEPOSIT_CREDIT} AS "LedgerEntryType"), ${note}, ${opts.createdById}, ${now})
  `;
}
