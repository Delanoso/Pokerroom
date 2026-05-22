import "dotenv/config";
import { savePushFoldPolicy } from "@/lib/bot/cfr/policy-io";
import { trainPushFoldCfr } from "@/lib/bot/cfr/push-fold-game";

const iterations = Number(process.env.CFR_ITERATIONS ?? "25000");

async function main() {
  console.log(`[cfr] training push/fold abstraction (${iterations} iterations)…`);
  const policy = trainPushFoldCfr(iterations);
  const out = await savePushFoldPolicy(policy);
  console.log(`[cfr] wrote ${Object.keys(policy.nodes).length} info sets → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
