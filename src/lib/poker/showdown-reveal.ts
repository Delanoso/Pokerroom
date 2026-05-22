import type { NlheHandState, Street } from "./types";

/** Two or more players still in the pot (not a win-by-everyone-folded). */
export function aliveInHandCount(players: { folded: boolean }[]): number {
  return players.filter((p) => !p.folded).length;
}

/**
 * Hole cards must be shown to the table: check-down, call down, or all-in runout.
 * False when only one player remains (everyone else folded) — winner need not show.
 */
export function isContestedShowdown(
  street: Street,
  players: { folded: boolean }[],
): boolean {
  if (aliveInHandCount(players) < 2) return false;
  return street === "SHOWDOWN" || street === "COMPLETE";
}

export function contestedShowdownFromState(state: NlheHandState): boolean {
  return isContestedShowdown(state.street, state.players);
}
