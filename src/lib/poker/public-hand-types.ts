import type { Street } from "./types";

export type PublicHandPlayer = {
  seatIndex: number;
  stack: number;
  streetCommit: number;
  handCommit: number;
  folded: boolean;
  hole: [string, string] | null;
};

export type PublicHandState = {
  street: Street;
  board: string[];
  pot: number;
  toAct: number | null;
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  minRaise: number;
  players: PublicHandPlayer[];
  resultMessage?: string;
  legal: ("FOLD" | "CHECK" | "CALL" | "RAISE")[];
  viewerSeat: number | null;
  turnDeadlineIso: string | null;
  showdownRevealUntilIso?: string | null;
};
