import type { Prisma } from "@prisma/client";
import {
  creditHouseRakeCashPotSql,
  LEDGER_DEALER_TIP_RECEIVED,
  LEDGER_HOUSE_RAKE_CASH_POT,
  LEDGER_TOURNAMENT_ENTRY_FEE_PAID,
  LEDGER_TOURNAMENT_FEE_RECEIVED,
  recordTournamentEntryFeeSql,
  refundTournamentEntryFeeSql,
  HOUSE_REVENUE_LEDGER_TYPES,
} from "./house-fees-sql";

export {
  LEDGER_DEALER_TIP_RECEIVED,
  LEDGER_HOUSE_RAKE_CASH_POT,
  LEDGER_TOURNAMENT_ENTRY_FEE_PAID,
  LEDGER_TOURNAMENT_FEE_RECEIVED,
  HOUSE_REVENUE_LEDGER_TYPES,
};

type FeeTx = Prisma.TransactionClient;

export async function creditHouseRakeCashPot(
  tx: FeeTx,
  hostUserId: string,
  amountChips: number,
  tableId: string,
  handId: string,
): Promise<void> {
  await creditHouseRakeCashPotSql(tx, hostUserId, amountChips, tableId, handId);
}

export async function recordTournamentEntryFee(
  tx: FeeTx,
  playerUserId: string,
  hostUserId: string,
  amountChips: number,
  tableName: string,
): Promise<void> {
  await recordTournamentEntryFeeSql(tx, playerUserId, hostUserId, amountChips, tableName);
}

export async function refundTournamentEntryFee(
  tx: FeeTx,
  playerUserId: string,
  hostUserId: string,
  amountChips: number,
  tableName: string,
): Promise<void> {
  await refundTournamentEntryFeeSql(tx, playerUserId, hostUserId, amountChips, tableName);
}
