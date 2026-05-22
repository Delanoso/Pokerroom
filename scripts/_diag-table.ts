import { prisma } from "../src/lib/prisma";
import { findActiveTableHand } from "../src/lib/poker/hand-persist";
import { deserializeHandState } from "../src/lib/poker/nlhe-engine";

async function main() {
  const tables = await prisma.pokerTable.findMany({
    where: { closedAt: null },
    include: {
      seats: {
        include: { user: { select: { username: true, isBot: true } } },
      },
    },
  });

  for (const t of tables) {
    const seated = t.seats.filter((s) => s.userId);
    const active = await findActiveTableHand(prisma, t.id);
    console.log("\nTABLE", t.name, t.id);
    console.log(
      "  seated:",
      seated.map(
        (s) =>
          `${s.user?.username}@${s.seatIndex} stack=${s.stackChips} wait=${s.waitingForNextHand}`,
      ),
    );
    if (active) {
      const st = deserializeHandState(active.stateJson);
      console.log("  ACTIVE HAND", active.id, "street", st.street, "toAct", st.toAct);
      console.log("  revealUntil", st.showdownRevealUntilIso, "pot", st.pot);
      console.log(
        "  hand players:",
        st.players.map((p) => `seat${p.seatIndex} user=${p.userId.slice(0, 8)} folded=${p.folded}`),
      );
      const seatedIds = new Set(seated.map((s) => s.userId!));
      const ghosts = st.players.filter((p) => !seatedIds.has(p.userId));
      if (ghosts.length) console.log("  GHOST players (left table):", ghosts.length);
    } else {
      console.log("  no active hand");
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
