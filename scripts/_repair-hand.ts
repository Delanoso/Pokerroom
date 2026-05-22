import { syncTableHandForBot } from "../src/lib/bot/bot-table-engine";
import { findActiveTableHand } from "../src/lib/poker/hand-persist";
import { deserializeHandState } from "../src/lib/poker/nlhe-engine";
import { prisma } from "../src/lib/prisma";

const tableId = process.argv[2] ?? "cmp6rsv3n000gve08rz5o6yzr";

async function main() {
  const seat = await prisma.tableSeat.findFirst({
    where: { tableId, userId: { not: null }, user: { isBot: true } },
    select: { userId: true },
  });
  if (!seat?.userId) {
    console.log("no bot seated");
    return;
  }
  await syncTableHandForBot(prisma, tableId, seat.userId);
  const row = await findActiveTableHand(prisma, tableId);
  if (!row) {
    console.log("no active hand after sync");
    return;
  }
  const st = deserializeHandState(row.stateJson);
  console.log("street", st.street, "toAct", st.toAct, "players", st.players.map((p) => `${p.seatIndex}:folded=${p.folded}`));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
