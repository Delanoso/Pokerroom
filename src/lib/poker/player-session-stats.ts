import type { PublicHandState } from "@/lib/poker/public-hand-types";

export type SessionStatCounts = {
  hands: number;
  vpip: number;
  checks: number;
  folds: number;
  calls: number;
  raises: number;
  reRaises: number;
};

function emptyStats(): SessionStatCounts {
  return { hands: 0, vpip: 0, checks: 0, folds: 0, calls: 0, raises: 0, reRaises: 0 };
}

type SeatSnap = {
  folded: boolean;
  streetCommit: number;
  handCommit: number;
};

/** Tracks per-opponent action counts for the current table session (client-side). */
export class PlayerSessionStatsTracker {
  private readonly stats = new Map<string, SessionStatCounts>();
  private handId: string | null = null;
  private preflopVoluntary = new Set<number>();
  private lastSnap = new Map<number, SeatSnap>();
  private lastPot = 0;
  private lastCurrentBet = 0;
  private lastToAct: number | null = null;
  private streetAggressions = 0;
  private lastStreet: PublicHandState["street"] | null = null;

  reset(): void {
    this.stats.clear();
    this.handId = null;
    this.preflopVoluntary.clear();
    this.lastSnap.clear();
    this.lastPot = 0;
    this.lastCurrentBet = 0;
    this.lastToAct = null;
    this.streetAggressions = 0;
    this.lastStreet = null;
  }

  get(userId: string): SessionStatCounts {
    return this.stats.get(userId) ?? emptyStats();
  }

  getAll(): Map<string, SessionStatCounts> {
    return new Map(this.stats);
  }

  private bump(userId: string): SessionStatCounts {
    let row = this.stats.get(userId);
    if (!row) {
      row = emptyStats();
      this.stats.set(userId, row);
    }
    return row;
  }

  observe(
    handId: string,
    hand: PublicHandState,
    viewerUserId: string | null,
    seatUsers: Map<number, string>,
  ): void {
    if (this.handId !== handId) {
      this.handId = handId;
      this.preflopVoluntary.clear();
      this.lastSnap.clear();
      this.lastPot = hand.pot;
      this.lastCurrentBet = hand.currentBet;
      this.lastToAct = hand.toAct;
      this.streetAggressions = 0;
      this.lastStreet = hand.street;
      for (const p of hand.players) {
        this.lastSnap.set(p.seatIndex, {
          folded: p.folded,
          streetCommit: p.streetCommit,
          handCommit: p.handCommit,
        });
      }
      return;
    }

    const actedSeat = this.lastToAct;
    if (actedSeat !== null && seatUsers.has(actedSeat)) {
      const uid = seatUsers.get(actedSeat)!;
      if (uid !== viewerUserId) {
        this.recordAction(actedSeat, uid, hand);
      }
    }

    if (hand.street === "COMPLETE") {
      for (const [, uid] of seatUsers) {
        if (uid === viewerUserId) continue;
        const row = this.bump(uid);
        row.hands += 1;
      }
      this.handId = null;
      this.preflopVoluntary.clear();
      this.lastSnap.clear();
      this.streetAggressions = 0;
      this.lastStreet = null;
      return;
    }

    if (hand.street !== this.lastStreet) {
      this.streetAggressions = 0;
      this.lastStreet = hand.street;
    }

    for (const p of hand.players) {
      this.lastSnap.set(p.seatIndex, {
        folded: p.folded,
        streetCommit: p.streetCommit,
        handCommit: p.handCommit,
      });
    }
    this.lastPot = hand.pot;
    this.lastCurrentBet = hand.currentBet;
    this.lastToAct = hand.toAct;
  }

  private recordAction(actedSeat: number, userId: string, hand: PublicHandState): void {
    const prev = this.lastSnap.get(actedSeat);
    const pl = hand.players.find((p) => p.seatIndex === actedSeat);
    if (!prev || !pl) return;

    const row = this.bump(userId);
    const betFacing = this.lastCurrentBet > prev.streetCommit;

    if (pl.folded && !prev.folded) {
      row.folds += 1;
      if (betFacing && this.lastCurrentBet > 0) {
        /* counted as fold when facing bet */
      }
      return;
    }

    if (!pl.folded && pl.streetCommit === prev.streetCommit && hand.currentBet <= pl.streetCommit) {
      row.checks += 1;
      return;
    }

    if (pl.streetCommit > prev.streetCommit) {
      if (hand.street === "PREFLOP" && pl.handCommit > hand.bigBlind && !this.preflopVoluntary.has(actedSeat)) {
        this.preflopVoluntary.add(actedSeat);
        row.vpip += 1;
      }

      const raisedLevel = hand.currentBet > this.lastCurrentBet;
      if (raisedLevel) {
        if (this.streetAggressions === 0) {
          row.raises += 1;
        } else {
          row.reRaises += 1;
        }
        this.streetAggressions += 1;
      } else if (betFacing) {
        row.calls += 1;
      }
    }
  }
}

export function buildSeatUserMap(
  seats: { seatIndex: number; user: { id: string } | null }[],
): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of seats) {
    if (s.user?.id) m.set(s.seatIndex, s.user.id);
  }
  return m;
}

export function pct(n: number, d: number): string {
  if (d <= 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}
