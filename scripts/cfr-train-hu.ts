import "dotenv/config";
import { buildBucketEquityTable } from "@/lib/bot/cfr/equity-cache";
import { createHuNlheAbstractGame, HU_BOARD_BUCKETS, HU_HOLE_BUCKETS } from "@/lib/bot/cfr/hu-nlhe-abstract";
import { trainExternalSamplingMccfr } from "@/lib/bot/cfr/external-sampling-mccfr";
import { saveCfrPolicy } from "@/lib/bot/cfr/policy-io";
import type { CfrPolicy } from "@/lib/bot/cfr/types";

const iterations = Number(process.env.CFR_ITERATIONS ?? "150000");
const mcPerCell = Number(process.env.CFR_EQUITY_MC ?? "40");

async function main() {
  console.log(`[cfr:hu] building equity table (${HU_HOLE_BUCKETS}×${HU_HOLE_BUCKETS}×${HU_BOARD_BUCKETS}, ${mcPerCell} MC/cell)…`);
  const equity = buildBucketEquityTable(HU_HOLE_BUCKETS, HU_BOARD_BUCKETS, mcPerCell);

  const game = createHuNlheAbstractGame(equity);
  console.log(`[cfr:hu] external-sampling MCCFR (${iterations} iterations)…`);

  const table = trainExternalSamplingMccfr(game, iterations, (done, total) => {
    if (done % Math.max(1, Math.floor(total / 20)) === 0) {
      console.log(`[cfr:hu] ${done}/${total}`);
    }
  });

  const policy: CfrPolicy = {
    version: 2,
    algorithm: "external_sampling_mccfr",
    game: "hu_nlhe_abstract",
    iterations,
    nodes: table.toPolicy(),
  };

  const out = await saveCfrPolicy(policy);
  console.log(`[cfr:hu] wrote ${Object.keys(policy.nodes).length} info sets → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
