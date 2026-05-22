import type { PrismaClient } from "@prisma/client";
import { notifyTableChanged } from "@/lib/notify-table";
import {
  applyNlheAction,
  deserializeHandState,
  serializeHandState,
  type ActionPayload,
} from "@/lib/poker/nlhe-engine";
import { finalizeCompletedHand, findActiveTableHand } from "@/lib/poker/hand-persist";
import { toPublicHandState, type PublicHandState } from "@/lib/poker/public-state";
import { syncTableHandServer, type SyncTableHandResult } from "@/lib/poker/sync-table-hand";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";

export type BotTableHandSnapshot = SyncTableHandResult;

/**
 * Advances server-side clocks (timeouts, showdown reveal) and auto-starts hands.
 * Delegates to the shared table sync used by the table worker.
 */
export async function syncTableHandForBot(
  prisma: PrismaClient,
  tableId: string,
  botUserId: string,
): Promise<BotTableHandSnapshot> {
  return syncTableHandServer(prisma, tableId, { viewerUserId: botUserId });
}

export async function applyBotTableAction(
  prisma: PrismaClient,
  tableId: string,
  botUserId: string,
  action: ActionPayload,
): Promise<
  | { ok: true; handId: string | null; hand: PublicHandState | null; tableKind: "CASH" | "TOURNAMENT" | "SIT_AND_GO" }
  | { ok: false; error: string }
> {
  const table = await prisma.pokerTable.findUnique({ where: { id: tableId } });
  if (!table) return { ok: false, error: "Table not found" };
  if (table.closedAt) return { ok: false, error: "Table closed" };

  const tableKind = (await fetchPokerTableTournamentMetaOne(tableId)).kind;

  const row = await findActiveTableHand(prisma, tableId);
  if (!row) return { ok: false, error: "No active hand" };

  const state = deserializeHandState(row.stateJson);
  const mySeat = state.players.find((p) => p.userId === botUserId);
  if (!mySeat) return { ok: false, error: "Bot is not in this hand" };

  const out = applyNlheAction(state, mySeat.seatIndex, botUserId, action, { source: "manual" });
  if (out.error) return { ok: false, error: out.error };

  if (out.state.street === "COMPLETE") {
    const hand = toPublicHandState(out.state, botUserId);
    await finalizeCompletedHand(
      prisma,
      tableId,
      row.id,
      out.state,
      table.dealerButtonSeat ?? 0,
      tableKind,
    );
    void notifyTableChanged(tableId);
    return { ok: true, handId: row.id, hand, tableKind };
  }

  await prisma.tableHand.update({
    where: { id: row.id },
    data: { stateJson: serializeHandState(out.state) },
  });
  void notifyTableChanged(tableId);
  return {
    ok: true,
    handId: row.id,
    hand: toPublicHandState(out.state, botUserId),
    tableKind,
  };
}
