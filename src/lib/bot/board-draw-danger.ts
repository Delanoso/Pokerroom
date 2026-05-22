const RANKS = "23456789TJQKA";

function rankIdx(card: string): number {
  return RANKS.indexOf(card[0]!);
}

function suitOf(card: string): string {
  return card[1]!;
}

/** 0–1: how scary flush completions are for villains (board texture). */
function boardFlushThreat(board: string[]): number {
  if (board.length < 3) return 0;
  const counts: Record<string, number> = {};
  for (const c of board) {
    const s = suitOf(c);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const max = Math.max(...Object.values(counts));
  if (max >= 4) return 1;
  if (max === 3) return 0.72;
  if (max === 2 && board.length >= 3) return 0.22;
  return 0;
}

/** All rank indices that can complete some 5-card straight (wheel uses ace low = -1). */
function straightWindowHits(ranks: number[]): number {
  const set = new Set(ranks);
  let best = 0;
  for (let low = 0; low <= 8; low++) {
    const window: number[] = [low, low + 1, low + 2, low + 3, low + 4];
    let hits = window.filter((r) => set.has(r)).length;
    if (low === 0 && set.has(12)) hits += 1; // wheel ace
    best = Math.max(best, hits);
  }
  return best;
}

/** 0–1: connected board / one-card straight possibilities. */
function boardStraightThreat(board: string[]): number {
  if (board.length < 3) return 0;
  const ranks = board.map(rankIdx).filter((r) => r >= 0);
  const hits = straightWindowHits(ranks);
  if (hits >= 4) return 0.95;
  if (hits === 3) {
    const sorted = [...new Set(ranks)].sort((a, b) => a - b);
    const span = sorted[sorted.length - 1]! - sorted[0]!;
    return span <= 4 ? 0.68 : 0.45;
  }
  if (board.length >= 3 && hits === 2) {
    const sorted = [...ranks].sort((a, b) => a - b);
    if (sorted[sorted.length - 1]! - sorted[0]! <= 3) return 0.28;
  }
  return 0;
}

function heroFlushMitigation(
  board: string[],
  hole: [string, string],
): { made: boolean; draw: boolean; blocker: number } {
  const counts: Record<string, number> = {};
  for (const c of board) {
    const s = suitOf(c);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const flushSuit = Object.entries(counts).find(([, n]) => n >= 3)?.[0];
  if (!flushSuit) return { made: false, draw: false, blocker: 0 };

  const onBoard = counts[flushSuit] ?? 0;
  const heroSuit = [hole[0], hole[1]].filter((c) => suitOf(c) === flushSuit);
  if (onBoard >= 4) {
    return { made: heroSuit.length >= 1, draw: false, blocker: heroSuit.length ? 0.4 : 0 };
  }
  if (heroSuit.length === 2) {
    return { made: onBoard >= 3, draw: onBoard === 3, blocker: 0.35 };
  }
  if (heroSuit.length === 1) {
    const r = rankIdx(heroSuit[0]!);
    const blocker = r >= 11 ? 0.45 : r >= 9 ? 0.28 : 0.12;
    return { made: false, draw: onBoard === 3, blocker };
  }
  return { made: false, draw: false, blocker: 0 };
}

function heroStraightMitigation(board: string[], hole: [string, string]): number {
  const ranks = [...board.map(rankIdx), rankIdx(hole[0]!), rankIdx(hole[1]!)].filter((r) => r >= 0);
  const hits = straightWindowHits(ranks);
  if (hits >= 5) return 0.85;
  if (hits >= 4) return 0.5;
  if (hits >= 3) return 0.25;
  return 0;
}

export type BoardDrawDanger = {
  flushThreat: number;
  straightThreat: number;
  /** Scales 0–1 with bet size (larger bets → higher). */
  betPressure: number;
  /** Added to required equity to call. */
  callEquityPremium: number;
  /** Tightens fold threshold (fold more). */
  foldEquityPenalty: number;
};

/**
 * Postflop: extra caution vs large bets when the board can complete flushes or straights.
 * Hero made hands / draws / blockers reduce the scare factor.
 */
export function assessBoardDrawDanger(
  board: string[],
  hole: [string, string],
  toCall: number,
  pot: number,
): BoardDrawDanger {
  const none = {
    flushThreat: 0,
    straightThreat: 0,
    betPressure: 0,
    callEquityPremium: 0,
    foldEquityPenalty: 0,
  };
  if (board.length < 3 || toCall <= 0) return none;

  const flushMit = heroFlushMitigation(board, hole);
  const straightMit = heroStraightMitigation(board, hole);

  let flushThreat = boardFlushThreat(board);
  let straightThreat = boardStraightThreat(board);

  if (flushMit.made) flushThreat *= 0.15;
  else if (flushMit.draw) flushThreat *= 0.45;
  else flushThreat = Math.max(0, flushThreat - flushMit.blocker);

  straightThreat = Math.max(0, straightThreat - straightMit);

  const betRatio = toCall / Math.max(pot + toCall, 1);
  const betPressure = Math.min(1, Math.max(0, (betRatio - 0.33) / 0.52));

  const combined = Math.min(1, flushThreat * 0.55 + straightThreat * 0.5);
  const callEquityPremium = Math.min(0.22, combined * 0.2 * betPressure);
  const foldEquityPenalty = Math.min(0.18, combined * 0.16 * betPressure);

  return {
    flushThreat,
    straightThreat,
    betPressure,
    callEquityPremium,
    foldEquityPenalty,
  };
}
