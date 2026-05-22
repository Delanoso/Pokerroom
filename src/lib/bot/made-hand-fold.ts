import type { PublicHandState } from "@/lib/poker/public-state";
import type { Street } from "@/lib/poker/types";
import { assessBoardDrawDanger } from "./board-draw-danger";

export type BotActionLike =
  | { type: "FOLD" }
  | { type: "CHECK" }
  | { type: "CALL" }
  | { type: "RAISE"; raiseTo: number };

/* eslint-disable @typescript-eslint/no-require-imports */
const { Hand } = require("pokersolver") as {
  Hand: {
    solve: (cards: string[], game?: string) => { rank: number; name: string };
  };
};

const RANKS = "23456789TJQKA";

function rankIdx(card: string): number {
  return RANKS.indexOf(card.slice(0, -1));
}

/**
 * Bottom two pair: board pairs or connects with a higher rank than both hole cards
 * (e.g. K-5-4-4 on board, hero 5-4 loses to K-4).
 */
function isVulnerableTwoPair(board: string[], hole: [string, string]): boolean {
  if (board.length < 3) return false;
  const h0 = rankIdx(hole[0]);
  const h1 = rankIdx(hole[1]);
  if (h0 < 0 || h1 < 0) return false;

  const boardRanks = board.map(rankIdx).filter((r) => r >= 0);
  const maxBoard = Math.max(...boardRanks);
  const maxHole = Math.max(h0, h1);

  const counts: Record<number, number> = {};
  for (const r of boardRanks) counts[r] = (counts[r] ?? 0) + 1;
  const boardPaired = Object.values(counts).some((n) => n >= 2);

  if (!boardPaired) return false;

  // Higher card on board than both hole cards → often dominated two pair
  if (maxBoard > maxHole) {
    const heroTouchesPair = boardRanks.some((r) => r === h0 || r === h1) || h0 === h1;
    return heroTouchesPair;
  }

  return false;
}

/**
 * Fold clearly marginal made hands vs large bets (fixes pair vs two pair, pair vs straight, etc.).
 */
export function shouldFoldMarginalMadeHand(
  hole: [string, string],
  board: string[],
  street: Street,
  toCall: number,
  pot: number,
): boolean {
  if (board.length < 3 || toCall <= 0) return false;

  let solved: { rank: number; name: string };
  try {
    solved = Hand.solve([...hole, ...board], "standard");
  } catch {
    return false;
  }

  const betRatio = toCall / Math.max(pot + toCall, 1);
  const draw = assessBoardDrawDanger(board, hole, toCall, pot);
  const scare = Math.max(draw.flushThreat, draw.straightThreat);
  const river = street === "RIVER";
  const turnOrRiver = street === "TURN" || river;

  if (solved.rank <= 1) {
    return betRatio > 0.22 || (turnOrRiver && betRatio > 0.15);
  }

  if (solved.rank === 2) {
    if (betRatio > 0.48) return true;
    if (river && betRatio > 0.32) return true;
    if (turnOrRiver && scare > 0.55 && betRatio > 0.28) return true;
    if (draw.flushThreat > 0.85 && betRatio > 0.25) return true;
    return false;
  }

  if (solved.rank === 3) {
    if (isVulnerableTwoPair(board, hole) && betRatio > 0.36) return true;
    if (river && betRatio > 0.5 && scare > 0.4) return true;
    return false;
  }

  return false;
}

/** Extra equity required to call (on top of pot odds). Scales with bet size. */
export function callEquityPremiumFromBetSize(toCall: number, pot: number, callPenalty: number): number {
  const betRatio = toCall / Math.max(pot + toCall, 1);
  return (callPenalty - 1) * 0.06 + Math.min(0.14, betRatio * 0.2);
}

/**
 * After HU CFR (or any solver) picks CALL, fold if made-hand strength says the call is -EV.
 * Prevents abstract policy from stationing with one pair / dominated two pair.
 */
export function vetoLightCallIfLegal(
  hole: [string, string],
  hand: Pick<PublicHandState, "board" | "street" | "pot" | "legal" | "currentBet">,
  meStreetCommit: number,
  action: BotActionLike,
): BotActionLike {
  if (action.type !== "CALL") return action;
  const toCall = Math.max(0, hand.currentBet - meStreetCommit);
  if (toCall <= 0) return action;
  if (!hand.legal.includes("FOLD")) return action;
  if (shouldFoldMarginalMadeHand(hole, hand.board, hand.street, toCall, hand.pot)) {
    return { type: "FOLD" };
  }
  return action;
}
