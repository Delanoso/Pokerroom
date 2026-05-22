import type { NlheHandState } from "./types";

/**
 * Voluntary RAISE (incl. open-shove) is only meaningful if some other non-folded player
 * still has chips and could respond to a larger wager.
 */
export function canRaiseInCurrentSpot(state: NlheHandState, actorSeat: number): boolean {
  const p = state.players.find((x) => x.seatIndex === actorSeat);
  if (!p || p.folded || p.stack <= 0) return false;
  if (state.street === "COMPLETE" || state.street === "SHOWDOWN") return false;

  const alive = state.players.filter((x) => !x.folded);
  const others = alive.filter((x) => x.seatIndex !== actorSeat);
  if (others.length === 0) return false;

  const othersWhoCouldRespond = others.filter((o) => o.stack > 0);
  if (othersWhoCouldRespond.length === 0) return false;

  return true;
}
