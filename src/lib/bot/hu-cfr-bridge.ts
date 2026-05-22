import type { PublicHandPlayer, PublicHandState } from "@/lib/poker/public-state";
import { boardBucketFromCards, holeBucketFromCards } from "./cfr/equity-cache";
import { HU_ACTIONS } from "./cfr/hu-nlhe-abstract";
import { lookupPolicy, samplePolicyAction } from "./cfr/policy-io";
import type { CfrPolicy } from "./cfr/types";
import type { BotActionPayload } from "./decide-action";

function phaseFromStreet(street: PublicHandState["street"]): string {
  if (street === "PREFLOP") return "preflop";
  if (street === "FLOP") return "flop";
  if (street === "TURN") return "turn";
  if (street === "RIVER") return "river";
  return "preflop";
}

/** Map live table state → abstract HU CFR information set (must match trainer). */
export function liveHandToHuInfoSet(hand: PublicHandState, me: PublicHandPlayer, playerSeat: number): string {
  const bb = Math.max(1, hand.bigBlind);
  const hole = me.hole ? holeBucketFromCards(me.hole) : 0;
  const board = boardBucketFromCards(hand.board);
  const facing = hand.currentBet > me.streetCommit ? 1 : 0;
  const spr = Math.floor((me.stack + me.streetCommit) / Math.max(bb, hand.pot));
  const player = playerSeat === hand.buttonSeat ? 0 : 1;

  return [
    `p${player}`,
    phaseFromStreet(hand.street),
    `b${board}`,
    `h${hole}`,
    `pot${Math.floor(hand.pot / bb)}`,
    `cb${hand.currentBet}`,
    `sc${me.streetCommit}`,
    `f${facing}`,
    `spr${Math.min(30, spr)}`,
    `r0`,
    `t${hand.toAct === playerSeat ? 1 : 0}`,
  ].join("|");
}

function mapCfrActionToPayload(
  hand: PublicHandState,
  me: PublicHandPlayer,
  actionKind: string,
): BotActionPayload | null {
  const toCall = Math.max(0, hand.currentBet - me.streetCommit);
  const shoveTo = me.streetCommit + me.stack;

  if (actionKind === "fold" && hand.legal.includes("FOLD")) return { type: "FOLD" };
  if (actionKind === "check_call") {
    if (toCall === 0 && hand.legal.includes("CHECK")) return { type: "CHECK" };
    if (hand.legal.includes("CALL")) return { type: "CALL" };
  }
  if (actionKind === "bet_half" || actionKind === "bet_pot") {
    if (!hand.legal.includes("RAISE")) return null;
    const potAfter = hand.pot + toCall;
    const bump = actionKind === "bet_half" ? Math.max(hand.bigBlind, Math.floor(potAfter * 0.5)) : potAfter;
    const target = hand.currentBet + bump;
    return { type: "RAISE", raiseTo: Math.min(shoveTo, Math.max(hand.currentBet + hand.minRaise, target)) };
  }
  if (actionKind === "all_in" && hand.legal.includes("RAISE")) {
    return { type: "RAISE", raiseTo: shoveTo };
  }
  return null;
}

/**
 * Heads-up only: query MCCFR policy for an action. Returns null if no policy / not HU / no mapping.
 */
export function tryHuCfrAction(
  hand: PublicHandState,
  policy: CfrPolicy | null | undefined,
): BotActionPayload | null {
  if (!policy || hand.viewerSeat === null) return null;
  const alive = hand.players.filter((p) => !p.folded);
  if (alive.length !== 2) return null;

  const me = hand.players.find((p) => p.seatIndex === hand.viewerSeat);
  if (!me?.hole) return null;

  const info = liveHandToHuInfoSet(hand, me, hand.viewerSeat);
  const probs = lookupPolicy(policy, info);
  if (!probs || probs.length === 0) return null;

  const idx = samplePolicyAction(probs);
  const kind = HU_ACTIONS[idx] ?? "check_call";
  return mapCfrActionToPayload(hand, me, kind);
}
