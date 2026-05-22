/** Counterfactual regret matching — pick action probabilities from cumulative regrets. */
export function regretMatchingStrategy(
  regrets: number[],
  actionCount: number,
): number[] {
  const positive = new Array<number>(actionCount).fill(0);
  let sum = 0;
  for (let a = 0; a < actionCount; a++) {
    const r = regrets[a] ?? 0;
    if (r > 0) {
      positive[a] = r;
      sum += r;
    }
  }
  if (sum <= 0) {
    return new Array<number>(actionCount).fill(1 / actionCount);
  }
  return positive.map((p) => p / sum);
}

export function averageStrategyUpdate(
  avg: number[],
  current: number[],
  weight: number,
): void {
  for (let a = 0; a < current.length; a++) {
    avg[a] = (avg[a] ?? 0) + weight * (current[a] ?? 0);
  }
}

export function normalizeAverageStrategy(avg: number[]): number[] {
  const sum = avg.reduce((s, x) => s + x, 0);
  if (sum <= 0) return avg.map(() => 1 / avg.length);
  return avg.map((x) => x / sum);
}
