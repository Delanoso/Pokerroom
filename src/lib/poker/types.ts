export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" | "COMPLETE";

export type PublicAction = "FOLD" | "CHECK" | "CALL" | "RAISE" | "ALL_IN";

export type PlayerInHand = {
  seatIndex: number;
  userId: string;
  /** Chips not yet committed this hand */
  stack: number;
  /** Committed in current betting round */
  streetCommit: number;
  /** Total committed across all streets this hand */
  handCommit: number;
  folded: boolean;
  hole: [string, string];
};

export type PotSlice = {
  amount: number;
  /** Seats eligible to win this slice (not folded when awarded) */
  eligibleSeats: number[];
};

export type NlheHandState = {
  version: number;
  street: Street;
  /** Remaining deck (server secret) */
  deck: string[];
  board: string[];
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  /** Heads-up table */
  headsUp: boolean;
  smallBlind: number;
  bigBlind: number;
  players: PlayerInHand[];
  /** Highest street commitment this betting round */
  currentBet: number;
  /** Minimum raise increment (>= big blind at start of street) */
  minRaise: number;
  /** Seat whose action it is, or null during deal / complete */
  toAct: number | null;
  /** Last seat that raised (or opened) this street — betting closes when action returns here with matched bets */
  lastAggressorSeat: number | null;
  pot: number;
  /** Seats that have finished acting this betting round (check/call/fold), cleared on raise or new street */
  actedThisStreet: number[];
  /** After showdown */
  resultMessage?: string;
  /** Wall-clock deadline (ISO) for current player to act; cleared when hand ends or no one to act. */
  turnDeadlineIso?: string;
  /** When street is SHOWDOWN, payouts wait until this instant so all players can see hole cards. */
  showdownRevealUntilIso?: string;
  /** Count of auto check/fold actions applied this hand (timeout), per userId. */
  timeoutActionsByUser?: Record<string, number>;
  /** Count of client-posted actions this hand, per userId. */
  manualActionsByUser?: Record<string, number>;
  /** Cash games: rake settings copied from the table when the hand starts. */
  rakePercentBps?: number;
  rakeCapChips?: number;
  /** Cash games: chips removed from the pot as rake when the hand completes. */
  rakeChips?: number;
};
