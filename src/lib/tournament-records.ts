import type { PrismaClient } from "@prisma/client";
import { TournamentFlightStatus } from "@prisma/client";

export type TournamentPlacementRow = {
  place: number;
  userId: string;
  username: string;
  displayName: string;
  prizeZar: number;
  paidAt: Date | null;
};

export type TournamentRecordRow = {
  id: string;
  flightKey: string;
  tableName: string;
  anchorTableId: string;
  status: TournamentFlightStatus;
  completedAt: Date;
  entryFeeZar: number;
  prize1stZar: number;
  prize2ndZar: number;
  prize3rdZar: number;
  registrationCount: number;
  topFive: TournamentPlacementRow[];
};

export async function listTournamentRecords(
  prisma: PrismaClient,
  limit = 50,
): Promise<TournamentRecordRow[]> {
  const archives = await prisma.tournamentFlightArchive.findMany({
    orderBy: { completedAt: "desc" },
    take: limit,
    include: {
      placements: {
        where: { place: { lte: 5 } },
        orderBy: { place: "asc" },
        include: {
          user: {
            select: {
              username: true,
              displayUsername: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  return archives.map((a) => ({
    id: a.id,
    flightKey: a.flightKey,
    tableName: a.tableName,
    anchorTableId: a.anchorTableId,
    status: a.status,
    completedAt: a.completedAt,
    entryFeeZar: a.entryFeeZar,
    prize1stZar: a.prize1stZar,
    prize2ndZar: a.prize2ndZar,
    prize3rdZar: a.prize3rdZar,
    registrationCount: a.registrationCount,
    topFive: a.placements.map((p) => ({
      place: p.place,
      userId: p.userId,
      username: p.user.username,
      displayName:
        p.user.displayUsername?.trim() ||
        `${p.user.firstName} ${p.user.lastName}`.trim() ||
        p.user.username,
      prizeZar: p.prizeZar,
      paidAt: p.paidAt,
    })),
  }));
}
