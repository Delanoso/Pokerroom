import { createRequire } from "node:module";
import { ALL_CARDS } from "@/lib/poker/cards";
import { canonicalHoleKey } from "../preflop-chart";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: {
    solve: (cards: string[], game?: string) => { rank: number };
  };
};

/** Map canonical hole key → strength bucket 0..7 */
export function holeBucketFromCards(hole: [string, string]): number {
  const key = canonicalHoleKey(hole);
  const r0 = hole[0]![0]!;
  const r1 = hole[1]![0]!;
  const suited = hole[0]![1] === hole[1]![1];
  const ranks = "23456789TJQKA";
  const i0 = ranks.indexOf(r0);
  const i1 = ranks.indexOf(r1);
  if (r0 === r1) {
    if (i0 >= 10) return 7;
    if (i0 >= 7) return 6;
    if (i0 >= 4) return 5;
    return 4;
  }
  const hi = Math.max(i0, i1);
  const lo = Math.min(i0, i1);
  if (hi >= 12 && lo >= 9) return suited ? 7 : 6;
  if (hi >= 11 && lo >= 8) return suited ? 6 : 5;
  if (suited && hi - lo <= 2) return 4;
  if (suited) return 3;
  if (hi >= 10) return 2;
  return lo <= 4 ? 0 : 1;
}

/** Board texture bucket 0..7 from 0–5 board cards. */
export function boardBucketFromCards(board: string[]): number {
  if (board.length === 0) return 0;
  const ranks = board.map((c) => "23456789TJQKA".indexOf(c[0]!));
  const suits = board.map((c) => c[1]!);
  const maxR = Math.max(...ranks);
  const paired = new Set(ranks).size < ranks.length;
  const suitCounts = suits.reduce(
    (acc, s) => {
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const maxSuit = Math.max(...Object.values(suitCounts));
  if (maxSuit >= 3) return 6;
  if (paired) return 5;
  if (maxR >= 11) return 7;
  if (maxR <= 6) return 1;
  const sorted = [...ranks].sort((a, b) => a - b);
  const span = sorted[sorted.length - 1]! - sorted[0]!;
  if (span <= 4 && board.length >= 3) return 4;
  return 2;
}

function sampleHoleForBucket(bucket: number, exclude: Set<string>): [string, string] | null {
  const deck = ALL_CARDS.filter((c) => !exclude.has(c));
  for (let t = 0; t < 400; t++) {
    const i = Math.floor(Math.random() * deck.length);
    let j = Math.floor(Math.random() * (deck.length - 1));
    if (j >= i) j++;
    const h: [string, string] = [deck[i]!, deck[j]!];
    if (holeBucketFromCards(h) === bucket) return h;
  }
  return null;
}

function sampleBoardForBucket(bucket: number, exclude: Set<string>, len: number): string[] | null {
  const deck = ALL_CARDS.filter((c) => !exclude.has(c));
  for (let t = 0; t < 500; t++) {
    const cards: string[] = [];
    const used = new Set(exclude);
    for (let k = 0; k < len; k++) {
      const avail = deck.filter((c) => !used.has(c));
      if (avail.length === 0) break;
      const c = avail[Math.floor(Math.random() * avail.length)]!;
      cards.push(c);
      used.add(c);
    }
    if (cards.length === len && boardBucketFromCards(cards) === bucket) return cards;
  }
  return null;
}

/** P0 equity at showdown (0..1) for abstract buckets. */
export function buildBucketEquityTable(
  holeBuckets: number,
  boardBuckets: number,
  mcPerCell: number,
): Float32Array {
  const table = new Float32Array(boardBuckets * holeBuckets * holeBuckets);
  for (let b = 0; b < boardBuckets; b++) {
    for (let h0 = 0; h0 < holeBuckets; h0++) {
      for (let h1 = 0; h1 < holeBuckets; h1++) {
        let wins = 0;
        let ties = 0;
        for (let it = 0; it < mcPerCell; it++) {
          const ex = new Set<string>();
          const hole0 = sampleHoleForBucket(h0, ex);
          if (!hole0) continue;
          ex.add(hole0[0]!);
          ex.add(hole0[1]!);
          const hole1 = sampleHoleForBucket(h1, ex);
          if (!hole1) continue;
          ex.add(hole1[0]!);
          ex.add(hole1[1]!);
          const board =
            b === 0 ? [] : sampleBoardForBucket(b, ex, 5) ?? sampleBoardForBucket(b, ex, 3);
          if (!board) continue;
          const runout = board.length >= 5 ? board : board;
          const b5 =
            runout.length >= 5
              ? runout
              : (() => {
                  const d = ALL_CARDS.filter((c) => !ex.has(c) && !runout.includes(c));
                  const extra = [...runout];
                  while (extra.length < 5 && d.length) {
                    const c = d.splice(Math.floor(Math.random() * d.length), 1)[0]!;
                    extra.push(c);
                  }
                  return extra;
                })();
          if (b5.length < 5) continue;
          const s0 = Hand.solve([...hole0, ...b5], "standard").rank;
          const s1 = Hand.solve([...hole1, ...b5], "standard").rank;
          if (s0 > s1) wins++;
          else if (s0 === s1) ties += 0.5;
        }
        const eq = mcPerCell > 0 ? (wins + ties) / mcPerCell : 0.5;
        table[b * holeBuckets * holeBuckets + h0 * holeBuckets + h1] = eq;
      }
    }
  }
  return table;
}

export function lookupBucketEquity(
  table: Float32Array,
  boardBucket: number,
  hole0: number,
  hole1: number,
  holeBuckets: number,
): number {
  return table[boardBucket * holeBuckets * holeBuckets + hole0 * holeBuckets + hole1] ?? 0.5;
}
