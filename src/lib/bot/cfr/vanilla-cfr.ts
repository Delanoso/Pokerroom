import type { CfrGame } from "./types";
import { RegretTable } from "./regret-table";

/**
 * Vanilla CFR (full tree traversal) for small games like Leduc.
 * Both players update regrets each iteration.
 */
export function trainVanillaCfr<State>(
  game: CfrGame<State>,
  iterations: number,
  onProgress?: (done: number, total: number) => void,
): RegretTable {
  const table = new RegretTable();

  function cfr(state: State, reach: [number, number], weight: number): number {
    if (game.isTerminal(state)) {
      return game.utility(state, 0);
    }

    if (game.isChance(state)) {
      let v = 0;
      for (const o of game.chanceOutcomes(state)) {
        v += o.probability * cfr(o.state, reach, weight * o.probability);
      }
      return v;
    }

    const player = game.currentPlayer(state);
    const info = game.informationSet(state, player);
    const actions = game.legalActions(state);
    const n = actions.length;
    const strat = table.getStrategy(info, n);

    const utils = new Array<number>(n).fill(0);
    for (let a = 0; a < n; a++) {
      const next = game.nextState(state, actions[a]!);
      const r: [number, number] = [reach[0], reach[1]];
      r[player] *= strat[a]!;
      utils[a] = cfr(next, r, weight);
    }

    let nodeUtil = 0;
    for (let a = 0; a < n; a++) nodeUtil += strat[a]! * utils[a]!;

    const opp = (1 - player) as 0 | 1;
    table.applyRegretMatch(info, utils, nodeUtil, weight * reach[opp]);

    return nodeUtil;
  }

  for (let t = 1; t <= iterations; t++) {
    cfr(game.initialState(), [1, 1], 1);
    if (onProgress && t % Math.max(1, Math.floor(iterations / 20)) === 0) {
      onProgress(t, iterations);
    }
  }

  return table;
}
