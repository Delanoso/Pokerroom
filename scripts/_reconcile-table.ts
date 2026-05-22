import { reconcileAndPersistActiveHand } from "../src/lib/poker/reconcile-active-hand";
import { findActiveTableHand } from "../src/lib/poker/hand-persist";
import { prisma } from "../src/lib/prisma";

const tableId = process.argv[2] ?? "cmp6pudf20004vegganmwzlgd";

async function main() {
  const changed = await reconcileAndPersistActiveHand(prisma, tableId);
  const active = await findActiveTableHand(prisma, tableId);
  console.log("reconciled", changed, "activeHand", Boolean(active));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
