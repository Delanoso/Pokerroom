import type { LedgerEntryType, PrismaClient } from "@prisma/client";
import { ledgerTypeMeta, type LedgerHistoryCategory } from "@/lib/ledger-labels";
import { getChipBalance } from "@/lib/wallet";

export type LedgerHistoryRow = {
  id: string;
  createdAt: Date;
  amountChips: number;
  type: LedgerEntryType;
  typeLabel: string;
  category: LedgerHistoryCategory;
  note: string | null;
  createdByUsername: string | null;
  balanceAfter: number;
};

export type UserLedgerHistory = {
  user: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    isBot: boolean;
    role: string;
  };
  currentBalance: number;
  entries: LedgerHistoryRow[];
};

export async function getUserLedgerHistory(
  prisma: PrismaClient,
  userId: string,
  options?: { limit?: number },
): Promise<UserLedgerHistory | null> {
  const limit = Math.min(500, Math.max(1, options?.limit ?? 200));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      email: true,
      isBot: true,
      role: true,
    },
  });
  if (!user) return null;

  const [currentBalance, rows] = await Promise.all([
    getChipBalance(userId),
    prisma.ledgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        amountChips: true,
        type: true,
        note: true,
        createdBy: { select: { username: true } },
      },
    }),
  ]);

  let balanceAfter = currentBalance;
  const entries: LedgerHistoryRow[] = rows.map((row) => {
    const meta = ledgerTypeMeta(row.type);
    const out: LedgerHistoryRow = {
      id: row.id,
      createdAt: row.createdAt,
      amountChips: row.amountChips,
      type: row.type,
      typeLabel: meta.label,
      category: meta.category,
      note: row.note,
      createdByUsername: row.createdBy?.username ?? null,
      balanceAfter,
    };
    balanceAfter -= row.amountChips;
    return out;
  });

  return { user, currentBalance, entries };
}
