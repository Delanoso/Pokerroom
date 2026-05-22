-- Tournament blind levels: optional timed escalation after flight starts.
ALTER TABLE "PokerTable" ADD COLUMN "tournamentEscalatingBlinds" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentBlindLevelMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentBlindLevelMultiplierBps" INTEGER NOT NULL DEFAULT 20000;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentBlindLevel" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentBlindLevelEndsAt" TIMESTAMP(3);
ALTER TABLE "PokerTable" ADD COLUMN "tournamentBlindBaseSmallBlind" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentBlindBaseBigBlind" INTEGER NOT NULL DEFAULT 0;
