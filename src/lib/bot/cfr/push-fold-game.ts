/**
 * Tiny heads-up push/fold abstraction for offline CFR (not full NLHE).
 * Stack buckets in BB; hand strength 0–4 (preflop tier).
 */
import { averageStrategyUpdate, normalizeAverageStrategy, regretMatchingStrategy } from "./regret-matching";

export const STACK_BB_BUCKETS = [6, 8, 10, 12, 15] as const;
export const HAND_TIERS = 5;

/** Approximate all-in equity: heroTier vs villainTier (symmetric-ish chart). */
const TIER_EQUITY: number[][] = [
  [0.5, 0.42, 0.36, 0.3, 0.24],
  [0.58, 0.5, 0.43, 0.36, 0.3],
  [0.64, 0.57, 0.5, 0.43, 0.36],
  [0.7, 0.64, 0.57, 0.5, 0.43],
  [0.76, 0.7, 0.64, 0.57, 0.5],
];

export type PushFoldPolicy = {
  version: 1;
  iterations: number;
  /** key → [fold, shove] or [fold, call] probabilities */
  nodes: Record<string, number[]>;
};

function infoKey(role: "SB" | "BB", stackBb: number, tier: number, facing: "open" | "shove"): string {
  const stack = STACK_BB_BUCKETS.includes(stackBb as (typeof STACK_BB_BUCKETS)[number])
    ? stackBb
    : STACK_BB_BUCKETS.reduce((best, b) => (Math.abs(b - stackBb) < Math.abs(best - stackBb) ? b : best));
  return `${role}|${stack}|${tier}|${facing}`;
}

function sbShoveEv(stackBb: number, heroTier: number, villainTier: number, villainCalls: boolean): number {
  if (!villainCalls) return stackBb * 0.5; // win blinds / open
  const eq = TIER_EQUITY[heroTier]![villainTier] ?? 0.5;
  const pot = stackBb * 2;
  return eq * pot - (pot / 2);
}

function bbVsShoveEv(stackBb: number, heroTier: number, villainTier: number, call: boolean): number {
  if (!call) return -stackBb * 0.5;
  const eq = TIER_EQUITY[heroTier]![villainTier] ?? 0.5;
  const pot = stackBb * 2;
  return eq * pot - (pot / 2);
}

/**
 * One betting round: SB open (fold / shove), BB responds (fold / call), random villain tier.
 * CFR on SB and BB information sets separately (zero-sum, utility from SB perspective).
 */
export function trainPushFoldCfr(iterations: number): PushFoldPolicy {
  const regrets: Record<string, number[]> = {};
  const strategySum: Record<string, number[]> = {};

  const getRegrets = (key: string, n: number) => {
    if (!regrets[key]) regrets[key] = new Array(n).fill(0);
    return regrets[key]!;
  };
  const getSum = (key: string, n: number) => {
    if (!strategySum[key]) strategySum[key] = new Array(n).fill(0);
    return strategySum[key]!;
  };

  for (let it = 1; it <= iterations; it++) {
    const weight = it;
    for (const stackBb of STACK_BB_BUCKETS) {
      for (let heroTier = 0; heroTier < HAND_TIERS; heroTier++) {
        for (let villainTier = 0; villainTier < HAND_TIERS; villainTier++) {
          const pVillain = 1 / HAND_TIERS;

          // --- SB acts (fold / shove) ---
          const sbKey = infoKey("SB", stackBb, heroTier, "open");
          const sbReg = getRegrets(sbKey, 2);
          const sbStrat = regretMatchingStrategy(sbReg, 2);
          getSum(sbKey, 2);
          averageStrategyUpdate(getSum(sbKey, 2), sbStrat, weight);

          const sbFoldUtil = -0.5;
          let sbShoveUtil = 0;
          const bbKey = infoKey("BB", stackBb, villainTier, "shove");
          const bbReg = getRegrets(bbKey, 2);
          const bbStrat = regretMatchingStrategy(bbReg, 2);
          averageStrategyUpdate(getSum(bbKey, 2), bbStrat, weight);

          const bbFoldUtil = 0.5;
          const bbCallUtil = bbVsShoveEv(stackBb, villainTier, heroTier, true);
          sbShoveUtil =
            bbStrat[0]! * sbShoveEv(stackBb, heroTier, villainTier, false) +
            bbStrat[1]! * sbShoveEv(stackBb, heroTier, villainTier, true);

          const sbUtil = sbStrat[0]! * sbFoldUtil + sbStrat[1]! * sbShoveUtil;
          sbReg[0]! += pVillain * (sbFoldUtil - sbUtil);
          sbReg[1]! += pVillain * (sbShoveUtil - sbUtil);

          // --- BB faces shove (fold / call) — hero is BB with villainTier as SB shover ---
          const bbFacingKey = infoKey("BB", stackBb, villainTier, "shove");
          const bbFacingReg = getRegrets(bbFacingKey, 2);
          const bbFacingStrat = regretMatchingStrategy(bbFacingReg, 2);
          averageStrategyUpdate(getSum(bbFacingKey, 2), bbFacingStrat, weight);

          const utilFold = bbFoldUtil;
          const utilCall = bbCallUtil;
          const bbUtil = bbFacingStrat[0]! * utilFold + bbFacingStrat[1]! * utilCall;
          bbFacingReg[0]! += pVillain * (utilFold - bbUtil);
          bbFacingReg[1]! += pVillain * (utilCall - bbUtil);
        }
      }
    }
  }

  const nodes: Record<string, number[]> = {};
  for (const key of new Set([...Object.keys(strategySum)])) {
    nodes[key] = normalizeAverageStrategy([...strategySum[key]!]);
  }

  return { version: 1, iterations, nodes };
}

export function nearestStackBucket(stackBb: number): number {
  return STACK_BB_BUCKETS.reduce((best, b) =>
    Math.abs(b - stackBb) < Math.abs(best - stackBb) ? b : best,
  );
}

export function lookupPushFold(
  policy: PushFoldPolicy,
  role: "SB" | "BB",
  stackBb: number,
  tier: number,
  facing: "open" | "shove",
): number[] | null {
  const key = infoKey(role, nearestStackBucket(stackBb), Math.min(4, Math.max(0, tier)), facing);
  return policy.nodes[key] ?? null;
}
