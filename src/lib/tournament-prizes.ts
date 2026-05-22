export type TournamentPrizes = {
  firstZar: number;
  secondZar: number;
  thirdZar: number;
};

export function tournamentPrizesFromTable(row: {
  tournamentPrize1stZar?: number;
  tournamentPrize2ndZar?: number;
  tournamentPrize3rdZar?: number;
}): TournamentPrizes {
  return {
    firstZar: row.tournamentPrize1stZar ?? 0,
    secondZar: row.tournamentPrize2ndZar ?? 0,
    thirdZar: row.tournamentPrize3rdZar ?? 0,
  };
}

/** Compact lobby label, e.g. "1st 5,000 Zar · 2nd 2,000 Zar". Omits empty 2nd/3rd. */
export function formatTournamentPrizeLine(prizes: TournamentPrizes, formatZar: (n: number) => string): string {
  const parts: string[] = [];
  if (prizes.firstZar > 0) parts.push(`1st ${formatZar(prizes.firstZar)}`);
  if (prizes.secondZar > 0) parts.push(`2nd ${formatZar(prizes.secondZar)}`);
  if (prizes.thirdZar > 0) parts.push(`3rd ${formatZar(prizes.thirdZar)}`);
  return parts.join(" · ");
}

export function hasAnyTournamentPrize(prizes: TournamentPrizes): boolean {
  return prizes.firstZar > 0 || prizes.secondZar > 0 || prizes.thirdZar > 0;
}
