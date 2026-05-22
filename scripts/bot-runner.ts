import "dotenv/config";

import { loadCfrPolicy, loadPushFoldPolicy } from "@/lib/bot/cfr/policy-io";
import { decideBotAction } from "@/lib/bot/decide-action";
import { collectSetCookiesFromResponse, cookieHeaderValue, mergeSetCookieHeaders } from "@/lib/bot/cookie-jar";
import {
  buildSeatUserMap,
  HandObserver,
  tableOpponentProfiles,
} from "@/lib/bot/hand-observer";
import { loadLearningStore, saveLearningStore } from "@/lib/bot/learning-store";
import { signInWithCredentials } from "@/lib/bot/nextauth-sign-in";
import { textureFromProfiles } from "@/lib/bot/opponent-adjust";
import type { PublicHandState } from "@/lib/poker/public-state";

type TablePayload = {
  id: string;
  name: string;
  kind: "CASH" | "TOURNAMENT";
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  seats: { seatIndex: number; stackChips: number; user: { id: string } | null }[];
};

type TableGetJson = {
  table: TablePayload;
  viewerBalance: number;
  mySeatIndex: number | null;
  tournament: {
    viewerRegistered: boolean;
    registrationWindowOpen: boolean;
    sittingWindowOpen: boolean;
  } | null;
};

type HandGetJson = {
  handId: string | null;
  hand: PublicHandState | null;
};

/** Human-like pacing (only affects the bot client, not other players). */
const DEAL_PAUSE_MS = 2800;
const THINK_MIN_MS = 4000;
const THINK_MAX_MS = 11_000;
const STREET_PAUSE_MIN_MS = 650;
const STREET_PAUSE_MAX_MS = 1800;

function randomIntInclusive(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomThinkMs(): number {
  return randomIntInclusive(THINK_MIN_MS, THINK_MAX_MS);
}

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

async function fetchJson(
  origin: string,
  path: string,
  jar: Map<string, string>,
  init?: RequestInit,
): Promise<Response> {
  const cookie = cookieHeaderValue(jar);
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      ...(cookie ? { cookie } : {}),
    },
  });
}

async function ensureTournamentRegistered(origin: string, tableId: string, jar: Map<string, string>, t: TableGetJson) {
  const tour = t.tournament;
  if (!tour || t.table.kind !== "TOURNAMENT") return;
  if (tour.viewerRegistered || !tour.registrationWindowOpen) return;
  const res = await fetchJson(origin, `/api/tables/${tableId}/tournament/register`, jar, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[bot] tournament register failed ${res.status}: ${text}`);
  }
}

async function trySit(
  origin: string,
  tableId: string,
  jar: Map<string, string>,
  table: TablePayload,
  viewerBalance: number,
): Promise<boolean> {
  const emptySeats = table.seats.filter((s) => s.user == null);
  const empty = emptySeats[0];
  if (!empty) {
    console.warn(`[bot] no empty seat (${table.name}) — all ${table.seats.length} seats taken`);
    return false;
  }
  console.log(
    `[bot] trying sit ${table.name} seat ${empty.seatIndex} (${emptySeats.length} empty) bankroll ${viewerBalance} BI ${table.minBuyIn}-${table.maxBuyIn}`,
  );
  const buyInEnv = optionalEnv("BOT_BUY_IN_CHIPS");
  let buyIn = buyInEnv ? Number(buyInEnv) : table.minBuyIn;
  if (!Number.isFinite(buyIn)) buyIn = table.minBuyIn;
  buyIn = Math.min(Math.max(buyIn, table.minBuyIn), table.maxBuyIn, viewerBalance);
  if (buyIn < table.minBuyIn) {
    console.warn(`[bot] bankroll ${viewerBalance} below table minBuyIn ${table.minBuyIn}`);
    return false;
  }
  const res = await fetchJson(origin, `/api/tables/${tableId}/sit`, jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seatIndex: empty.seatIndex, buyInChips: buyIn }),
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const j = JSON.parse(detail) as { error?: string };
      if (j.error) detail = j.error;
    } catch {
      /* keep raw */
    }
    console.warn(`[bot] sit failed ${res.status}: ${detail}`);
    return false;
  }
  console.log(`[bot] sat seat ${empty.seatIndex} buyIn ${buyIn}`);
  return true;
}

/** Leave the table (stack cash-out handled by API). Call only between hands. */
async function tryLeave(origin: string, tableId: string, jar: Map<string, string>): Promise<boolean> {
  const res = await fetchJson(origin, `/api/tables/${tableId}/leave`, jar, { method: "POST" });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const j = JSON.parse(detail) as { error?: string };
      if (j.error) detail = j.error;
    } catch {
      /* keep raw */
    }
    console.warn(`[bot] leave failed ${res.status}: ${detail}`);
    return false;
  }
  console.log("[bot] left table (will rejoin when bankroll allows)");
  return true;
}

async function main() {
  const origin = env("BOT_APP_ORIGIN").replace(/\/$/, "");
  const tableId = env("BOT_TABLE_ID");
  const login = env("BOT_LOGIN");
  const password = env("BOT_PASSWORD");
  const pollMs = Number(optionalEnv("BOT_POLL_MS") ?? "1200");

  console.log("[bot] signing in…");
  const { jar } = await signInWithCredentials(origin, login, password);

  const sessRes = await fetchJson(origin, "/api/auth/session", jar);
  const sess = (await sessRes.json().catch(() => ({}))) as { user?: { id?: string } };
  const botUserId = sess.user?.id ?? optionalEnv("BOT_USER_ID");
  if (!botUserId) {
    throw new Error("Could not resolve bot user id (session or BOT_USER_ID)");
  }

  const learningStore = await loadLearningStore(botUserId);
  const huCfrPolicy = await loadCfrPolicy();
  const pushFoldPolicy = await loadPushFoldPolicy();
  if (huCfrPolicy) {
    console.log(
      `[bot] HU MCCFR policy loaded (${huCfrPolicy.iterations} iters, ${Object.keys(huCfrPolicy.nodes).length} info sets)`,
    );
  } else {
    console.log("[bot] no HU CFR policy — run: npm run bot:train-cfr:hu");
  }
  if (pushFoldPolicy) {
    console.log(`[bot] push/fold fallback loaded (${pushFoldPolicy.iterations} iters)`);
  }

  const handObserver = new HandObserver();
  let learningDirty = false;
  let saveLearningEvery = 0;

  let dealPausedHandId: string | null = null;
  let lastStreet: string | null = null;
  let lastStreetHandId: string | null = null;

  for (;;) {
    try {
    const tableRes = await fetchJson(origin, `/api/tables/${tableId}`, jar);
    if (!tableRes.ok) {
      console.warn(`[bot] GET table ${tableRes.status}`);
      await sleep(pollMs);
      continue;
    }
    mergeSetCookieHeaders(jar, collectSetCookiesFromResponse(tableRes));
    const tableJson = (await tableRes.json()) as TableGetJson;
    const seatUsers = buildSeatUserMap(tableJson.table.seats);

    if (tableJson.mySeatIndex !== null) {
      const mySeatIndex = tableJson.mySeatIndex;
      const mySeatRow = tableJson.table.seats.find((s) => s.seatIndex === mySeatIndex);

      const handRes = await fetchJson(origin, `/api/tables/${tableId}/hand`, jar);
      if (!handRes.ok) {
        await sleep(pollMs);
        continue;
      }
      mergeSetCookieHeaders(jar, collectSetCookiesFromResponse(handRes));
      const { handId, hand } = (await handRes.json()) as HandGetJson;
      const betweenHands = !hand || !handId;

      /**
       * Busted to 0 at the seat: leave between hands so the next loop can sit again
       * (e.g. after a bankroll top-up). Temporary playtest behaviour.
       */
      if (betweenHands && mySeatRow && mySeatRow.stackChips <= 0) {
        console.log("[bot] zero stack between hands — leaving table to rejoin on next cycle");
        await tryLeave(origin, tableId, jar);
        dealPausedHandId = null;
        lastStreet = null;
        lastStreetHandId = null;
        await sleep(pollMs);
        continue;
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
        await sleep(pollMs);
        continue;
      }

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
        tableOpponentProfiles(learningStore, seatUsers, botUserId),
      );
      const action = decideBotAction(hand, {
        tableKind: tableJson.table.kind,
        huCfrPolicy,
        pushFoldPolicy,
        opponentTexture,
      });
      if (!action) {
        await sleep(pollMs);
        continue;
      }

      await sleep(randomThinkMs());

      const actRes = await fetchJson(origin, `/api/tables/${tableId}/hand/action`, jar, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      mergeSetCookieHeaders(jar, collectSetCookiesFromResponse(actRes));
      if (!actRes.ok) {
        const text = await actRes.text();
        console.warn(`[bot] action ${JSON.stringify(action)} → ${actRes.status} ${text}`);
      } else {
        console.log(`[bot] acted ${action.type}`);
      }

      await sleep(Math.max(1100, pollMs));
      continue;
    }

    await ensureTournamentRegistered(origin, tableId, jar, tableJson);

    const tour = tableJson.tournament;
    if (tableJson.table.kind === "TOURNAMENT" && tour && !tour.sittingWindowOpen) {
      await sleep(pollMs);
      continue;
    }
    /** Always POST /sit when not seated. Do not skip while a hand runs — we would never join mid-session. */
    await trySit(origin, tableId, jar, tableJson.table, tableJson.viewerBalance);
    await sleep(pollMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[bot] recoverable error, retrying: ${msg}`);
      await sleep(Math.max(pollMs, 5000));
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
