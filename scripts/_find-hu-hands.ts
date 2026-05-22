import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { deserializeHandState } from "../src/lib/poker/nlhe-engine";

async function main() {
  const needles = (process.env.ANALYZE_PLAYERS ?? "delanoso,bravo").split(",").map((s) => s.trim().toLowerCase());

  const users = await prisma.user.findMany({
    where: {
      OR: needles.flatMap((n) => [
        { username: { contains: n } },
        { displayUsername: { contains: n } },
      ]),
    },
    select: { id: true, username: true, displayUsername: true, isBot: true },
  });
  console.log("Users:", users);

  const userIds = new Set(users.map((u) => u.id));
  const hands = await prisma.tableHand.findMany({
    where: { complete: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: { table: { select: { name: true, id: true } } },
  });

  const matched: typeof hands = [];
  for (const h of hands) {
    const st = deserializeHandState(h.stateJson);
    const inHand = st.players.map((p) => p.userId);
    const hit = inHand.filter((id) => userIds.has(id));
    if (hit.length >= Math.min(2, userIds.size)) matched.push(h);
  }

  console.log(`\nHands with both players: ${matched.length} / ${hands.length} scanned`);
  for (const h of matched.slice(0, 40).reverse()) {
    const st = deserializeHandState(h.stateJson);
    console.log(`\n${h.table.name} …${h.id.slice(-8)} @ ${h.updatedAt.toISOString()}`);
    console.log(" ", st.resultMessage);
    console.log("  board:", st.board.join(" ") || "—");
    for (const p of st.players) {
      const u = users.find((x) => x.id === p.userId);
      const name = u?.displayUsername ?? u?.username ?? p.userId.slice(0, 8);
      console.log(`  ${name}: ${p.hole[0]} ${p.hole[1]} folded=${p.folded} stack=${p.stack} commit=${p.handCommit}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
