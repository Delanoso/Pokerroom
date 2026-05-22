import { PokerTableKind } from "@prisma/client";

export function isScheduledTournament(kind: PokerTableKind | string): boolean {
  return kind === PokerTableKind.TOURNAMENT;
}

export function isSitAndGo(kind: PokerTableKind | string): boolean {
  return kind === PokerTableKind.SIT_AND_GO;
}

/** Fixed starting stack on sit (not bankroll stack size). */
export function usesFixedStartingStack(kind: PokerTableKind | string): boolean {
  return kind === PokerTableKind.TOURNAMENT || kind === PokerTableKind.SIT_AND_GO;
}

/** Buy-in debited from player bankroll when sitting. */
export function usesBankrollBuyInOnSit(kind: PokerTableKind | string): boolean {
  return kind === PokerTableKind.CASH || kind === PokerTableKind.SIT_AND_GO;
}
