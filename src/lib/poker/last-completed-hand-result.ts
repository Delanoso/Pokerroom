import type { PrismaClient } from "@prisma/client";
import { deserializeHandState } from "./nlhe-engine";

export type LastCompletedHandResult = {
  handId: string;
  resultMessage: string;
};

/** Most recent completed hand on the table (for table log when clients skip COMPLETE). */
export async function fetchLastCompletedHandResult(
  prisma: PrismaClient,
  tableId: string,
): Promise<LastCompletedHandResult | null> {
  const row = await prisma.tableHand.findFirst({
    where: { tableId, complete: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, stateJson: true },
  });
  if (!row) return null;
  const state = deserializeHandState(row.stateJson);
  if (!state.resultMessage?.trim()) return null;
  return { handId: row.id, resultMessage: state.resultMessage };
}
