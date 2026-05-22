"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AdminWithdrawalRow = {
  id: string;
  amountChips: number;
  createdAt: string;
  username: string;
  email: string;
};

export function AdminWithdrawalQueue({ initial }: { initial: AdminWithdrawalRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function approve(id: string) {
    setBusyId(id);
    setMsg(null);
    const res = await fetch(`/api/admin/withdrawals/${id}/approve`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setMsg(data.error ?? "Approve failed");
      return;
    }
    setRows((r) => r.filter((x) => x.id !== id));
    router.refresh();
  }

  async function decline(id: string) {
    setBusyId(id);
    setMsg(null);
    const res = await fetch(`/api/admin/withdrawals/${id}/decline`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);
    if (!res.ok) {
      setMsg(data.error ?? "Decline failed");
      return;
    }
    setRows((r) => r.filter((x) => x.id !== id));
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/30 px-4 py-3 text-sm text-zinc-500">
        {msg ? <p className="mb-2 text-xs text-red-400">{msg}</p> : null}
        No pending withdrawal requests.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-amber-900/40 bg-amber-950/15 px-4 py-4">
      <h2 className="text-sm font-semibold text-amber-100">Pending withdrawal requests</h2>
      <p className="mt-1 text-xs text-zinc-500">Approve removes chips from the player ledger. Decline frees the hold.</p>
      {msg ? <p className="mt-2 text-xs text-red-400">{msg}</p> : null}
      <ul className="mt-3 divide-y divide-zinc-800/80">
        {rows.map((w) => (
          <li key={w.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-zinc-100">@{w.username}</p>
              <p className="text-xs text-zinc-500">{w.email}</p>
              <p className="mt-1 text-sm tabular-nums text-amber-200">{w.amountChips.toLocaleString()} chips</p>
              <p className="text-[10px] text-zinc-600">
                {new Date(w.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void decline(w.id)}
                className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
              >
                Decline
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void approve(w.id)}
                className="rounded-lg bg-emerald-800/80 px-3 py-1.5 text-xs font-semibold text-emerald-50 ring-1 ring-emerald-600/40 hover:bg-emerald-700/80 disabled:opacity-40"
              >
                Approve
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
