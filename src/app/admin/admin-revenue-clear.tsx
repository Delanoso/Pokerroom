"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminRevenueClear() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClear() {
    if (
      !window.confirm(
        "Clear all house revenue stats? This permanently deletes rake, tournament fee, and dealer tip ledger records. Host bankrolls are not changed.",
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/admin/revenue/clear", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not clear revenue stats");
      return;
    }
    setMessage(
      data.deleted === 0
        ? "Revenue stats were already empty."
        : `Cleared ${data.deleted?.toLocaleString() ?? 0} fee records.`,
    );
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => void onClear()}
        className="rounded-lg border border-red-900/80 bg-red-950/40 px-3 py-1.5 text-sm font-medium text-red-200 hover:bg-red-950/70 disabled:opacity-50"
      >
        {pending ? "Clearing…" : "Clear stats"}
      </button>
      {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
