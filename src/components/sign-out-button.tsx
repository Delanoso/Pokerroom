"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

const defaultClassName =
  "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50";

export function SignOutButton({ className = defaultClassName }: { className?: string }) {
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut({ callbackUrl: "/" });
    } catch {
      setPending(false);
    }
  }

  return (
    <button type="button" onClick={() => void handleSignOut()} disabled={pending} className={className}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
