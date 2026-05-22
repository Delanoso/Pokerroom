/** Canonical hole keys: pairs `AA`, suited `AKs` (high rank first), offsuit `AKo`. */

const RANKS = "23456789TJQKA";

export function rankIndex(r: string): number {
  const i = RANKS.indexOf(r);
  return i >= 0 ? i : -1;
}

export function canonicalHoleKey(hole: [string, string]): string {
  const r1 = hole[0]![0]!;
  const r2 = hole[1]![0]!;
  if (r1 === r2) return `${r1}${r2}`;
  const hi = rankIndex(r1) >= rankIndex(r2) ? r1 : r2;
  const lo = rankIndex(r1) >= rankIndex(r2) ? r2 : r1;
  const s1 = hole[0]![1]!;
  const s2 = hole[1]![1]!;
  const hiSuit = rankIndex(r1) >= rankIndex(r2) ? s1 : s2;
  const loSuit = rankIndex(r1) >= rankIndex(r2) ? s2 : s1;
  const suited = hiSuit === loSuit;
  return `${hi}${lo}${suited ? "s" : "o"}`;
}

/** 0 = trash, 1 = marginal/green, 2 = speculative/orange, 3 = strong/yellow, 4 = premium/pink */
const PREMIUM = new Set<string>([
  "AA",
  "KK",
  "QQ",
  "AKs",
  "AKo",
]);

const STRONG = new Set<string>([
  "JJ",
  "TT",
  "99",
  "AQs",
  "AJs",
  "ATs",
  "KQs",
]);

const SPECULATIVE = new Set<string>([
  "A5s",
  "A4s",
  "KTs",
  "QTs",
  "KJs",
  "KJo",
  "QJs",
  "QJo",
  "JTs",
  "JTo",
  "KQo",
  "AJo",
]);

/** Chart “green”: wide suited + mid pairs + listed offsuit — built + explicit. */
const MARGINAL_EXPLICIT = new Set<string>([
  "88",
  "77",
  "66",
  "55",
  "44",
  "33",
  "22",
  "A9s",
  "A8s",
  "A7s",
  "A6s",
  "A3s",
  "A2s",
  "K9s",
  "K8s",
  "K7s",
  "K6s",
  "K5s",
  "K4s",
  "K3s",
  "K2s",
  "Q9s",
  "Q8s",
  "Q7s",
  "Q6s",
  "Q5s",
  "Q4s",
  "Q3s",
  "Q2s",
  "J9s",
  "J8s",
  "J7s",
  "J6s",
  "J5s",
  "J4s",
  "J3s",
  "J2s",
  "T9s",
  "98s",
  "87s",
  "76s",
  "65s",
  "54s",
  "T8s",
  "T7s",
  "T6s",
  "97s",
  "96s",
  "86s",
  "85s",
  "75s",
  "74s",
  "64s",
  "63s",
  "53s",
  "43s",
  "ATo",
  "A9o",
  "A8o",
  "A7o",
  "A6o",
  "A5o",
  "A4o",
  "KTo",
  "K9o",
  "K8o",
  "QTo",
  "Q9o",
  "J9o",
  "T9o",
  "98o",
]);

function marginalSuitedHeuristic(key: string): boolean {
  if (!key.endsWith("s") || key.length !== 3) return false;
  const hi = key[0]!;
  const lo = key[1]!;
  const gap = rankIndex(hi) - rankIndex(lo);
  if (gap <= 0) return false;
  // Suited wheel / low connectors not already in speculative
  if (hi === "A") return rankIndex(lo) <= rankIndex("9"); // A9s+ explicit; A8s- covered elsewhere
  if (gap === 1 && rankIndex(lo) >= rankIndex("4")) return true; // connected 54s+
  if (gap === 2 && rankIndex(hi) >= rankIndex("6") && rankIndex(lo) >= rankIndex("4")) return true; // one-gappers 64s+
  return false;
}

export function preflopTier(hole: [string, string]): number {
  const k = canonicalHoleKey(hole);
  if (PREMIUM.has(k)) return 4;
  if (STRONG.has(k)) return 3;
  if (SPECULATIVE.has(k)) return 2;
  if (MARGINAL_EXPLICIT.has(k)) return 1;
  if (marginalSuitedHeuristic(k)) return 1;
  return 0;
}
