import { canRaiseInCurrentSpot } from "./betting-rules";
import { contestedShowdownFromState } from "./showdown-reveal";
import type { PublicHandPlayer, PublicHandState } from "./public-hand-types";
import type { NlheHandState } from "./types";

export type { PublicHandPlayer, PublicHandState } from "./public-hand-types";
export { isContestedShowdown, aliveInHandCount } from "./showdown-reveal";

export function toPublicHandState(
  state: NlheHandState,
  viewerUserId: string | null,
): PublicHandState {
  const viewerSeat =
    viewerUserId === null
      ? null
      : (state.players.find((p) => p.userId === viewerUserId)?.seatIndex ?? null);

  const revealContested = contestedShowdownFromState(state);

  const players: PublicHandPlayer[] = state.players.map((p) => {
    const isSelf =
      Boolean(viewerUserId) &&
      (p.userId === viewerUserId || (viewerSeat !== null && p.seatIndex === viewerSeat));
    const showHole = Boolean(!p.folded && (revealContested || isSelf));
    return {
      seatIndex: p.seatIndex,
      stack: p.stack,
      streetCommit: p.streetCommit,
      handCommit: p.handCommit,
      folded: p.folded,
      hole: showHole ? p.hole : null,
    };
  });

  const legal: PublicHandState["legal"] = [];
  if (
    viewerUserId &&
    viewerSeat !== null &&
    state.toAct === viewerSeat &&
    state.street !== "COMPLETE" &&
    state.street !== "SHOWDOWN"
  ) {
    const p = state.players.find((x) => x.seatIndex === viewerSeat)!;
    const toCall = Math.max(0, state.currentBet - p.streetCommit);
    if (toCall > 0) {
      legal.push("FOLD");
      if (p.stack > 0) {
        legal.push("CALL");
        if (canRaiseInCurrentSpot(state, viewerSeat)) {
          legal.push("RAISE");
        }
      }
    } else {
      if (p.stack > 0) {
        legal.push("CHECK");
      }
      if (p.stack > 0 && canRaiseInCurrentSpot(state, viewerSeat)) {
        legal.push("RAISE");
      }
    }
  }

  return {
    street: state.street,
    board: state.board,
    pot: state.pot,
    toAct: state.toAct,
    buttonSeat: state.buttonSeat,
    sbSeat: state.sbSeat,
    bbSeat: state.bbSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    players,
    resultMessage: state.resultMessage,
    legal,
    viewerSeat,
    turnDeadlineIso: state.turnDeadlineIso ?? null,
    showdownRevealUntilIso: state.showdownRevealUntilIso ?? null,
  };
}
