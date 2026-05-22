/* eslint-disable @typescript-eslint/no-require-imports */
const { Hand } = require("pokersolver") as {
  Hand: {
    solve: (cards: string[], game?: string) => { rank: number; name: string; descr?: string };
  };
};

/** Standard hold'em: 9 hand categories, rank 1 (high card) … 9 (straight flush). */
const MAX_HAND_RANK = 9;

export type HandRankDisplay = {
  label: string;
  /** 0–100 fill for strength bar */
  strengthPct: number;
  tone: "weak" | "mid" | "strong" | "monster";
};

const RANK_VALUES: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function cardRank(code: string): number {
  return RANK_VALUES[code.slice(0, -1)] ?? 0;
}

function toneFromCategoryRank(rank: number): HandRankDisplay["tone"] {
  if (rank >= 7) return "monster";
  if (rank >= 5) return "strong";
  if (rank >= 3) return "mid";
  return "weak";
}

function strengthPctFromCategoryRank(rank: number): number {
  return Math.round((Math.max(1, Math.min(MAX_HAND_RANK, rank)) / MAX_HAND_RANK) * 100);
}

function preflopHoleDisplay(hole: [string, string]): HandRankDisplay {
  const r1 = cardRank(hole[0]);
  const r2 = cardRank(hole[1]);
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const suited = hole[0].slice(-1) === hole[1].slice(-1);
  const rankName = (r: number) =>
    ({ 14: "Ace", 13: "King", 12: "Queen", 11: "Jack", 10: "Ten" } as Record<number, string>)[r] ??
    String(r);

  if (r1 === r2) {
    const pct = 28 + Math.round((high / 14) * 22);
    return {
      label: `Pocket ${rankName(r1)}s`,
      strengthPct: pct,
      tone: high >= 10 ? "strong" : high >= 7 ? "mid" : "weak",
    };
  }

  const gap = high - low;
  const pct = Math.min(
    72,
    Math.round((high / 14) * 38 + (suited ? 10 : 0) + (gap <= 2 ? 6 : 0)),
  );
  const highLabel = rankName(high);
  if (suited && gap <= 1) {
    return { label: `Suited ${highLabel}-${rankName(low)}`, strengthPct: pct, tone: pct >= 50 ? "mid" : "weak" };
  }
  if (suited) {
    return { label: `Suited, ${highLabel} high`, strengthPct: pct, tone: pct >= 45 ? "mid" : "weak" };
  }
  return { label: `${highLabel} high`, strengthPct: pct, tone: pct >= 48 ? "mid" : "weak" };
}

/**
 * Best made hand (or preflop holding) for the viewer HUD below their seat.
 */
export function evaluateHandRankDisplay(
  hole: [string, string],
  board: string[],
): HandRankDisplay | null {
  if (!hole[0] || !hole[1]) return null;

  if (board.length >= 3) {
    try {
      const h = Hand.solve([...hole, ...board], "standard");
      return {
        label: h.name,
        strengthPct: strengthPctFromCategoryRank(h.rank),
        tone: toneFromCategoryRank(h.rank),
      };
    } catch {
      return null;
    }
  }

  if (board.length === 0) {
    return preflopHoleDisplay(hole);
  }

  return null;
}

export function handRankBarColor(tone: HandRankDisplay["tone"]): string {
  switch (tone) {
    case "monster":
      return "bg-gradient-to-r from-amber-500 to-amber-300";
    case "strong":
      return "bg-gradient-to-r from-emerald-600 to-emerald-400";
    case "mid":
      return "bg-gradient-to-r from-sky-600 to-sky-400";
    default:
      return "bg-gradient-to-r from-zinc-500 to-zinc-400";
  }
}
