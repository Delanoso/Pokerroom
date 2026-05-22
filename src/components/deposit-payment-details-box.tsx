"use client";

import type { DepositPaymentDetails } from "@/lib/deposit-payment-details";
import type { ReactNode } from "react";
import { useState } from "react";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="shrink-0 rounded border border-zinc-600/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function DetailRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="flex items-center gap-2 text-sm text-zinc-100">
        <span className={copy ? "tabular-nums" : ""}>{value}</span>
        {copy ? <CopyButton value={value} /> : null}
      </dd>
    </div>
  );
}

function PopTargets({ details }: { details: DepositPaymentDetails }) {
  const parts: ReactNode[] = [];
  if (details.popEmail) {
    parts.push(
      <a key="email" href={`mailto:${details.popEmail}`} className="font-medium text-emerald-300 hover:underline">
        {details.popEmail}
      </a>,
    );
  }
  if (details.popPhone) {
    const tel = details.popPhone.replace(/\s/g, "");
    parts.push(
      <a key="phone" href={`tel:${tel}`} className="font-medium text-emerald-300 hover:underline">
        {details.popPhone}
      </a>,
    );
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return <>{parts[0]}</>;
  return (
    <>
      {parts[0]}
      <span> or </span>
      {parts[1]}
    </>
  );
}

export function DepositPaymentDetailsBox({ details }: { details: DepositPaymentDetails }) {
  if (!details.configured) {
    return (
      <UnconfiguredNotice />
    );
  }

  return (
    <div className="rounded-xl border border-emerald-900/35 bg-emerald-950/20 px-4 py-4 ring-1 ring-black/20">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-500/90">Pay into this account</p>
      <dl className="mt-3 space-y-2.5">
        <DetailRow label="Bank" value={details.bankName} />
        <DetailRow label="Account name" value={details.accountName} />
        <DetailRow label="Account number" value={details.accountNumber} copy />
        {details.branchCode ? <DetailRow label="Branch code" value={details.branchCode} copy /> : null}
        {details.paymentReferenceHint ? <DetailRow label="Reference" value={details.paymentReferenceHint} /> : null}
      </dl>
      <p className="mt-4 border-t border-emerald-900/30 pt-3 text-xs leading-relaxed text-zinc-400">
        After you pay, send your <span className="text-zinc-300">proof of payment (POP)</span> to{" "}
        <PopTargets details={details} />. Include the amount and your account username so we can match your deposit.
      </p>
    </div>
  );
}

function UnconfiguredNotice() {
  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
      <p className="font-medium">Payment details not configured</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        The operator must set deposit bank details and a POP email or phone number in the server environment before
        players can deposit.
      </p>
    </div>
  );
}
