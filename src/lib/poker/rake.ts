/**
 * Cash-game pot rake: percent of pot (basis points) with optional per-hand cap.
 * `rakeCapChips === 0` means no cap (only the percentage applies).
 */
export function computePotRake(potChips: number, rakePercentBps: number, rakeCapChips: number): number {
  if (potChips <= 0 || rakePercentBps <= 0) return 0;
  let r = Math.floor((potChips * rakePercentBps) / 10_000);
  if (rakeCapChips > 0) {
    r = Math.min(r, rakeCapChips);
  }
  return Math.min(r, potChips);
}

/** Scale non-negative slice amounts so they sum to `newTotal` (integer-safe). */
export function scaleSliceAmounts(amounts: number[], oldTotal: number, newTotal: number): number[] {
  if (amounts.length === 0) return [];
  if (oldTotal <= 0) return amounts.map(() => 0);
  const scaled: number[] = [];
  let acc = 0;
  for (let i = 0; i < amounts.length; i++) {
    const a = amounts[i]!;
    const isLast = i === amounts.length - 1;
    const v = isLast ? newTotal - acc : Math.floor((a * newTotal) / oldTotal);
    scaled.push(Math.max(0, v));
    acc += scaled[i]!;
  }
  return scaled;
}
