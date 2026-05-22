import type { PrismaClient } from "@prisma/client";
import { loadCfrPolicy, loadPushFoldPolicy } from "@/lib/bot/cfr/policy-io";
import { decideBotAction } from "@/lib/bot/decide-action";
import { applyBotTableAction, syncTableHandForBot } from "@/lib/bot/bot-table-engine";
import {
  buildSeatUserMap,
  HandObserver,
  tableOpponentProfiles,
} from "@/lib/bot/hand-observer";
import { loadLearningStore, saveLearningStore } from "@/lib/bot/learning-store";
import { textureFromProfiles } from "@/lib/bot/opponent-adjust";
import { adminLeaveBotFromTables } from "@/lib/admin-bot-seat";
import { notifyTableChanged } from "@/lib/notify-table";
import { tryAutoStartHand } from "@/lib/poker/try-auto-start-hand";
import { syncSitAndGoAfterHand } from "@/lib/poker/sit-and-go-sync";
import {
  clearPlayerFromFlight,
  loadFlightContext,
  syncTournamentFlightAfterHand,
} from "@/lib/tournament-flight";
import { fetchPokerTableTournamentMetaOne } from "@/lib/poker-table-tournament-meta";
import { prisma } from "@/lib/prisma";
import { tickTournamentsReadyToStart } from "@/lib/tournament-auto-seat";

export type BotFleetAssignment = {
  userId: string;
  username: string;
  tableId: string;
  tableName: string;
  seatIndex: number;
  stackChips: number;
};

const DEAL_PAUSE_MS = 2800;
/** Act quickly so the 32s table clock is not beaten by bot "thinking". */
const THINK_MIN_MS = 600;
const THINK_MAX_MS = 2400;
const STREET_PAUSE_MIN_MS = 650;
const STREET_PAUSE_MAX_MS = 1800;
const DEFAULT_POLL_MS = 1200;
const ASSIGNMENT_POLL_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomIntInclusive(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function workerKey(userId: string, tableId: string) {
  return `${userId}:${tableId}`;
}

export async function listBotFleetAssignments(db: PrismaClient): Promise<BotFleetAssignment[]> {
  const seats = await db.tableSeat.findMany({
    where: {
      userId: { not: null },
      table: { closedAt: null },
      user: { isBot: true, blockedAt: null },
    },
    select: {
      seatIndex: true,
      stackChips: true,
      userId: true,
      user: { select: { id: true, username: true } },
      table: { select: { id: true, name: true } },
    },
  });

  return seats
    .filter((s) => s.userId && s.user)
    .map((s) => ({
      userId: s.userId!,
      username: s.user!.username,
      tableId: s.table.id,
      tableName: s.table.name,
      seatIndex: s.seatIndex,
      stackChips: s.stackChips,
    }));
}

type WorkerHandle = {
  abort: AbortController;
  promise: Promise<void>;
};

export class BotFleet {
  private readonly workers = new Map<string, WorkerHandle>();
  private readonly tableTickers = new Map<string, WorkerHandle>();
  private readonly pollMs: number;
  private stopped = false;

  constructor(
    private readonly db: PrismaClient = prisma,
    pollMs = Number(process.env.BOT_FLEET_POLL_MS ?? DEFAULT_POLL_MS),
  ) {
    this.pollMs = Number.isFinite(pollMs) && pollMs > 200 ? pollMs : DEFAULT_POLL_MS;
  }

  async start(): Promise<void> {
    console.log(`[bot-fleet] watching seated bots (poll ${this.pollMs}ms)`);
    void this.runTournamentScheduler();
    for (;;) {
      if (this.stopped) return;
      try {
        await this.syncWorkers();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[bot-fleet] assignment sync failed: ${msg}`);
      }
      await sleep(ASSIGNMENT_POLL_MS);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const w of this.workers.values()) {
      w.abort.abort();
    }
    for (const w of this.tableTickers.values()) {
      w.abort.abort();
    }
    this.workers.clear();
    this.tableTickers.clear();
  }

  private async runTournamentScheduler(): Promise<void> {
    while (!this.stopped) {
      try {
        await tickTournamentsReadyToStart(this.db);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[bot-fleet] tournament tick failed: ${msg}`);
      }
      await sleep(5000);
    }
  }

  private async syncWorkers(): Promise<void> {
    const assignments = await listBotFleetAssignments(this.db);
    const want = new Set(assignments.map((a) => workerKey(a.userId, a.tableId)));
    const wantTables = new Set(assignments.map((a) => a.tableId));

    for (const [key, handle] of this.workers) {
      if (!want.has(key)) {
        handle.abort.abort();
        this.workers.delete(key);
      }
    }

    for (const [tableId, handle] of this.tableTickers) {
      if (!wantTables.has(tableId)) {
        handle.abort.abort();
        this.tableTickers.delete(tableId);
      }
    }

    for (const tableId of wantTables) {
      if (this.tableTickers.has(tableId)) continue;
      const sample = assignments.find((a) => a.tableId === tableId);
      if (!sample) continue;
      const abort = new AbortController();
      const promise = this.runTableTicker(tableId, sample.userId, abort.signal).catch((e) => {
        if (abort.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[bot-fleet] table ticker ${tableId} stopped: ${msg}`);
      });
      this.tableTickers.set(tableId, { abort, promise });
    }

    for (const a of assignments) {
      const key = workerKey(a.userId, a.tableId);
      if (this.workers.has(key)) continue;
      const abort = new AbortController();
      const promise = this.runWorker(a, abort.signal).catch((e) => {
        if (abort.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[bot-fleet] worker ${a.username}@${a.tableName} stopped: ${msg}`);
      });
      this.workers.set(key, { abort, promise });
      console.log(`[bot-fleet] started @${a.username} at ${a.tableName} (seat ${a.seatIndex + 1})`);
    }
  }

  /** Keeps clocks/timeouts advancing even when every bot worker is in a long "think" sleep. */
  private async runTableTicker(tableId: string, botUserId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await syncTableHandForBot(this.db, tableId, botUserId);
      } catch (e) {
        if (signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[bot-fleet] table sync ${tableId}: ${msg}`);
      }
      await sleep(900);
    }
  }

  private async runWorker(assignment: BotFleetAssignment, signal: AbortSignal): Promise<void> {
    const { userId, tableId, username, tableName } = assignment;
    const learningStore = await loadLearningStore(userId);
    const huCfrPolicy = await loadCfrPolicy();
    const pushFoldPolicy = await loadPushFoldPolicy();
    const handObserver = new HandObserver();
    let learningDirty = false;
    let saveLearningEvery = 0;
    let dealPausedHandId: string | null = null;
    let lastStreet: string | null = null;
    let lastStreetHandId: string | null = null;

    while (!signal.aborted) {
      if (signal.aborted) return;
      try {
        const seat = await this.db.tableSeat.findFirst({
          where: { tableId, userId },
          select: {
            seatIndex: true,
            stackChips: true,
            sittingOut: true,
            sitOutNextHand: true,
            user: { select: { isBot: true, blockedAt: true } },
            table: { select: { closedAt: true } },
          },
        });
        if (!seat?.user?.isBot || seat.user.blockedAt || seat.table.closedAt) {
          return;
        }

        if (seat.sittingOut || seat.sitOutNextHand) {
          await this.db.tableSeat.update({
            where: { tableId, userId },
            data: {
              sittingOut: false,
              sitOutSince: null,
              sitOutNextHand: false,
              consecutiveIdleHands: 0,
            },
          });
          await tryAutoStartHand(this.db, tableId);
          void notifyTableChanged(tableId);
        }

        const { handId, hand, tableKind } = await syncTableHandForBot(this.db, tableId, userId);
        const betweenHands = !hand || !handId;

        if (betweenHands && seat.stackChips <= 0) {
          console.log(`[bot-fleet] @${username} busted at ${tableName} — leaving seat`);
          const meta = await fetchPokerTableTournamentMetaOne(tableId);
          if (meta.kind === "TOURNAMENT") {
            const ctx = await loadFlightContext(this.db, tableId);
            if (ctx) {
              await clearPlayerFromFlight(this.db, ctx, userId, true);
              await syncTournamentFlightAfterHand(this.db, tableId);
            }
          } else if (meta.kind === "SIT_AND_GO") {
            await syncSitAndGoAfterHand(this.db, tableId);
          } else {
            await adminLeaveBotFromTables(this.db, userId, tableId);
          }
          return;
        }

        if (betweenHands) {
          dealPausedHandId = null;
          lastStreet = null;
          lastStreetHandId = null;
          handObserver.reset();
          if (learningDirty) {
            await saveLearningStore(learningStore);
            learningDirty = false;
          }
          await sleep(this.pollMs);
          continue;
        }

        const seatRows = await this.db.tableSeat.findMany({
          where: { tableId },
          select: { seatIndex: true, user: { select: { id: true } } },
        });
        const seatUsers = buildSeatUserMap(
          seatRows.map((s) => ({
            seatIndex: s.seatIndex,
            user: s.user ? { id: s.user.id } : null,
          })),
        );

        if (hand && handId && hand.viewerSeat !== null) {
          handObserver.observe(handId, hand, hand.viewerSeat, seatUsers, learningStore);
          learningDirty = true;
          saveLearningEvery += 1;
          if (saveLearningEvery >= 25) {
            await saveLearningStore(learningStore);
            saveLearningEvery = 0;
          }
        }

        if (hand.viewerSeat !== null) {
          if (dealPausedHandId !== handId) {
            await sleep(DEAL_PAUSE_MS);
            dealPausedHandId = handId;
            lastStreet = hand.street;
            lastStreetHandId = handId;
          } else if (
            lastStreetHandId === handId &&
            lastStreet !== null &&
            hand.street !== lastStreet &&
            hand.street !== "COMPLETE" &&
            hand.street !== "SHOWDOWN"
          ) {
            await sleep(randomIntInclusive(STREET_PAUSE_MIN_MS, STREET_PAUSE_MAX_MS));
            lastStreet = hand.street;
          } else {
            lastStreet = hand.street;
            lastStreetHandId = handId;
          }
        }

        const opponentTexture = textureFromProfiles(
          tableOpponentProfiles(learningStore, seatUsers, userId),
        );
        const action = decideBotAction(hand, {
          tableKind,
          huCfrPolicy,
          pushFoldPolicy,
          opponentTexture,
        });
        if (!action) {
          await sleep(this.pollMs);
          continue;
        }

        let thinkMs = randomIntInclusive(THINK_MIN_MS, THINK_MAX_MS);
        if (hand.turnDeadlineIso) {
          const msLeft = new Date(hand.turnDeadlineIso).getTime() - Date.now() - 2000;
          thinkMs = Math.min(thinkMs, Math.max(200, msLeft));
        }
        if (thinkMs > 0) await sleep(thinkMs);

        let result = await applyBotTableAction(this.db, tableId, userId, action);
        if (!result.ok && action.type === "CHECK" && hand.legal.includes("CALL")) {
          result = await applyBotTableAction(this.db, tableId, userId, { type: "CALL" });
        }
        if (!result.ok) {
          console.warn(`[bot-fleet] @${username} action ${action.type}: ${result.error}`);
        } else {
          console.log(`[bot-fleet] @${username} ${action.type} @ ${tableName}`);
        }

        await sleep(Math.max(1100, this.pollMs));
      } catch (e) {
        if (signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[bot-fleet] @${username} recoverable: ${msg}`);
        await sleep(Math.max(this.pollMs, 5000));
      }
    }
  }
}
