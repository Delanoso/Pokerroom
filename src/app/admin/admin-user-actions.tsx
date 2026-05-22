"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminUserActions({
  userId,
  username,
  isBlocked,
  isSelf,
}: {
  userId: string;
  username: string;
  isBlocked: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return <span className="text-xs text-zinc-600">—</span>;
  }

  async function setBlocked(blocked: boolean) {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked }),
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function removeAccount() {
    setError(null);
    const ok = window.confirm(
      `Permanently remove @${username}? This deletes their account, ledger history, and any tables they created (and those tables’ hands). This cannot be undone.`,
    );
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error ? <span className="max-w-[10rem] text-right text-[10px] text-red-400">{error}</span> : null}
      <div className="flex flex-wrap justify-end gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => void setBlocked(!isBlocked)}
          className={`rounded border px-2 py-0.5 text-[10px] font-medium disabled:opacity-50 ${
            isBlocked
              ? "border-emerald-800/80 bg-emerald-950/50 text-emerald-100 hover:bg-emerald-900/40"
              : "border-amber-800/80 bg-amber-950/50 text-amber-100 hover:bg-amber-900/40"
          }`}
        >
          {isBlocked ? "Unblock" : "Block"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void removeAccount()}
          className="rounded border border-red-900/80 bg-red-950/40 px-2 py-0.5 text-[10px] font-medium text-red-100 hover:bg-red-900/35 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
