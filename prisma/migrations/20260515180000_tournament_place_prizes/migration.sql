-- AlterTable
ALTER TABLE "PokerTable" ADD COLUMN "tournamentPrize1stZar" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentPrize2ndZar" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentPrize3rdZar" INTEGER NOT NULL DEFAULT 0;

UPDATE "PokerTable" SET "tournamentPrize1stZar" = "tournamentPrizeZar" WHERE "tournamentPrizeZar" > 0;
