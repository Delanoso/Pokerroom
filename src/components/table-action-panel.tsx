"use client";

import { ACTION_TIMEOUT_MS } from "@/lib/poker/action-timeout";
import type { PublicHandState } from "@/lib/poker/public-hand-types";

type HandPlayer = PublicHandState["players"][number];

export function TableActionPanel({
  hand,
  myHandPlayer,
  dockLegal,
  dockTimerSec,
  dockBarPct,
  toCall,
  raiseToInput,
  onRaiseToInputChange,
  defaultRaiseTo,
  showPurpleAllIn,
  callCommitsFullStack,
  pending,
  onSendAction,
  onError,
}: {
  hand: PublicHandState;
  myHandPlayer: HandPlayer;
  dockLegal: PublicHandState["legal"];
  dockTimerSec: number | null;
  dockBarPct: number;
  toCall: number;
  raiseToInput: string;
  onRaiseToInputChange: (value: string) => void;
  defaultRaiseTo: number | string;
  showPurpleAllIn: boolean;
  callCommitsFullStack: boolean;
  pending: boolean;
  onSendAction: (action: { type: "FOLD" | "CHECK" | "CALL" | "RAISE"; raiseTo?: number }) => void;
  onError: (message: string) => void;
}) {
  /** First wager on this street (no bet out yet) → Bet; otherwise Raise. */
  const isOpeningBet = dockLegal.includes("RAISE") && toCall === 0 && hand.currentBet === 0;
  const wagerLabel = isOpeningBet ? "Bet" : "Raise";
  const wagerTotalLabel = isOpeningBet ? "Bet to (total this street)" : "Raise to (total this street)";

  return (
    <div className="mt-1.5 space-y-2">
      {dockTimerSec !== null ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] tabular-nums text-zinc-400">
            <span>Clock</span>
            <span className="font-medium text-amber-300">{dockTimerSec}s</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-amber-500" style={{ width: `${dockBarPct}%` }} />
          </div>
          <p className="text-[8px] leading-snug text-zinc-500">
            No bet to you: auto-check. Facing a bet: auto-fold ({Math.round(ACTION_TIMEOUT_MS / 1000)}s).
          </p>
        </div>
      ) : null}
      {hand.legal.includes("CALL") && !hand.legal.includes("RAISE") && toCall > 0 ? (
        <p className="text-[8px] leading-snug text-violet-200/90">
          Everyone else is all-in — you can only call or fold (no further raise).
        </p>
      ) : null}
      {dockLegal.includes("RAISE") ? (
        <div className="flex flex-col gap-0.5 border-b border-zinc-800 pb-1.5">
          <label className="text-[8px] text-zinc-500">{wagerTotalLabel}</label>
          <input
            type="number"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
            placeholder={String(defaultRaiseTo)}
            value={raiseToInput}
            onChange={(e) => onRaiseToInputChange(e.target.value)}
          />
        </div>
      ) : null}
      <div className="flex flex-row flex-wrap items-center justify-end gap-1.5">
        {showPurpleAllIn ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (dockLegal.includes("RAISE")) {
                onRaiseToInputChange("");
                onSendAction({ type: "RAISE", raiseTo: myHandPlayer.streetCommit + myHandPlayer.stack });
                return;
              }
              onSendAction({ type: "CALL" });
            }}
            className="rounded-md bg-violet-700 px-2.5 py-1.5 text-xs font-medium text-white ring-1 ring-violet-400/80 hover:bg-violet-600 disabled:opacity-50"
          >
            All-in
          </button>
        ) : null}
        {dockLegal.includes("RAISE") ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const raw = raiseToInput.trim() === "" ? String(defaultRaiseTo) : raiseToInput;
              const n = Number.parseInt(raw, 10);
              if (Number.isNaN(n)) {
                onError(isOpeningBet ? "Enter a valid bet total" : "Enter a valid raise total");
                return;
              }
              onRaiseToInputChange("");
              onSendAction({ type: "RAISE", raiseTo: n });
            }}
            className="rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs font-medium text-white ring-1 ring-emerald-500/80 hover:bg-emerald-600 disabled:opacity-50"
          >
            {wagerLabel}
          </button>
        ) : null}
        {dockLegal.includes("CALL") && !callCommitsFullStack ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSendAction({ type: "CALL" })}
            className="rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white ring-1 ring-blue-500/80 hover:bg-blue-600 disabled:opacity-50"
          >
            Call {toCall.toLocaleString()}
          </button>
        ) : null}
        {dockLegal.includes("CHECK") ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSendAction({ type: "CHECK" })}
            className="rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white ring-1 ring-blue-500/80 hover:bg-blue-600 disabled:opacity-50"
          >
            Check
          </button>
        ) : null}
        {dockLegal.includes("FOLD") ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSendAction({ type: "FOLD" })}
            className="rounded-md bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white ring-1 ring-red-500/80 hover:bg-red-600 disabled:opacity-50"
          >
            Fold
          </button>
        ) : null}
      </div>
    </div>
  );
}
