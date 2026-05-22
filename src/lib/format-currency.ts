/** Real-money balance (bankroll, fees, prizes). */
export function formatZar(amount: number): string {
  return `${amount.toLocaleString()} Zar`;
}

/** In-play table stack (cash or tournament). */
export function formatChips(amount: number): string {
  return `${amount.toLocaleString()} chips`;
}
