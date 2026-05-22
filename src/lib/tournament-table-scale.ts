/**
 * Table count scales with registrations (even split across tables).
 * <6 → 1, 6–12 → 2, 13–18 → 3, then one table per 6 players.
 */
export function desiredTournamentTableCount(registrationCount: number): number {
  if (registrationCount < 6) return 1;
  if (registrationCount < 13) return 2;
  if (registrationCount < 19) return 3;
  return Math.ceil(registrationCount / 6);
}
