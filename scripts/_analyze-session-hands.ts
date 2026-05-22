import "dotenv/config";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/prisma";
import { deserializeHandState } from "../src/lib/poker/nlhe-engine";
import type { NlheHandState } from "../src/lib/poker/types";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: { solve: (cards: string[], game?: string) => { name: string; rank: number } };
};

async function main() {
  const tableId = process.env.BOT_TABLE_ID?.trim();
  const playerFilter = process.env.ANALYZE_PLAYERS?.trim(); // comma-separated usernames
  const tables = await prisma.pokerTable.findMany({
    where: tableId ? { id: tableId } : { kind: "CASH" },
    include: {
      seats: {
        include: {
          user: { select: { id: true, username: true, displayUsername: true, isBot: true } },
        },
      },
    },
  });

  for (const t of tables) {
    const seated = t.seats
      .filter((s) => s.user)
      .map((s) => `${s.user!.displayUsername ?? s.user!.username}${s.user!.isBot ? " (bot)" : ""}`);
    console.log(`\n=== ${t.name} (${t.id}) ===`);
    console.log("Seated:", seated.join(", ") || "(empty)");

    let hands = await prisma.tableHand.findMany({
      where: { tableId: t.id, complete: true },
      orderBy: { updatedAt: "asc" },
      take: 200,
    });

    const filters = playerFilter
      ? playerFilter.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : null;

    const userIds = new Set<string>();
    for (const h of hands) {
      const st = deserializeHandState(h.stateJson);
      for (const p of st.players) userIds.add(p.userId);
    }
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, username: true, displayUsername: true, isBot: true },
    });
    const label = (userId: string) => {
      const u = users.find((x) => x.id === userId);
      return u ? (u.displayUsername ?? u.username) + (u.isBot ? " (bot)" : "") : userId.slice(0, 8);
    };
    const usernameMatch = (userId: string) => {
      if (!filters?.length) return true;
      const u = users.find((x) => x.id === userId);
      const names = [u?.username, u?.displayUsername].filter(Boolean).map((n) => n!.toLowerCase());
      return filters.some((f) => names.some((n) => n.includes(f)));
    };

    if (filters?.length) {
      hands = hands.filter((h) => {
        const st = deserializeHandState(h.stateJson);
        const ids = st.players.map((p) => p.userId);
        const matched = ids.filter((id) => usernameMatch(id));
        return matched.length >= Math.min(2, filters.length);
      });
    }

    console.log(`Completed hands (filtered): ${hands.length}`);

    type Insight = {
      type: string;
      handId: string;
      note: string;
    };
    const insights: Insight[] = [];
    const byUser = new Map<string, { net: number; hands: number; showdowns: number; foldsWin: number }>();

    console.log("\n--- Hand-by-hand (HU / filtered) ---");
    let prevStacks: Map<number, number> | null = null;

    for (const h of hands) {
      const st = deserializeHandState(h.stateJson);
      const before =
        prevStacks ??
        new Map(st.players.map((p) => [p.seatIndex, p.stack + p.handCommit]));
      const deltas = st.players.map((p) => ({
        userId: p.userId,
        seat: p.seatIndex,
        delta: p.stack - (before.get(p.seatIndex) ?? p.stack),
        folded: p.folded,
        hole: p.hole,
        handCommit: p.handCommit,
      }));
      prevStacks = new Map(st.players.map((p) => [p.seatIndex, p.stack]));

      const alive = st.players.filter((p) => !p.folded);
      const wentShowdown = st.board.length >= 3 && alive.length >= 2;
      const humanize = (msg: string) =>
        msg.replace(/Seat (\d+)/g, (_, n) => {
          const seat = Number(n) - 1;
          const p = st.players.find((x) => x.seatIndex === seat);
          return p ? label(p.userId) : `Seat ${n}`;
        });

      for (const d of deltas) {
        const cur = byUser.get(d.userId) ?? { net: 0, hands: 0, showdowns: 0, foldsWin: 0 };
        cur.hands += 1;
        cur.net += d.delta;
        if (wentShowdown && !d.folded) cur.showdowns += 1;
        if (d.delta > 0 && !wentShowdown) cur.foldsWin += 1;
        byUser.set(d.userId, cur);
      }

      const holeLine = st.players
        .filter((p) => !p.folded && st.board.length > 0)
        .map((p) => {
          try {
            const ev = Hand.solve([...p.hole, ...st.board], "standard");
            return `${label(p.userId)}: ${ev.name}`;
          } catch {
            return `${label(p.userId)}: ?`;
          }
        })
        .join(" · ");

      console.log(`\n…${h.id.slice(-8)} | ${humanize(st.resultMessage ?? "—")}`);
      console.log(`   board: ${st.board.join(" ") || "—"} | pot ${st.pot}`);
      if (holeLine) console.log(`   made: ${holeLine}`);
      console.log(
        `   Δ: ${deltas.map((d) => `${label(d.userId)} ${d.delta >= 0 ? "+" : ""}${d.delta}`).join(" · ")}`,
      );

      analyzeHand(st, deltas, label, insights, h.id.slice(-8));
    }

    console.log("\n--- Session totals ---");
    for (const [uid, stats] of byUser) {
      console.log(
        `  ${label(uid)}: ${stats.net >= 0 ? "+" : ""}${stats.net} over ${stats.hands} hands (${stats.showdowns} showdowns, ${stats.foldsWin} won without showdown)`,
      );
    }

    if (insights.length) {
      console.log("\n--- Improvement notes ---");
      for (const i of insights) {
        console.log(`  [${i.type}] …${i.handId}: ${i.note}`);
      }
    }
  }
}

function analyzeHand(
  st: NlheHandState,
  deltas: { userId: string; delta: number; folded: boolean; hole: [string, string]; handCommit: number }[],
  label: (id: string) => string,
  insights: { type: string; handId: string; note: string }[],
  handId: string,
): void {
  const bb = st.bigBlind;
  const board = st.board;
  const alive = st.players.filter((p) => !p.folded);

  for (const p of st.players) {
    const d = deltas.find((x) => x.userId === p.userId);
    if (!d) continue;
    const isBot = label(p.userId).includes("(bot)");

    if (d.delta < -bb * 8 && !p.folded && board.length >= 5) {
      insights.push({
        type: isBot ? "BOT-LEAK" : "HERO-LEAK",
        handId,
        note: `${label(p.userId)} lost ${-d.delta} at river showdown — review whether call-down was justified.`,
      });
    }

    if (p.folded && d.handCommit >= bb * 4 && board.length === 0) {
      insights.push({
        type: isBot ? "BOT" : "HERO",
        handId,
        note: `${label(p.userId)} put in ${d.handCommit} preflop then folded — expensive preflop fold.`,
      });
    }
  }

  if (alive.length >= 2 && board.length >= 3) {
    const ranked = alive.map((p) => {
      const ev = Hand.solve([...p.hole, ...board], "standard");
      return { userId: p.userId, rank: ev.rank, name: ev.name };
    });
    ranked.sort((a, b) => b.rank - a.rank);
    const winner = ranked[0]!;
    const loser = ranked[ranked.length - 1]!;
    if (winner.rank === loser.rank) {
      insights.push({
        type: "SPLIT",
        handId,
        note: `Split pot (${winner.name}) — both ${label(winner.userId)} and ${label(loser.userId)} had same category.`,
      });
    } else {
      const wDelta = deltas.find((d) => d.userId === winner.userId)?.delta ?? 0;
      const lDelta = deltas.find((d) => d.userId === loser.userId)?.delta ?? 0;
      if (lDelta < 0 && loser.rank >= 3) {
        insights.push({
          type: label(loser.userId).includes("(bot)") ? "BOT" : "HERO",
          handId,
          note: `${label(loser.userId)} lost with ${ranked.find((r) => r.userId === loser.userId)?.name} vs winner ${winner.name} — marginal call-down or missed fold on earlier street.`,
        });
      }
      if (wDelta > 0 && winner.rank <= 2 && board.length === 5) {
        insights.push({
          type: label(winner.userId).includes("(bot)") ? "BOT" : "HERO",
          handId,
          note: `${label(winner.userId)} won with only ${winner.name} at showdown — thin value or opponent over-called.`,
        });
      }
    }
  }

  if (alive.length === 1 && st.board.length === 0) {
    const w = alive[0]!;
    const pot = st.players.reduce((s, p) => s + p.handCommit, 0);
    if (pot >= bb * 6) {
      insights.push({
        type: "FOLD-EQUITY",
        handId,
        note: `${label(w.userId)} won ${pot} chips without showdown — aggression / folds worked.`,
      });
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
