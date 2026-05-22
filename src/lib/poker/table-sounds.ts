/**
 * Table UI sounds — MP3 assets in `/public/sounds/` (see filenames below).
 * Fold has no dedicated clip; uses a tiny built-in tone so the module stays self-contained.
 */

const SOUND = {
  check: "/sounds/check.mp3",
  call: "/sounds/call.mp3",
  /** Betting raise — chip stack (placing-chips clip). */
  raiseBet: "/sounds/between-hands.mp3",
  /** New hand after previous completed — shuffle clip only here. */
  shuffleBetweenHands: "/sounds/raise.mp3",
  allIn: "/sounds/all-in.mp3",
  yourTurn: "/sounds/your-turn.mp3",
  cardFlip: "/sounds/card-flip.mp3",
  tipDealer: "/sounds/tip-dealer.mp3",
  handWin: "/sounds/hand-win.mp3",
} as const;

function playMp3(src: string, volume = 0.88): void {
  if (typeof window === "undefined") return;
  try {
    const a = new Audio(src);
    a.volume = Math.min(1, Math.max(0, volume));
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Skip `trimStartSec` at the beginning, stop `trimEndSec` before the file end. */
function playMp3Trimmed(src: string, trimStartSec: number, trimEndSec: number, volume = 0.88): void {
  if (typeof window === "undefined") return;
  try {
    const a = new Audio(src);
    a.volume = Math.min(1, Math.max(0, volume));
    const stopAt = () => {
      const d = a.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      const start = Math.min(trimStartSec, Math.max(0, d - 0.06));
      const end =
        d > trimEndSec ? Math.max(start + 0.04, d - trimEndSec) : Math.max(start + 0.04, d - 0.01);
      if (a.currentTime >= end) {
        a.pause();
        a.currentTime = 0;
        a.removeEventListener("timeupdate", stopAt);
      }
    };
    a.addEventListener(
      "loadedmetadata",
      () => {
        const d = a.duration;
        if (!Number.isFinite(d) || d <= 0) return;
        const start = Math.min(trimStartSec, Math.max(0, d - 0.06));
        const end =
          d > trimEndSec ? Math.max(start + 0.04, d - trimEndSec) : Math.max(start + 0.04, d - 0.01);
        if (end <= start) return;
        a.currentTime = start;
        a.addEventListener("timeupdate", stopAt);
        void a.play().catch(() => {});
      },
      { once: true },
    );
    a.load();
  } catch {
    /* ignore */
  }
}

let foldCtx: AudioContext | null = null;

function playFoldTone(): void {
  if (typeof window === "undefined") return;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!foldCtx) foldCtx = new Ctx();
    if (foldCtx.state === "suspended") void foldCtx.resume().catch(() => {});
    const t = foldCtx.currentTime;
    const o = foldCtx.createOscillator();
    const g = foldCtx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(196, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g);
    g.connect(foldCtx.destination);
    o.start(t);
    o.stop(t + 0.1);
  } catch {
    /* ignore */
  }
}

export function playYourTurnSound(): void {
  playMp3(SOUND.yourTurn, 0.82);
}

export function playFoldSound(): void {
  playFoldTone();
}

export function playCheckSound(): void {
  playMp3Trimmed(SOUND.check, 0.6, 0, 0.9);
}

export function playCallSound(): void {
  playMp3(SOUND.call, 0.88);
}

export function playRaiseSound(): void {
  playMp3(SOUND.raiseBet, 0.85);
}

export function playAllInSound(): void {
  playMp3(SOUND.allIn, 0.9);
}

export function playCardFlipSound(): void {
  playMp3(SOUND.cardFlip, 0.78);
}

export function playTipDealerSound(): void {
  playMp3(SOUND.tipDealer, 0.88);
}

/** New hand after previous completed — shuffle clip. */
export function playBetweenHandsShuffleSound(): void {
  // Disabled: users requested to remove the shuffling sound effect.
  // Keep the function as a no-op so the rest of the table UI flow stays unchanged.
}

/** Viewer won chips this hand (stack increased from start of hand to complete). */
export function playHandWinSound(): void {
  playMp3(SOUND.handWin, 0.82);
}
