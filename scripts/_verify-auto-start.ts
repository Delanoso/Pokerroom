import { prisma } from "../src/lib/prisma";
import { tryAutoStartHand } from "../src/lib/poker/try-auto-start-hand";

async function main() {
  const tableId = process.argv[2] ?? "cmp6pudf20004vegganmwzlgd";

  const ok = await tryAutoStartHand(prisma, tableId);
  const hand = await prisma.tableHand.findFirst({
    where: { tableId, complete: false },
    orderBy: { createdAt: "desc" },
  });

  console.log("started", ok, "activeHand", Boolean(hand));
  if (hand) {
    const state = JSON.parse(hand.stateJson) as { street?: string; players?: unknown[] };
    console.log("street", state.street, "players", state.players?.length);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
