import type { LedgerEntryType } from "@prisma/client";

export type LedgerHistoryCategory =
  | "adjustment"
  | "deposit"
  | "withdrawal"
  | "table"
  | "tournament"
  | "host";

export type LedgerTypeMeta = {
  label: string;
  category: LedgerHistoryCategory;
};

const META: Record<LedgerEntryType, LedgerTypeMeta> = {
  ADMIN_ADJUSTMENT: { label: "Operator adjustment", category: "adjustment" },
  DEPOSIT_CREDIT: { label: "Deposit approved", category: "deposit" },
  WITHDRAWAL_PAYOUT: { label: "Withdrawal paid", category: "withdrawal" },
  TABLE_BUY_IN: { label: "Table buy-in", category: "table" },
  TABLE_CASH_OUT: { label: "Table cash-out", category: "table" },
  TABLE_STACK_RELOAD: { label: "Stack reload", category: "table" },
  TOURNAMENT_ENTRY_FEE_PAID: { label: "Tournament entry fee", category: "tournament" },
  TOURNAMENT_PRIZE_PAID: { label: "Tournament prize won", category: "tournament" },
  TOURNAMENT_PRIZE_EXPENSE: { label: "Tournament prize paid (host)", category: "host" },
  TOURNAMENT_FEE_RECEIVED: { label: "Tournament entry fee received", category: "host" },
  HOUSE_RAKE_CASH_POT: { label: "Cash rake received", category: "host" },
  DEALER_TIP_RECEIVED: { label: "Dealer tip received", category: "host" },
};

export function ledgerTypeMeta(type: LedgerEntryType | string): LedgerTypeMeta {
  const m = META[type as LedgerEntryType];
  if (m) return m;
  return { label: String(type).replace(/_/g, " ").toLowerCase(), category: "adjustment" };
}

export const LEDGER_CATEGORY_LABELS: Record<LedgerHistoryCategory, string> = {
  adjustment: "Operator",
  deposit: "Deposits",
  withdrawal: "Withdrawals",
  table: "Cash / Sit & Go",
  tournament: "Tournament",
  host: "Host income",
};
