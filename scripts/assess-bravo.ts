/**
 * Bravo (bot) assessment report from completed hands in the DB.
 * Usage: npm run bot:assess-bravo
 *        npm run bot:assess-bravo -- --hours 24
 *        npm run bot:assess-bravo -- --opponent delanoso
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/prisma";
import { deserializeHandState } from "../src/lib/poker/nlhe-engine";
import { loadLearningStore } from "../src/lib/bot/learning-store";
import { textureFromProfiles } from "../src/lib/bot/opponent-adjust";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: { solve: (cards: string[], game?: string) => { name: string; rank: number };
  };
};

const BRAVO_USERNAME = process.env.BOT_ASSESS_USER ?? "bravo";

type HandRow = {
  handId: string;
  table: string;
  at: string;
  hu: boolean;
  players: number;
  pot: number;
  board: string;
  bravo: {
    seat: number;
    delta: number;
    hole: string;
    folded: boolean;
    commit: number;
    made?: string;
  };
  opponents: { label: string; delta: number; folded: boolean; made?: string }[];
  result: string;
  showdown: boolean;
};

function parseArgs() {
  const args = process.argv.slice(2);
  let hours = 48;
  let opponent: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hours" && args[i + 1]) hours = Number(args[++i]);
    if (args[i] === "--opponent" && args[i + 1]) opponent = args[++i]!.toLowerCase();
  }
  return { hours, opponentFilter: opponent };
}

function madeHand(hole: [string, string], board: string[]): string | undefined {
  if (board.length < 3) return undefined;
  try {
    return Hand.solve([...hole, ...board], "standard").name;
  } catch {
    return undefined;
  }
}

function classifyBravoLoss(row: HandRow): string | null {
  if (row.bravo.delta >= 0) return null;
  const b = row.bravo;
  if (!row.showdown) return "fold_equity_lost";
  if (b.made === "One Pair" || b.made === "High Card") return "thin_showdown";
  if (b.made === "Two Pair") return "dominated_two_pair";
  if (b.made && ["Straight", "Flush", "Full House", "Three of a Kind"].includes(b.made)) {
    return "cooler";
  }
  return "other_showdown";
}

function classifyBravoWin(row: HandRow): string | null {
  if (row.bravo.delta <= 0) return null;
  if (!row.showdown) return "fold_equity";
  if (row.bravo.made === "One Pair" || row.bravo.made === "High Card") return "thin_value";
  return "showdown_value";
}

async function main() {
  const { hours, opponentFilter } = parseArgs();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const bravo = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: BRAVO_USERNAME } },
        { displayUsername: { equals: BRAVO_USERNAME } },
      ],
      isBot: true,
    },
    select: { id: true, username: true, displayUsername: true },
  });

  if (!bravo) {
    console.error(`Bot user "${BRAVO_USERNAME}" not found.`);
    process.exit(1);
  }

  const bravoLabel = bravo.displayUsername ?? bravo.username;

  const hands = await prisma.tableHand.findMany({
    where: { complete: true, updatedAt: { gte: since } },
    orderBy: { updatedAt: "asc" },
    include: { table: { select: { id: true, name: true } } },
  });

  const userCache = new Map<string, string>();
  async function label(userId: string) {
    if (userCache.has(userId)) return userCache.get(userId)!;
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayUsername: true, isBot: true },
    });
    const lab = u
      ? `${u.displayUsername ?? u.username}${u.isBot ? " (bot)" : ""}`
      : userId.slice(0, 8);
    userCache.set(userId, lab);
    return lab;
  }

  const stackByTable = new Map<string, Map<string, number>>();
  const rows: HandRow[] = [];

  const raw: {
    h: (typeof hands)[0];
    st: ReturnType<typeof deserializeHandState>;
    bravoP: ReturnType<typeof deserializeHandState>["players"][number];
  }[] = [];

  for (const h of hands) {
    const st = deserializeHandState(h.stateJson);
    const bravoP = st.players.find((p) => p.userId === bravo.id);
    if (!bravoP) continue;
    const oppPlayers = st.players.filter((p) => p.userId !== bravo.id);
    if (opponentFilter) {
      let ok = false;
      for (const p of oppPlayers) {
        const lab = (await label(p.userId)).toLowerCase();
        if (lab.includes(opponentFilter)) ok = true;
      }
      if (!ok) continue;
    }
    raw.push({ h, st, bravoP });
  }

  for (const { h, st, bravoP } of raw) {
    const tableId = h.table.id;
    const stacks = stackByTable.get(tableId) ?? new Map<string, number>();

    const bravoBefore = stacks.get(bravo.id);
    const bravoDelta = bravoBefore !== undefined ? bravoP.stack - bravoBefore : 0;

    const oppPlayers = st.players.filter((p) => p.userId !== bravo.id);
    const opps: HandRow["opponents"] = [];
    for (const p of oppPlayers) {
      const before = stacks.get(p.userId);
      opps.push({
        label: await label(p.userId),
        delta: before !== undefined ? p.stack - before : 0,
        folded: p.folded,
        made: madeHand(p.hole, st.board),
      });
    }

    for (const p of st.players) {
      stacks.set(p.userId, p.stack);
    }
    stackByTable.set(tableId, stacks);

    const alive = st.players.filter((p) => !p.folded);
    const showdown =
      st.board.length >= 3 && alive.length >= 2 && alive.some((x) => x.userId === bravo.id);

    rows.push({
      handId: h.id.slice(-8),
      table: h.table.name,
      at: h.updatedAt.toISOString(),
      hu: alive.length === 2,
      players: st.players.length,
      pot: st.players.reduce((s, p) => s + p.handCommit, 0),
      board: st.board.join(" ") || "—",
      bravo: {
        seat: bravoP.seatIndex,
        delta: bravoDelta,
        hole: `${bravoP.hole[0]} ${bravoP.hole[1]}`,
        folded: bravoP.folded,
        commit: bravoP.handCommit,
        made: madeHand(bravoP.hole, st.board),
      },
      opponents: opps,
      result: st.resultMessage ?? "",
      showdown,
    });
  }

  let net = 0;
  let wins = 0;
  let losses = 0;
  let huHands = 0;
  let huNet = 0;
  let foldWins = 0;
  let showdownWins = 0;
  let showdownLosses = 0;
  const lossCats: Record<string, number> = {};
  const winCats: Record<string, number> = {};
  const bigLosses: HandRow[] = [];
  const bigWins: HandRow[] = [];

  for (const r of rows) {
    net += r.bravo.delta;
    if (r.bravo.delta > 0) wins++;
    if (r.bravo.delta < 0) losses++;
    if (r.hu) {
      huHands++;
      huNet += r.bravo.delta;
    }
    const wc = classifyBravoWin(r);
    const lc = classifyBravoLoss(r);
    if (wc === "fold_equity") foldWins++;
    if (r.bravo.delta > 0 && r.showdown) showdownWins++;
    if (lc === "thin_showdown" || lc === "dominated_two_pair") showdownLosses++;
    if (wc) winCats[wc] = (winCats[wc] ?? 0) + 1;
    if (lc) lossCats[lc] = (lossCats[lc] ?? 0) + 1;
    if (r.bravo.delta <= -60) bigLosses.push(r);
    if (r.bravo.delta >= 60) bigWins.push(r);
  }

  let learningNote = "(no learning file)";
  try {
    const store = await loadLearningStore(bravo.id);
    const profiles = Object.values(store.opponents);
    if (profiles.length > 0) {
      const tex = textureFromProfiles(profiles);
      learningNote = `opponents=${profiles.length} bluffScale=${tex.bluffScale.toFixed(2)} tightness=${tex.tightness.toFixed(2)} callPenalty=${tex.callPenalty.toFixed(2)}`;
    }
  } catch {
    /* optional */
  }

  const cfrHu = await import("node:fs/promises")
    .then((fs) => fs.access(path.join(process.cwd(), "data/cfr/hu-abstract-policy.json")))
    .then(() => "loaded")
    .catch(() => "missing");

  const report = [
    `# Bravo assessment — ${bravoLabel}`,
    ``,
    `Window: last **${hours}h** (since ${since.toISOString()})`,
    opponentFilter ? `Filter: vs **${opponentFilter}**` : `Filter: all opponents`,
    ``,
    `## Summary`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Hands | ${rows.length} |`,
    `| Net chips | ${net >= 0 ? "+" : ""}${net} |`,
    `| Won / lost (hands) | ${wins} / ${losses} |`,
    `| HU hands | ${huHands} (net ${huNet >= 0 ? "+" : ""}${huNet}) |`,
    `| Won without showdown | ${foldWins} |`,
    `| Showdown wins | ${showdownWins} |`,
    `| Thin / dominated SD losses | ${showdownLosses} |`,
    `| HU CFR policy | ${cfrHu} |`,
    `| Learning | ${learningNote} |`,
    ``,
    `## Win types`,
    ...Object.entries(winCats).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## Loss types`,
    ...Object.entries(lossCats).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## Big losses (≥60)`,
    ...bigLosses.slice(-12).map(
      (r) =>
        `- …${r.handId} **${r.bravo.delta}** ${r.board} · ${r.bravo.hole} → ${r.bravo.made ?? "—"} · ${humanize(r.result, bravoLabel)}`,
    ),
    ``,
    `## Big wins (≥60)`,
    ...bigWins.slice(-8).map(
      (r) =>
        `- …${r.handId} **+${r.bravo.delta}** ${r.board} · ${r.bravo.hole} → ${r.bravo.made ?? "—"} · ${humanize(r.result, bravoLabel)}`,
    ),
    ``,
    `## Recommendations`,
    ...buildRecommendations({
      rows: rows.length,
      net,
      foldWins,
      showdownLosses,
      thinShowdownLosses: lossCats.thin_showdown ?? 0,
      huHands,
      cfrHu,
    }),
    ``,
  ].join("\n");

  console.log(report);

  const outDir = path.join(process.cwd(), ".data", "bravo-assessments");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(outDir, `${stamp}.md`);
  await writeFile(outPath, report, "utf8");
  console.log(`\nWrote ${outPath}`);
}

function humanize(msg: string, bravo: string): string {
  return msg.replace(/Seat (\d+)/g, "seat$1").slice(0, 120);
}

function buildRecommendations(ctx: {
  rows: number;
  net: number;
  foldWins: number;
  showdownLosses: number;
  thinShowdownLosses: number;
  huHands: number;
  cfrHu: string;
}): string[] {
  const rec: string[] = [];
  if (ctx.rows < 10) rec.push("- Play more hands before tuning (sample < 10).");
  if (ctx.foldWins < ctx.rows * 0.15 && ctx.rows >= 10) {
    rec.push("- **More preflop/flop aggression** — fold equity is low vs human.");
  }
  if (ctx.thinShowdownLosses >= 3) {
    rec.push("- **CFR call veto / made-hand fold** — still paying off with pair-only (check veto is live).");
  }
  if (ctx.net < -200 && ctx.rows >= 15) rec.push("- Net loser in window — tighten calls or increase steals.");
  if (ctx.huHands > ctx.rows * 0.5 && ctx.cfrHu === "missing") {
    rec.push("- Train HU CFR: `npm run bot:train-cfr:hu` and restart bot-fleet.");
  }
  if (rec.length === 0) rec.push("- No urgent flags; keep logging hands and re-run assess.");
  return rec;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
