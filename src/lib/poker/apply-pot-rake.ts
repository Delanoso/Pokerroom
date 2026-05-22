import { createRequire } from "node:module";
import type { NlheHandState } from "./types";
import { computePotRake, scaleSliceAmounts } from "./rake";
import { buildPotSlices } from "./pot";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: {
    solve: (cards: string[], game?: string, canDisqualify?: boolean) => unknown;
    winners: (hands: unknown[]) => unknown[];
  };
};

function rakeConfigFromState(state: NlheHandState): { rakePercentBps: number; rakeCapChips: number } | null {
  const bps = state.rakePercentBps ?? 0;
  if (bps <= 0) return null;
  return { rakePercentBps: bps, rakeCapChips: state.rakeCapChips ?? 0 };
}

/**
 * Awards the pot (minus rake on cash tables) and clears `state.pot`.
 * Returns rake taken this call.
 */
export function awardPotFromState(state: NlheHandState): number {
  const pot = state.pot;
  if (pot <= 0) return 0;

  const rakeCfg = rakeConfigFromState(state);
  const rake = rakeCfg ? computePotRake(pot, rakeCfg.rakePercentBps, rakeCfg.rakeCapChips) : 0;

  const alive = state.players.filter((p) => !p.folded);
  if (alive.length === 1) {
    const w = alive[0]!;
    w.stack += pot - rake;
    state.pot = 0;
    if (rake > 0) state.rakeChips = (state.rakeChips ?? 0) + rake;
    return rake;
  }

  const slices = buildPotSlices(state.players);
  const oldAmounts = slices.map((s) => s.amount);
  const oldTotal = oldAmounts.reduce((a, b) => a + b, 0);
  const newTotal = pot - rake;
  const scaled = rake > 0 ? scaleSliceAmounts(oldAmounts, oldTotal, newTotal) : oldAmounts;

  const payouts = new Map<number, number>();
  for (const p of state.players) payouts.set(p.seatIndex, 0);

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!;
    const amount = scaled[i] ?? 0;
    if (amount === 0) continue;
    const contenders = slice.eligibleSeats.filter((si) => {
      const pl = state.players.find((x) => x.seatIndex === si);
      return pl && !pl.folded;
    });
    if (contenders.length === 0) continue;
    const solved = contenders.map((si) => {
      const pl = state.players.find((x) => x.seatIndex === si)!;
      const cards = [...pl.hole, ...state.board];
      return { seat: si, hand: Hand.solve(cards, "standard") };
    });
    const winners = Hand.winners(solved.map((x) => x.hand));
    const winSeats = solved.filter((x) => winners.includes(x.hand)).map((x) => x.seat);
    const share = Math.floor(amount / winSeats.length);
    let remainder = amount - share * winSeats.length;
    for (const si of winSeats) {
      payouts.set(si, (payouts.get(si) ?? 0) + share + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder--;
    }
  }

  for (const p of state.players) {
    p.stack += payouts.get(p.seatIndex) ?? 0;
  }
  state.pot = 0;
  if (rake > 0) state.rakeChips = (state.rakeChips ?? 0) + rake;
  return rake;
}
