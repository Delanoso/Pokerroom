import "dotenv/config";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/prisma";
import { deserializeHandState } from "../src/lib/poker/nlhe-engine";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: { solve: (cards: string[], game?: string) => { name: string; rank: number } };
};

const DELANOSO = "cmp3u0vbv0000velst0hlkam1";
const BRAVO = "cmp6rttwf000pve08b7vq7468";

async function main() {
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const hands = await prisma.tableHand.findMany({
    where: { complete: true, updatedAt: { gte: since } },
    orderBy: { updatedAt: "asc" },
    include: { table: { select: { name: true } } },
  });

  type HandRec = {
    id: string;
    table: string;
    result: string;
    board: string;
    delanoso: { delta: number; hole: string; folded: boolean; made?: string };
    bravo: { delta: number; hole: string; folded: boolean; made?: string };
    pot: number;
    showdown: boolean;
  };

  const recs: HandRec[] = [];
  const stacks = new Map<string, number>([
    [DELANOSO, 0],
    [BRAVO, 0],
  ]);
  let prevD = 1000;
  let prevB = 2000;

  for (const h of hands) {
    const st = deserializeHandState(h.stateJson);
    const ids = new Set(st.players.map((p) => p.userId));
    if (!ids.has(DELANOSO) || !ids.has(BRAVO)) continue;

    const d = st.players.find((p) => p.userId === DELANOSO)!;
    const b = st.players.find((p) => p.userId === BRAVO)!;
    const dBefore = prevD;
    const bBefore = prevB;
    const dDelta = d.stack - dBefore;
    const bDelta = b.stack - bBefore;
    prevD = d.stack;
    prevB = b.stack;

    const board = st.board;
    const showdown = board.length >= 3 && !d.folded && !b.folded;
    const made = (hole: [string, string]) => {
      if (board.length < 3 || hole[0] === "") return undefined;
      try {
        return Hand.solve([...hole, ...board], "standard").name;
      } catch {
        return undefined;
      }
    };

    recs.push({
      id: h.id.slice(-8),
      table: h.table.name,
      result: st.resultMessage ?? "",
      board: board.join(" ") || "—",
      delanoso: {
        delta: dDelta,
        hole: `${d.hole[0]} ${d.hole[1]}`,
        folded: d.folded,
        made: made(d.hole),
      },
      bravo: {
        delta: bDelta,
        hole: `${b.hole[0]} ${b.hole[1]}`,
        folded: b.folded,
        made: made(b.hole),
      },
      pot: st.players.reduce((s, p) => s + p.handCommit, 0),
      showdown,
    });
  }

  let dNet = 0;
  let bNet = 0;
  let dShowdownWins = 0;
  let bShowdownWins = 0;
  let dFoldWins = 0;
  let bFoldWins = 0;
  let dBigLosses: HandRec[] = [];
  let bBigLosses: HandRec[] = [];

  for (const r of recs) {
    dNet += r.delanoso.delta;
    bNet += r.bravo.delta;
    if (r.delanoso.delta > 0 && r.showdown) dShowdownWins++;
    if (r.bravo.delta > 0 && r.showdown) bShowdownWins++;
    if (r.delanoso.delta > 0 && !r.showdown) dFoldWins++;
    if (r.bravo.delta > 0 && !r.showdown) bFoldWins++;
    if (r.delanoso.delta <= -80) dBigLosses.push(r);
    if (r.bravo.delta <= -80) bBigLosses.push(r);
  }

  console.log(`Session: ${recs.length} HU hands (delanoso vs Bravo) since ${since.toISOString()}\n`);
  console.log(`delanoso net: ${dNet >= 0 ? "+" : ""}${dNet}`);
  console.log(`Bravo net:   ${bNet >= 0 ? "+" : ""}${bNet}`);
  console.log(`\ndelanoso: ${dShowdownWins} showdown wins, ${dFoldWins} won without showdown`);
  console.log(`Bravo:    ${bShowdownWins} showdown wins, ${bFoldWins} won without showdown`);

  console.log("\n=== Big losses — delanoso (≥80 chips) ===");
  for (const r of dBigLosses) {
    console.log(`…${r.id} ${r.delanoso.delta} | ${r.board}`);
    console.log(`  you: ${r.delanoso.hole} → ${r.delanoso.made ?? "folded"} | Bravo: ${r.bravo.hole} → ${r.bravo.made ?? "folded"}`);
    console.log(`  ${humanize(r.result)}`);
  }

  console.log("\n=== Big losses — Bravo (≥80 chips) ===");
  for (const r of bBigLosses.slice(-8)) {
    console.log(`…${r.id} ${r.bravo.delta} | ${r.board}`);
    console.log(`  Bravo: ${r.bravo.hole} → ${r.bravo.made ?? "folded"} | you: ${r.delanoso.hole} → ${r.delanoso.made ?? "folded"}`);
    console.log(`  ${humanize(r.result)}`);
  }

  console.log("\n=== Patterns ===");
  const thinCalls = recs.filter(
    (r) =>
      r.showdown &&
      r.delanoso.delta < 0 &&
      r.delanoso.made &&
      ["One Pair", "High Card"].includes(r.delanoso.made) &&
      r.pot >= 80,
  );
  console.log(`delanoso lost at showdown with only pair/high card in ${thinCalls.length} pots ≥80`);

  const bravoOvercalls = recs.filter(
    (r) =>
      r.showdown &&
      r.bravo.delta < 0 &&
      r.bravo.made &&
      ["One Pair", "High Card"].includes(r.bravo.made) &&
      r.pot >= 80,
  );
  console.log(`Bravo lost thin at showdown in ${bravoOvercalls.length} similar spots`);

  const dAggWins = recs.filter((r) => r.delanoso.delta > 50 && !r.showdown);
  console.log(`delanoso won 50+ without showdown: ${dAggWins.length} times (fold equity)`);
}

function humanize(msg: string): string {
  return msg
    .replace(/Seat 1/g, "Bravo")
    .replace(/Seat 4/g, "delanoso")
    .replace(/Seat 2/g, "seat2")
    .replace(/Seat 3/g, "seat3");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
