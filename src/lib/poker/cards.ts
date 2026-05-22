const RANKS = "23456789TJQKA";
const SUITS = "shdc";

export const ALL_CARDS: string[] = [];
for (const r of RANKS) {
  for (const s of SUITS) {
    ALL_CARDS.push(`${r}${s}`);
  }
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newShuffledDeck(): string[] {
  return shuffle(ALL_CARDS);
}
