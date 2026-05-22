import type { CfrGame } from "./types";
import { RegretTable } from "./regret-table";

/**
 * External-sampling Monte Carlo CFR (Lanctot et al.).
 * Standard for large imperfect-information games (poker research).
 * One traverser per iteration; samples opponent + chance moves.
 */
export function trainExternalSamplingMccfr<State>(
  game: CfrGame<State>,
  iterations: number,
  onProgress?: (done: number, total: number) => void,
): RegretTable {
  const table = new RegretTable();

  function mccfr(state: State, traverser: 0 | 1, reachTraverser: number): number {
    if (game.isTerminal(state)) {
      const u = game.utility(state, traverser);
      return u;
    }

    if (game.isChance(state)) {
      const outcomes = game.chanceOutcomes(state);
      const r = Math.random();
      let acc = 0;
      for (const o of outcomes) {
        acc += o.probability;
        if (r <= acc) {
          return mccfr(o.state, traverser, reachTraverser);
        }
      }
      return mccfr(outcomes[outcomes.length - 1]!.state, traverser, reachTraverser);
    }

    const player = game.currentPlayer(state);
    const actions = game.legalActions(state);
    const n = actions.length;
    const info = game.informationSet(state, player);
    const strat = table.getStrategy(info, n);

    if (player !== traverser) {
      const a = sampleAction(strat);
      return mccfr(game.nextState(state, actions[a]!), traverser, reachTraverser);
    }

    const utils = new Array<number>(n).fill(0);
    for (let a = 0; a < n; a++) {
      utils[a] = mccfr(game.nextState(state, actions[a]!), traverser, reachTraverser * strat[a]!);
    }
    let nodeUtil = 0;
    for (let a = 0; a < n; a++) nodeUtil += strat[a]! * utils[a]!;

    table.applyRegretMatch(info, utils, nodeUtil, reachTraverser);

    return nodeUtil;
  }

  for (let t = 1; t <= iterations; t++) {
    mccfr(game.initialState(), 0, 1);
    mccfr(game.initialState(), 1, 1);
    if (onProgress && t % Math.max(1, Math.floor(iterations / 20)) === 0) {
      onProgress(t, iterations);
    }
  }

  return table;
}

function sampleAction(probs: number[]): number {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i]!;
    if (r <= acc) return i;
  }
  return probs.length - 1;
}
