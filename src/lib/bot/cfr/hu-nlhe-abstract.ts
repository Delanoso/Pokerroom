/**
 * Abstracted heads-up no-limit Hold'em for External-Sampling MCCFR.
 * Not full 52-card NLHE — bucketed cards + discrete bet sizes (research-style abstraction).
 */
import type { CfrGame } from "./types";
import { lookupBucketEquity } from "./equity-cache";

export const HU_HOLE_BUCKETS = 8;
export const HU_BOARD_BUCKETS = 8;
export const HU_ACTIONS = ["fold", "check_call", "bet_half", "bet_pot", "all_in"] as const;

const START_STACK = 200;
const SB = 1;
const BB = 2;
const MAX_RAISES_STREET = 3;

export type HuPhase =
  | "deal_hole"
  | "preflop"
  | "deal_flop"
  | "flop"
  | "deal_turn"
  | "turn"
  | "deal_river"
  | "river"
  | "showdown";

export type HuState = {
  phase: HuPhase;
  /** Remaining deck size (abstract: only for chance sampling). */
  deckSize: number;
  hole: [number, number] | null;
  board: number;
  pot: number;
  stacks: [number, number];
  streetCommit: [number, number];
  currentBet: number;
  toAct: 0 | 1;
  button: 0 | 1;
  raisesThisStreet: number;
  folded: [boolean, boolean];
  terminal: boolean;
  /** Total chips P0 put in (for utility). */
  invested: [number, number];
};

function clone(s: HuState): HuState {
  return { ...s, stacks: [...s.stacks] as [number, number], streetCommit: [...s.streetCommit] as [number, number], folded: [...s.folded] as [boolean, boolean], invested: [...s.invested] as [number, number] };
}

function postBlinds(): HuState {
  const s: HuState = {
    phase: "deal_hole",
    deckSize: 52,
    hole: null,
    board: 0,
    pot: 0,
    stacks: [START_STACK, START_STACK],
    streetCommit: [0, 0],
    currentBet: BB,
    toAct: 0,
    button: 0,
    raisesThisStreet: 0,
    folded: [false, false],
    terminal: false,
    invested: [0, 0],
  };
  const sb = Math.min(SB, s.stacks[0]);
  const bb = Math.min(BB, s.stacks[1]);
  s.stacks[0] -= sb;
  s.stacks[1] -= bb;
  s.streetCommit[0] = sb;
  s.streetCommit[1] = bb;
  s.pot = sb + bb;
  s.invested[0] = sb;
  s.invested[1] = bb;
  s.toAct = 0;
  return s;
}

function beginStreet(s: HuState, phase: HuPhase): HuState {
  const n = clone(s);
  n.phase = phase;
  n.streetCommit = [0, 0];
  n.currentBet = 0;
  n.raisesThisStreet = 0;
  n.toAct = n.button;
  return n;
}

function legalKinds(s: HuState): number[] {
  if (s.terminal || s.folded[0] || s.folded[1]) return [];
  const p = s.toAct;
  const opp = (1 - p) as 0 | 1;
  const toCall = s.currentBet - s.streetCommit[p];
  const out: number[] = [];

  if (toCall > 0) out.push(0);
  if (toCall === 0 || s.stacks[p] >= toCall) out.push(1);
  const potAfterCall = s.pot + toCall;
  const halfBet = Math.max(BB, Math.floor(potAfterCall * 0.5));
  const potBet = Math.max(BB, potAfterCall);
  const canBet = s.raisesThisStreet < MAX_RAISES_STREET && s.stacks[p] > toCall;
  if (canBet && s.stacks[p] >= toCall + halfBet) out.push(2);
  if (canBet && s.stacks[p] >= toCall + potBet) out.push(3);
  if (s.stacks[p] > 0) out.push(4);

  return [...new Set(out)];
}

function pay(s: HuState, player: 0 | 1, amount: number): void {
  const pay = Math.min(s.stacks[player], amount);
  s.stacks[player] -= pay;
  s.streetCommit[player] += pay;
  s.invested[player] += pay;
  s.pot += pay;
}

function applyAction(s: HuState, action: number): HuState {
  const n = clone(s);
  const p = n.toAct;
  const opp = (1 - p) as 0 | 1;
  const toCall = n.currentBet - n.streetCommit[p];

  if (action === 0) {
    n.folded[p] = true;
    n.terminal = true;
    return n;
  }

  if (action === 1) {
    if (toCall > 0) pay(n, p, toCall);
  } else if (action === 4) {
    pay(n, p, toCall + n.stacks[p]);
    n.currentBet = n.streetCommit[p];
  } else {
    const potAfter = n.pot + toCall;
    const raiseSize = action === 2 ? Math.max(BB, Math.floor(potAfter * 0.5)) : Math.max(BB, potAfter);
    const target = n.streetCommit[p] + toCall + raiseSize;
    pay(n, p, target - n.streetCommit[p]);
    n.currentBet = Math.max(n.currentBet, n.streetCommit[p]);
    n.raisesThisStreet += 1;
  }

  const matched = n.streetCommit[0] === n.currentBet && n.streetCommit[1] === n.currentBet;
  const bothAllIn = n.stacks[0] === 0 && n.stacks[1] === 0;

  if (matched || bothAllIn) {
    if (n.phase === "preflop") return { ...n, phase: "deal_flop" };
    if (n.phase === "flop") return { ...n, phase: "deal_turn" };
    if (n.phase === "turn") return { ...n, phase: "deal_river" };
    if (n.phase === "river") return { ...n, phase: "showdown", terminal: true };
  }

  if (n.stacks[opp] === 0 && n.streetCommit[opp] === n.currentBet) {
    if (n.phase === "preflop") return { ...n, phase: "deal_flop" };
    if (n.phase === "flop") return { ...n, phase: "deal_turn" };
    if (n.phase === "turn") return { ...n, phase: "deal_river" };
    return { ...n, phase: "showdown", terminal: true };
  }

  n.toAct = opp;
  return n;
}

function nextPhaseAfterDeal(s: HuState): HuState {
  if (s.phase === "deal_flop") return beginStreet(s, "flop");
  if (s.phase === "deal_turn") return beginStreet(s, "turn");
  if (s.phase === "deal_river") return beginStreet(s, "river");
  return s;
}

export function createHuNlheAbstractGame(equityTable: Float32Array): CfrGame<HuState> {
  return {
    numPlayers: 2,

    initialState(): HuState {
      return postBlinds();
    },

    isTerminal(s) {
      return s.terminal;
    },

    isChance(s) {
      return (
        s.phase === "deal_hole" ||
        s.phase === "deal_flop" ||
        s.phase === "deal_turn" ||
        s.phase === "deal_river"
      );
    },

    currentPlayer(s) {
      return s.toAct;
    },

    utility(s, player) {
      if (s.folded[0] && !s.folded[1]) {
        const gain = s.pot - s.invested[1];
        return player === 1 ? gain : -gain;
      }
      if (s.folded[1] && !s.folded[0]) {
        const gain = s.pot - s.invested[0];
        return player === 0 ? gain : -gain;
      }
      const h = s.hole!;
      const eq = lookupBucketEquity(equityTable, s.board, h[0], h[1], HU_HOLE_BUCKETS);
      const u0 = (eq - 0.5) * s.pot * 2;
      return player === 0 ? u0 : -u0;
    },

    chanceOutcomes(s) {
      if (s.phase === "deal_hole") {
        const outcomes: { probability: number; state: HuState }[] = [];
        const p = 1 / (HU_HOLE_BUCKETS * (HU_HOLE_BUCKETS - 1));
        for (let h0 = 0; h0 < HU_HOLE_BUCKETS; h0++) {
          for (let h1 = 0; h1 < HU_HOLE_BUCKETS; h1++) {
            if (h0 === h1) continue;
            outcomes.push({
              probability: p,
              state: { ...clone(s), hole: [h0, h1], phase: "preflop", toAct: 0 },
            });
          }
        }
        return outcomes;
      }

      const outcomes: { probability: number; state: HuState }[] = [];
      const boardCount = HU_BOARD_BUCKETS - 1;
      const p = 1 / boardCount;
      for (let b = 1; b < HU_BOARD_BUCKETS; b++) {
        outcomes.push({
          probability: p,
          state: nextPhaseAfterDeal({ ...clone(s), board: b }),
        });
      }
      return outcomes;
    },

    legalActions(s) {
      return legalKinds(s);
    },

    nextState(s, actionIndex) {
      const kinds = legalKinds(s);
      return applyAction(s, kinds[actionIndex]!);
    },

    informationSet(s, player) {
      const h = s.hole!;
      const hole = h[player];
      const facing = s.currentBet > s.streetCommit[player] ? 1 : 0;
      const spr = Math.floor((s.stacks[player] + s.streetCommit[player]) / Math.max(BB, s.pot));
      return [
        `p${player}`,
        s.phase,
        `b${s.board}`,
        `h${hole}`,
        `pot${Math.floor(s.pot / BB)}`,
        `cb${s.currentBet}`,
        `sc${s.streetCommit[player]}`,
        `f${facing}`,
        `spr${Math.min(30, spr)}`,
        `r${s.raisesThisStreet}`,
        `t${s.toAct === player ? 1 : 0}`,
      ].join("|");
    },

    actionCount(s) {
      return legalKinds(s).length;
    },

    actionLabel(_s, actionIndex) {
      return HU_ACTIONS[actionIndex] ?? "?";
    },
  };
}
