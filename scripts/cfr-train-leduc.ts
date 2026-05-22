import "dotenv/config";
import { leducGame } from "@/lib/bot/cfr/leduc";
import { saveCfrPolicy } from "@/lib/bot/cfr/policy-io";
import type { CfrPolicy } from "@/lib/bot/cfr/types";
import { trainVanillaCfr } from "@/lib/bot/cfr/vanilla-cfr";

const iterations = Number(process.env.CFR_ITERATIONS ?? "8000");

async function main() {
  console.log(`[cfr:leduc] vanilla CFR (${iterations} iterations)…`);
  const table = trainVanillaCfr(leducGame, iterations, (done, total) => {
    if (done % Math.max(1, Math.floor(total / 10)) === 0) {
      console.log(`[cfr:leduc] ${done}/${total}`);
    }
  });

  const policy: CfrPolicy = {
    version: 2,
    algorithm: "vanilla_cfr",
    game: "leduc",
    iterations,
    nodes: table.toPolicy(),
  };

  const out = await saveCfrPolicy(policy, "data/cfr/leduc-policy.json");
  console.log(`[cfr:leduc] wrote ${Object.keys(policy.nodes).length} info sets → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
