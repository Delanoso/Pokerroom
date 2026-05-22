import type { CSSProperties } from "react";

/** Degrees of arc kept clear at the top for the dealer tray. */
const TOP_GAP_DEG = 68;
/** Ellipse radii (% of table box) — tuned for the wide oval felt. */
const RX_PCT = 44;
const RY_PCT = 40;

export type SeatPositionPct = { left: number; top: number };

/**
 * Place seats evenly on an ellipse around the felt (clockwise from lower-right),
 * with the top arc left clear for the dealer tray. Works for 2–9 seats.
 */
export function seatPositionPercent(seatIndex: number, maxSeats: number): SeatPositionPct {
  const n = Math.max(2, Math.min(9, Math.floor(maxSeats)));
  const idx = Math.max(0, Math.min(n - 1, seatIndex));

  const arcStart = TOP_GAP_DEG / 2;
  const arcEnd = 360 - TOP_GAP_DEG / 2;
  const arcSpan = arcEnd - arcStart;
  const angleDeg = arcStart + ((idx + 0.5) / n) * arcSpan;
  const rad = (angleDeg * Math.PI) / 180;

  // 0° = top of ellipse; increases clockwise (screen coords).
  const left = 50 + RX_PCT * Math.sin(rad);
  const top = 50 - RY_PCT * Math.cos(rad);

  return { left, top };
}

export function seatLayoutStyle(seatIndex: number, maxSeats: number): CSSProperties {
  const { left, top } = seatPositionPercent(seatIndex, maxSeats);
  return {
    position: "absolute",
    left: `${left}%`,
    top: `${top}%`,
    transform: "translate(-50%, -50%)",
  };
}

/** Dealer button disc — between the button seat and table centre. */
export function dealerButtonStyle(buttonSeat: number, maxSeats: number, t = 0.45): CSSProperties {
  const seat = seatPositionPercent(buttonSeat, maxSeats);
  let left = seat.left + (50 - seat.left) * t;
  let top = seat.top + (50 - seat.top) * t;

  // Pull toward the seat so the disc does not sit on the community cards (river is right of centre).
  const towardSeat = seat.left > 54 ? 0.38 : 0.2;
  left += (seat.left - left) * towardSeat;
  top += (seat.top - top) * towardSeat;

  if (seat.left > 54) {
    top -= 3;
  }

  return {
    position: "absolute",
    left: `${left}%`,
    top: `${top}%`,
    transform: "translate(-50%, -50%)",
  };
}

/** Street bet stack — partway from seat toward centre. */
export function betChipsTowardCenterStyle(
  seatIndex: number,
  maxSeats: number,
  t = 0.3,
): CSSProperties {
  const base = lerpSeatTowardCenter(seatIndex, maxSeats, t);
  return { ...base, transform: "translate(-50%, -100%)" };
}

function lerpSeatTowardCenter(seatIndex: number, maxSeats: number, t: number): CSSProperties {
  const { left, top } = seatPositionPercent(seatIndex, maxSeats);
  return {
    position: "absolute",
    left: `${left + (50 - left) * t}%`,
    top: `${top + (50 - top) * t}%`,
    transform: "translate(-50%, -50%)",
  };
}
