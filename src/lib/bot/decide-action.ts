import type { PublicHandPlayer, PublicHandState } from "@/lib/poker/public-state";
import { tryCfrPreflopAction } from "./cfr-preflop";
import { tryHuCfrAction } from "./hu-cfr-bridge";
import { assessBoardDrawDanger } from "./board-draw-danger";
import {
  callEquityPremiumFromBetSize,
  shouldFoldMarginalMadeHand,
  vetoLightCallIfLegal,
} from "./made-hand-fold";
import { equityVsRandomOneOpponent } from "./equity-mc";
import { preflopTier } from "./preflop-chart";
import {
  isTournament,
  positionPressure,
  sprAfterCall,
  tournamentTightness,
  type BotDecideContext,
} from "./play-context";

export type BotActionPayload =
  | { type: "FOLD" }
  | { type: "CHECK" }
  | { type: "CALL" }
  | { type: "RAISE"; raiseTo: number };

const PREFLOP_MC_ITERS = 48;
const POSTFLOP_MC_ITERS = 80;
/** When facing a bet, fold trash (tier 0) this often if FOLD is legal. */
const TIER_0_PREFLOP_FOLD_FREQ = 0.9;
/** Marginal (tier 1): extra fold frequency vs any preflop raise. */
const TIER_1_PREFLOP_FOLD_FREQ = 0.58;

function aliveCount(hand: PublicHandState): number {
  return hand.players.filter((p) => !p.folded).length;
}

function pickRaiseTo(hand: PublicHandState, me: PublicHandPlayer, potFraction: number): number {
  const shoveTo = me.streetCommit + me.stack;
  const minTotal = hand.currentBet + hand.minRaise;
  const bump = Math.max(hand.minRaise, Math.floor(hand.pot * potFraction));
  const target = hand.currentBet + bump;
  return Math.min(shoveTo, Math.max(minTotal, target));
}

/**
 * Cash + tournament NLHE: chart preflop, MC postflop, pot odds, position, SPR, and format
 * (tournament = slightly tighter, especially shallow). Tuned to avoid bleeding while still
 * applying pressure in position with legitimate equity.
 */
export function decideBotAction(hand: PublicHandState, ctx?: BotDecideContext): BotActionPayload | null {
  if (hand.legal.length === 0 || hand.viewerSeat === null) {
    return null;
  }

  const me = hand.players.find((p) => p.seatIndex === hand.viewerSeat);
  if (!me?.hole) return null;

  const hole = me.hole;
  const toCall = Math.max(0, hand.currentBet - me.streetCommit);
  const alive = Math.max(2, aliveCount(hand));
  const bb = Math.max(1, hand.bigBlind);
  const tour = isTournament(ctx);
  const opp = ctx?.opponentTexture;
  const tight =
    (tour ? tournamentTightness(me.stack, bb) : 1) * (opp?.tightness ?? 1);
  const posP = positionPressure(hand, hand.viewerSeat);
  const spr = sprAfterCall(me.stack, me.streetCommit, hand.pot, toCall);
  const sprPressure = spr < 1.35 && toCall >= bb * 2 ? 1.06 : spr > 5 ? 0.97 : 1;
  const bluffScale = opp?.bluffScale ?? 1;
  const callPenalty = opp?.callPenalty ?? 1;

  const mcOpts = tour
    ? { multiwayExponent: 0.29 as const, conservativeTrim: 0.965 as const }
    : { multiwayExponent: 0.22 as const };

  /** Minimum equity bar (scales up when tournament / shallow = need stronger hand). */
  const need = (t: number) => t * tight * sprPressure;

  const potSlack = (base: number) => base / tight;

  const huCfr = tryHuCfrAction(hand, ctx?.huCfrPolicy);
  if (huCfr) {
    return vetoLightCallIfLegal(hole, hand, me.streetCommit, huCfr);
  }

  if (ctx?.pushFoldPolicy) {
    const cfr = tryCfrPreflopAction(hand, me, hole, ctx.pushFoldPolicy);
    if (cfr) return cfr;
  }

  if (hand.street !== "PREFLOP") {
    const eq = equityVsRandomOneOpponent(hole, hand.board, POSTFLOP_MC_ITERS, alive, mcOpts);
    const potOdds = toCall <= 0 ? 0 : toCall / (hand.pot + toCall + 0.01);
    const drawDanger =
      toCall > 0 ? assessBoardDrawDanger(hand.board, hole, toCall, hand.pot) : null;
    const drawFoldSlack = drawDanger?.foldEquityPenalty ?? 0;
    const drawCallPremium = drawDanger?.callEquityPremium ?? 0;
    const drawBluffScale =
      1 - (drawDanger?.betPressure ?? 0) * (drawDanger ? drawDanger.flushThreat * 0.35 + drawDanger.straightThreat * 0.35 : 0);

    if (hand.legal.includes("CHECK")) {
      if (hand.legal.includes("RAISE") && me.stack > 0) {
        const thinRaise = 0.03 * (1 / posP) * (tour ? 0.85 : 1) + drawCallPremium * 0.5;
        if (eq >= need(0.72)) {
          return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.58 + 0.06 * (posP - 0.95)) };
        }
        if (
          eq >= need(0.54) + drawCallPremium &&
          eq > potOdds + thinRaise &&
          Math.random() < 0.38 * posP * bluffScale * drawBluffScale * (tour ? 0.75 : 1)
        ) {
          return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.42) };
        }
      }
      return { type: "CHECK" };
    }

    if (
      hand.legal.includes("FOLD") &&
      toCall > 0 &&
      eq <
        potOdds -
        (tour ? 0.022 : 0.012) / Math.max(0.85, posP) -
        (callPenalty - 1) * 0.04 -
        drawFoldSlack
    ) {
      return { type: "FOLD" };
    }

    if (hand.legal.includes("RAISE") && me.stack > 0) {
      if (eq >= need(0.84)) {
        return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.7) };
      }
      if (
        eq >= need(0.7) + drawCallPremium &&
        eq > potOdds + 0.11 * tight + drawCallPremium &&
        Math.random() < 0.4 * posP * drawBluffScale * (spr < 2.2 ? 0.75 : 1) * (tour ? 0.72 : 1)
      ) {
        return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.52) };
      }
    }

    const callPremium = callEquityPremiumFromBetSize(toCall, hand.pot, callPenalty) + drawCallPremium;
    if (
      hand.legal.includes("FOLD") &&
      shouldFoldMarginalMadeHand(hole, hand.board, hand.street, toCall, hand.pot)
    ) {
      return { type: "FOLD" };
    }

    if (hand.legal.includes("CALL") && eq >= potOdds + callPremium) {
      return { type: "CALL" };
    }
    if (hand.legal.includes("FOLD")) {
      return { type: "FOLD" };
    }
    if (hand.legal.includes("RAISE")) {
      return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.48) };
    }
    return null;
  }

  // --- PREFLOP ---
  const tier = preflopTier(hole);
  const eq = equityVsRandomOneOpponent(hole, [], PREFLOP_MC_ITERS, alive, mcOpts);
  const potOdds = toCall <= 0 ? 0 : toCall / (hand.pot + toCall + 0.01);
  const openScale = (posP * (tour ? 0.9 : 1)) / tight;

  if (hand.legal.includes("CHECK")) {
    if (hand.legal.includes("RAISE") && me.stack > 0) {
      const stealBoost = bluffScale > 1.15 ? 1.35 : 1;
      const baseOpen =
        tier >= 4
          ? 0.9
          : tier === 3
            ? 0.72
            : tier === 2
              ? 0.22 * stealBoost
              : tier === 1
                ? 0.1 * stealBoost
                : 0.04;
      const openFreq = Math.min(0.97, baseOpen * openScale);
      if (Math.random() < openFreq) {
        const potFrac =
          tier >= 4
            ? 0.52 + 0.05 * (posP - 1)
            : tier === 3
              ? 0.45
              : tier === 2
                ? 0.34
                : 0.28;
        return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, Math.max(0.28, potFrac)) };
      }
    }
    return { type: "CHECK" };
  }

  if (tier === 0 && hand.legal.includes("FOLD") && Math.random() < TIER_0_PREFLOP_FOLD_FREQ) {
    return { type: "FOLD" };
  }

  if (tier === 1 && hand.legal.includes("FOLD") && toCall > 0 && Math.random() < TIER_1_PREFLOP_FOLD_FREQ) {
    return { type: "FOLD" };
  }

  if (toCall > 0 && hand.legal.includes("FOLD")) {
    const po = potOdds;
    if (tier === 1 && eq < po + potSlack(tour ? 0.035 : 0.05)) {
      return { type: "FOLD" };
    }
    if (tier === 2 && eq < po + potSlack(tour ? 0.01 : 0.02)) {
      return { type: "FOLD" };
    }
    if (tier === 1 && toCall > bb * 5 && eq < need(0.4)) {
      return { type: "FOLD" };
    }
    if (tier === 2 && toCall > bb * 8 && eq < need(0.44)) {
      return { type: "FOLD" };
    }
    if (toCall > bb * 12 && tier < 4 && eq < need(0.42)) {
      return { type: "FOLD" };
    }
    if (spr < 1.2 && tier < 3 && toCall > bb * 4 && eq < need(0.38)) {
      return { type: "FOLD" };
    }
    if (spr < 1.2 && tier === 2 && toCall > bb * 3 && eq < need(0.42)) {
      return { type: "FOLD" };
    }
  }

  if (hand.legal.includes("RAISE") && me.stack > 0) {
    const threeBetScale = posP * (tour ? 0.88 : 1);
    if (tier >= 4) {
      return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.78) };
    }
    if (tier === 3 && toCall <= bb * 9 && (eq > potOdds + need(0.06) || Math.random() < 0.5 * threeBetScale)) {
      return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.55) };
    }
    if (
      tier === 2 &&
      toCall <= bb * 4 &&
      eq > potOdds + need(0.14) &&
      Math.random() < 0.22 * threeBetScale
    ) {
      return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.42) };
    }
  }

  if (hand.legal.includes("CALL")) {
    const callBar =
      (callPenalty - 1) * 0.05 +
      (tier === 1 ? 0.09 : tier === 2 ? 0.055 : 0);
    if (eq >= potOdds + callBar) {
      return { type: "CALL" };
    }
    if (hand.legal.includes("FOLD")) {
      return { type: "FOLD" };
    }
    return null;
  }
  if (hand.legal.includes("FOLD")) {
    return { type: "FOLD" };
  }
  if (hand.legal.includes("RAISE")) {
    return { type: "RAISE", raiseTo: pickRaiseTo(hand, me, 0.42) };
  }
  return null;
}

export type { BotDecideContext } from "./play-context";
