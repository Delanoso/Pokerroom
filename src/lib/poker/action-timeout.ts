/** Wall clock for NLHE auto check / fold when no manual action (ms). */
export const ACTION_TIMEOUT_MS = 32_000;

/** After river (or all-in runout), keep street at SHOWDOWN this long so all active players' hole cards are shown. */
export const SHOWDOWN_REVEAL_MS = 3000;

/** Pause after a hand is marked complete before auto-dealing the next one. */
export const BETWEEN_HANDS_DEAL_DELAY_MS = 3000;
