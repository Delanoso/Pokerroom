"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type UserOption = { id: string; username: string };

export function AdminAdjustForm({ users }: { users: UserOption[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const n = Number.parseInt(amount, 10);
    if (!userId || !Number.isFinite(n) || n <= 0) {
      setError("Choose a player and enter a positive whole number of chips.");
      return;
    }
    const amountChips = direction === "remove" ? -n : n;
    setPending(true);
    const res = await fetch("/api/admin/adjust-balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        amountChips,
        note: note.trim() || undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; newBalance?: number };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Request failed");
      return;
    }
    setMessage(`Updated. New balance: ${data.newBalance?.toLocaleString() ?? "?"} chips.`);
    setAmount("");
    setNote("");
    router.refresh();
  }

  if (users.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No players registered yet.</p>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
      <h2 className="text-lg font-medium text-zinc-100">Add or remove chips</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Choose <span className="text-emerald-400/90">Add</span> or <span className="text-amber-400/90">Remove</span>, then enter a positive amount. Removal cannot take a balance below zero.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="userId" className="block text-sm font-medium text-zinc-300">
            Player
          </label>
          <select
            id="userId"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/40"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                @{u.username}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="block text-sm font-medium text-zinc-300">Direction</span>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setDirection("add")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                direction === "add"
                  ? "border-emerald-600 bg-emerald-950/60 text-emerald-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              Add chips
            </button>
            <button
              type="button"
              onClick={() => setDirection("remove")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                direction === "remove"
                  ? "border-amber-600 bg-amber-950/50 text-amber-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              Remove chips
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-zinc-300">
            Amount (chips)
          </label>
          <input
            id="amount"
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/40"
            placeholder={direction === "remove" ? "e.g. 5000 to deduct" : "e.g. 10000 to credit"}
            required
          />
        </div>
        <div>
          <label htmlFor="note" className="block text-sm font-medium text-zinc-300">
            Note (optional)
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/40"
            placeholder="Buy-in for Friday game"
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {pending ? "Applying…" : direction === "remove" ? "Remove chips" : "Add chips"}
        </button>
      </form>
    </section>
  );
}
