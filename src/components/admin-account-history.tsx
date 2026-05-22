"use client";

import { formatZar } from "@/lib/format-currency";
import { LEDGER_CATEGORY_LABELS, type LedgerHistoryCategory } from "@/lib/ledger-labels";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export type AccountHistoryUserOption = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  isBot: boolean;
};

type LedgerEntryDto = {
  id: string;
  createdAt: string;
  amountChips: number;
  type: string;
  typeLabel: string;
  category: LedgerHistoryCategory;
  note: string | null;
  createdByUsername: string | null;
  balanceAfter: number;
};

type HistoryResponse = {
  user: AccountHistoryUserOption & { email: string; role: string };
  currentBalance: number;
  entries: LedgerEntryDto[];
};

const ALL_CATEGORIES = "all" as const;
type CategoryFilter = typeof ALL_CATEGORIES | LedgerHistoryCategory;

function amountClass(n: number): string {
  if (n > 0) return "text-emerald-300";
  if (n < 0) return "text-red-300/90";
  return "text-zinc-400";
}

function formatSignedZar(n: number): string {
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatZar(n)}`;
}

export function AdminAccountHistory({ users }: { users: AccountHistoryUserOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = searchParams.get("user") ?? users[0]?.id ?? "";

  const [userId, setUserId] = useState(initialId);
  const [category, setCategory] = useState<CategoryFilter>(ALL_CATEGORIES);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${id}/ledger`);
    const json = (await res.json().catch(() => ({}))) as HistoryResponse & { error?: string };
    setLoading(false);
    if (!res.ok) {
      setData(null);
      setError(json.error ?? "Could not load history");
      return;
    }
    setData(json);
  }, []);

  useEffect(() => {
    if (userId) void load(userId);
  }, [userId, load]);

  useEffect(() => {
    const q = searchParams.get("user");
    if (q && q !== userId && users.some((u) => u.id === q)) {
      setUserId(q);
    }
  }, [searchParams, userId, users]);

  function onSelectAccount(id: string) {
    setUserId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("user", id);
    else params.delete("user");
    router.replace(`/admin/records?${params.toString()}`, { scroll: false });
  }

  const filtered =
    data?.entries.filter((e) => category === ALL_CATEGORIES || e.category === category) ?? [];

  const selected = users.find((u) => u.id === userId);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Account history</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Full ledger for any player or bot: operator adjustments, deposits, withdrawals, table buy-ins and
          cash-outs, tournament entry fees, and prizes.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-zinc-500">
          Account
          <select
            value={userId}
            onChange={(e) => onSelectAccount(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          >
            {users.length === 0 ? (
              <option value="">No accounts</option>
            ) : (
              users.map((u) => (
                <option key={u.id} value={u.id}>
                  @{u.username}
                  {u.isBot ? " (bot)" : ""} — {u.firstName} {u.lastName}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Filter
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          >
            <option value={ALL_CATEGORIES}>All activity</option>
            {(Object.keys(LEDGER_CATEGORY_LABELS) as LedgerHistoryCategory[]).map((c) => (
              <option key={c} value={c}>
                {LEDGER_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!userId || loading}
          onClick={() => void load(userId)}
          className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {selected ? (
        <p className="text-xs text-zinc-500">
          <span className="text-zinc-300">@{selected.username}</span>
          {selected.isBot ? <span className="ml-1 text-violet-300/90">bot</span> : null}
          {data ? (
            <>
              {" · "}
              Current balance{" "}
              <span className="font-medium tabular-nums text-emerald-300">{formatZar(data.currentBalance)}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-300/90">{error}</p> : null}

      {loading && !data ? <p className="text-sm text-zinc-500">Loading history…</p> : null}

      {data && filtered.length === 0 && !loading ? (
        <p className="text-sm text-zinc-500">No ledger entries for this filter.</p>
      ) : null}

      {filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Change</th>
                <th className="px-3 py-2 font-medium text-right">Balance after</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {filtered.map((e) => (
                <tr key={e.id} className="text-zinc-200">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-zinc-400">
                    {new Date(e.createdAt).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-zinc-100">{e.typeLabel}</span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-zinc-600">
                      {LEDGER_CATEGORY_LABELS[e.category]}
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${amountClass(e.amountChips)}`}>
                    {formatSignedZar(e.amountChips)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
                    {formatZar(e.balanceAfter)}
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-xs text-zinc-500">
                    {e.note ? <span>{e.note}</span> : <span className="text-zinc-700">—</span>}
                    {e.createdByUsername ? (
                      <span className="mt-0.5 block text-zinc-600">by @{e.createdByUsername}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.entries.length >= 200 ? (
        <p className="text-xs text-zinc-600">Showing the 200 most recent entries.</p>
      ) : null}

      {userId ? (
        <p className="text-xs text-zinc-600">
          Adjust balance on{" "}
          <Link href="/admin/players" className="text-emerald-400/90 hover:text-emerald-300">
            Players
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
