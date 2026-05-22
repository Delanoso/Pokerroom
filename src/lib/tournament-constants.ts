/** Registration opens max(createdAt, startsAt − 48h). */
export const REGISTRATION_LEAD_MS = 48 * 60 * 60 * 1000;

/** Buy-in / sit allowed from startsAt − 10m onward (for tournaments). */
export const SITTING_LEAD_MS = 10 * 60 * 1000;

/** Registration and unregister close this long before scheduled start. */
export const UNREGISTER_CUTOFF_MS = 30 * 1000;
