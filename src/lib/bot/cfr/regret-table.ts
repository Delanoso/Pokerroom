import { averageStrategyUpdate, normalizeAverageStrategy, regretMatchingStrategy } from "./regret-matching";

/** Per–information-set regrets and average strategy (CFR storage). */
export class RegretTable {
  private regrets = new Map<string, number[]>();
  private strategySum = new Map<string, number[]>();

  ensure(infoSet: string, actionCount: number): void {
    if (!this.regrets.has(infoSet)) {
      this.regrets.set(infoSet, new Array(actionCount).fill(0));
      this.strategySum.set(infoSet, new Array(actionCount).fill(0));
    }
  }

  getStrategy(infoSet: string, actionCount: number): number[] {
    this.ensure(infoSet, actionCount);
    return regretMatchingStrategy(this.regrets.get(infoSet)!, actionCount);
  }

  applyRegretMatch(
    infoSet: string,
    actionUtilities: number[],
    nodeUtility: number,
    weight: number,
  ): void {
    const n = actionUtilities.length;
    this.ensure(infoSet, n);
    const reg = this.regrets.get(infoSet)!;
    for (let a = 0; a < n; a++) {
      reg[a]! += weight * ((actionUtilities[a] ?? 0) - nodeUtility);
    }
    const strat = regretMatchingStrategy(reg, n);
    averageStrategyUpdate(this.strategySum.get(infoSet)!, strat, weight);
  }

  toPolicy(): Record<string, number[]> {
    const nodes: Record<string, number[]> = {};
    for (const [key, sum] of this.strategySum) {
      nodes[key] = normalizeAverageStrategy([...sum]);
    }
    return nodes;
  }

  infoSetCount(): number {
    return this.strategySum.size;
  }
}
