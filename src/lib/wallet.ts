import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumPendingWithdrawalHoldSql } from "@/lib/withdrawal-sql";

export async function getChipBalance(userId: string): Promise<number> {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { userId },
    _sum: { amountChips: true },
  });
  return agg._sum.amountChips ?? 0;
}

/** Chips reserved by pending withdrawal requests (still on ledger until approved). */
export async function getPendingWithdrawalHold(userId: string): Promise<number> {
  return sumPendingWithdrawalHoldSql(prisma, userId);
}

/** Bankroll that can be spent at tables (ledger total minus pending withdrawals). */
export async function getAvailableChipBalance(userId: string): Promise<number> {
  const total = await getChipBalance(userId);
  const hold = await getPendingWithdrawalHold(userId);
  return Math.max(0, total - hold);
}

async function pendingWithdrawalSumTx(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  return sumPendingWithdrawalHoldSql(tx, userId);
}

export async function getAvailableChipBalanceTx(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const [ledger, hold] = await Promise.all([
    tx.ledgerEntry.aggregate({ where: { userId }, _sum: { amountChips: true } }),
    pendingWithdrawalSumTx(tx, userId),
  ]);
  const t = ledger._sum.amountChips ?? 0;
  return Math.max(0, t - hold);
}
