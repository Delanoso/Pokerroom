"use client";

import { formatZar } from "@/lib/format-currency";
import type { OpenTournamentFlightRow } from "@/lib/tournament-revenue";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminTournamentFlights({ flights }: { flights: OpenTournamentFlightRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { first: string; second: string; third: string }>>(() =>
    Object.fromEntries(
      flights.map((f) => [
        f.representativeTableId,
        {
          first: String(f.prizes.firstZar || ""),
          second: String(f.prizes.secondZar || ""),
          third: String(f.prizes.thirdZar || ""),
        },
      ]),
    ),
  );

  async function savePrizes(tableId: string) {
    const d = drafts[tableId];
    if (!d) return;
    setError(null);
    setBusyId(tableId);
    const res = await fetch(`/api/tables/${tableId}/tournament/prizes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        tournamentPrize1stZar: Number(d.first) || 0,
        tournamentPrize2ndZar: Number(d.second) || 0,
        tournamentPrize3rdZar: Number(d.third) || 0,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Could not update prizes");
      return;
    }
    router.refresh();
  }

  if (flights.length === 0) {
    return <p className="mt-3 text-sm text-zinc-500">No open tournaments.</p>;
  }

  return (
    <ul className="mt-3 space-y-4">
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {flights.map((f) => {
        const draft = drafts[f.representativeTableId] ?? {
          first: "",
          second: "",
          third: "",
        };
        const started = f.startsAt ? new Date(f.startsAt).getTime() <= Date.now() : false;
        return (
          <li
            key={f.representativeTableId}
            className="list-none rounded-xl border border-zinc-800/90 bg-black/25 px-4 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/tables/${f.representativeTableId}`}
                  className="font-medium text-emerald-400 hover:text-emerald-300"
                >
                  {f.name}
                </Link>
                <p className="mt-1 text-xs text-zinc-500">
                  @{f.hostUsername}
                  {f.startsAt
                    ? ` · starts ${new Date(f.startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                </p>
                <p className="mt-2 text-sm text-zinc-300">
                  <span className="font-semibold tabular-nums text-amber-200">
                    {f.registeredCount.toLocaleString()}
                  </span>
                  <span className="text-zinc-500"> / {f.registrationCap.toLocaleString()} registered</span>
                  {f.entryFeeZar > 0 ? (
                    <>
                      {" · "}
                      <span className="tabular-nums">{formatZar(f.entryPoolZar)}</span>
                      <span className="text-zinc-500"> entry pool ({formatZar(f.entryFeeZar)} each)</span>
                    </>
                  ) : (
                    <span className="text-zinc-500"> · free entry</span>
                  )}
                </p>
              </div>
            </div>
            {!started ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <label className="text-xs text-zinc-500">
                  1st (Zar)
                  <input
                    type="number"
                    min={0}
                    value={draft.first}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [f.representativeTableId]: { ...draft, first: e.target.value },
                      }))
                    }
                    className="mt-0.5 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-500">
                  2nd (Zar)
                  <input
                    type="number"
                    min={0}
                    value={draft.second}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [f.representativeTableId]: { ...draft, second: e.target.value },
                      }))
                    }
                    className="mt-0.5 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-500">
                  3rd (Zar)
                  <input
                    type="number"
                    min={0}
                    value={draft.third}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [f.representativeTableId]: { ...draft, third: e.target.value },
                      }))
                    }
                    className="mt-0.5 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-100"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={busyId === f.representativeTableId}
                    onClick={() => void savePrizes(f.representativeTableId)}
                    className="w-full rounded-lg border border-amber-600/60 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
                  >
                    {busyId === f.representativeTableId ? "Saving…" : "Update prizes"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">Prizes locked — tournament has started.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
