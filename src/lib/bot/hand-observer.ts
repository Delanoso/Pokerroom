import type { PublicHandState } from "@/lib/poker/public-state";
import type { LearningStore, OpponentProfile } from "./learning-store";
import { getOpponentProfile, upsertOpponentProfile } from "./learning-store";

export type SeatUserMap = Map<number, string>;

type SeatSnap = {
  folded: boolean;
  streetCommit: number;
  handCommit: number;
};

export class HandObserver {
  private handId: string | null = null;
  private preflopCommitted = new Set<number>();
  private lastSnap = new Map<number, SeatSnap>();
  private lastPot = 0;
  private lastCurrentBet = 0;
  private lastToAct: number | null = null;

  reset(): void {
    this.handId = null;
    this.preflopCommitted.clear();
    this.lastSnap.clear();
    this.lastPot = 0;
    this.lastCurrentBet = 0;
    this.lastToAct = null;
  }

  observe(
    handId: string,
    hand: PublicHandState,
    viewerSeat: number,
    seatUsers: SeatUserMap,
    store: LearningStore,
  ): void {
    if (this.handId !== handId) {
      this.handId = handId;
      this.preflopCommitted.clear();
      this.lastSnap.clear();
      this.lastPot = hand.pot;
      this.lastCurrentBet = hand.currentBet;
      this.lastToAct = hand.toAct;
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
    if (actedSeat !== null && actedSeat !== viewerSeat && seatUsers.has(actedSeat)) {
      const uid = seatUsers.get(actedSeat)!;
      const prof = { ...getOpponentProfile(store, uid) };
      const prev = this.lastSnap.get(actedSeat);
      const pl = hand.players.find((p) => p.seatIndex === actedSeat);
      if (prev && pl) {
        const betFacing = this.lastCurrentBet > prev.streetCommit;
        if (betFacing && this.lastCurrentBet > 0) {
          prof.facedBet += 1;
          if (pl.folded && !prev.folded) prof.foldToBet += 1;
          else if (pl.streetCommit > prev.streetCommit) {
            if (hand.currentBet > this.lastCurrentBet) {
              prof.raiseCount += 1;
              if (hand.street === "PREFLOP") prof.pfrCount += 1;
            } else {
              prof.callCount += 1;
            }
          }
        }
        if (hand.street === "PREFLOP" && pl.handCommit > hand.bigBlind && !this.preflopCommitted.has(actedSeat)) {
          this.preflopCommitted.add(actedSeat);
          prof.vpipCount += 1;
        }
      }
      upsertOpponentProfile(store, prof);
    }

    if (hand.street === "COMPLETE") {
      for (const [seat, uid] of seatUsers) {
        if (seat === viewerSeat) continue;
        const prof = { ...getOpponentProfile(store, uid) };
        prof.handsObserved += 1;
        upsertOpponentProfile(store, prof);
      }
      this.reset();
      return;
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
}

export function buildSeatUserMap(
  seats: { seatIndex: number; user: { id: string } | null }[],
): SeatUserMap {
  const m: SeatUserMap = new Map();
  for (const s of seats) {
    if (s.user?.id) m.set(s.seatIndex, s.user.id);
  }
  return m;
}

export function tableOpponentProfiles(
  store: LearningStore,
  seatUsers: SeatUserMap,
  botUserId: string,
): OpponentProfile[] {
  const out: OpponentProfile[] = [];
  for (const uid of seatUsers.values()) {
    if (uid === botUserId) continue;
    const p = getOpponentProfile(store, uid);
    if (p.handsObserved > 0 || p.facedBet > 0) out.push(p);
  }
  return out;
}
