"use client";

import type { PublicHandState } from "@/lib/poker/public-hand-types";
import { isContestedShowdown } from "@/lib/poker/showdown-reveal";
import { humanizeResultMessage } from "@/lib/poker/humanize-result-message";
import {
  buildTableHandLogSnap,
  deriveHandLogMessages,
  type TableHandLogSnap,
} from "@/lib/poker/table-hand-log";
import { formatTournamentPrizeLine } from "@/lib/tournament-prizes";
import type { TournamentViewerSnapshot } from "@/lib/tournament-policy";
import { formatBlindLevelCountdown } from "@/lib/tournament-blind-escalation";
import { ACTION_TIMEOUT_MS } from "@/lib/poker/action-timeout";
import {
  betChipsTowardCenterStyle,
  dealerButtonStyle,
  seatLayoutStyle,
  type TableLayoutMode,
} from "@/lib/poker/table-seat-layout";
import {
  playAllInSound,
  playBetweenHandsShuffleSound,
  playCallSound,
  playCardFlipSound,
  playHandWinSound,
  playCheckSound,
  playFoldSound,
  playRaiseSound,
  playTipDealerSound,
  playYourTurnSound,
} from "@/lib/poker/table-sounds";
import { HandStrengthBar } from "@/components/hand-strength-bar";
import { TableActionPanel } from "@/components/table-action-panel";
import { TablePlayerSidebar, type SidebarPlayer } from "@/components/table-player-sidebar";
import { useTableSocketOptional } from "@/components/table-socket-provider";
import type { LastCompletedHandResult } from "@/lib/poker/last-completed-hand-result";
import {
  buildSeatUserMap,
  PlayerSessionStatsTracker,
  type SessionStatCounts,
} from "@/lib/poker/player-session-stats";
import { formatChips, formatZar } from "@/lib/format-currency";
import { claimTablePlayTab, tablePlayUrl, tableWindowTarget } from "@/lib/poker/open-table-window";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Standard chip colours: white $1, red $5, green $25, blue $50, black $100, yellow $1,000 */
const CHIP_VALUES_DESC = [1000, 100, 50, 25, 5, 1] as const;
type ChipDenom = (typeof CHIP_VALUES_DESC)[number];

type Seat = {
  seatIndex: number;
  stackChips: number;
  sittingOut: boolean;
  sitOutNextHand: boolean;
  waitingForNextHand: boolean;
  user: { id: string; username: string; usernameDisplay: string; displayName: string } | null;
};

export type TablePayload = {
  id: string;
  name: string;
  kind: "CASH" | "TOURNAMENT" | "SIT_AND_GO";
  startsAt: string | null;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  tournamentEntryFeeZar?: number;
  tournamentStartingStackChips?: number;
  hostUsername: string;
  seats: Seat[];
};

export type TableRoomInitial = {
  table: TablePayload;
  viewerUserId: string;
  viewerBalance: number;
  mySeatIndex: number | null;
  /** Operator or table host may force an early tournament start. */
  viewerCanDeal: boolean;
  isSiteAdmin: boolean;
  tournament: TournamentViewerSnapshot | null;
  viewerEliminatedFromSnG: boolean;
  /** Server render time — keeps countdown text aligned on hydration. */
  serverNowMs: number;
};

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

const SUIT_SYM: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function formatCard(code: string): string {
  if (code.length < 2) return code;
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  const r = rank === "T" ? "10" : rank;
  return `${r}${SUIT_SYM[suit] ?? suit}`;
}

function parseCard(code: string): { rank: string; suitChar: string } {
  if (code.length < 2) return { rank: "?", suitChar: "" };
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  return { rank: rank === "T" ? "10" : rank, suitChar: SUIT_SYM[suit] ?? suit };
}

function PlayingCardFace({ code, className = "" }: { code: string; className?: string }) {
  const { rank, suitChar } = parseCard(code);
  const red = suitChar === "♥" || suitChar === "♦";
  const ink = red ? "text-red-600" : "text-zinc-900";
  return (
    <div
      className={`relative flex h-[4.5rem] w-[3.25rem] shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border border-zinc-300/90 bg-gradient-to-br from-[#faf8f5] via-white to-[#e8e4dc] text-center shadow-[0_4px_14px_rgba(0,0,0,0.35),0_1px_0_rgba(255,255,255,0.85)_inset,inset_0_-3px_8px_rgba(0,0,0,0.06)] ring-1 ring-black/15 ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-multiply"
        style={{
          backgroundImage: `repeating-linear-gradient(-12deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 3px)`,
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-[3px] rounded-sm border border-white/70 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]" aria-hidden />
      <span className={`absolute left-1 top-0.5 text-[8px] font-bold leading-none ${ink}`}>
        {rank}
        <span className="block text-[7px] leading-none">{suitChar}</span>
      </span>
      <span className={`absolute bottom-0.5 right-1 rotate-180 text-[8px] font-bold leading-none ${ink}`}>
        {rank}
        <span className="block text-[7px] leading-none">{suitChar}</span>
      </span>
      <div className="relative z-[1] flex flex-col items-center justify-center">
        <span className={`text-lg font-bold leading-none drop-shadow-[0_1px_0_rgba(255,255,255,0.6)] ${ink}`}>{rank}</span>
        <span className={`mt-0.5 text-xl leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.12)] ${ink}`}>{suitChar}</span>
      </div>
    </div>
  );
}

function BoardCardFace({ code, className = "" }: { code: string; className?: string }) {
  const { rank, suitChar } = parseCard(code);
  const red = suitChar === "♥" || suitChar === "♦";
  const ink = red ? "text-red-600" : "text-zinc-900";
  return (
    <span
      className={`relative inline-flex min-h-[2.65rem] min-w-[2.35rem] flex-col items-center justify-center overflow-hidden rounded-lg border border-zinc-300/90 bg-gradient-to-br from-[#faf8f5] via-white to-[#e8e4dc] px-1 py-0.5 font-sans text-lg font-bold shadow-[0_3px_10px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.75)] ring-1 ring-black/12 sm:min-w-[2.55rem] sm:text-xl ${className}`}
    >
      <span className={`absolute left-0.5 top-0.5 text-[6px] font-bold leading-none ${ink}`}>
        {rank}
        <span className="block text-[5px]">{suitChar}</span>
      </span>
      <span className={`absolute bottom-0.5 right-0.5 rotate-180 text-[6px] font-bold leading-none ${ink}`}>
        {rank}
        <span className="block text-[5px]">{suitChar}</span>
      </span>
      <div className="relative z-[1] flex items-center justify-center gap-0.5 pt-1.5">
        <span className={`text-base font-bold leading-none sm:text-lg ${ink}`}>{rank}</span>
        <span className={`text-lg leading-none sm:text-xl ${ink}`}>{suitChar}</span>
      </div>
    </span>
  );
}

/** Hole card: deal-in motion, then cross-fade back → face. */
function FlippableHoleCard({
  code,
  faceUp,
  dealStage,
  className = "",
}: {
  code: string;
  faceUp: boolean;
  dealStage: "in" | "settled";
  className?: string;
}) {
  const dealCls =
    dealStage === "in" ? "translate-y-7 opacity-40 scale-95" : "translate-y-0 opacity-100 scale-100";
  return (
    <div
      className={`relative h-[4.5rem] w-[3.25rem] shrink-0 transition-all duration-450 ease-out ${dealCls} ${className}`}
    >
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ease-out ${
          faceUp ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={faceUp}
      >
        <PlayingCardBack className="h-[4.5rem] w-[3.25rem] rounded-md" />
      </div>
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ease-out ${
          faceUp ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <PlayingCardFace code={code} className="h-full w-full" />
      </div>
    </div>
  );
}

/** Board community card: back until `faceUp`, then cross-fade to face. */
function FlippableBoardCard({ code, faceUp }: { code: string; faceUp: boolean }) {
  return (
    <div className="relative h-[2.75rem] w-[2.4rem] shrink-0 sm:h-[3rem] sm:w-[2.65rem]">
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ease-out ${
          faceUp ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={faceUp}
      >
        <PlayingCardBack className="h-[2.65rem] w-[2.05rem] sm:h-[2.85rem] sm:w-[2.2rem]" />
      </div>
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ease-out ${
          faceUp ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <BoardCardFace code={code} />
      </div>
    </div>
  );
}

function PlayingCardBack({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative flex h-11 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-amber-500/45 shadow-[0_4px_14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(253,230,138,0.35),inset_0_-10px_22px_rgba(69,26,3,0.55)] ring-1 ring-amber-400/25 ${className}`}
      style={{
        background: `linear-gradient(148deg, #fbbf24 0%, #d97706 28%, #b45309 55%, #78350f 82%, #451a03 100%)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            -32deg,
            rgba(255,255,255,0.07) 0px 1px,
            transparent 1px 5px
          )`,
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-[10%] rounded-sm border border-amber-200/30 bg-gradient-to-b from-black/5 to-amber-950/25 shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute left-1 top-1 text-[10px] leading-none text-black/55"
        aria-hidden
      >
        ♠
      </span>
      <span
        className="pointer-events-none absolute bottom-1 right-1 rotate-180 text-[10px] leading-none text-black/55"
        aria-hidden
      >
        ♠
      </span>
      <span
        className="relative z-[1] text-[1.35rem] font-black leading-none text-black drop-shadow-[0_1px_0_rgba(255,255,255,0.22),0_2px_6px_rgba(0,0,0,0.35)]"
        aria-hidden
      >
        ♠
      </span>
    </div>
  );
}

function greedyChipBreakdown(total: number, maxPerDenom = 7): { denom: ChipDenom; count: number }[] {
  let rest = Math.max(0, Math.floor(total));
  const out: { denom: ChipDenom; count: number }[] = [];
  for (const v of CHIP_VALUES_DESC) {
    const n = Math.floor(rest / v);
    rest -= n * v;
    if (n > 0) out.push({ denom: v, count: Math.min(n, maxPerDenom) });
  }
  return out;
}

function denomToChipTone(d: ChipDenom): "white" | "red" | "green" | "blue" | "black" | "yellow" {
  switch (d) {
    case 1:
      return "white";
    case 5:
      return "red";
    case 25:
      return "green";
    case 50:
      return "blue";
    case 100:
      return "black";
    case 1000:
      return "yellow";
  }
}

/** Clay casino chip — radial face, moulded edge, contact shadow. */
function PokerChipDisc({
  tone,
  className = "",
}: {
  tone: "white" | "red" | "green" | "blue" | "black" | "yellow";
  className?: string;
}) {
  const face = {
    white:
      "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.98) 0%, #f4f4f5 38%, #a1a1aa 72%, #71717a 100%)",
    red: "radial-gradient(circle at 30% 28%, #fecdd3 0%, #e11d48 42%, #9f1239 78%, #4c0519 100%)",
    green:
      "radial-gradient(circle at 30% 28%, #d1fae5 0%, #10b981 42%, #065f46 78%, #022c22 100%)",
    blue: "radial-gradient(circle at 30% 28%, #bae6fd 0%, #2563eb 42%, #1e3a8a 78%, #172554 100%)",
    black:
      "radial-gradient(circle at 30% 28%, #a1a1aa 0%, #3f3f46 45%, #18181b 82%, #09090b 100%)",
    yellow:
      "radial-gradient(circle at 30% 28%, #fef9c3 0%, #eab308 40%, #a16207 76%, #422006 100%)",
  } as const;

  const edge = {
    white: "from-zinc-300 via-zinc-500 to-zinc-700",
    red: "from-rose-300 via-rose-700 to-red-950",
    green: "from-emerald-300 via-emerald-700 to-emerald-950",
    blue: "from-sky-300 via-blue-800 to-blue-950",
    black: "from-zinc-500 via-zinc-800 to-black",
    yellow: "from-amber-200 via-amber-600 to-amber-950",
  } as const;

  return (
    <div
      className={`relative shrink-0 rounded-full p-[2.5px] ${className}`}
      style={{
        background: `linear-gradient(145deg, rgba(255,255,255,0.22), rgba(0,0,0,0.55))`,
        boxShadow:
          "0 3px 5px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.12) inset, 0 -2px 6px rgba(0,0,0,0.45) inset",
      }}
    >
      <div
        className={`relative overflow-hidden rounded-full bg-gradient-to-b ${edge[tone]}`}
        style={{
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -3px 8px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="relative aspect-square w-full rounded-full border border-black/35"
          style={{
            background: face[tone],
            boxShadow:
              "inset 0 5px 10px rgba(255,255,255,0.45), inset 0 -8px 14px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,0,0,0.12)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-[10%] rounded-full border border-white/15"
            style={{
              boxShadow: "inset 0 2px 4px rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.25)",
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-[22%] rounded-full border border-black/20 bg-black/5"
            style={{ boxShadow: "inset 0 1px 2px rgba(255,255,255,0.2)" }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-[38%] rounded-full bg-gradient-to-b from-white/25 to-transparent opacity-70"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-full opacity-[0.18]"
            style={{
              background: `repeating-conic-gradient(
            from 0deg,
            transparent 0deg 11deg,
            rgba(0,0,0,0.2) 11deg 13deg
          )`,
            }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

function ChipDenomStack({
  breakdown,
  discClass,
  gapClass = "gap-0.5",
  stackKind = "bet",
  tightColumns = false,
}: {
  breakdown: { denom: ChipDenom; count: number }[];
  discClass: string;
  gapClass?: string;
  /** Tighter overlap and shadow for in-play vs main pot. */
  stackKind?: "bet" | "pot" | "tray";
  /** Pull denom columns together so the rack reads as one stack, not a line. */
  tightColumns?: boolean;
}) {
  const overlapClass =
    stackKind === "pot" ? "-mb-[6px]" : stackKind === "tray" ? "-mb-[3px]" : "-mb-[7px]";
  const shell =
    stackKind === "pot"
      ? "drop-shadow-[0_5px_6px_rgba(0,0,0,0.55)]"
      : "drop-shadow-[0_4px_5px_rgba(0,0,0,0.5)]";
  return (
    <div className={`flex flex-nowrap items-end justify-center ${gapClass} ${shell}`}>
      {breakdown.map(({ denom, count }, di) => (
        <div
          key={denom}
          className={`flex flex-col-reverse items-center ${tightColumns && di > 0 ? "-ml-2.5 sm:-ml-[11px]" : ""}`}
        >
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={`${denom}-${i}`}
              className={`first:mb-0 ${overlapClass} relative`}
              style={{
                zIndex: i,
                transform: `rotate(${(i * 11) % 9 - 4}deg) translateY(${i * (stackKind === "bet" ? 0.25 : 0.45)}px)`,
              }}
            >
              <PokerChipDisc tone={denomToChipTone(denom)} className={discClass} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function BetChipsVisual({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  const breakdown = greedyChipBreakdown(amount, 10);
  return (
    <div className="flex flex-col items-center" title={`${amount.toLocaleString()} this street`}>
      <ChipDenomStack
        breakdown={breakdown}
        discClass="h-[0.58rem] w-[0.58rem] sm:h-[0.62rem] sm:w-[0.62rem]"
        gapClass="gap-0"
        stackKind="bet"
        tightColumns
      />
      <span className="mt-0.5 rounded bg-black/65 px-1 py-px text-[8px] font-bold tabular-nums text-amber-100 ring-1 ring-amber-500/35 shadow-sm sm:text-[9px]">
        {amount.toLocaleString()}
      </span>
    </div>
  );
}

/** Main pot — taller columns, heavier discs */
function MainPotChips({ amount }: { amount: number }) {
  const breakdown = greedyChipBreakdown(amount, 12);
  return (
    <div
      className="flex flex-col items-center gap-0.5"
      style={{ transform: "perspective(420px) rotateX(8deg)", transformOrigin: "50% 100%" }}
    >
      <ChipDenomStack
        breakdown={breakdown}
        discClass="h-[0.72rem] w-[0.72rem] sm:h-[0.78rem] sm:w-[0.78rem]"
        gapClass="gap-0"
        stackKind="pot"
        tightColumns
      />
      <span className="text-[10px] font-bold tabular-nums text-amber-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
        {amount.toLocaleString()}
      </span>
    </div>
  );
}

/** Decorative house rack — all denom colours in a full tray (not a live balance). */
const DEALER_TRAY_BREAKDOWN: { denom: ChipDenom; count: number }[] = [
  { denom: 1, count: 9 },
  { denom: 5, count: 8 },
  { denom: 25, count: 8 },
  { denom: 50, count: 7 },
  { denom: 100, count: 6 },
  { denom: 1000, count: 5 },
];

function SeatAvatar({ username }: { username: string }) {
  const ch = username.charAt(0).toUpperCase() || "?";
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-slate-600 via-slate-800 to-slate-950 text-xs font-bold uppercase text-slate-100 shadow-inner ring-1 ring-sky-900/50 sm:h-9 sm:w-9 sm:text-sm">
      {ch}
    </div>
  );
}

/** Yellow countdown bar under a seat (references: PlayersOnly / similar skins). */
function SeatTurnTimerBar({
  deadlineIso,
  nowMs,
}: {
  deadlineIso: string | null | undefined;
  nowMs: number;
}) {
  if (!deadlineIso) return null;
  const pct = Math.min(
    100,
    (Math.max(0, new Date(deadlineIso).getTime() - nowMs) / ACTION_TIMEOUT_MS) * 100,
  );
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-slate-950 ring-1 ring-slate-700/60">
      <div
        className="h-full rounded-sm bg-gradient-to-r from-yellow-500 to-amber-400"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function seatStackFromHand(seat: Seat, hand: PublicHandState | null): number {
  if (!hand) return seat.stackChips;
  const hp = hand.players.find((p) => p.seatIndex === seat.seatIndex);
  if (hp) return hp.stack;
  return seat.stackChips;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function secondsRemaining(deadlineIso: string | null | undefined, nowMs: number): number | null {
  if (!deadlineIso) return null;
  const t = new Date(deadlineIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

function isValidCardCode(c: string | undefined | null): boolean {
  return typeof c === "string" && c.length >= 2 && c.length <= 3;
}

function holeCardsReady(hole: [string, string] | null | undefined): hole is [string, string] {
  return !!hole && hole.length >= 2 && isValidCardCode(hole[0]) && isValidCardCode(hole[1]);
}

function isMidHandLeave409(data: { error?: string; code?: string }) {
  if (data.code === "MID_HAND_LEAVE_CONFIRM") return true;
  const msg = typeof data.error === "string" ? data.error.toLowerCase() : "";
  return msg.includes("still in this hand");
}

export function TableRoomClient({
  tableId,
  initial,
  className = "",
  embedded = false,
  isActiveTable = true,
  hideHeaderBankroll = false,
}: {
  tableId: string;
  initial: TableRoomInitial;
  className?: string;
  /** Compact layout for multi-table play page. */
  embedded?: boolean;
  /** When false, hand polling is slower (background table). */
  isActiveTable?: boolean;
  hideHeaderBankroll?: boolean;
}) {
  const sharedSocket = useTableSocketOptional();
  const [table, setTable] = useState(initial.table);
  const viewerUserId = initial.viewerUserId;
  const [viewerBalance, setViewerBalance] = useState(initial.viewerBalance);
  const statsTrackerRef = useRef(new PlayerSessionStatsTracker());
  const [sessionStats, setSessionStats] = useState<Map<string, SessionStatCounts>>(new Map());
  const [mySeatIndex, setMySeatIndex] = useState(initial.mySeatIndex);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isPortraitOrientation, setIsPortraitOrientation] = useState(false);
  const [rotateScale, setRotateScale] = useState(1);
  const tableSceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mySeatIndex !== null) claimTablePlayTab(tableId);
  }, [tableId, mySeatIndex]);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 639px)");
    const portrait = window.matchMedia("(orientation: portrait)");
    const apply = () => {
      setIsMobileViewport(narrow.matches);
      setIsPortraitOrientation(portrait.matches);
    };
    apply();
    narrow.addEventListener("change", apply);
    portrait.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      narrow.removeEventListener("change", apply);
      portrait.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  /** Portrait phone: show laptop landscape layout rotated 90° (no need to turn the device). */
  const showLandscapeInPortrait = isMobileViewport && isPortraitOrientation && !embedded;

  useEffect(() => {
    if (!showLandscapeInPortrait) {
      setRotateScale(1);
      return;
    }
    const outer = tableSceneRef.current;
    if (!outer) return;
    const update = () => {
      const w = outer.clientWidth;
      const h = outer.clientHeight;
      const scale = Math.min(w / window.innerHeight, h / window.innerWidth) * 0.94;
      setRotateScale(Math.max(0.35, Math.min(1, scale)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [showLandscapeInPortrait]);
  const [viewerCanDeal, setViewerCanDeal] = useState(initial.viewerCanDeal);
  const [isSiteAdmin, setIsSiteAdmin] = useState(initial.isSiteAdmin);
  const [tournament, setTournament] = useState<TournamentViewerSnapshot | null>(initial.tournament);
  const [viewerEliminatedFromSnG, setViewerEliminatedFromSnG] = useState(initial.viewerEliminatedFromSnG);
  const [error, setError] = useState<string | null>(null);
  const [midHandLeaveMessage, setMidHandLeaveMessage] = useState<string | null>(null);
  const [tournamentLeaveMessage, setTournamentLeaveMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState("");
  const [hand, setHand] = useState<PublicHandState | null>(null);
  const [activeHandId, setActiveHandId] = useState<string | null>(null);
  const [tableLogLines, setTableLogLines] = useState<{ id: number; text: string }[]>([]);
  const tableLogSeq = useRef(0);
  const prevHandLogSnap = useRef<TableHandLogSnap | null>(null);
  const lastCompletedHandForLog = useRef<LastCompletedHandResult | null>(null);
  const loggedResultHandIds = useRef<Set<string>>(new Set());
  const tableLogScrollRef = useRef<HTMLDivElement | null>(null);
  const [boardSlots, setBoardSlots] = useState<{ code: string; faceUp: boolean }[]>([]);
  const [holeReveal, setHoleReveal] = useState(0);
  const [raiseToInput, setRaiseToInput] = useState("");
  const [nowMs, setNowMs] = useState(initial.serverNowMs);
  const [addChipsOpen, setAddChipsOpen] = useState(false);
  const [addChipsAmount, setAddChipsAmount] = useState("");
  const rafLast = useRef(0);
  const handRef = useRef(hand);
  handRef.current = hand;
  const prevBoardJoin = useRef("");
  const boardAnimTimers = useRef<number[]>([]);
  const holeRevealHandRef = useRef<string | null>(null);
  const activeHandIdRef = useRef<string | null>(null);
  const wasActionDockOpen = useRef(false);
  const lastHandStreetForShuffle = useRef<string | null>(null);
  const heroStackAtHandStart = useRef<number | null>(null);
  const playedHandWinSound = useRef(false);

  const boardSig = hand?.board?.join("|") ?? "";

  useEffect(() => {
    if (!hand) {
      heroStackAtHandStart.current = null;
      playedHandWinSound.current = false;
      return;
    }
    const wasComplete = lastHandStreetForShuffle.current === "COMPLETE";
    if (hand.street === "PREFLOP" && hand.board.length === 0) {
      if (hand.viewerSeat !== null) {
        const hp = hand.players.find((p) => p.seatIndex === hand.viewerSeat);
        if (hp) heroStackAtHandStart.current = hp.stack;
      }
      if (wasComplete) {
        playBetweenHandsShuffleSound();
        playedHandWinSound.current = false;
      }
    }
    if (hand.street === "COMPLETE" && hand.viewerSeat !== null) {
      const hp = hand.players.find((p) => p.seatIndex === hand.viewerSeat);
      const start = heroStackAtHandStart.current;
      if (
        hp &&
        !hp.folded &&
        start !== null &&
        !playedHandWinSound.current &&
        hp.stack > start
      ) {
        playedHandWinSound.current = true;
        playHandWinSound();
      }
    }
    lastHandStreetForShuffle.current = hand.street;
  }, [hand]);

  useEffect(() => {
    const b = handRef.current?.board ?? [];
    const j = b.join("|");
    if (j === prevBoardJoin.current) return;
    const prevJ = prevBoardJoin.current;
    prevBoardJoin.current = j;
    for (const tid of boardAnimTimers.current) clearTimeout(tid);
    boardAnimTimers.current = [];
    if (b.length === 0) {
      setBoardSlots([]);
      return;
    }
    const prevCards = prevJ ? prevJ.split("|").filter(Boolean) : [];
    const prefixOk =
      prevCards.length > 0 &&
      b.length > prevCards.length &&
      prevCards.every((c, i) => c === b[i]);
    if (prefixOk) {
      const added = b.slice(prevCards.length).map((c) => ({ code: c, faceUp: false }));
      setBoardSlots([...prevCards.map((c, i) => ({ code: b[i], faceUp: true })), ...added]);
      added.forEach((_, k) => {
        const idx = prevCards.length + k;
        boardAnimTimers.current.push(
          window.setTimeout(() => {
            playCardFlipSound();
            setBoardSlots((s2) => s2.map((x, i) => (i === idx ? { ...x, faceUp: true } : x)));
          }, 520 + k * 680),
        );
      });
      return;
    }
    setBoardSlots(b.map((c) => ({ code: c, faceUp: false })));
    b.forEach((_, i) => {
      boardAnimTimers.current.push(
        window.setTimeout(() => {
          playCardFlipSound();
          setBoardSlots((s2) => s2.map((x, k) => (k === i ? { ...x, faceUp: true } : x)));
        }, 420 + i * 640),
      );
    });
  }, [boardSig]);

  useEffect(() => {
    return () => {
      for (const tid of boardAnimTimers.current) clearTimeout(tid);
    };
  }, []);

  useEffect(() => {
    let id = 0;
    const loop = (t: number) => {
      if (t - rafLast.current >= 32) {
        rafLast.current = t;
        setNowMs(Date.now());
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/tables/${tableId}`, { credentials: "include" });
    if (res.status === 404) {
      setError("Table not found");
      return;
    }
    if (res.status === 410) {
      setError("This table has been closed");
      return;
    }
    if (!res.ok) {
      setError("Could not load table");
      return;
    }
    const data = (await res.json()) as {
      table: TablePayload;
      viewerBalance: number;
      mySeatIndex: number | null;
      viewerCanDeal?: boolean;
      isSiteAdmin?: boolean;
      tournament?: TournamentViewerSnapshot | null;
      viewerEliminatedFromSnG?: boolean;
    };
    setTable(data.table);
    setViewerBalance(data.viewerBalance);
    setMySeatIndex(data.mySeatIndex);
    if (typeof data.viewerCanDeal === "boolean") {
      setViewerCanDeal(data.viewerCanDeal);
    }
    if (typeof data.isSiteAdmin === "boolean") {
      setIsSiteAdmin(data.isSiteAdmin);
    }
    if ("tournament" in data) {
      setTournament(data.tournament ?? null);
    }
    if (typeof data.viewerEliminatedFromSnG === "boolean") {
      setViewerEliminatedFromSnG(data.viewerEliminatedFromSnG);
    }
  }, [tableId]);

  const loadHand = useCallback(async () => {
    const res = await fetch(`/api/tables/${tableId}/hand`, { credentials: "include" });
    if (!res.ok) {
      if (res.status === 401) {
        setError("Session expired — refresh the page and sign in again.");
      }
      return;
    }
    const data = (await res.json()) as {
      handId: string | null;
      hand: PublicHandState | null;
      lastCompletedHand?: LastCompletedHandResult | null;
    };
    lastCompletedHandForLog.current = data.lastCompletedHand ?? null;
    setHand(data.hand);
    setActiveHandId(data.handId ?? null);
  }, [tableId]);

  const loadHandRef = useRef(loadHand);
  loadHandRef.current = loadHand;

  const handPollMs = isActiveTable
    ? Number(process.env.NEXT_PUBLIC_HAND_POLL_MS ?? 2500) || 2500
    : Number(process.env.NEXT_PUBLIC_HAND_POLL_BACKGROUND_MS ?? 6000) || 6000;

  useEffect(() => {
    const boot = window.setTimeout(() => void loadHand(), 0);
    const t = window.setInterval(() => void loadHand(), handPollMs);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(t);
    };
  }, [loadHand, handPollMs]);

  useEffect(() => {
    setHand(null);
    setActiveHandId(null);
    setTableLogLines([]);
    prevHandLogSnap.current = null;
    lastCompletedHandForLog.current = null;
    loggedResultHandIds.current = new Set();
    tableLogSeq.current = 0;
    statsTrackerRef.current.reset();
    setSessionStats(new Map());
    holeRevealHandRef.current = null;
  }, [tableId]);

  useEffect(() => {
    if (!hand || !activeHandId) return;
    const seatUsers = buildSeatUserMap(table.seats);
    statsTrackerRef.current.observe(activeHandId, hand, viewerUserId, seatUsers);
    setSessionStats(new Map(statsTrackerRef.current.getAll()));
  }, [hand, activeHandId, table.seats, viewerUserId]);

  const seatLabelForLog = useCallback(
    (seatIndex: number) => {
      const s = table.seats.find((x) => x.seatIndex === seatIndex);
      if (s?.user) return s.user.usernameDisplay || s.user.displayName;
      return `Seat ${seatIndex + 1}`;
    },
    [table.seats],
  );

  useEffect(() => {
    const snap = buildTableHandLogSnap(activeHandId, hand);
    const msgs = deriveHandLogMessages({
      prev: prevHandLogSnap.current,
      next: snap,
      seatLabel: seatLabelForLog,
      lastCompletedHand: lastCompletedHandForLog.current,
      loggedResultHandIds: loggedResultHandIds.current,
    });
    prevHandLogSnap.current = snap;
    if (msgs.length === 0) return;
    setTableLogLines((prev) => [
      ...prev,
      ...msgs.map((text) => ({ id: ++tableLogSeq.current, text })),
    ].slice(-260));
  }, [hand, activeHandId, seatLabelForLog]);

  useEffect(() => {
    const el = tableLogScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tableLogLines]);

  useEffect(() => {
    const onChange = () => {
      void load();
      void loadHand();
    };

    if (sharedSocket) {
      sharedSocket.watch(tableId, onChange);
      return () => sharedSocket.unwatch(tableId, onChange);
    }

    let cancelled = false;
    let socket: Socket | null = null;

    async function connect() {
      const tokenRes = await fetch("/api/socket/token");
      if (!tokenRes.ok || cancelled) return;
      const { token } = (await tokenRes.json()) as { token?: string };
      if (!token || cancelled) return;

      socket = io(socketUrl, {
        auth: { token },
        transports: ["websocket", "polling"],
      });
      socket.emit("table:watch", tableId);
      socket.on("table:changed", onChange);
    }

    void connect();

    return () => {
      cancelled = true;
      if (socket) {
        socket.emit("table:unwatch", tableId);
        socket.disconnect();
      }
    };
  }, [tableId, load, loadHand, sharedSocket]);

  async function postSit(seatIndex: number, buyInChips: number) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/sit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatIndex, buyInChips }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not sit");
      return;
    }
    setSitSeat(null);
    claimTablePlayTab(tableId);
    await load();
    await loadHand();
  }

  async function onSit(e: React.FormEvent) {
    e.preventDefault();
    if (sitSeat === null || !table) return;
    await postSit(sitSeat, Number.parseInt(buyIn, 10));
  }

  async function onTournamentSit(seatIndex: number) {
    if (!table) return;
    const stack = table.tournamentStartingStackChips || table.minBuyIn;
    await postSit(seatIndex, stack);
  }

  async function requestLeave(midHandLeave: boolean) {
    setPending(true);
    setError(null);
    setMidHandLeaveMessage(null);
    setTournamentLeaveMessage(null);
    const res = await fetch(`/api/tables/${tableId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(midHandLeave ? { midHandLeave: true } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };

    if (res.status === 409 && isMidHandLeave409(data)) {
      setPending(false);
      setMidHandLeaveMessage(
        data.error ??
          "You are still in this hand. Leaving now will fold you out; chips already in the pot may be lost.",
      );
      return;
    }

    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not leave");
      return;
    }
    await load();
    await loadHand();
  }

  function onLeave() {
    if (!table) return;
    if (table.kind === "TOURNAMENT") {
      setTournamentLeaveMessage(
        "Standing up forfeits your tournament chips and removes you from this tournament. You cannot re-enter. Continue?",
      );
      return;
    }
    if (table.kind === "SIT_AND_GO") {
      const sitAndGoStarted = seatedCount >= table.maxSeats || hand !== null;
      setTournamentLeaveMessage(
        sitAndGoStarted
          ? "This Sit & Go has started. Standing up forfeits your buy-in and you cannot re-enter. Continue?"
          : `Leave before the table is full? Your ${formatZar(table.minBuyIn)} buy-in will be returned to your balance.`,
      );
      return;
    }
    void requestLeave(false);
  }

  async function onTournamentRegister() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/tournament/register`, { method: "POST", credentials: "include" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not register");
      return;
    }
    await load();
  }

  async function onTournamentUnregister() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/tournament/register`, { method: "DELETE", credentials: "include" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not unregister");
      return;
    }
    await load();
  }

  const startsMs = table.startsAt ? new Date(table.startsAt).getTime() : null;
  const tournamentLocked =
    table.kind === "TOURNAMENT" && startsMs !== null && !Number.isNaN(startsMs) && startsMs > nowMs;
  const countdownMs = tournamentLocked && startsMs !== null ? startsMs - nowMs : 0;
  const showEarlyTournamentStart =
    viewerCanDeal && isSiteAdmin && table.kind === "TOURNAMENT" && tournamentLocked;

  const seatedCount = table.seats.filter((s) => s.user !== null).length;
  const sngWaitingForPlayers = table.kind === "SIT_AND_GO" && seatedCount < table.maxSeats;
  const tournamentMaySit =
    table.kind === "SIT_AND_GO"
      ? !viewerEliminatedFromSnG && seatedCount < table.maxSeats
      : table.kind !== "TOURNAMENT" ||
        Boolean(tournament?.viewerRegistered && tournament?.sittingWindowOpen);

  const mySeat =
    mySeatIndex !== null ? table.seats.find((s) => s.seatIndex === mySeatIndex) ?? null : null;
  const showCashSitOut =
    table.kind === "CASH" && mySeatIndex !== null && mySeat?.user && !tournamentLocked;
  const maxAddChips =
    table.kind === "CASH"
      ? Math.max(0, Math.min(viewerBalance, table.maxBuyIn - (mySeat?.stackChips ?? 0)))
      : 0;
  const dealerChipTrayUsable = mySeatIndex !== null && !hand;
  const dealerChipTrayCanTip =
    dealerChipTrayUsable && (mySeat?.stackChips ?? 0) >= table.smallBlind && table.smallBlind > 0;

  async function onStartHand() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/hand/start`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      handId?: string;
      hand?: PublicHandState;
    };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not start hand");
      return;
    }
    if (data.hand) setHand(data.hand);
    if (typeof data.handId === "string") setActiveHandId(data.handId);
    await load();
    await loadHand();
  }

  async function onSitOut(sittingOut: boolean) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/sit-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sittingOut }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not update sit out");
      return;
    }
    await load();
    await loadHand();
    await loadHand();
  }

  async function onStackAdd() {
    const n = Number.parseInt(addChipsAmount.trim(), 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("Enter a valid chip amount");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/stack-add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ amountChips: n }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not add chips");
      return;
    }
    setAddChipsOpen(false);
    setAddChipsAmount("");
    await load();
    await loadHand();
  }

  async function onTipDealer() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/tip-dealer`, {
      method: "POST",
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not tip dealer");
      return;
    }
    playTipDealerSound();
    await load();
    await loadHand();
  }

  async function sendAction(body: { type: string; raiseTo?: number }) {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/tables/${tableId}/hand/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      handId?: string;
      hand?: PublicHandState;
    };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Action rejected");
      return;
    }
    if (myHandPlayer && hand) {
      const toCallNow = Math.max(0, hand.currentBet - myHandPlayer.streetCommit);
      const shoveRaise =
        body.type === "RAISE" &&
        typeof body.raiseTo === "number" &&
        body.raiseTo >= myHandPlayer.streetCommit + myHandPlayer.stack;
      const callAllIn = body.type === "CALL" && toCallNow > 0 && toCallNow >= myHandPlayer.stack;
      if (body.type === "FOLD") {
        playFoldSound();
      } else if (body.type === "CHECK") {
        playCheckSound();
      } else if (shoveRaise || callAllIn) {
        playAllInSound();
      } else if (body.type === "CALL") {
        playCallSound();
      } else if (body.type === "RAISE") {
        playRaiseSound();
      }
    }
    if (data.hand) setHand(data.hand);
    if (typeof data.handId === "string") setActiveHandId(data.handId);
    await load();
  }

  const viewerInHand = hand != null && hand.viewerSeat !== null;
  const myHandPlayer =
    hand && hand.viewerSeat !== null ? hand.players.find((p) => p.seatIndex === hand.viewerSeat) : undefined;
  const toCall =
    myHandPlayer && hand ? Math.max(0, hand.currentBet - myHandPlayer.streetCommit) : 0;
  const defaultRaiseTo =
    hand && myHandPlayer
      ? Math.min(
          myHandPlayer.streetCommit + myHandPlayer.stack,
          hand.currentBet > 0 ? hand.currentBet + hand.minRaise : hand.minRaise,
        )
      : "";

  const callCommitsFullStack =
    !!myHandPlayer && !!hand && hand.legal.includes("CALL") && toCall > 0 && toCall >= myHandPlayer.stack;

  const showPurpleAllIn =
    !!hand &&
    !!myHandPlayer &&
    myHandPlayer.stack > 0 &&
    (hand.legal.includes("RAISE") || callCommitsFullStack);

  /** No chips left — check is automatic server-side; never show a Check control. */
  const dockLegal =
    hand && myHandPlayer
      ? hand.legal.filter((a) => !(a === "CHECK" && myHandPlayer.stack === 0))
      : [];
  const showActionDock = viewerInHand && hand && dockLegal.length > 0;
  const dockDeadline = showActionDock ? hand.turnDeadlineIso : null;
  const dockTimerSec = dockDeadline ? secondsRemaining(dockDeadline, nowMs) : null;
  const dockBarPct = dockDeadline
    ? Math.min(100, (Math.max(0, new Date(dockDeadline).getTime() - nowMs) / ACTION_TIMEOUT_MS) * 100)
    : 0;

  useEffect(() => {
    if (showActionDock && !wasActionDockOpen.current) {
      playYourTurnSound();
    }
    wasActionDockOpen.current = showActionDock;
  }, [showActionDock]);

  useEffect(() => {
    const base = table.name;
    const prev = document.title;
    document.title = showActionDock ? `⚡ Your turn — ${base}` : base;
    return () => {
      document.title = prev;
    };
  }, [showActionDock, table.name]);

  const restoreVisibleCards = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    const h = handRef.current;
    const viewerSeat = h?.viewerSeat ?? null;
    const hp =
      viewerSeat !== null ? h?.players.find((p) => p.seatIndex === viewerSeat) : undefined;
    if (hp && holeCardsReady(hp.hole)) {
      setHoleReveal(3);
      const key =
        activeHandIdRef.current ??
        `hole-${hp.hole[0]}-${hp.hole[1]}-${h?.street ?? ""}`;
      holeRevealHandRef.current = key;
    }

    setBoardSlots((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((s) => ({ ...s, faceUp: true }));
    });
    for (const tid of boardAnimTimers.current) clearTimeout(tid);
    boardAnimTimers.current = [];
    const b = h?.board ?? [];
    if (b.length > 0) prevBoardJoin.current = b.join("|");

    void loadHandRef.current();
  }, []);

  useEffect(() => {
    activeHandIdRef.current = activeHandId;
  }, [activeHandId]);

  useEffect(() => {
    if (!myHandPlayer || !holeCardsReady(myHandPlayer.hole)) {
      setHoleReveal(0);
      holeRevealHandRef.current = null;
      return;
    }
    const hole = myHandPlayer.hole;

    const handKey =
      activeHandId ??
      `hole-${hole[0]}-${hole[1]}-${hand?.street ?? ""}`;
    const alreadyRevealed = holeRevealHandRef.current === handKey;

    if (hand?.street === "SHOWDOWN" || hand?.street === "COMPLETE") {
      setHoleReveal(3);
      holeRevealHandRef.current = handKey;
      return;
    }

    const instant =
      document.visibilityState === "hidden" ||
      !hand ||
      hand.street !== "PREFLOP" ||
      (hand.board?.length ?? 0) > 0 ||
      alreadyRevealed;

    if (instant) {
      setHoleReveal(3);
      if (document.visibilityState === "visible") {
        holeRevealHandRef.current = handKey;
      }
      return;
    }

    holeRevealHandRef.current = handKey;
    setHoleReveal(0);
    let raf = 0;
    raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setHoleReveal(1));
    });
    const t1 = window.setTimeout(() => {
      playCardFlipSound();
      setHoleReveal(2);
    }, 420);
    const t2 = window.setTimeout(() => {
      playCardFlipSound();
      setHoleReveal(3);
    }, 820);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [
    activeHandId,
    myHandPlayer?.hole?.[0],
    myHandPlayer?.hole?.[1],
    hand?.street,
    hand?.board?.join("|"),
  ]);

  useEffect(() => {
    const onVisible = () => restoreVisibleCards();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [restoreVisibleCards]);

  const seatLayoutOpts = { mode: "desktop" as TableLayoutMode, heroSeatIndex: mySeatIndex };

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-1 overflow-hidden ${className}`.trim()}>
      <header
        className={`flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-black/25 ${embedded ? "pb-0.5" : "pb-1"}`}
      >
        <div className="min-w-0 flex-1">
          <h1 className={`truncate font-semibold leading-tight text-zinc-50 ${embedded ? "text-[10px]" : "text-xs"}`}>
            {table.name}
          </h1>
          <p className="truncate text-[9px] leading-snug text-zinc-400">
            NLHE ·{" "}
            {table.kind === "TOURNAMENT" ? (
              <span className="text-red-300">MTT</span>
            ) : table.kind === "SIT_AND_GO" ? (
              <span className="text-emerald-300">Sit &amp; Go</span>
            ) : (
              "Cash"
            )}{" "}
            · {table.smallBlind}/{table.bigBlind}
            {tournament?.escalatingBlinds && tournament.flightStatus === "RUNNING" ? (
              <>
                {" · "}
                <span className="text-amber-200/90">
                  Level {tournament.blindLevel}
                  {tournament.nextBlindLevelAt
                    ? ` · next ${formatBlindLevelCountdown(tournament.nextBlindLevelAt, nowMs)}`
                    : null}
                </span>
              </>
            ) : null}
            {table.kind === "TOURNAMENT" ? (
              <>
                {" · "}
                <span className="text-zinc-300">{formatChips(table.tournamentStartingStackChips || table.minBuyIn)} start</span>
              </>
            ) : (
              <>
                {" · BI "}
                {formatZar(table.minBuyIn)}–{formatZar(table.maxBuyIn)}
              </>
            )}
            {table.kind === "TOURNAMENT" && table.startsAt ? (
              <>
                {" · "}
                <span className="text-zinc-300">
                  {new Date(table.startsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                {tournamentLocked ? (
                  <span className="ml-1 tabular-nums text-amber-200/90">({formatCountdown(countdownMs)})</span>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          {hideHeaderBankroll ? null : (
            <div className="text-right text-[9px] leading-tight">
              <span className="text-zinc-500">Balance </span>
              <span className="font-semibold tabular-nums text-amber-200">{formatZar(viewerBalance)}</span>
            </div>
          )}
          {mySeatIndex !== null ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                disabled={pending}
                onClick={() => void onLeave()}
                className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-900/80 disabled:opacity-50"
              >
                Stand up
              </button>
              {showCashSitOut ? (
                mySeat?.sittingOut || mySeat?.sitOutNextHand ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void onSitOut(false)}
                    className="rounded border border-emerald-800/80 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-50"
                  >
                    {mySeat.sitOutNextHand && hand && hand.viewerSeat !== null && hand.street !== "COMPLETE"
                      ? "Stay for this hand"
                      : "I'm back"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void onSitOut(true)}
                    className="rounded border border-amber-800/80 bg-amber-950/30 px-2 py-0.5 text-[10px] text-amber-100 hover:bg-amber-900/30 disabled:opacity-50"
                  >
                    {hand && hand.viewerSeat !== null && hand.street !== "COMPLETE"
                      ? "Sit out after hand"
                      : "Sit out"}
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {error ? <p className="shrink-0 text-[10px] text-red-400">{error}</p> : null}

      {mySeat?.waitingForNextHand ? (
        <p className="shrink-0 rounded border border-sky-800/60 bg-sky-950/40 px-2 py-1 text-[10px] text-sky-100">
          You are seated. A hand is in progress — you will be dealt in on the next round.
        </p>
      ) : null}

      {mySeat?.sitOutNextHand && hand && hand.viewerSeat !== null && hand.street !== "COMPLETE" ? (
        <p className="shrink-0 rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-100">
          You will sit out after this hand — finish the current hand (you can still check or fold). Tap &quot;I&apos;m
          back&quot; to cancel.
        </p>
      ) : null}

      {tournamentLeaveMessage ? (
        <div className="shrink-0 rounded border border-red-800/70 bg-red-950/40 px-2 py-1.5 text-[10px] leading-snug text-red-50">
          <p>{tournamentLeaveMessage}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setTournamentLeaveMessage(null)}
              className="rounded border border-zinc-500 px-2 py-0.5 text-zinc-200 hover:bg-zinc-900/80 disabled:opacity-50"
            >
              Stay
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void requestLeave(false)}
              className="rounded border border-red-500/80 bg-red-900/50 px-2 py-0.5 font-medium text-red-50 hover:bg-red-800/50 disabled:opacity-50"
            >
              Forfeit and leave
            </button>
          </div>
        </div>
      ) : null}

      {midHandLeaveMessage ? (
        <div className="shrink-0 rounded border border-amber-700/70 bg-amber-950/45 px-2 py-1.5 text-[10px] leading-snug text-amber-50">
          <p>{midHandLeaveMessage}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setMidHandLeaveMessage(null)}
              className="rounded border border-zinc-500 px-2 py-0.5 text-zinc-200 hover:bg-zinc-900/80 disabled:opacity-50"
            >
              Stay
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void requestLeave(true)}
              className="rounded border border-amber-500/80 bg-amber-900/50 px-2 py-0.5 font-medium text-amber-50 hover:bg-amber-800/50 disabled:opacity-50"
            >
              {table.kind === "TOURNAMENT" || table.kind === "SIT_AND_GO"
                ? "Forfeit and leave"
                : "Leave anyway"}
            </button>
          </div>
        </div>
      ) : null}

      {table.kind === "SIT_AND_GO" ? (
        <div className="flex shrink-0 flex-col gap-1 border-b border-black/20 pb-1 text-[9px] text-zinc-300">
          <span className="font-medium tabular-nums text-emerald-200/95">
            {seatedCount}/{table.maxSeats} seated · starts when full
          </span>
          <span className="text-zinc-500">
            {formatZar(table.minBuyIn)} buy-in · {formatChips(table.tournamentStartingStackChips ?? 0)} starting chips
          </span>
        </div>
      ) : null}

      {viewerEliminatedFromSnG ? (
        <p className="shrink-0 rounded border border-red-800/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-100">
          You were eliminated from this Sit &amp; Go. You cannot re-enter or add chips.
        </p>
      ) : null}

      {table.kind === "TOURNAMENT" && tournament && table.startsAt ? (
        <div className="flex shrink-0 flex-col gap-1 border-b border-black/20 pb-1 text-[9px] text-zinc-300">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {tournament.flightStatus === "CANCELLED" ? (
              <span className="font-semibold text-red-400/90">Cancelled — entry fees refunded</span>
            ) : null}
            {tournament.escalatingBlinds ? (
              <span className="text-amber-200/85">
                · Blinds {tournament.currentSmallBlind}/{tournament.currentBigBlind}
                {tournament.flightStatus === "RUNNING" ? (
                  <>
                    {" "}
                    · level {tournament.blindLevel} · {tournament.blindLevelMinutes} min ·{" "}
                    {tournament.blindMultiplierLabel} per level
                    {tournament.nextBlindLevelAt ? (
                      <>
                        {" "}
                        · next level{" "}
                        {formatBlindLevelCountdown(tournament.nextBlindLevelAt, nowMs)}
                      </>
                    ) : null}
                  </>
                ) : (
                  <> · increasing after start</>
                )}
              </span>
            ) : null}
            {tournament.registrationFeeZar > 0 ? (
              <span className="text-zinc-400">· Entry {formatZar(tournament.registrationFeeZar)}</span>
            ) : (
              <span className="text-zinc-500">· Free entry</span>
            )}
            {formatTournamentPrizeLine(tournament.prizes, formatZar) ? (
              <span className="text-emerald-300/90">
                · {formatTournamentPrizeLine(tournament.prizes, formatZar)}
              </span>
            ) : null}
            {tournament.listingVisibility === "PRIVATE" ? (
              <span className="rounded bg-zinc-800/80 px-1.5 py-px text-[8px] font-semibold uppercase tracking-wide text-amber-100/90">
                Private
              </span>
            ) : null}
            {!tournament.registrationWindowOpen && nowMs < new Date(table.startsAt).getTime() ? (
              <span className="text-zinc-500">
                Registration opens{" "}
                {new Date(tournament.registrationOpensAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
            {tournament.registrationWindowOpen &&
            !tournament.viewerRegistered &&
            nowMs < new Date(table.startsAt).getTime() ? (
              <button
                type="button"
                disabled={pending || tournament.registrationCount >= tournament.registrationCap}
                onClick={() => void onTournamentRegister()}
                className="rounded-md border border-amber-600/70 bg-amber-950/40 px-2 py-0.5 text-[9px] font-semibold text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
              >
                {tournament.registrationCount >= tournament.registrationCap ? "Flight full" : "Register"}
              </button>
            ) : null}
            {tournament.viewerRegistered &&
            tournament.unregisterWindowOpen &&
            mySeatIndex === null &&
            nowMs < new Date(table.startsAt).getTime() ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void onTournamentUnregister()}
                className="rounded-md border border-zinc-600 px-2 py-0.5 text-[9px] text-zinc-300 hover:bg-zinc-900/80 disabled:opacity-50"
              >
                Unregister
              </button>
            ) : null}
          </div>
          {tournament.siblingTableIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[8px] text-zinc-500">
              <span>Other tables:</span>
              {tournament.siblingTableIds.map((sid) => (
                <a
                  key={sid}
                  href={tablePlayUrl(sid)}
                  target={tableWindowTarget(sid)}
                  rel="noopener noreferrer"
                  title={sid}
                  className="rounded border border-zinc-700/80 bg-black/30 px-1.5 py-px font-mono text-amber-200/90 hover:border-amber-600/50 hover:text-amber-100"
                >
                  …{sid.slice(-6)}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showEarlyTournamentStart ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-[9px] leading-snug text-zinc-400">
          <button
            type="button"
            disabled={pending || !!hand}
            onClick={() => void onStartHand()}
            className="shrink-0 rounded-md bg-red-800 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start tournament early
          </button>
        </div>
      ) : null}

      <div ref={tableSceneRef} className="relative min-h-0 flex-1 overflow-hidden">
        <TablePlayerSidebar
          viewerUserId={viewerUserId}
          embedded={embedded}
          players={table.seats
            .filter((s): s is Seat & { user: NonNullable<Seat["user"]> } => s.user !== null)
            .map(
              (s): SidebarPlayer => ({
                userId: s.user.id,
                label: s.user.usernameDisplay || s.user.displayName,
              }),
            )}
          statsByUserId={sessionStats}
          logLines={tableLogLines}
          logScrollRef={tableLogScrollRef}
        />
        <div
          className={
            showLandscapeInPortrait
              ? "absolute inset-0 overflow-hidden"
              : "relative mt-1 flex min-h-0 w-full flex-col items-stretch justify-center overflow-visible rounded-[1.75rem] sm:mt-4 sm:rounded-[2.25rem]"
          }
        >
        <div
          className={
            showLandscapeInPortrait
              ? "absolute left-1/2 top-1/2 z-[5] pointer-events-none"
              : "relative flex min-h-0 w-full flex-col items-stretch justify-center overflow-visible rounded-[1.75rem] sm:rounded-[2.25rem]"
          }
          style={
            showLandscapeInPortrait
              ? {
                  width: "100dvh",
                  height: "100dvw",
                  transform: `translate(-50%, -50%) rotate(90deg) scale(${rotateScale})`,
                  transformOrigin: "center center",
                }
              : undefined
          }
        >
        <div
          className={`relative flex min-h-0 w-full flex-col items-stretch justify-center overflow-visible ${
            showLandscapeInPortrait ? "pointer-events-auto h-full min-h-[280px]" : ""
          } rounded-[1.75rem] sm:rounded-[2.25rem]`}
        >
        {/* Wood floor (full bleed), then rug on top; object-contain letterboxing shows wood */}
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.75rem] shadow-[inset_0_0_50px_rgba(0,0,0,0.35)] sm:rounded-[2.25rem]"
          aria-hidden
        >
          <img
            src="/images/table-room-wood-bg.png"
            alt=""
            decoding="async"
            fetchPriority="low"
            draggable={false}
            className={`pointer-events-none absolute inset-0 z-0 h-full w-full select-none object-cover object-center ${showLandscapeInPortrait ? "block" : "hidden sm:block"}`}
          />
          <img
            src="/images/table-surround-rug.webp"
            alt=""
            width={1896}
            height={2816}
            decoding="async"
            fetchPriority="low"
            draggable={false}
            className={`table-room-rug-img pointer-events-none absolute left-1/2 top-1/2 z-[1] max-h-none max-w-none select-none object-contain object-center contrast-[1.04] ${showLandscapeInPortrait ? "block" : "hidden sm:block"}`}
            style={{
              width: "clamp(320px, min(96vmin, 98dvh), min(4200px, 140vw))",
              height: "clamp(880px, max(100vw, 280vw), 5600px)",
              transform: "translate3d(-50%, -50%, 0) rotate(90deg) scaleY(1.54)",
              backfaceVisibility: "hidden",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 z-[2] rounded-[2.25rem] bg-gradient-to-b from-black/8 via-transparent to-black/22"
            aria-hidden
          />
        </div>
        {/* Oval table — explicit min/max size; rail+felt use % insets so they cannot flex-collapse to 0 */}
        <div
          className={`relative z-10 mx-auto min-w-0 shrink-0 select-none overflow-visible ${
            showLandscapeInPortrait
              ? "h-[min(72dvh,620px)] w-[min(calc(2.12*min(72dvh,620px)),96dvw,1200px)]"
              : "h-[min(58dvh,460px)] w-[min(100vw,calc(2.12*min(58dvh,460px)))] sm:h-[min(78dvh,800px)] sm:w-[min(100vw,calc(2.12*min(78dvh,800px)))]"
          }`}
        >
        {/* Padded leather rail + red felt */}
        <div
          className="pointer-events-none absolute inset-[1.25%] rounded-[50%] p-[1.75%] shadow-[0_28px_56px_rgba(0,0,0,0.62)]"
          style={{
            background: `linear-gradient(165deg, #5c4030 0%, #3d2918 22%, #1f140c 55%, #0f0a06 100%)`,
            boxShadow: `
              inset 0 10px 28px rgba(255,255,255,0.07),
              inset 0 -22px 48px rgba(0,0,0,0.65),
              inset 0 0 0 1px rgba(255,255,255,0.04)
            `,
          }}
          aria-hidden
        >
          <div
            className="flex h-full w-full items-stretch justify-stretch rounded-[50%] p-[0.4rem] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{
              background: `linear-gradient(145deg, rgba(255,255,255,0.06), rgba(0,0,0,0.35))`,
            }}
          >
            <div
              className="relative h-full w-full overflow-hidden rounded-[50%] border-[2px] border-dashed border-white/10"
              style={{
                background: `
                  radial-gradient(ellipse 72% 58% at 50% 36%, rgba(254,202,202,0.22) 0%, transparent 58%),
                  radial-gradient(ellipse 95% 80% at 50% 120%, rgba(0,0,0,0.55) 0%, transparent 45%),
                  repeating-linear-gradient(125deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 4px),
                  linear-gradient(172deg, #dc2626 0%, #b91c1c 28%, #991b1b 55%, #450a0a 100%)
                `,
                boxShadow: `
                  inset 0 5px 22px rgba(255,255,255,0.08),
                  inset 0 -18px 42px rgba(0,0,0,0.45),
                  inset 0 0 0 3px rgba(127,29,29,0.9)
                `,
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.09]"
                style={{
                  backgroundImage: `radial-gradient(circle at 22% 32%, rgba(255,255,255,0.28) 0.5px, transparent 0.6px)`,
                  backgroundSize: "3px 3px",
                }}
                aria-hidden
              />
            </div>
          </div>
        </div>

        {/* Dealer button on felt */}
        {hand && hand.street !== "COMPLETE" ? (
          <div
            className="pointer-events-none absolute z-[28]"
            style={dealerButtonStyle(hand.buttonSeat, table.maxSeats, seatLayoutOpts)}
          >
            <div
              className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-amber-700 bg-gradient-to-b from-amber-50 to-amber-300 text-[8px] font-black text-black shadow-[0_2px_6px_rgba(0,0,0,0.55)] ring-2 ring-white/30 sm:h-5 sm:w-5 sm:text-[9px]"
              title="Dealer"
            >
              D
            </div>
          </div>
        ) : null}

        {/* Street bets — on felt between seats and centre */}
        {hand && hand.street !== "COMPLETE" ? (
          <div className="pointer-events-none absolute inset-0 z-[14]">
            {hand.street === "SHOWDOWN"
              ? null
              : hand.players.map((hp) => {
              if (hp.folded || hp.streetCommit <= 0) return null;
              return (
                <div
                  key={`felt-bet-${hp.seatIndex}`}
                  className="absolute"
                  style={betChipsTowardCenterStyle(hp.seatIndex, table.maxSeats, seatLayoutOpts)}
                >
                  <BetChipsVisual amount={hp.streetCommit} />
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Seats */}
        <div className="absolute inset-0 z-20">
          {table.seats.map((seat) => {
            const isMe = seat.user && mySeatIndex === seat.seatIndex;
            const toActHere = hand?.toAct === seat.seatIndex && hand.street !== "COMPLETE";
            const actTimer =
              toActHere && hand?.turnDeadlineIso ? secondsRemaining(hand.turnDeadlineIso, nowMs) : null;
            const displayStack = seatStackFromHand(seat, hand);
            const hp = hand?.players.find((p) => p.seatIndex === seat.seatIndex);
            const showOppBacks = Boolean(
              hand &&
                hp &&
                !hp.folded &&
                seat.user &&
                hand.street !== "COMPLETE" &&
                hand.street !== "SHOWDOWN" &&
                (hand.viewerSeat === null || seat.seatIndex !== hand.viewerSeat),
            );
            const contestedShowdown = hand ? isContestedShowdown(hand.street, hand.players) : false;
            const oppShowHole = Boolean(
              hand &&
                contestedShowdown &&
                hp &&
                !hp.folded &&
                seat.user &&
                (hand.viewerSeat === null || seat.seatIndex !== hand.viewerSeat) &&
                holeCardsReady(hp.hole),
            );
            return (
              <div
                key={seat.seatIndex}
                style={seatLayoutStyle(seat.seatIndex, table.maxSeats, seatLayoutOpts)}
                className="z-20 flex w-[11.5rem] max-w-[42vw] flex-col items-stretch sm:max-w-none"
              >
                {oppShowHole && hp && holeCardsReady(hp.hole) ? (
                  <div className="mb-1 flex flex-col items-center gap-1 drop-shadow-md pointer-events-none">
                    <div className="flex origin-bottom scale-[0.58] justify-center gap-0.5 sm:scale-[0.72]">
                      <FlippableHoleCard
                        code={hp.hole[0]}
                        faceUp
                        dealStage="settled"
                        className="-rotate-6"
                      />
                      <FlippableHoleCard
                        code={hp.hole[1]}
                        faceUp
                        dealStage="settled"
                        className="rotate-6"
                      />
                    </div>
                  </div>
                ) : showOppBacks && hp ? (
                  <div className="mb-1 flex flex-col items-center gap-1 drop-shadow-md pointer-events-none">
                    <div className="flex justify-center gap-0.5">
                      <PlayingCardBack />
                      <PlayingCardBack />
                    </div>
                  </div>
                ) : null}
                {isMe && viewerInHand && hand && myHandPlayer ? (
                  <div className="mb-1 flex flex-col items-center gap-0.5 drop-shadow-2xl pointer-events-none">
                    <div className="flex origin-bottom scale-[0.58] items-end justify-center gap-1.5 sm:scale-[0.72] sm:gap-2">
                      <div className="flex gap-0.5">
                        {holeCardsReady(myHandPlayer.hole) ? (
                          <>
                            <FlippableHoleCard
                              code={myHandPlayer.hole[0]}
                              faceUp={holeReveal >= 2}
                              dealStage={holeReveal >= 1 ? "settled" : "in"}
                              className="-rotate-6"
                            />
                            <FlippableHoleCard
                              code={myHandPlayer.hole[1]}
                              faceUp={holeReveal >= 3}
                              dealStage={holeReveal >= 1 ? "settled" : "in"}
                              className="rotate-6"
                            />
                          </>
                        ) : (
                          <>
                            <PlayingCardBack className="-rotate-6" />
                            <PlayingCardBack className="rotate-6" />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div
                  className={`rounded-lg bg-gradient-to-br from-slate-700/90 via-blue-950/80 to-slate-950 p-[1px] shadow-xl ${
                    toActHere ? "ring-2 ring-amber-300/95 ring-offset-1 ring-offset-slate-600" : ""
                  }`}
                >
                  <div
                    className={`rounded-[7px] px-1.5 py-1 sm:px-2 sm:py-1.5 ${
                      seat.user
                        ? isMe
                          ? "bg-gradient-to-br from-slate-900 via-[#0c1929] to-slate-950 ring-1 ring-sky-500/45"
                          : "bg-gradient-to-br from-slate-900 to-slate-950 ring-1 ring-slate-700/90"
                        : "border border-dashed border-slate-500/70 bg-slate-950/95"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {seat.user ? (
                        <SeatAvatar username={seat.user.usernameDisplay} />
                      ) : (
                        <div className="h-7 w-7 shrink-0 rounded-md bg-slate-800/90 ring-1 ring-slate-600/80 sm:h-9 sm:w-9" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[8px] font-medium text-slate-400 sm:text-[9px]">#{seat.seatIndex + 1}</span>
                          <div className="flex items-center gap-0.5">
                            {actTimer !== null ? (
                              <span className="rounded bg-slate-950 px-1 py-px font-mono text-[8px] font-semibold tabular-nums text-amber-300">
                                {actTimer}s
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {seat.user ? (
                          <>
                            <p className="truncate text-[10px] font-semibold text-slate-100 sm:text-[11px]">{seat.user.usernameDisplay}</p>
                            {seat.waitingForNextHand ? (
                              <p className="text-[8px] font-medium uppercase tracking-wide text-sky-300/90">
                                Next hand
                              </p>
                            ) : (seat.sittingOut || seat.sitOutNextHand) && table.kind === "CASH" ? (
                              <p className="text-[8px] font-medium uppercase tracking-wide text-amber-300/90">
                                {seat.sitOutNextHand ? "Sit out next" : "Sitting out"}
                              </p>
                            ) : null}
                            <p className="text-[9px] font-medium tabular-nums text-amber-200/95 sm:text-[10px]">
                              {displayStack.toLocaleString()}
                            </p>
                          </>
                        ) : (
                          <p className="text-[10px] text-slate-500">Open</p>
                        )}
                      </div>
                    </div>
                    {toActHere && hand?.turnDeadlineIso ? (
                      <SeatTurnTimerBar deadlineIso={hand.turnDeadlineIso} nowMs={nowMs} />
                    ) : null}
                    {!seat.user && mySeatIndex === null && tournamentMaySit ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (table.kind === "TOURNAMENT") {
                            void onTournamentSit(seat.seatIndex);
                          } else {
                            setError(null);
                            setSitSeat(seat.seatIndex);
                            setBuyIn(String(table.minBuyIn));
                          }
                        }}
                        className="mt-1.5 w-full rounded border border-slate-500/80 bg-slate-900 py-0.5 text-[9px] font-medium text-slate-200 hover:bg-slate-800"
                      >
                        Sit here
                      </button>
                    ) : null}
                  </div>
                </div>
                {isMe &&
                viewerInHand &&
                hand &&
                myHandPlayer &&
                !myHandPlayer.folded &&
                hand.street !== "COMPLETE" &&
                holeCardsReady(myHandPlayer.hole) ? (
                  <HandStrengthBar hole={myHandPlayer.hole} board={hand.board} />
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Dealer + chip tray (not a seat). Top-centre; player seats ring the felt. */}
        <div className="pointer-events-auto absolute left-1/2 top-[1.25%] z-[25] w-[min(82vw,9.25rem)] -translate-x-1/2 sm:w-[min(88vw,11.75rem)]">
          <div className="rounded-md border border-amber-800/50 bg-gradient-to-b from-zinc-900/95 to-black/90 p-1.5 shadow-xl ring-1 ring-amber-900/30">
            <p className="text-center text-[6px] font-bold uppercase tracking-widest text-amber-300/90">Dealer</p>
            <div
              className="mt-1 rounded-md border border-zinc-700/90 bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 px-0.5 py-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.65)]"
              aria-hidden
            >
              <ChipDenomStack
                breakdown={DEALER_TRAY_BREAKDOWN}
                discClass="h-2 w-2"
                gapClass="gap-0.5"
                stackKind="tray"
              />
            </div>
            {table.kind === "CASH" ? (
              <button
                type="button"
                disabled={pending || !dealerChipTrayUsable || maxAddChips <= 0}
                onClick={() => {
                  setError(null);
                  setAddChipsAmount(String(Math.min(maxAddChips, table.minBuyIn)));
                  setAddChipsOpen(true);
                }}
                className="mt-1.5 w-full rounded border border-amber-700/80 bg-amber-950/50 py-0.5 text-[8px] font-semibold text-amber-100 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add chips
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending || !dealerChipTrayCanTip}
              onClick={() => void onTipDealer()}
              className="mt-0.5 w-full rounded border border-violet-800/70 bg-violet-950/40 py-0.5 text-[8px] font-semibold text-violet-100 hover:bg-violet-900/35 disabled:cursor-not-allowed disabled:opacity-40"
              title={`Tip host ${table.smallBlind} (small blind)`}
            >
              Tip dealer ({table.smallBlind})
            </button>
          </div>
        </div>

        {/* Center: pot above community cards */}
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center pt-[2%]">
          <div className="pointer-events-auto flex max-h-[88%] max-w-[min(92%,420px)] flex-col items-center gap-2 px-1.5 text-center sm:max-w-[min(88%,480px)] sm:gap-3 sm:px-2">
            <div
              className={`pointer-events-none -mb-0.5 justify-center ${showLandscapeInPortrait ? "flex" : "hidden sm:flex"}`}
              aria-hidden
            >
              <div className="rotate-[-4deg] px-2 py-1.5 text-center">
                <p className="text-[7px] font-semibold uppercase tracking-[0.34em] text-amber-200/85 sm:text-[8px] sm:tracking-[0.36em] [text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_0_18px_rgba(251,191,36,0.12)]">
                  Private club
                </p>
                <p className="mt-1 text-[13px] font-black leading-none tracking-tight text-amber-50 sm:mt-1.5 sm:text-[16px] md:text-[19px] [text-shadow:0_1px_1px_rgba(0,0,0,0.95),0_2px_6px_rgba(0,0,0,0.65),0_0_22px_rgba(252,211,77,0.3),0_0_1px_rgba(254,252,232,0.45)]">
                  Poker-room
                </p>
              </div>
            </div>
            {hand ? (
              <>
                <div className="flex flex-col items-center gap-1 rounded-lg border border-red-950/50 bg-black/50 px-3 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-amber-500/25 backdrop-blur-md sm:px-5 sm:py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-100/90">Pot</p>
                  <MainPotChips amount={hand.pot} />
                </div>

                <div className="w-full space-y-1.5 rounded-xl border border-red-950/40 bg-black/40 px-2.5 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.4)] ring-1 ring-white/10 backdrop-blur-md sm:space-y-2 sm:px-4 sm:py-3">
                  <p
                    className={`text-[9px] font-semibold uppercase tracking-widest ${
                      hand.street === "SHOWDOWN" ? "text-amber-200" : "text-amber-100/90"
                    }`}
                  >
                    {hand.street === "COMPLETE"
                      ? "Complete"
                      : hand.street === "SHOWDOWN"
                        ? "Showdown"
                        : hand.street.replace("_", " ")}
                  </p>
                  <div className="flex min-h-[2.25rem] flex-wrap justify-center gap-1.5 sm:min-h-[2.75rem] sm:gap-2">
                    {hand.board.length === 0 ? (
                      <span className="self-center text-[11px] text-amber-100/75">Preflop</span>
                    ) : (
                      (() => {
                        const hb = hand.board;
                        const slots =
                          boardSlots.length === hb.length ? boardSlots : hb.map((code) => ({ code, faceUp: false }));
                        return slots.map((slot, i) => (
                          <FlippableBoardCard key={`${i}-${slot.code}`} code={slot.code} faceUp={slot.faceUp} />
                        ));
                      })()
                    )}
                  </div>
                  {hand.street !== "COMPLETE" && hand.toAct !== null ? (
                    <p className="text-[10px] text-amber-100/80">Action seat {hand.toAct + 1}</p>
                  ) : null}
                  {hand.resultMessage ? (
                    <p className="text-[11px] font-medium text-emerald-200">
                      {humanizeResultMessage(hand.resultMessage, seatLabelForLog)}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-red-950/35 bg-black/35 px-4 py-3 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-amber-100/85">Board</p>
                <p className="mt-0.5 max-w-[15rem] text-[11px] leading-snug text-amber-100/80">
                  {tournamentLocked
                    ? "MTT: take a seat to register. Deal after start."
                    : table.kind === "SIT_AND_GO"
                      ? sngWaitingForPlayers
                        ? `Waiting for players (${seatedCount}/${table.maxSeats}). Hand starts when full.`
                        : "Starting hand…"
                      : table.kind === "CASH"
                        ? "Waiting for players or next auto hand."
                        : "Waiting for deal or take a seat."}
                </p>
              </div>
            )}
          </div>
        </div>
        </div>
        </div>
        </div>
        </div>
      </div>

      {sitSeat !== null ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-xl">
            <h3 className="text-lg font-medium text-zinc-50">Take seat {sitSeat + 1}</h3>
            <p className="mt-1 text-sm text-zinc-500">
              {table.kind === "SIT_AND_GO"
                ? `Buy-in ${formatZar(table.minBuyIn)} from your balance. You receive ${formatChips(table.tournamentStartingStackChips ?? 0)} chips at the table.`
                : `Buy-in between ${formatZar(table.minBuyIn)} and ${formatZar(table.maxBuyIn)} from your balance.`}
            </p>
            {hand ? (
              <p className="mt-2 text-sm text-sky-200/90">
                A hand is in progress. You can take this seat now and will join the next deal.
              </p>
            ) : null}
            <form onSubmit={onSit} className="mt-4 space-y-4">
              <div>
                <label className="text-sm text-zinc-400">Buy-in (Zar)</label>
                <input
                  type="number"
                  min={table.minBuyIn}
                  max={table.kind === "SIT_AND_GO" ? table.minBuyIn : table.maxBuyIn}
                  readOnly={table.kind === "SIT_AND_GO"}
                  value={buyIn}
                  onChange={(e) => setBuyIn(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 disabled:opacity-80"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setSitSeat(null)}
                  className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {addChipsOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-xl">
            <h3 className="text-lg font-medium text-zinc-50">Add chips</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Bank {viewerBalance.toLocaleString()} · max add {maxAddChips.toLocaleString()} (table cap{" "}
              {table.maxBuyIn.toLocaleString()}).
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm text-zinc-400">Amount</label>
                <input
                  type="number"
                  min={1}
                  max={maxAddChips}
                  value={addChipsAmount}
                  onChange={(e) => setAddChipsAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void onStackAdd()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Add to stack
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddChipsOpen(false);
                    setAddChipsAmount("");
                  }}
                  className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showActionDock && hand && myHandPlayer ? (
        <div className="pointer-events-auto fixed bottom-2 left-2 right-2 z-[110] w-auto max-w-none rounded-xl border border-zinc-800 bg-black/93 p-2 shadow-2xl shadow-black/60 backdrop-blur-md pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:bottom-3 sm:left-auto sm:right-3 sm:w-[min(calc(100vw-1rem),15.5rem)] sm:p-2.5">
          <p className="text-center text-[9px] font-semibold uppercase tracking-widest text-zinc-500">Your action</p>
          <TableActionPanel
            hand={hand}
            myHandPlayer={myHandPlayer}
            dockLegal={dockLegal}
            dockTimerSec={dockTimerSec}
            dockBarPct={dockBarPct}
            toCall={toCall}
            raiseToInput={raiseToInput}
            onRaiseToInputChange={setRaiseToInput}
            defaultRaiseTo={defaultRaiseTo}
            showPurpleAllIn={showPurpleAllIn}
            callCommitsFullStack={callCommitsFullStack}
            pending={pending}
            onSendAction={(action) => void sendAction(action)}
            onError={setError}
          />
        </div>
      ) : null}

      <p className="text-center text-[9px] text-zinc-500/90">
        {socketUrl.replace(/^https?:\/\//, "")}
      </p>
    </div>
  );
}
