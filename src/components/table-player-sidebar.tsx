"use client";

import type { SessionStatCounts } from "@/lib/poker/player-session-stats";
import { pct } from "@/lib/poker/player-session-stats";
import { loadPlayerNotes, savePlayerNote } from "@/lib/poker/player-table-notes";
import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";

export type SidebarPlayer = {
  userId: string;
  label: string;
};

function emptyStats(): SessionStatCounts {
  return { hands: 0, vpip: 0, checks: 0, folds: 0, calls: 0, raises: 0, reRaises: 0 };
}

function CollapsibleBlock({
  title,
  titleClassName,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  titleClassName?: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800/90 bg-black/88 shadow-lg shadow-black/40 backdrop-blur-md">
      <button
        type="button"
        onClick={onToggle}
        className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 px-2 py-1 text-left hover:bg-zinc-900/60"
        aria-expanded={expanded}
      >
        <span
          className={`text-[9px] font-bold uppercase tracking-[0.18em] ${titleClassName ?? "text-amber-500/90"}`}
        >
          {title}
        </span>
        <span className="text-[9px] font-medium text-zinc-500">{expanded ? "−" : "+"}</span>
      </button>
      {expanded ? <div className="min-h-0 flex-1 overflow-hidden">{children}</div> : null}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2 text-[9px]">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular-nums font-medium text-zinc-200">{value}</span>
    </div>
  );
}

function StatsBody({ player, stats }: { player: SidebarPlayer; stats: SessionStatCounts }) {
  const h = stats.hands;
  return (
    <div className="space-y-1 px-2 py-1.5">
      <p className="truncate text-[9px] font-semibold text-zinc-100">{player.label}</p>
      <StatRow label="Hands" value={h} />
      <StatRow label="VPIP" value={pct(stats.vpip, h)} />
      <StatRow label="Check" value={stats.checks} />
      <StatRow label="Fold" value={stats.folds} />
      <StatRow label="Call" value={stats.calls} />
      <StatRow label="Raise" value={stats.raises} />
      <StatRow label="Re-raise" value={stats.reRaises} />
    </div>
  );
}

function StatsPanel({
  opponents,
  statsByUserId,
}: {
  opponents: SidebarPlayer[];
  statsByUserId: Map<string, SessionStatCounts>;
}) {
  if (opponents.length === 0) {
    return (
      <p className="px-2 py-2.5 text-[9px] leading-relaxed text-zinc-500">
        Stats appear when others are seated and hands are played.
      </p>
    );
  }
  return (
    <div className="max-h-[min(20vh,180px)] overflow-y-auto">
      {opponents.map((p) => (
        <div key={p.userId} className="border-b border-zinc-800/50 last:border-b-0">
          <StatsBody player={p} stats={statsByUserId.get(p.userId) ?? emptyStats()} />
        </div>
      ))}
    </div>
  );
}

function LogPanel({
  lines,
  scrollRef,
}: {
  lines: { id: number; text: string }[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={scrollRef}
      className="max-h-[min(18vh,160px)] overflow-y-auto px-2 py-1.5 text-[9px] font-normal leading-relaxed tracking-tight text-zinc-200 antialiased"
    >
      {lines.length === 0 ? (
        <p className="text-zinc-500">Waiting for table events…</p>
      ) : (
        lines.map((row) => (
          <p key={row.id} className="border-b border-zinc-800/40 py-0.5 last:border-b-0">
            {row.text}
          </p>
        ))
      )}
    </div>
  );
}

export function TablePlayerSidebar({
  viewerUserId,
  players,
  statsByUserId,
  embedded,
  logLines,
  logScrollRef,
}: {
  viewerUserId: string;
  players: SidebarPlayer[];
  statsByUserId: Map<string, SessionStatCounts>;
  embedded?: boolean;
  logLines: { id: number; text: string }[];
  logScrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const opponents = players.filter((p) => p.userId !== viewerUserId);

  useEffect(() => {
    setNotes(loadPlayerNotes(viewerUserId));
  }, [viewerUserId]);

  useEffect(() => {
    if (selectedPlayerId && opponents.some((p) => p.userId === selectedPlayerId)) return;
    setSelectedPlayerId(opponents[0]?.userId ?? null);
  }, [opponents, selectedPlayerId]);

  const onNoteChange = useCallback(
    (text: string) => {
      if (!selectedPlayerId) return;
      setNotes((prev) => {
        const next = { ...prev };
        const trimmed = text.trim();
        if (trimmed) next[selectedPlayerId] = trimmed;
        else delete next[selectedPlayerId];
        return next;
      });
    },
    [selectedPlayerId],
  );

  const onNoteBlur = useCallback(() => {
    if (!selectedPlayerId) return;
    savePlayerNote(viewerUserId, selectedPlayerId, notes[selectedPlayerId] ?? "");
  }, [viewerUserId, selectedPlayerId, notes]);

  const anyExpanded = notesExpanded || statsExpanded || logExpanded;
  const widthClass = anyExpanded
    ? embedded
      ? "w-[min(8.75rem,32vw)] sm:w-[min(10.5rem,30vw)]"
      : "w-[min(9.5rem,28vw)] sm:w-[min(11.5rem,20vw)]"
    : "w-8 sm:w-9";

  const collapsedTab = (label: string, onClick: () => void, className: string, title: string) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border border-zinc-800/80 bg-black/85 px-1 py-2 text-[8px] font-bold uppercase tracking-wider [writing-mode:vertical-rl] ${className}`}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <aside
      className={`pointer-events-auto fixed left-0 top-0 z-[35] flex h-dvh max-h-dvh flex-col gap-1.5 py-0.5 pl-0.5 transition-[width] duration-200 ${widthClass}`}
      aria-label="Player notes, stats, and table log"
    >
      {!anyExpanded ? (
        <div className="flex flex-col gap-1">
          {collapsedTab("Notes", () => setNotesExpanded(true), "text-amber-500/90", "Expand notes")}
          {collapsedTab("Stats", () => setStatsExpanded(true), "text-sky-400/90", "Expand stats")}
          {collapsedTab("Log", () => setLogExpanded(true), "text-zinc-400", "Expand table log")}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden">
          <CollapsibleBlock title="Notes" expanded={notesExpanded} onToggle={() => setNotesExpanded((e) => !e)}>
            <div className="flex max-h-[min(18vh,170px)] flex-col overflow-hidden">
              {opponents.length === 0 ? (
                <p className="px-2 py-2.5 text-[9px] leading-relaxed text-zinc-500">
                  No other players seated. Notes apply to opponents when they sit.
                </p>
              ) : (
                <>
                  <div className="shrink-0 border-b border-zinc-800/60 p-1.5">
                    <label className="sr-only" htmlFor="note-player">
                      Player
                    </label>
                    <select
                      id="note-player"
                      value={selectedPlayerId ?? ""}
                      onChange={(e) => setSelectedPlayerId(e.target.value || null)}
                      className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[9px] text-zinc-100"
                    >
                      {opponents.map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    className="min-h-[4rem] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[9px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-700/50"
                    placeholder="Tendencies, sizing tells, position play…"
                    value={selectedPlayerId ? (notes[selectedPlayerId] ?? "") : ""}
                    onChange={(e) => onNoteChange(e.target.value)}
                    onBlur={onNoteBlur}
                    disabled={!selectedPlayerId}
                  />
                  <p className="shrink-0 border-t border-zinc-800/60 px-2 py-1 text-[8px] text-zinc-600">
                    Saved on this device
                  </p>
                </>
              )}
            </div>
          </CollapsibleBlock>

          <CollapsibleBlock
            title="Stats"
            titleClassName="text-sky-400/90"
            expanded={statsExpanded}
            onToggle={() => setStatsExpanded((e) => !e)}
          >
            <StatsPanel opponents={opponents} statsByUserId={statsByUserId} />
          </CollapsibleBlock>

          <CollapsibleBlock
            title="Table log"
            titleClassName="text-zinc-400"
            expanded={logExpanded}
            onToggle={() => setLogExpanded((e) => !e)}
          >
            <LogPanel lines={logLines} scrollRef={logScrollRef} />
          </CollapsibleBlock>
        </div>
      )}
    </aside>
  );
}
