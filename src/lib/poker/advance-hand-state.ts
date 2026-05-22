import {
  ensureTurnDeadline,
  repairStalledAction,
  resolveElapsedTurnTimeouts,
  runShowdown,
} from "./nlhe-engine";
import { resolveShowdownWhenRevealElapsed } from "./resolve-showdown-when-reveal-elapsed";
import type { NlheHandState } from "./types";

export type AdvanceHandOptions = {
  /** Skip the showdown reveal timer (admin close / recovery). */
  forceShowdown?: boolean;
};

/**
 * Advances timers, repairs stalled action, and resolves showdown — same steps as GET /hand.
 */
export function advanceActiveHandState(
  state: NlheHandState,
  nowMs: number,
  options?: AdvanceHandOptions,
): void {
  ensureTurnDeadline(state);
  repairStalledAction(state);
  resolveElapsedTurnTimeouts(state, nowMs);

  if (options?.forceShowdown && state.street === "SHOWDOWN") {
    delete state.showdownRevealUntilIso;
    runShowdown(state);
    return;
  }

  resolveShowdownWhenRevealElapsed(state, nowMs);
}
