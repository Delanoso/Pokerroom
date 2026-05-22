import "dotenv/config";
import { BotFleet } from "@/lib/bot/bot-fleet";

const fleet = new BotFleet();

process.on("SIGINT", () => {
  console.log("[bot-fleet] shutting down…");
  fleet.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  fleet.stop();
  process.exit(0);
});

fleet.start().catch((e) => {
  console.error(e);
  process.exit(1);
});
