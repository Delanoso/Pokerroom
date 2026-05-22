-- AlterTable
ALTER TABLE "PokerTable" ADD COLUMN "tournamentMinPlayersToStart" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "PokerTable" ADD COLUMN "tournamentFlightStatus" TEXT;

-- CreateTable
CREATE TABLE "TournamentElimination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flightKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bustOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "TournamentElimination_flightKey_userId_key" ON "TournamentElimination"("flightKey", "userId");
CREATE INDEX "TournamentElimination_flightKey_bustOrder_idx" ON "TournamentElimination"("flightKey", "bustOrder");
