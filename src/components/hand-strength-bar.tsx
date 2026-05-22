"use client";

import { useMemo } from "react";
import {
  evaluateHandRankDisplay,
  handRankBarColor,
} from "@/lib/poker/hand-rank-display";

export function HandStrengthBar({
  hole,
  board,
}: {
  hole: [string, string];
  board: string[];
}) {
  const view = useMemo(() => evaluateHandRankDisplay(hole, board), [hole, board]);

  if (!view) return null;

  return (
    <div
      className="pointer-events-none mt-1 w-full rounded-md border border-zinc-800/90 bg-zinc-950/90 px-1.5 py-1 shadow-md ring-1 ring-black/30"
      aria-label={`Hand strength: ${view.label}`}
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800/95">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${handRankBarColor(view.tone)}`}
          style={{ width: `${view.strengthPct}%` }}
        />
      </div>
      <p className="mt-0.5 truncate text-center text-[8px] font-medium leading-tight text-zinc-300">
        {view.label}
      </p>
    </div>
  );
}
