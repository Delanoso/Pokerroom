import "dotenv/config";
import { LedgerEntryType, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const username = (process.env.SEED_ADMIN_USERNAME ?? "house_admin").trim().toLowerCase();
  const firstName = (process.env.SEED_ADMIN_FIRST_NAME ?? "House").trim() || "House";
  const lastName = (process.env.SEED_ADMIN_LAST_NAME ?? "Admin").trim() || "Admin";

  if (email && password) {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      console.log("Seed admin skipped: a user with this email or username already exists");
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          firstName,
          lastName,
          username,
          email,
          passwordHash,
          role: Role.ADMIN,
        },
      });
      console.log(`Created admin user @${username}`);
    }
  } else {
    console.log("Skipping admin seed: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env");
  }

  const botEmail = process.env.SEED_BOT_EMAIL?.trim().toLowerCase();
  const botPassword = process.env.SEED_BOT_PASSWORD;
  const botUsername = (process.env.SEED_BOT_USERNAME ?? "bot_alpha").trim().toLowerCase();
  const botBankroll = Number(process.env.SEED_BOT_BANKROLL_CHIPS ?? "5000000");

  if (botEmail && botPassword) {
    const botExisting = await prisma.user.findFirst({
      where: { OR: [{ email: botEmail }, { username: botUsername }] },
    });
    if (botExisting) {
      console.log("Seed bot skipped: user with bot email or username already exists");
    } else {
      const botHash = await bcrypt.hash(botPassword, 12);
      const bot = await prisma.user.create({
        data: {
          firstName: "Bot",
          lastName: "Alpha",
          username: botUsername,
          email: botEmail,
          passwordHash: botHash,
          role: Role.USER,
          isBot: true,
        },
      });
      if (Number.isFinite(botBankroll) && botBankroll > 0) {
        await prisma.ledgerEntry.create({
          data: {
            userId: bot.id,
            amountChips: botBankroll,
            type: LedgerEntryType.ADMIN_ADJUSTMENT,
            note: "Seed bankroll for playtest bot",
          },
        });
      }
      console.log(`Created bot user @${botUsername} (${bot.id}) bankroll +${botBankroll}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
