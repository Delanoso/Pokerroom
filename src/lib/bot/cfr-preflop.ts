import type { PublicHandPlayer, PublicHandState } from "@/lib/poker/public-state";
import { lookupPushFold, type PushFoldPolicy } from "./cfr/push-fold-game";

type BotActionPayload =
  | { type: "FOLD" }
  | { type: "CHECK" }
  | { type: "CALL" }
  | { type: "RAISE"; raiseTo: number };
import { preflopTier } from "./preflop-chart";

/** Shallow-stack preflop spots: use offline CFR policy (push/fold abstraction). */
export function tryCfrPreflopAction(
  hand: PublicHandState,
  me: PublicHandPlayer,
  hole: [string, string],
  policy: PushFoldPolicy,
): BotActionPayload | null {
  if (hand.street !== "PREFLOP" || hand.viewerSeat === null) return null;

  const bb = Math.max(1, hand.bigBlind);
  const effective = me.stack + me.streetCommit;
  const stackBb = effective / bb;
  if (stackBb > 15) return null;

  const tier = preflopTier(hole);
  const role = hand.viewerSeat === hand.sbSeat ? "SB" : "BB";
  const toCall = Math.max(0, hand.currentBet - me.streetCommit);
  const facingShove = toCall > 0 && toCall >= me.stack * 0.45;

  if (facingShove) {
    const probs = lookupPushFold(policy, role, stackBb, tier, "shove");
    if (!probs) return null;
    const [, callP] = probs;
    if (callP >= 0.52 && hand.legal.includes("CALL")) return { type: "CALL" };
    if (callP >= 0.52 && hand.legal.includes("RAISE")) {
      return { type: "RAISE", raiseTo: me.streetCommit + me.stack };
    }
    if (hand.legal.includes("FOLD")) return { type: "FOLD" };
    return null;
  }

  if (hand.legal.includes("CHECK") && hand.legal.includes("RAISE")) {
    const probs = lookupPushFold(policy, role, stackBb, tier, "open");
    if (!probs) return null;
    const [foldP, shoveP] = probs;
    if (shoveP >= 0.5) {
      return { type: "RAISE", raiseTo: me.streetCommit + me.stack };
    }
    if (foldP >= 0.55) return { type: "CHECK" };
  }

  return null;
}
