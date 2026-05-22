"use client";

import type { MyTableSeatSummary } from "@/lib/my-table-seats";
import { clickTableAnchors, tablePlayUrl, tableWindowTarget } from "@/lib/poker/open-table-window";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function TableWindowsLauncher() {
  const [seats, setSeats] = useState<MyTableSeatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openHint, setOpenHint] = useState(false);
  const anchorRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/tables/my-seats", { credentials: "include" });
    if (!res.ok) {
      setError("Could not load your tables");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { seats?: MyTableSeatSummary[] };
    setSeats(data.seats ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tableIds = useMemo(() => [...new Set(seats.map((s) => s.tableId))], [seats]);

  const setAnchorRef = useCallback((tableId: string, el: HTMLAnchorElement | null) => {
    if (el) anchorRefs.current.set(tableId, el);
    else anchorRefs.current.delete(tableId);
  }, []);

  const openAll = useCallback(() => {
    setOpenHint(false);
    const anchors = tableIds
      .map((id) => anchorRefs.current.get(id))
      .filter((a): a is HTMLAnchorElement => a != null);
    clickTableAnchors(anchors);
    if (tableIds.length > 1) setOpenHint(true);
  }, [tableIds]);

  const byTable = useMemo(() => {
    const m = new Map<string, MyTableSeatSummary>();
    for (const s of seats) m.set(s.tableId, s);
    return [...m.values()];
  }, [seats]);

  if (loading) {
    return <p className="py-8 text-center text-sm text-zinc-500">Loading your tables…</p>;
  }

  if (error) {
    return <p className="py-8 text-center text-sm text-red-400">{error}</p>;
  }

  if (seats.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-zinc-400">
        <p>You are not seated at any open table.</p>
        <Link href="/tables" className="mt-3 inline-block text-amber-400 hover:text-amber-300">
          ← Back to tables
        </Link>
      </div>
    );
  }

  const needsAction = seats.filter((s) => s.needsAction).length;

  return (
    <div className="mx-auto max-w-lg space-y-6 py-4">
      {tableIds.map((id) => (
        <a
          key={`open-${id}`}
          ref={(el) => setAnchorRef(id, el)}
          href={tablePlayUrl(id)}
          target="_blank"
          rel="noopener noreferrer"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        >
          Open table
        </a>
      ))}

      <div>
        <h1 className="text-lg font-semibold text-amber-100">Table windows</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Each table opens in its own browser tab or window. Resize and arrange them on your screen.
        </p>
        {needsAction > 0 ? (
          <p className="mt-2 text-sm font-medium text-amber-300">
            {needsAction} table{needsAction === 1 ? "" : "s"} need{needsAction === 1 ? "s" : ""} your action.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={openAll}
          className="rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2 text-sm font-semibold text-black shadow hover:brightness-110"
        >
          Open all ({tableIds.length})
        </button>
        <Link
          href="/tables"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
        >
          ← Lobby
        </Link>
      </div>

      {openHint ? (
        <p className="text-[11px] text-amber-200/90">
          If only one tab opened, allow pop-ups for this site, then try again—or open each table with the links below.
        </p>
      ) : null}

      <ul className="space-y-2">
        {byTable.map((s) => (
          <li
            key={s.tableId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
          >
            <div>
              <span className="font-medium text-zinc-100">{s.tableName}</span>
              <span className="mt-0.5 block text-xs tabular-nums text-zinc-500">
                {s.stackChips.toLocaleString()} stack
                {s.needsAction ? <span className="ml-2 font-semibold text-amber-300">· Your turn</span> : null}
              </span>
            </div>
            <a
              href={tablePlayUrl(s.tableId)}
              target={tableWindowTarget(s.tableId)}
              rel="noopener noreferrer"
              className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/50"
            >
              Open table
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
