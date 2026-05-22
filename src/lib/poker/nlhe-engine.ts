import { createRequire } from "node:module";
import { newShuffledDeck } from "./cards";
import { awardPotFromState } from "./apply-pot-rake";
import { assignHandResultMessage, snapshotStacks } from "./hand-result-message";
import { buildPotSlices } from "./pot";
import type { NlheHandState, PlayerInHand } from "./types";

import { ACTION_TIMEOUT_MS, SHOWDOWN_REVEAL_MS } from "./action-timeout";
import { resolveShowdownWhenRevealElapsed } from "./resolve-showdown-when-reveal-elapsed";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: {
    solve: (cards: string[], game?: string, canDisqualify?: boolean) => {
      name: string;
      descr: string;
      rank: number;
    };
    winners: (hands: ReturnType<(typeof Hand)["solve"]>[]) => ReturnType<(typeof Hand)["solve"]>[];
  };
};

export type StartHandInput = {
  smallBlind: number;
  bigBlind: number;
  dealerButtonSeat: number;
  seats: { seatIndex: number; userId: string; stackChips: number }[];
  /** Cash tables: copied onto hand state for pot rake at showdown. */
  rakePercentBps?: number;
  rakeCapChips?: number;
};

export function pickButtonSeat(dealerButtonSeat: number, occupiedSeatIndices: number[]): number {
  if (occupiedSeatIndices.length === 0) return 0;
  if (!occupiedSeatIndices.includes(dealerButtonSeat)) {
    return occupiedSeatIndices[0]!;
  }
  return dealerButtonSeat;
}

function nextClockwise(seatOrder: number[], fromSeat: number): number {
  const idx = seatOrder.indexOf(fromSeat);
  if (idx === -1) return seatOrder[0]!;
  return seatOrder[(idx + 1) % seatOrder.length]!;
}

function sbBbSeats(seatOrder: number[], button: number, headsUp: boolean): { sb: number; bb: number } {
  if (headsUp) {
    return { sb: button, bb: nextClockwise(seatOrder, button) };
  }
  const sb = nextClockwise(seatOrder, button);
  const bb = nextClockwise(seatOrder, sb);
  return { sb, bb };
}

function firstPreflopActor(seatOrder: number[], bbSeat: number, headsUp: boolean, sbSeat: number): number {
  if (headsUp) return sbSeat;
  return nextClockwise(seatOrder, bbSeat);
}

export function startNlheHand(input: StartHandInput): { state: NlheHandState; error?: string } {
  const { smallBlind, bigBlind, seats } = input;
  if (seats.length < 2) {
    return { state: null as unknown as NlheHandState, error: "Need at least two players with chips" };
  }

  const seatOrder = [...seats].sort((a, b) => a.seatIndex - b.seatIndex).map((s) => s.seatIndex);
  const button = pickButtonSeat(input.dealerButtonSeat, seatOrder);
  const headsUp = seats.length === 2;
  const { sb, bb } = sbBbSeats(seatOrder, button, headsUp);

  const deck = newShuffledDeck();
  const players: PlayerInHand[] = seats.map((s) => ({
    seatIndex: s.seatIndex,
    userId: s.userId,
    stack: s.stackChips,
    streetCommit: 0,
    handCommit: 0,
    folded: false,
    hole: ["", ""] as unknown as [string, string],
  }));

  const bySeat = (si: number) => players.find((p) => p.seatIndex === si)!;
  const dealOrder = [...seatOrder];
  const cursor = dealOrder.indexOf(sb);
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < dealOrder.length; i++) {
      const seat = dealOrder[(cursor + i) % dealOrder.length]!;
      const pl = bySeat(seat);
      const card = deck.pop();
      if (!card) return { state: null as unknown as NlheHandState, error: "Deck error" };
      if (round === 0) pl.hole = [card, pl.hole[1]!];
      else pl.hole = [pl.hole[0]!, card];
    }
  }

  let pot = 0;
  const postBlind = (seat: number, amount: number) => {
    const pl = bySeat(seat);
    const pay = Math.min(pl.stack, amount);
    pl.stack -= pay;
    pl.streetCommit += pay;
    pl.handCommit += pay;
    pot += pay;
  };

  postBlind(sb, smallBlind);
  postBlind(bb, bigBlind);

  const bbPlayer = bySeat(bb);
  const currentBet = bbPlayer.streetCommit;
  const minRaise = bigBlind;

  const state: NlheHandState = {
    version: 1,
    street: "PREFLOP",
    deck,
    board: [],
    buttonSeat: button,
    sbSeat: sb,
    bbSeat: bb,
    headsUp,
    smallBlind,
    bigBlind,
    players,
    currentBet,
    minRaise,
    toAct: firstPreflopActor(seatOrder, bb, headsUp, sb),
    lastAggressorSeat: bbPlayer.streetCommit > 0 ? bb : null,
    pot,
    actedThisStreet: [],
    timeoutActionsByUser: {},
    manualActionsByUser: {},
    ...(input.rakePercentBps != null && input.rakePercentBps > 0
      ? { rakePercentBps: input.rakePercentBps, rakeCapChips: input.rakeCapChips ?? 0 }
      : {}),
  };

  chainImplicitChecksAtCurrentToAct(state);
  touchTurnDeadline(state);
  return { state };
}

function activePlayers(state: NlheHandState): PlayerInHand[] {
  return state.players.filter((p) => !p.folded);
}

/** Chips needed to match the current bet (never negative when over-committed). */
function chipsToCall(state: NlheHandState, p: PlayerInHand): number {
  return Math.max(0, state.currentBet - p.streetCommit);
}

/** Raise currentBet if a seat is ahead of it (legacy / partial-update safety). */
function repairBettingRoundConsistency(state: NlheHandState): boolean {
  const active = activePlayers(state);
  if (active.length === 0) return false;
  const maxCommit = Math.max(0, ...active.map((p) => p.streetCommit));
  if (maxCommit > state.currentBet) {
    state.currentBet = maxCommit;
    return true;
  }
  return false;
}

/** Every player still in the hand has no chips behind (all-in). */
export function shouldAutoRunOut(state: NlheHandState): boolean {
  const alive = activePlayers(state);
  return alive.length >= 2 && alive.every((p) => p.stack === 0);
}

/** Deal remaining board cards and go to SHOWDOWN — no checks on turn/river. */
export function runOutBoardToShowdown(state: NlheHandState): string | undefined {
  while (state.board.length < 5) {
    if (state.board.length === 0) {
      resetStreetCommits(state);
      state.street = "FLOP";
      const err = burnAndDraw(state, 3);
      if (err) return err;
    } else if (state.board.length === 3) {
      resetStreetCommits(state);
      state.street = "TURN";
      const err = burnAndDraw(state, 1);
      if (err) return err;
    } else if (state.board.length === 4) {
      resetStreetCommits(state);
      state.street = "RIVER";
      const err = burnAndDraw(state, 1);
      if (err) return err;
    } else {
      break;
    }
  }

  state.street = "SHOWDOWN";
  state.toAct = null;
  state.turnDeadlineIso = undefined;
  const aliveShowdown = activePlayers(state);
  if (aliveShowdown.length >= 2) {
    state.showdownRevealUntilIso = new Date(Date.now() + SHOWDOWN_REVEAL_MS).toISOString();
    return undefined;
  }
  return runShowdown(state);
}

export { canRaiseInCurrentSpot } from "./betting-rules";

function seatOrderFromState(state: NlheHandState): number[] {
  return [...state.players].sort((a, b) => a.seatIndex - b.seatIndex).map((p) => p.seatIndex);
}

function resetStreetCommits(state: NlheHandState) {
  for (const p of state.players) {
    p.streetCommit = 0;
  }
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.lastAggressorSeat = null;
  state.actedThisStreet = [];
}

function burnAndDraw(state: NlheHandState, n: number): string | undefined {
  state.deck.pop();
  for (let i = 0; i < n; i++) {
    const c = state.deck.pop();
    if (!c) return "Deck empty";
    state.board.push(c);
  }
  return undefined;
}

/** Next seat that still needs to act this street, clockwise from afterSeat. */
export function findNextActorFrom(state: NlheHandState, afterSeat: number): number | null {
  if (state.street === "COMPLETE" || state.street === "SHOWDOWN") return null;
  const order = seatOrderFromState(state);
  let s = afterSeat;
  for (let k = 0; k < order.length + 2; k++) {
    s = nextClockwise(order, s);
    const p = state.players.find((x) => x.seatIndex === s);
    if (!p || p.folded) continue;
    const tc = chipsToCall(state, p);
    if (tc > 0) {
      if (p.stack > 0) return s;
      continue;
    }
    if (p.stack === 0) continue;
    if (!state.actedThisStreet.includes(s)) return s;
  }
  return null;
}

export function runShowdown(state: NlheHandState): string | undefined {
  delete state.showdownRevealUntilIso;
  const alive = activePlayers(state);
  if (alive.length === 1) {
    const before = snapshotStacks(state);
    awardPotFromState(state);
    state.street = "COMPLETE";
    state.toAct = null;
    assignHandResultMessage(state, before);
    return undefined;
  }

  const before = snapshotStacks(state);
  awardPotFromState(state);
  state.street = "COMPLETE";
  state.toAct = null;
  assignHandResultMessage(state, before);
  return undefined;
}

/** First seat clockwise from the BB that can still bet (has chips behind). */
function firstActorWhoCanBet(state: NlheHandState): number | null {
  const order = seatOrderFromState(state);
  if (order.length === 0) return null;
  const start = state.headsUp ? state.bbSeat : nextClockwise(order, state.bbSeat);
  let s = start;
  for (let k = 0; k < order.length; k++) {
    const p = state.players.find((x) => x.seatIndex === s);
    if (p && !p.folded && p.stack > 0) return s;
    s = nextClockwise(order, s);
    if (k > 0 && s === start) break;
  }
  return null;
}

function advanceStreet(state: NlheHandState): string | undefined {
  if (shouldAutoRunOut(state)) {
    return runOutBoardToShowdown(state);
  }

  if (state.street === "PREFLOP") {
    resetStreetCommits(state);
    state.street = "FLOP";
    const err = burnAndDraw(state, 3);
    if (err) return err;
  } else if (state.street === "FLOP") {
    resetStreetCommits(state);
    state.street = "TURN";
    const err = burnAndDraw(state, 1);
    if (err) return err;
  } else if (state.street === "TURN") {
    resetStreetCommits(state);
    state.street = "RIVER";
    const err = burnAndDraw(state, 1);
    if (err) return err;
  } else if (state.street === "RIVER") {
    resetStreetCommits(state);
    state.street = "SHOWDOWN";
    state.toAct = null;
    state.turnDeadlineIso = undefined;
    const aliveRiver = activePlayers(state);
    if (aliveRiver.length >= 2) {
      state.showdownRevealUntilIso = new Date(Date.now() + SHOWDOWN_REVEAL_MS).toISOString();
      return undefined;
    }
    return runShowdown(state);
  }

  const next = firstActorWhoCanBet(state);
  if (next === null && shouldAutoRunOut(state)) {
    return runOutBoardToShowdown(state);
  }
  state.toAct = next;
  return undefined;
}

export type ActionPayload =
  | { type: "FOLD" }
  | { type: "CHECK" }
  | { type: "CALL" }
  | { type: "RAISE"; raiseTo: number };

/** Sets or clears the action clock for whoever is in `toAct`. */
export function touchTurnDeadline(state: NlheHandState): void {
  if (state.street === "COMPLETE" || state.street === "SHOWDOWN") {
    state.turnDeadlineIso = undefined;
    return;
  }
  if (state.toAct === null) {
    state.turnDeadlineIso = undefined;
    return;
  }
  state.turnDeadlineIso = new Date(Date.now() + ACTION_TIMEOUT_MS).toISOString();
}

/** If no deadline yet (legacy JSON), start the clock without forcing an auto-action. */
export function ensureTurnDeadline(state: NlheHandState): void {
  if (state.street === "COMPLETE" || state.street === "SHOWDOWN" || state.toAct === null) return;
  if (!state.turnDeadlineIso) {
    touchTurnDeadline(state);
  }
}

/**
 * When `toAct` points at a folded / missing seat, or betting should have closed,
 * repair so timeouts and bots can resume. Returns true if state changed.
 */
export function repairStalledAction(state: NlheHandState): boolean {
  if (state.street === "COMPLETE" || state.street === "SHOWDOWN") return false;

  const changed = repairBettingRoundConsistency(state);

  const actor = state.toAct;
  if (actor !== null) {
    const p = state.players.find((x) => x.seatIndex === actor);
    if (p && !p.folded) {
      const tc = chipsToCall(state, p);
      if (p.stack > 0 && (tc > 0 || !state.actedThisStreet.includes(actor))) {
        return false;
      }
    }
  }

  if (actor !== null) {
    const next = findNextActorFrom(state, actor);
    if (next !== null) {
      state.toAct = next;
      touchTurnDeadline(state);
      return true;
    }
  }

  const alive = activePlayers(state);
  if (alive.length <= 1) {
    const before = snapshotStacks(state);
    awardPotFromState(state);
    state.street = "COMPLETE";
    state.toAct = null;
    state.turnDeadlineIso = undefined;
    assignHandResultMessage(state, before);
    return true;
  }

  const allMatched = alive.every(
    (pl) =>
      pl.streetCommit === state.currentBet ||
      (pl.stack === 0 && pl.streetCommit <= state.currentBet),
  );
  if (!allMatched) {
    if (actor === null) {
      const seed = state.lastAggressorSeat ?? state.bbSeat;
      const next = findNextActorFrom(state, seed);
      if (next !== null) {
        state.toAct = next;
        touchTurnDeadline(state);
        return true;
      }
    }
    return false;
  }

  if (shouldAutoRunOut(state)) {
    const err = runOutBoardToShowdown(state);
    return !err;
  }

  const err = advanceStreet(state);
  if (err) return false;
  touchTurnDeadline(state);
  return true;
}

/** House auto-action: check when no bet to call, otherwise fold (facing a bet). */
export function autoActionForTimeout(state: NlheHandState, actorSeat: number): ActionPayload | null {
  const p = state.players.find((x) => x.seatIndex === actorSeat);
  if (!p || p.folded) return null;
  const toCall = chipsToCall(state, p);
  if (toCall <= 0) return { type: "CHECK" };
  return { type: "FOLD" };
}

/**
 * Applies auto check/fold for every elapsed turn deadline (chain if several are overdue).
 * Mutates `state` in place.
 */
export function resolveElapsedTurnTimeouts(state: NlheHandState, nowMs: number): boolean {
  let changed = false;
  for (let guard = 0; guard < 24; guard++) {
    if (state.street === "COMPLETE" || state.street === "SHOWDOWN") break;
    if (repairStalledAction(state)) {
      changed = true;
      continue;
    }
    if (state.toAct === null) break;
    if (!state.turnDeadlineIso) break;
    if (nowMs <= new Date(state.turnDeadlineIso).getTime()) break;
    const actor = state.toAct;
    const p = state.players.find((x) => x.seatIndex === actor);
    if (!p || p.folded) {
      if (repairStalledAction(state)) {
        changed = true;
        continue;
      }
      break;
    }
    const action = autoActionForTimeout(state, actor);
    if (!action) break;
    const out = applyNlheActionCore(state, actor, p.userId, action);
    if (out.error) break;
    if (!state.timeoutActionsByUser) state.timeoutActionsByUser = {};
    state.timeoutActionsByUser[p.userId] = (state.timeoutActionsByUser[p.userId] ?? 0) + 1;
    changed = true;
    touchTurnDeadline(state);
  }
  return changed;
}

/** All-in with nothing to call cannot bet; apply CHECK until `toAct` can act or hand advances. */
function chainImplicitChecksAtCurrentToAct(state: NlheHandState): void {
  for (let guard = 0; guard < 24; guard++) {
    if (state.toAct === null) return;
    const w = state.players.find((x) => x.seatIndex === state.toAct!);
    if (!w || w.folded) return;
    const wtc = chipsToCall(state, w);
    if (wtc !== 0 || w.stack > 0) return;
    const out = applyNlheActionCore(state, state.toAct!, w.userId, { type: "CHECK" });
    if (out.error) return;
  }
}

function applyNlheActionCore(
  state: NlheHandState,
  actorSeat: number,
  userId: string,
  action: ActionPayload,
): { state: NlheHandState; error?: string } {
  if (state.street === "COMPLETE" || state.street === "SHOWDOWN") {
    return { state, error: "Hand is over" };
  }
  if (state.toAct !== actorSeat) {
    return { state, error: "Not your turn" };
  }
  const p = state.players.find((x) => x.seatIndex === actorSeat);
  if (!p || p.folded || p.userId !== userId) {
    return { state, error: "Invalid player" };
  }

  const toCall = chipsToCall(state, p);

  if (action.type === "FOLD") {
    if (toCall === 0) {
      return { state, error: "You can check" };
    }
    p.folded = true;
    state.actedThisStreet.push(actorSeat);
  } else if (action.type === "CHECK") {
    if (toCall !== 0) {
      return { state, error: "Cannot check" };
    }
    state.actedThisStreet.push(actorSeat);
  } else if (action.type === "CALL") {
    const pay = Math.min(p.stack, toCall);
    p.stack -= pay;
    p.streetCommit += pay;
    p.handCommit += pay;
    state.pot += pay;
    state.actedThisStreet.push(actorSeat);
  } else if (action.type === "RAISE") {
    const target = action.raiseTo;
    if (target < p.streetCommit) {
      return { state, error: "Invalid raise" };
    }
    const add = target - p.streetCommit;
    if (add > p.stack) {
      return { state, error: "Not enough chips" };
    }
    const increment = target - state.currentBet;
    if (increment < state.minRaise && add < p.stack) {
      return { state, error: `Minimum raise is ${state.minRaise}` };
    }
    p.stack -= add;
    p.streetCommit = target;
    p.handCommit += add;
    state.pot += add;
    state.currentBet = Math.max(state.currentBet, target);
    state.lastAggressorSeat = actorSeat;
    if (increment >= state.minRaise) {
      state.minRaise = increment;
    }
    state.actedThisStreet = [actorSeat];
  }

  const alive = activePlayers(state);
  if (alive.length === 1) {
    const before = snapshotStacks(state);
    awardPotFromState(state);
    state.street = "COMPLETE";
    state.toAct = null;
    assignHandResultMessage(state, before);
    return { state };
  }

  let next = findNextActorFrom(state, actorSeat);
  if (next === null) {
    const allMatched = alive.every(
      (pl) => pl.streetCommit === state.currentBet || (pl.stack === 0 && pl.streetCommit <= state.currentBet),
    );
    if (allMatched) {
      if (shouldAutoRunOut(state)) {
        const e = runOutBoardToShowdown(state);
        if (e) return { state, error: e };
        return { state };
      }
      const err = advanceStreet(state);
      if (err) return { state, error: err };
      next = state.toAct;
    }
  }

  state.toAct = next;

  chainImplicitChecksAtCurrentToAct(state);
  return { state };
}

export function applyNlheAction(
  state: NlheHandState,
  actorSeat: number,
  userId: string,
  action: ActionPayload,
  opts?: { source?: "manual" | "timeout" },
): { state: NlheHandState; error?: string } {
  const out = applyNlheActionCore(state, actorSeat, userId, action);
  if (!out.error && (opts?.source ?? "manual") === "manual") {
    if (!out.state.manualActionsByUser) out.state.manualActionsByUser = {};
    out.state.manualActionsByUser[userId] = (out.state.manualActionsByUser[userId] ?? 0) + 1;
  }
  if (!out.error) {
    touchTurnDeadline(out.state);
  }
  return out;
}

/**
 * Folds the player out of an in-progress hand so they can leave the table.
 * If it is their turn, applies a normal check/fold; otherwise marks them folded without advancing action.
 */
export function applyForcedLeaveFromHand(
  state: NlheHandState,
  userId: string,
): { state: NlheHandState; error?: string } {
  if (state.street === "COMPLETE") {
    return { state };
  }
  if (state.street === "SHOWDOWN") {
    const p = state.players.find((x) => x.userId === userId);
    if (p && !p.folded) {
      p.folded = true;
    }
    const alive = activePlayers(state);
    if (alive.length <= 1) {
      runShowdown(state);
    } else {
      resolveShowdownWhenRevealElapsed(state, Date.now());
    }
    return { state };
  }
  const p = state.players.find((x) => x.userId === userId);
  if (!p) {
    return { state, error: "Not in this hand" };
  }
  if (p.folded) {
    return { state };
  }

  if (state.toAct === p.seatIndex) {
    const toCall = chipsToCall(state, p);
    const action: ActionPayload = toCall > 0 ? { type: "FOLD" } : { type: "CHECK" };
    return applyNlheAction(state, p.seatIndex, userId, action, { source: "manual" });
  }

  p.folded = true;
  const alive = activePlayers(state);
  if (alive.length === 1) {
    const before = snapshotStacks(state);
    awardPotFromState(state);
    state.street = "COMPLETE";
    state.toAct = null;
    state.turnDeadlineIso = undefined;
    assignHandResultMessage(state, before);
    return { state };
  }
  return { state };
}

export function serializeHandState(state: NlheHandState): string {
  return JSON.stringify(state);
}

export function deserializeHandState(json: string): NlheHandState {
  const s = JSON.parse(json) as NlheHandState;
  if (!s.actedThisStreet) {
    s.actedThisStreet = [];
  }
  if (!s.timeoutActionsByUser) {
    s.timeoutActionsByUser = {};
  }
  if (!s.manualActionsByUser) {
    s.manualActionsByUser = {};
  }
  return s;
}

export { ACTION_TIMEOUT_MS, SHOWDOWN_REVEAL_MS } from "./action-timeout";
