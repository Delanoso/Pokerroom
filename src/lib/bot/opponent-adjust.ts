import type { OpponentProfile } from "./learning-store";

/** Derived table texture from seated opponents the bot has seen before. */
export type OpponentTexture = {
  /** >1 = play tighter (need more equity). */
  tightness: number;
  /** >1 = bluff / thin-value more (they over-fold). */
  bluffScale: number;
  /** >1 = call less marginal (they raise more). */
  callPenalty: number;
  sampleHands: number;
};

export function textureFromProfiles(profiles: OpponentProfile[]): OpponentTexture {
  if (profiles.length === 0) {
    return { tightness: 1, bluffScale: 1, callPenalty: 1, sampleHands: 0 };
  }

  let hands = 0;
  let vpip = 0;
  let pfr = 0;
  let faced = 0;
  let folds = 0;

  for (const p of profiles) {
    hands += p.handsObserved;
    vpip += p.vpipCount;
    pfr += p.pfrCount;
    faced += p.facedBet;
    folds += p.foldToBet;
  }

  const vpipRate = hands > 0 ? vpip / hands : 0.35;
  const pfrRate = hands > 0 ? pfr / Math.max(1, hands) : 0.15;
  const foldRate = faced > 0 ? folds / faced : 0.45;

  // Loose-aggressive table → tighten and call less
  let tightness = 1 + Math.max(0, vpipRate - 0.42) * 0.35 + Math.max(0, pfrRate - 0.18) * 0.4;
  // Over-folders → bluff / steal more, call down less
  let bluffScale = 1 + Math.max(0, foldRate - 0.52) * 0.65;
  let callPenalty = 1 + Math.max(0, pfrRate - 0.2) * 0.45;

  if (foldRate > 0.55 && faced >= 8) {
    tightness = Math.min(tightness, 0.9);
    bluffScale = Math.max(bluffScale, 1.38);
    callPenalty = Math.max(callPenalty, 1.24);
  }

  return {
    tightness: Math.min(1.28, tightness),
    bluffScale: Math.min(1.55, bluffScale),
    callPenalty: Math.min(1.42, callPenalty),
    sampleHands: hands,
  };
}
