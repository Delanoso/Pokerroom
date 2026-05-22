import type { PlayerInHand, PotSlice } from "./types";

/**
 * Build side pots from total per-seat contributions this hand.
 * Each slice amount = (level - prevLevel) * count(seat with total >= level).
 * Eligible winners for a slice: seats with total >= level and not folded.
 */
export function buildPotSlices(players: PlayerInHand[]): PotSlice[] {
  const rows = players
    .filter((p) => p.handCommit > 0)
    .map((p) => ({
      seatIndex: p.seatIndex,
      total: p.handCommit,
      folded: p.folded,
    }));
  if (rows.length === 0) return [];

  const levels = [...new Set(rows.map((r) => r.total))].sort((a, b) => a - b);
  const slices: PotSlice[] = [];
  let prev = 0;
  for (const level of levels) {
    const delta = level - prev;
    const atLevel = rows.filter((r) => r.total >= level);
    const amount = delta * atLevel.length;
    const eligibleSeats = atLevel.filter((r) => !r.folded).map((r) => r.seatIndex);
    slices.push({ amount, eligibleSeats });
    prev = level;
  }
  return slices;
}
