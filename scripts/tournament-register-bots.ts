/**
 * Register bots for an open tournament from the console.
 *
 * Usage:
 *   npx tsx scripts/tournament-register-bots.ts <tableId>
 *   npx tsx scripts/tournament-register-bots.ts <tableId> --all
 *   npx tsx scripts/tournament-register-bots.ts <tableId> --bots alice,bob
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { registerUserForTournament } from "../src/lib/tournament-register-user";
import { getAvailableChipBalance } from "../src/lib/wallet";

async function main() {
  const args = process.argv.slice(2);
  const tableId = args.find((a) => !a.startsWith("--"));
  if (!tableId) {
    console.error(
      "Usage: npx tsx scripts/tournament-register-bots.ts <tableId> [--all | --bots name1,name2]",
    );
    process.exit(1);
  }

  const allBots = args.includes("--all");
  const botsArg = args.find((a) => a.startsWith("--bots="))?.slice("--bots=".length);
  const botsFlagIdx = args.indexOf("--bots");
  const botsList =
    botsArg ??
    (botsFlagIdx >= 0 && args[botsFlagIdx + 1] && !args[botsFlagIdx + 1]!.startsWith("--")
      ? args[botsFlagIdx + 1]
      : null);

  const table = await prisma.pokerTable.findUnique({
    where: { id: tableId },
    select: { id: true, name: true, kind: true, closedAt: true },
  });
  if (!table || table.closedAt) {
    console.error("Table not found or closed:", tableId);
    process.exit(1);
  }

  let bots = await prisma.user.findMany({
    where: { isBot: true, blockedAt: null },
    select: { id: true, username: true },
    orderBy: { username: "asc" },
  });

  if (botsList) {
    const names = new Set(botsList.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    bots = bots.filter((b) => names.has(b.username.toLowerCase()));
  } else if (!allBots && bots.length > 0) {
    console.log("Tip: pass --all to register every bot, or --bots name1,name2");
    bots = bots.slice(0, 1);
  }

  if (bots.length === 0) {
    console.error("No bots matched.");
    process.exit(1);
  }

  console.log(`Registering ${bots.length} bot(s) for tournament "${table.name}" (${tableId})…`);

  let ok = 0;
  let fail = 0;
  for (const bot of bots) {
    const balance = await getAvailableChipBalance(bot.id);
    const result = await registerUserForTournament(prisma, tableId, bot.id, {
      role: "ADMIN",
      skipPrivateCheck: true,
    });
    if (result.ok) {
      ok += 1;
      console.log(`  ✓ @${bot.username}${result.already ? " (already registered)" : ""} · balance ${balance}`);
    } else {
      fail += 1;
      console.log(`  ✗ @${bot.username}: ${result.error}`);
    }
  }

  console.log(`Done: ${ok} ok, ${fail} failed.`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
