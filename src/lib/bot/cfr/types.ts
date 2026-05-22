/** Two-player zero-sum extensive-form game for CFR / MCCFR. */
export interface CfrGame<State> {
  readonly numPlayers: 2;
  initialState(): State;
  isTerminal(state: State): boolean;
  /** Chance node (deal cards, etc.). */
  isChance(state: State): boolean;
  /** Acting player 0 | 1; ignored at chance/terminal. */
  currentPlayer(state: State): 0 | 1;
  /** Payoff for `player` at terminal (zero-sum: u0 = -u1). */
  utility(state: State, player: 0 | 1): number;
  /** Chance branches with probabilities summing to 1. */
  chanceOutcomes(state: State): { probability: number; state: State }[];
  /** Legal action indices 0 .. n-1. */
  legalActions(state: State): number[];
  nextState(state: State, actionIndex: number): State;
  /** Imperfect-information set id for `player`. */
  informationSet(state: State, player: 0 | 1): string;
  actionCount(state: State): number;
  /** Human-readable action labels (logging). */
  actionLabel?(state: State, actionIndex: number): string;
}

export type CfrPolicy = {
  version: 2;
  algorithm: "external_sampling_mccfr" | "vanilla_cfr";
  game: string;
  iterations: number;
  /** infoSet → probability per action index */
  nodes: Record<string, number[]>;
};
