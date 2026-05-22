"use client";

import { DepositPaymentDetailsBox } from "@/components/deposit-payment-details-box";
import type { DepositPaymentDetails } from "@/lib/deposit-payment-details";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type DepositRow = {
  id: string;
  amountChips: number;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

export function DepositRequestPanel({
  paymentDetails,
  recentRequests,
}: {
  paymentDetails: DepositPaymentDetails;
  recentRequests: DepositRow[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number.parseInt(amount.trim(), 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("Enter a whole chip amount of at least 1");
      return;
    }
    setPending(true);
    const res = await fetch("/api/wallet/deposit-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountChips: n }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Request failed");
      return;
    }
    setAmount("");
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-zinc-800/90 bg-zinc-950/50 p-5 ring-1 ring-black/30">
      <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">Deposits</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Request chips to be added to your ledger after an operator confirms your payment.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        Deposits do not affect your balance until approved. Pay using the details below, then submit your request once
        you have sent POP.
      </p>

      <div className="mt-4">
        <DepositPaymentDetailsBox details={paymentDetails} />
      </div>

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="deposit-amt" className="text-[11px] font-medium text-zinc-500">
            Amount (chips)
          </label>
          <input
            id="deposit-amt"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            placeholder="e.g. 5000"
          />
        </div>
        <button
          type="submit"
          disabled={pending || !paymentDetails.configured}
          className="rounded-lg bg-emerald-800/80 px-4 py-2 text-sm font-semibold text-emerald-50 ring-1 ring-emerald-600/50 hover:bg-emerald-700/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Sending…" : "Request deposit"}
        </button>
      </form>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      {recentRequests.length > 0 ? (
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Recent</p>
          <ul className="mt-2 space-y-1.5 text-xs">
            {recentRequests.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 text-zinc-400">
                <span className="tabular-nums text-zinc-300">{r.amountChips.toLocaleString()}</span>
                <span className="uppercase text-zinc-500">{r.status}</span>
                <span className="text-zinc-600">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
