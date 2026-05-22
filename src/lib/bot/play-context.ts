import type { PublicHandState } from "@/lib/poker/public-state";
import type { CfrPolicy } from "./cfr/types";
import type { PushFoldPolicy } from "./cfr/push-fold-game";
import type { OpponentTexture } from "./opponent-adjust";

/** Passed from the table payload so cash vs tournament can differ. */
export type BotDecideContext = {
  tableKind?: "CASH" | "TOURNAMENT" | "SIT_AND_GO";
  /** MCCFR policy for abstract HU NLHE (`npm run bot:train-cfr:hu`). */
  huCfrPolicy?: CfrPolicy | null;
  /** Legacy shallow push/fold policy. */
  pushFoldPolicy?: PushFoldPolicy | null;
  /** Built from per-hand opponent learning at this table. */
  opponentTexture?: OpponentTexture;
};

export function isTournament(ctx: BotDecideContext | undefined): boolean {
  return ctx?.tableKind === "TOURNAMENT";
}

/** Inferred ring size from seat indices and blind seats (2–10). */
export function tableSeatCount(hand: PublicHandState): number {
  let m = 0;
  for (const p of hand.players) m = Math.max(m, p.seatIndex + 1);
  m = Math.max(m, hand.buttonSeat + 1, hand.sbSeat + 1, hand.bbSeat + 1);
  return Math.min(Math.max(m, 2), 10);
}

/** Clockwise steps from button: 0 = BTN, 1 = SB, 2 = BB, then UTG… */
export function seatOffsetFromButton(hand: PublicHandState, viewerSeat: number): number {
  const n = tableSeatCount(hand);
  return (viewerSeat - hand.buttonSeat + n) % n;
}

/**
 * Late position → higher value (more steals / thin value).
 * Blinds slightly below par; BTN boosted.
 */
export function positionPressure(hand: PublicHandState, viewerSeat: number): number {
  const n = tableSeatCount(hand);
  const o = seatOffsetFromButton(hand, viewerSeat);
  if (o === 0) return 1.1;
  if (o === 1) return 0.9;
  if (o === 2) return 0.93;
  const afterBB = n - 3;
  if (afterBB <= 1) return 1.02;
  const u = (o - 3) / (afterBB - 1);
  return 0.86 + 0.22 * Math.min(1, Math.max(0, u));
}

/**
 * Crude SPR after paying `toCall`: chips left behind vs final pot if we call.
 * Low ⇒ more commitment; fold more marginal equity.
 */
export function sprAfterCall(
  stack: number,
  streetCommit: number,
  pot: number,
  toCall: number,
): number {
  const pay = Math.min(stack, toCall);
  const potAfter = pot + pay;
  const behind = Math.max(0, stack - pay);
  return behind / Math.max(1, potAfter);
}

/** Tournament survival: tighten slightly when shallow; never below 1bb semantics handled elsewhere. */
export function tournamentTightness(stackChips: number, bigBlind: number): number {
  const bb = Math.max(1, bigBlind);
  const s = stackChips / bb;
  if (s >= 35) return 1;
  if (s >= 18) return 1.04;
  if (s >= 12) return 1.08;
  return 1.12;
}
