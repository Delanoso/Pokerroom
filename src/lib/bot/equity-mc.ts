import { createRequire } from "node:module";
import { ALL_CARDS } from "@/lib/poker/cards";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: {
    solve: (cards: string[], game?: string, canDisqualify?: boolean) => { rank: number; name: string };
  };
};

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/**
 * Monte Carlo equity vs one random opponent hole, with random runout to the river.
 * Multiway: exponent scales equity down (tournament / conservative ⇒ stronger discount).
 */
export type EquityMcOpts = {
  multiwayExponent?: number;
  /** Multiply final equity (slightly <1 = more pessimistic vs field). */
  conservativeTrim?: number;
};

export function equityVsRandomOneOpponent(
  myHole: [string, string],
  board: string[],
  iterations: number,
  aliveCount: number,
  opts?: EquityMcOpts,
): number {
  const known = new Set<string>([myHole[0]!, myHole[1]!, ...board]);
  let wins = 0;
  let ties = 0;

  for (let it = 0; it < iterations; it++) {
    const deck = ALL_CARDS.filter((c) => !known.has(c));
    shuffleInPlace(deck);
    let idx = 0;
    const v1 = deck[idx++]!;
    const v2 = deck[idx++]!;
    const runout = [...board];
    while (runout.length < 5) {
      runout.push(deck[idx++]!);
    }
    const mine = Hand.solve([...myHole, ...runout], "standard");
    const villain = Hand.solve([v1, v2, ...runout], "standard");
    if (mine.rank > villain.rank) wins++;
    else if (mine.rank === villain.rank) ties += 0.5;
  }

  let eq = (wins + ties) / iterations;
  const exp = opts?.multiwayExponent ?? 0.22;
  if (aliveCount > 2) {
    eq *= Math.pow(aliveCount - 1, -exp);
  }
  if (opts?.conservativeTrim !== undefined) {
    eq *= opts.conservativeTrim;
  }
  return eq;
}
