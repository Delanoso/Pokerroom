import type { PublicHandState } from "./public-state";
import type { LastCompletedHandResult } from "./last-completed-hand-result";
import { humanizeResultMessage } from "./humanize-result-message";

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function formatCard(code: string): string {
  if (code.length < 2) return code;
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  const r = rank === "T" ? "10" : rank;
  return `${r}${SUIT[suit] ?? suit}`;
}

export type TableHandLogSnap = {
  handId: string;
  street: PublicHandState["street"];
  board: readonly string[];
  pot: number;
  currentBet: number;
  toAct: number | null;
  sbSeat: number;
  bbSeat: number;
  smallBlind: number;
  bigBlind: number;
  players: readonly { seatIndex: number; stack: number; streetCommit: number; folded: boolean }[];
  resultMessage?: string;
};

export function buildTableHandLogSnap(handId: string | null, hand: PublicHandState | null): TableHandLogSnap | null {
  if (!handId || !hand) return null;
  return {
    handId,
    street: hand.street,
    board: hand.board,
    pot: hand.pot,
    currentBet: hand.currentBet,
    toAct: hand.toAct,
    sbSeat: hand.sbSeat,
    bbSeat: hand.bbSeat,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    players: hand.players.map((p) => ({
      seatIndex: p.seatIndex,
      stack: p.stack,
      streetCommit: p.streetCommit,
      folded: p.folded,
    })),
    resultMessage: hand.resultMessage,
  };
}

function playerBySeat(snap: TableHandLogSnap, seat: number) {
  return snap.players.find((p) => p.seatIndex === seat);
}

function linesForNewHand(next: TableHandLogSnap, seatLabel: (seat: number) => string): string[] {
  const lines: string[] = [];
  lines.push(`— New hand · …${next.handId.slice(-8)} —`);
  const sb = playerBySeat(next, next.sbSeat);
  const bb = playerBySeat(next, next.bbSeat);
  if (sb && !sb.folded) {
    lines.push(`${seatLabel(next.sbSeat)} posts small blind ${next.smallBlind.toLocaleString()}.`);
  }
  if (bb && !bb.folded) {
    lines.push(`${seatLabel(next.bbSeat)} posts big blind ${next.bigBlind.toLocaleString()}.`);
  }
  if (!(next.street === "PREFLOP" && next.board.length === 0)) {
    const b = next.board.length ? formatBoard(next.board) : "—";
    lines.push(`Picked up in ${streetLabel(next.street)} · board ${b}`);
  }
  return lines;
}

function streetLabel(s: PublicHandState["street"]): string {
  switch (s) {
    case "PREFLOP":
      return "preflop";
    case "FLOP":
      return "flop";
    case "TURN":
      return "turn";
    case "RIVER":
      return "river";
    case "SHOWDOWN":
      return "showdown";
    case "COMPLETE":
      return "complete";
    default:
      return String(s).toLowerCase().replace("_", " ");
  }
}

function formatBoard(cards: readonly string[]): string {
  return cards.map(formatCard).join(" ");
}

function appendBoardLines(prev: TableHandLogSnap, next: TableHandLogSnap, lines: string[]): void {
  const pb = prev.board.length;
  const nb = next.board.length;
  if (nb <= pb) return;
  if (pb < 3 && nb >= 3) {
    lines.push(`Flop: ${formatBoard(next.board.slice(0, 3))}.`);
  }
  if (pb < 4 && nb >= 4) {
    lines.push(`Turn: ${formatCard(next.board[3]!)}.`);
  }
  if (pb < 5 && nb >= 5) {
    lines.push(`River: ${formatCard(next.board[4]!)}.`);
  }
}

function formatResultLine(resultMessage: string, seatLabel: (seat: number) => string): string {
  const msg = humanizeResultMessage(resultMessage, seatLabel);
  return msg + (msg.endsWith(".") ? "" : ".");
}

function appendResultIfNew(
  prev: TableHandLogSnap,
  next: TableHandLogSnap,
  seatLabel: (seat: number) => string,
  lines: string[],
  loggedResultHandIds?: Set<string>,
): void {
  if (prev.handId !== next.handId) return;
  if (!next.resultMessage?.trim()) return;
  if (prev.resultMessage === next.resultMessage) return;
  if (loggedResultHandIds?.has(next.handId)) return;
  lines.push(formatResultLine(next.resultMessage, seatLabel));
  loggedResultHandIds?.add(next.handId);
}

function appendStreetTransition(
  prev: TableHandLogSnap,
  next: TableHandLogSnap,
  seatLabel: (seat: number) => string,
  lines: string[],
): void {
  if (prev.street === next.street) return;
  if (next.street === "SHOWDOWN" && prev.street !== "SHOWDOWN") {
    lines.push("Showdown — cards on their backs.");
  }
  if (next.street === "COMPLETE" && prev.street !== "COMPLETE" && !next.resultMessage?.trim()) {
    lines.push("Hand complete.");
  }
}

function resultLineForEndedHand(
  snap: TableHandLogSnap,
  seatLabel: (seat: number) => string,
  lastCompletedHand: LastCompletedHandResult | null | undefined,
): string | null {
  if (snap.resultMessage?.trim()) {
    return formatResultLine(snap.resultMessage, seatLabel);
  }
  if (lastCompletedHand?.handId === snap.handId && lastCompletedHand.resultMessage.trim()) {
    return formatResultLine(lastCompletedHand.resultMessage, seatLabel);
  }
  return null;
}

function appendFolds(prev: TableHandLogSnap, next: TableHandLogSnap, seatLabel: (seat: number) => string, lines: string[]): void {
  for (const n of next.players) {
    const o = playerBySeat(prev, n.seatIndex);
    if (!o || o.folded) continue;
    if (!o.folded && n.folded) {
      lines.push(`${seatLabel(n.seatIndex)} folds.`);
    }
  }
}

function appendBetting(
  prev: TableHandLogSnap,
  next: TableHandLogSnap,
  seatLabel: (seat: number) => string,
  lines: string[],
): void {
  if (prev.street !== next.street) return;
  if (next.street === "COMPLETE" || next.street === "SHOWDOWN") return;

  const seats = [...next.players].sort((a, b) => a.seatIndex - b.seatIndex);

  for (const n of seats) {
    const o = playerBySeat(prev, n.seatIndex);
    if (!o || n.folded) continue;
    const added = n.streetCommit - o.streetCommit;
    if (added <= 0) continue;

    if (next.currentBet > prev.currentBet && n.streetCommit === next.currentBet) {
      if (prev.currentBet === 0) {
        lines.push(`${seatLabel(n.seatIndex)} bets ${n.streetCommit.toLocaleString()}.`);
      } else {
        lines.push(`${seatLabel(n.seatIndex)} raises to ${n.streetCommit.toLocaleString()}.`);
      }
      continue;
    }

    if (
      next.currentBet === prev.currentBet &&
      added > 0 &&
      n.stack === 0 &&
      n.streetCommit < next.currentBet
    ) {
      lines.push(`${seatLabel(n.seatIndex)} calls all-in for ${added.toLocaleString()}.`);
      continue;
    }

    if (next.currentBet === prev.currentBet && n.streetCommit === next.currentBet) {
      lines.push(`${seatLabel(n.seatIndex)} calls ${added.toLocaleString()}.`);
      continue;
    }

    if (next.currentBet === prev.currentBet && added > 0) {
      lines.push(`${seatLabel(n.seatIndex)} puts in ${added.toLocaleString()}.`);
    }
  }

  for (const n of seats) {
    const o = playerBySeat(prev, n.seatIndex);
    if (!o || n.folded) continue;
    if (prev.toAct !== n.seatIndex) continue;
    if (next.toAct === n.seatIndex) continue;
    if (n.streetCommit !== o.streetCommit || n.stack !== o.stack) continue;
    if (prev.currentBet !== next.currentBet) continue;
    lines.push(`${seatLabel(n.seatIndex)} checks.`);
  }
}

/**
 * Returns new log lines when `prev` transitions to `next` (same hand or new hand).
 * Caller stores `next` as the next `prev`.
 */
export function deriveHandLogMessages(opts: {
  prev: TableHandLogSnap | null;
  next: TableHandLogSnap | null;
  seatLabel: (seat: number) => string;
  lastCompletedHand?: LastCompletedHandResult | null;
  loggedResultHandIds?: Set<string>;
}): string[] {
  const { prev, next, seatLabel, lastCompletedHand, loggedResultHandIds } = opts;

  const pushResultOnce = (handId: string, line: string, lines: string[]) => {
    if (loggedResultHandIds?.has(handId)) return;
    lines.push(line);
    loggedResultHandIds?.add(handId);
  };

  if (!next) {
    if (!prev) return [];
    const line = resultLineForEndedHand(prev, seatLabel, lastCompletedHand);
    if (line) {
      const lines: string[] = [];
      pushResultOnce(prev.handId, line, lines);
      return lines;
    }
    if (prev.street === "SHOWDOWN" || prev.street === "COMPLETE") {
      return ["Hand complete."];
    }
    return [];
  }

  if (!prev || prev.handId !== next.handId) {
    const lines: string[] = [];
    if (prev && prev.handId !== next.handId) {
      const line = resultLineForEndedHand(prev, seatLabel, lastCompletedHand);
      if (line) {
        pushResultOnce(prev.handId, line, lines);
      } else if (prev.street === "COMPLETE" || prev.street === "SHOWDOWN") {
        lines.push("Hand complete.");
      }
    }
    lines.push(...linesForNewHand(next, seatLabel));
    return lines;
  }

  const lines: string[] = [];
  appendFolds(prev, next, seatLabel, lines);
  appendBoardLines(prev, next, lines);
  appendStreetTransition(prev, next, seatLabel, lines);
  appendResultIfNew(prev, next, seatLabel, lines, loggedResultHandIds);
  appendBetting(prev, next, seatLabel, lines);
  return lines;
}
