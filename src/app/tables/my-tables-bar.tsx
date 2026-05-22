"use client";

import type { MyTableSeatSummary } from "@/lib/my-table-seats";
import { clickTableAnchors, tablePlayUrl, tableWindowTarget } from "@/lib/poker/open-table-window";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function MyTablesBar() {
  const [seats, setSeats] = useState<MyTableSeatSummary[]>([]);
  const [openHint, setOpenHint] = useState(false);
  const anchorRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tables/my-seats", { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { seats?: MyTableSeatSummary[] };
    setSeats(data.seats ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

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

  if (seats.length === 0) return null;

  const needsAction = seats.filter((s) => s.needsAction).length;
  const cashCount = tableIds.length;

  return (
    <section className="rounded-xl border border-amber-800/40 bg-amber-950/25 px-4 py-3">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-amber-400/90">Your tables</p>
          <p className="mt-0.5 text-sm text-zinc-300">
            Seated at {cashCount} table{cashCount === 1 ? "" : "s"}
            {needsAction > 0 ? (
              <span className="ml-1 font-medium text-amber-200">
                · {needsAction} need{needsAction === 1 ? "s" : ""} action
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Use the lobby to open each table in its own tab—sit down there, then pick the next felt.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openAll}
            className="rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2 text-sm font-semibold text-black shadow hover:brightness-110"
          >
            Open all ({cashCount})
          </button>
          <Link
            href="/tables/play"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            Manage
          </Link>
        </div>
      </div>

      {openHint ? (
        <p className="mt-2 text-[11px] text-amber-200/90">
          If only one tab opened, allow pop-ups for this site—or open tables from the lobby with &quot;Open table&quot;.
        </p>
      ) : null}

      <ul className="mt-3 flex flex-wrap gap-2">
        {byTable.map((s) => (
          <li key={s.tableId}>
            <a
              href={tablePlayUrl(s.tableId)}
              target={tableWindowTarget(s.tableId)}
              rel="noopener noreferrer"
              className={`inline-block rounded-lg border px-2.5 py-1 text-xs transition ${
                s.needsAction
                  ? "border-amber-500/70 bg-amber-900/40 text-amber-100"
                  : "border-zinc-700 bg-zinc-900/50 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {s.tableName}
              {s.needsAction ? <span className="ml-1 font-bold text-amber-300">•</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
