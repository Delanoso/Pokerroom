import { createRequire } from "node:module";
import type { NlheHandState } from "./types";

const require = createRequire(import.meta.url);
const { Hand } = require("pokersolver") as {
  Hand: {
    solve: (cards: string[], game?: string) => { name: string; descr?: string };
  };
};

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function formatCard(code: string): string {
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  const r = rank === "T" ? "10" : rank;
  return `${r}${SUIT[suit] ?? suit}`;
}

function formatHole(hole: [string, string]): string {
  return `${formatCard(hole[0])} ${formatCard(hole[1])}`;
}

function handDescription(p: { hole: [string, string]; folded: boolean }, board: string[]): string | null {
  if (p.folded || board.length === 0) return null;
  try {
    const h = Hand.solve([...p.hole, ...board], "standard");
    const cards = formatHole(p.hole);
    return `${h.name} (${cards})`;
  } catch {
    return formatHole(p.hole);
  }
}

/** Set `state.resultMessage` from stack deltas after pot award. */
export function assignHandResultMessage(
  state: NlheHandState,
  stackBefore: Map<number, number>,
): void {
  const alive = state.players.filter((p) => !p.folded);
  const folders = state.players.filter((p) => p.folded);

  const winners = state.players
    .map((p) => ({
      seatIndex: p.seatIndex,
      gained: p.stack - (stackBefore.get(p.seatIndex) ?? 0),
      player: p,
    }))
    .filter((w) => w.gained > 0);

  if (winners.length === 0) {
    state.resultMessage = "Hand complete";
    return;
  }

  if (winners.length === 1 && alive.length === 1 && folders.length > 0) {
    const w = winners[0]!;
    state.resultMessage = `Seat ${w.seatIndex + 1} wins ${w.gained.toLocaleString()} (all others folded)`;
    return;
  }

  const parts = winners.map((w) => {
    const desc = handDescription(w.player, state.board);
    if (desc) {
      return `Seat ${w.seatIndex + 1} Wins with ${desc} wins ${w.gained.toLocaleString()}`;
    }
    return `Seat ${w.seatIndex + 1} wins ${w.gained.toLocaleString()}`;
  });

  if (alive.length >= 2) {
    const shown = alive
      .filter((p) => !winners.some((w) => w.seatIndex === p.seatIndex))
      .map((p) => {
        const desc = handDescription(p, state.board);
        return desc ? `Seat ${p.seatIndex + 1} showed ${desc}` : null;
      })
      .filter(Boolean);
    if (shown.length > 0) {
      state.resultMessage = `${parts.join(" · ")} · ${shown.join(" · ")}`;
      return;
    }
  }

  state.resultMessage = parts.join(" · ");
}

export function snapshotStacks(state: NlheHandState): Map<number, number> {
  return new Map(state.players.map((p) => [p.seatIndex, p.stack]));
}
