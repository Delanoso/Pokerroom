import type { CSSProperties } from "react";

/** Degrees of arc kept clear at the top for the dealer tray. */
const TOP_GAP_DEG = 68;
/** Ellipse radii (% of table box) — tuned for the wide oval felt. */
const RX_PCT = 44;
const RY_PCT = 40;

export type TableLayoutMode = "desktop" | "portrait";

export type SeatLayoutOptions = {
  mode?: TableLayoutMode;
  /** When portrait, this seat is anchored at the bottom (your seat). */
  heroSeatIndex?: number | null;
  /** Narrow screens: pull side seats slightly toward centre. */
  compact?: boolean;
};

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

/**
 * Portrait phone layout: hero at bottom centre, opponents on the upper arc
 * (no rotation required — matches how most mobile poker apps feel).
 */
export function seatPositionPortrait(
  seatIndex: number,
  maxSeats: number,
  heroSeatIndex: number | null,
): SeatPositionPct {
  const n = Math.max(2, Math.min(9, Math.floor(maxSeats)));
  const hero = heroSeatIndex ?? 0;
  const rel = ((seatIndex - hero) % n + n) % n;

  if (rel === 0) {
    return { left: 50, top: 86 };
  }

  const oppCount = n - 1;
  const oppIdx = rel - 1;
  const arcStart = 200;
  const arcEnd = 340;
  const angleDeg = arcStart + ((oppIdx + 0.5) / oppCount) * (arcEnd - arcStart);
  const rad = (angleDeg * Math.PI) / 180;
  const cx = 50;
  const cy = 36;
  const rx = 42;
  const ry = 30;
  return {
    left: cx + rx * Math.sin(rad),
    top: cy - ry * Math.cos(rad),
  };
}

function ellipseRadii(options?: SeatLayoutOptions): { rx: number; ry: number } {
  if (options?.compact) {
    return { rx: 38, ry: 36 };
  }
  return { rx: RX_PCT, ry: RY_PCT };
}

function seatPositionPercentWithRadii(
  seatIndex: number,
  maxSeats: number,
  rxPct: number,
  ryPct: number,
): SeatPositionPct {
  const n = Math.max(2, Math.min(9, Math.floor(maxSeats)));
  const idx = Math.max(0, Math.min(n - 1, seatIndex));

  const arcStart = TOP_GAP_DEG / 2;
  const arcEnd = 360 - TOP_GAP_DEG / 2;
  const arcSpan = arcEnd - arcStart;
  const angleDeg = arcStart + ((idx + 0.5) / n) * arcSpan;
  const rad = (angleDeg * Math.PI) / 180;

  const left = 50 + rxPct * Math.sin(rad);
  const top = 50 - ryPct * Math.cos(rad);

  return { left, top };
}

function resolveSeatPosition(
  seatIndex: number,
  maxSeats: number,
  options?: SeatLayoutOptions,
): SeatPositionPct {
  if (options?.mode === "portrait") {
    return seatPositionPortrait(seatIndex, maxSeats, options.heroSeatIndex ?? null);
  }
  const { rx, ry } = ellipseRadii(options);
  return seatPositionPercentWithRadii(seatIndex, maxSeats, rx, ry);
}

export function seatLayoutStyle(
  seatIndex: number,
  maxSeats: number,
  options?: SeatLayoutOptions,
): CSSProperties {
  const { left, top } = resolveSeatPosition(seatIndex, maxSeats, options);
  return {
    position: "absolute",
    left: `${left}%`,
    top: `${top}%`,
    transform: "translate(-50%, -50%)",
  };
}

/** Dealer button disc — between the button seat and table centre. */
export function dealerButtonStyle(
  buttonSeat: number,
  maxSeats: number,
  options?: SeatLayoutOptions & { t?: number },
): CSSProperties {
  const t = options?.t ?? 0.45;
  const seat = resolveSeatPosition(buttonSeat, maxSeats, options);
  let left = seat.left + (50 - seat.left) * t;
  let top = seat.top + (50 - seat.top) * t;

  const towardSeat = seat.left > 54 ? 0.38 : 0.2;
  left += (seat.left - left) * towardSeat;
  top += (seat.top - top) * towardSeat;

  if (seat.left > 54) {
    top -= 3;
  }

  if (options?.mode === "portrait") {
    top = Math.min(top, 72);
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
  options?: SeatLayoutOptions & { t?: number },
): CSSProperties {
  const t = options?.t ?? 0.3;
  const base = lerpSeatTowardCenter(seatIndex, maxSeats, t, options);
  return { ...base, transform: "translate(-50%, -100%)" };
}

function lerpSeatTowardCenter(
  seatIndex: number,
  maxSeats: number,
  t: number,
  options?: SeatLayoutOptions,
): CSSProperties {
  const { left, top } = resolveSeatPosition(seatIndex, maxSeats, options);
  const centerTop = options?.mode === "portrait" ? 44 : 50;
  return {
    position: "absolute",
    left: `${left + (50 - left) * t}%`,
    top: `${top + (centerTop - top) * t}%`,
    transform: "translate(-50%, -50%)",
  };
}
