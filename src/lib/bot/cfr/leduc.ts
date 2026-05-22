/**
 * Leduc Hold'em (standard CFR benchmark).
 * 6 cards: J,Q,K × two suits. One private card each, one public card, two betting rounds.
 * Limit betting: bet 2 chips, raise to 4 total per round, max 2 raises per round.
 */
import type { CfrGame } from "./types";

const CARDS = ["J1", "J2", "Q1", "Q2", "K1", "K2"] as const;
type Card = (typeof CARDS)[number];

const RANK: Record<string, number> = { J: 0, Q: 1, K: 2 };

export type LeducState = {
  deck: Card[];
  hole: [Card | null, Card | null];
  board: Card | null;
  pot: number;
  /** Chips each player still has behind (not in pot). */
  stacks: [number, number];
  /** Chips committed this betting round per player. */
  roundCommit: [number, number];
  /** Current wager level this round (both must match to continue). */
  wager: number;
  round: 0 | 1 | 2;
  toAct: 0 | 1;
  raisesThisRound: number;
  /** First actor preflop is P0; postflop first actor is last aggressor or P0. */
  lastAggressor: 0 | 1;
  folded: [boolean, boolean];
  terminal: boolean;
  /** Set when deck exhausted for deal. */
  phase: "deal_hole" | "bet1" | "deal_board" | "bet2" | "showdown";
};

const START_STACK = 100;
const ANTE = 1;
const BET = 2;
const MAX_RAISES = 2;

function rankOf(c: Card): number {
  return RANK[c[0]!]!;
}

function showdownUtility(hole: [Card, Card], board: Card): number {
  const r0 = rankOf(hole[0]);
  const r1 = rankOf(hole[1]);
  const rb = rankOf(board);
  const s0 = hole[0][1] === board[1];
  const s1 = hole[1][1] === board[1];

  const score = (priv: number, suited: boolean) => {
    if (priv === rb) return 100 + priv * 10 + (suited ? 1 : 0);
    return priv;
  };
  const v0 = score(r0, s0);
  const v1 = score(r1, s1);
  if (v0 > v1) return 1;
  if (v1 > v0) return -1;
  return 0;
}

function freshDeck(): Card[] {
  return [...CARDS];
}

function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

function initialBettingState(base: LeducState): LeducState {
  return {
    ...base,
    roundCommit: [0, 0],
    wager: 0,
    raisesThisRound: 0,
    phase: base.round === 0 ? "bet1" : "bet2",
    toAct: base.lastAggressor,
  };
}

function legalActionKinds(state: LeducState): ("fold" | "call" | "raise")[] {
  if (state.terminal || state.folded[0] || state.folded[1]) return [];
  const p = state.toAct;
  const opp = (1 - p) as 0 | 1;
  const toMatch = state.wager - state.roundCommit[p];
  const out: ("fold" | "call" | "raise")[] = [];
  if (toMatch > 0) out.push("fold");
  if (toMatch > 0 && state.stacks[p] >= toMatch) out.push("call");
  else if (toMatch === 0) out.push("call"); // check
  const canRaise =
    state.raisesThisRound < MAX_RAISES &&
    state.stacks[p] >= toMatch + BET &&
    (state.wager === 0 || state.roundCommit[opp] > 0 || toMatch > 0);
  if (canRaise) out.push("raise");
  return out;
}

function cloneLeduc(state: LeducState): LeducState {
  return {
    ...state,
    deck: [...state.deck],
    hole: [...state.hole] as [Card | null, Card | null],
    stacks: [...state.stacks] as [number, number],
    roundCommit: [...state.roundCommit] as [number, number],
    folded: [...state.folded] as [boolean, boolean],
  };
}

function applyAction(state: LeducState, kind: "fold" | "call" | "raise"): LeducState {
  const p = state.toAct;
  const opp = (1 - p) as 0 | 1;
  const s = cloneLeduc(state);

  if (kind === "fold") {
    s.folded[p] = true;
    s.terminal = true;
    return s;
  }

  const toMatch = s.wager - s.roundCommit[p];
  if (kind === "call") {
    const pay = Math.min(s.stacks[p], toMatch);
    s.stacks[p] -= pay;
    s.roundCommit[p] += pay;
    s.pot += pay;
  } else {
    const target = s.wager + BET;
    const pay = Math.min(s.stacks[p], target - s.roundCommit[p]);
    s.stacks[p] -= pay;
    s.roundCommit[p] += pay;
    s.pot += pay;
    s.wager = target;
    s.raisesThisRound += 1;
    s.lastAggressor = p;
  }

  if (s.roundCommit[0] === s.wager && s.roundCommit[1] === s.wager) {
    if (s.round === 0) {
      return { ...s, round: 1, phase: "deal_board", deck: s.deck };
    }
    return { ...s, phase: "showdown", terminal: true };
  }

  s.toAct = opp;
  return s;
}

export const leducGame: CfrGame<LeducState> = {
  numPlayers: 2,

  initialState(): LeducState {
    return {
      deck: shuffleDeck(freshDeck()),
      hole: [null, null],
      board: null,
      pot: ANTE * 2,
      stacks: [START_STACK - ANTE, START_STACK - ANTE],
      roundCommit: [0, 0],
      wager: 0,
      round: 0,
      toAct: 0,
      raisesThisRound: 0,
      lastAggressor: 0,
      folded: [false, false],
      terminal: false,
      phase: "deal_hole",
    };
  },

  isTerminal(s) {
    return s.terminal;
  },

  isChance(s) {
    return s.phase === "deal_hole" || s.phase === "deal_board";
  },

  currentPlayer(s) {
    return s.toAct;
  },

  utility(s, player) {
    if (s.folded[0] && !s.folded[1]) return player === 1 ? s.pot : -s.pot;
    if (s.folded[1] && !s.folded[0]) return player === 0 ? s.pot : -s.pot;
    const h0 = s.hole[0]!;
    const h1 = s.hole[1]!;
    const b = s.board!;
    const u0 = showdownUtility([h0, h1], b) * s.pot;
    return player === 0 ? u0 : -u0;
  },

  chanceOutcomes(s) {
    if (s.phase === "deal_hole") {
      const outcomes: { probability: number; state: LeducState }[] = [];
      const n = s.deck.length;
      let count = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          count++;
        }
      }
      const p = 1 / count;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const deck = [...s.deck];
          const c0 = deck[i]!;
          const c1 = deck[j]!;
          const rest = deck.filter((_, idx) => idx !== i && idx !== j);
          outcomes.push({
            probability: p,
            state: initialBettingState({
              ...s,
              deck: rest,
              hole: [c0, c1],
              phase: "bet1",
            }),
          });
        }
      }
      return outcomes;
    }

    if (s.phase === "deal_board") {
      const outcomes: { probability: number; state: LeducState }[] = [];
      const p = 1 / s.deck.length;
      for (let i = 0; i < s.deck.length; i++) {
        const board = s.deck[i]!;
        const rest = s.deck.filter((_, idx) => idx !== i);
        outcomes.push({
          probability: p,
          state: initialBettingState({
            ...s,
            deck: rest,
            board,
            round: 1,
            phase: "bet2",
            lastAggressor: 0,
            toAct: 0,
          }),
        });
      }
      return outcomes;
    }
    return [];
  },

  legalActions(s) {
    const kinds = legalActionKinds(s);
    return kinds.map((_, i) => i);
  },

  nextState(s, actionIndex) {
    const kinds = legalActionKinds(s);
    return applyAction(s, kinds[actionIndex]!);
  },

  informationSet(s, player) {
    const hole = s.hole[player]!;
    const board = s.board ?? "?";
    return `r${s.round}|h${hole}|b${board}|w${s.wager}|c${s.roundCommit[player]}|p${s.roundCommit[1 - player]}|ra${s.raisesThisRound}|act${s.toAct === player ? 1 : 0}`;
  },

  actionCount(s) {
    return legalActionKinds(s).length;
  },

  actionLabel(s, actionIndex) {
    return legalActionKinds(s)[actionIndex] ?? "?";
  },
};
