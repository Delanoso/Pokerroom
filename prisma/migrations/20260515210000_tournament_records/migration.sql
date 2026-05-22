-- CreateTable
CREATE TABLE "TournamentFlightArchive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flightKey" TEXT NOT NULL,
    "anchorTableId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "entryFeeZar" INTEGER NOT NULL DEFAULT 0,
    "prize1stZar" INTEGER NOT NULL DEFAULT 0,
    "prize2ndZar" INTEGER NOT NULL DEFAULT 0,
    "prize3rdZar" INTEGER NOT NULL DEFAULT 0,
    "registrationCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TournamentPlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "archiveId" TEXT,
    "flightKey" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "prizeZar" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TournamentPlacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TournamentPlacement_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "TournamentFlightArchive" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentFlightArchive_flightKey_key" ON "TournamentFlightArchive"("flightKey");
CREATE INDEX "TournamentFlightArchive_completedAt_idx" ON "TournamentFlightArchive"("completedAt");
CREATE INDEX "TournamentFlightArchive_status_idx" ON "TournamentFlightArchive"("status");
CREATE UNIQUE INDEX "TournamentPlacement_flightKey_place_key" ON "TournamentPlacement"("flightKey", "place");
CREATE INDEX "TournamentPlacement_archiveId_idx" ON "TournamentPlacement"("archiveId");
CREATE INDEX "TournamentPlacement_flightKey_idx" ON "TournamentPlacement"("flightKey");
