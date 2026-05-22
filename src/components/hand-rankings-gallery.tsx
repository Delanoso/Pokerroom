type Suit = "s" | "h" | "d" | "c";

export type DemoCard = { rank: string; suit: Suit; dim?: boolean };

export type HandRankDemo = {
  name: string;
  description: string;
  cards: readonly DemoCard[];
};

/** Best → worst. Kicker cards use `dim` (grayed like a chart). */
export const NLHE_HAND_DEMOS: readonly HandRankDemo[] = [
  {
    name: "Royal flush",
    description:
      "The five highest cards of one suit in sequence: ten through ace. It is the strongest possible hand.",
    cards: [
      { rank: "T", suit: "d" },
      { rank: "J", suit: "d" },
      { rank: "Q", suit: "d" },
      { rank: "K", suit: "d" },
      { rank: "A", suit: "d" },
    ],
  },
  {
    name: "Straight flush",
    description: "Five cards in a row, all the same suit. Higher top card wins if two players have one.",
    cards: [
      { rank: "7", suit: "c" },
      { rank: "8", suit: "c" },
      { rank: "9", suit: "c" },
      { rank: "T", suit: "c" },
      { rank: "J", suit: "c" },
    ],
  },
  {
    name: "Four of a kind",
    description: "Four cards of the same rank. The fifth card is a kicker and only matters if opponents tie on quads.",
    cards: [
      { rank: "4", suit: "s" },
      { rank: "4", suit: "h" },
      { rank: "4", suit: "d" },
      { rank: "4", suit: "c" },
      { rank: "K", suit: "s", dim: true },
    ],
  },
  {
    name: "Full house",
    description: "Three of one rank plus a pair of another. Compare trips first, then the pair.",
    cards: [
      { rank: "T", suit: "h" },
      { rank: "T", suit: "d" },
      { rank: "T", suit: "c" },
      { rank: "2", suit: "s" },
      { rank: "2", suit: "h" },
    ],
  },
  {
    name: "Flush",
    description: "Any five cards of the same suit, not in sequence. Highest cards compared top-down to break ties.",
    cards: [
      { rank: "K", suit: "s" },
      { rank: "J", suit: "s" },
      { rank: "9", suit: "s" },
      { rank: "5", suit: "s" },
      { rank: "A", suit: "s" },
    ],
  },
  {
    name: "Straight",
    description: "Five consecutive ranks; suits may differ. Ace can play high (T–J–Q–K–A) or low in wheel (A–2–3–4–5).",
    cards: [
      { rank: "7", suit: "h" },
      { rank: "8", suit: "d" },
      { rank: "9", suit: "s" },
      { rank: "T", suit: "c" },
      { rank: "J", suit: "h" },
    ],
  },
  {
    name: "Three of a kind",
    description: "Three cards of the same rank plus two kickers. Kickers decide ties when trips match.",
    cards: [
      { rank: "2", suit: "s" },
      { rank: "2", suit: "h" },
      { rank: "2", suit: "d" },
      { rank: "6", suit: "c", dim: true },
      { rank: "A", suit: "s", dim: true },
    ],
  },
  {
    name: "Two pair",
    description: "Two different pairs and a kicker. Higher pair wins first; if both pairs tie, the kicker decides.",
    cards: [
      { rank: "8", suit: "d" },
      { rank: "8", suit: "c" },
      { rank: "7", suit: "h" },
      { rank: "7", suit: "s" },
      { rank: "Q", suit: "d", dim: true },
    ],
  },
  {
    name: "One pair",
    description: "Two cards of the same rank and three side cards. Compare the pair, then kickers in order.",
    cards: [
      { rank: "5", suit: "h" },
      { rank: "5", suit: "d" },
      { rank: "J", suit: "c", dim: true },
      { rank: "T", suit: "s", dim: true },
      { rank: "3", suit: "c", dim: true },
    ],
  },
  {
    name: "High card",
    description: "No pair or better. The best single card wins, then the next highest cards in order if tied.",
    cards: [
      { rank: "K", suit: "h" },
      { rank: "Q", suit: "d", dim: true },
      { rank: "J", suit: "c", dim: true },
      { rank: "9", suit: "s", dim: true },
      { rank: "4", suit: "h", dim: true },
    ],
  },
] as const;

const SUIT_SYMBOL: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function PlayingCardMini({ rank, suit, dim }: DemoCard) {
  const red = suit === "h" || suit === "d";
  return (
    <div
      className={
        dim
          ? "flex h-9 w-6 shrink-0 flex-col items-center justify-between rounded border border-zinc-600/90 bg-zinc-800/95 py-0.5 text-[9px] font-bold text-zinc-500 shadow-inner shadow-black/40 sm:h-10 sm:w-7 sm:text-[10px]"
          : `flex h-9 w-6 shrink-0 flex-col items-center justify-between rounded border border-zinc-200/90 bg-gradient-to-b from-zinc-50 to-zinc-100 py-0.5 text-[9px] font-bold shadow-md shadow-black/25 sm:h-10 sm:w-7 sm:text-[10px] ${red ? "text-red-600" : "text-zinc-900"}`
      }
    >
      <span className="leading-none">{rank}</span>
      <span className="text-[11px] leading-none sm:text-xs" aria-hidden>
        {SUIT_SYMBOL[suit]}
      </span>
    </div>
  );
}

export function HandRankingsGallery() {
  return (
    <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-x-8 gap-y-1 overflow-hidden lg:grid-cols-2 lg:gap-y-1.5 xl:gap-y-2">
      {NLHE_HAND_DEMOS.map((hand, i) => (
        <article
          key={hand.name}
          className="flex min-h-0 min-w-0 items-center gap-2.5 rounded-lg border border-zinc-800/80 bg-black/30 px-2 py-1.5 ring-1 ring-zinc-900/50 sm:gap-3 sm:px-2.5 sm:py-2"
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-amber-950/55 text-[10px] font-bold tabular-nums text-amber-200 ring-1 ring-amber-800/40 sm:h-7 sm:w-7 sm:text-xs"
            aria-label={`Rank ${i + 1}`}
          >
            {i + 1}
          </span>
          <div className="flex shrink-0 gap-0.5 sm:gap-1" aria-hidden>
            {hand.cards.map((c, j) => (
              <PlayingCardMini key={`${hand.name}-${j}`} {...c} />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[11px] font-semibold leading-tight text-zinc-100 sm:text-xs">{hand.name}</h2>
            <p className="mt-0.5 text-[9px] leading-snug text-zinc-500 sm:text-[10px]">{hand.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
