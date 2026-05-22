import { runShowdown } from "./nlhe-engine";
import type { NlheHandState } from "./types";

/**
 * After the reveal window, awards pots and sets street COMPLETE. Safe to call repeatedly;
 * no-op unless street is SHOWDOWN and the deadline has passed (or is missing).
 */
export function resolveShowdownWhenRevealElapsed(state: NlheHandState, nowMs: number): void {
  if (state.street !== "SHOWDOWN") return;
  if (state.showdownRevealUntilIso) {
    if (nowMs < new Date(state.showdownRevealUntilIso).getTime()) return;
  }
  runShowdown(state);
}
