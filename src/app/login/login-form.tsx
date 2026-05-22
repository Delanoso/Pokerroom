"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const errorCode = searchParams.get("error");
  const blockedNotice = errorCode === "blocked";
  const sessionNotice = errorCode === "session";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn("credentials", {
      login: username.trim(),
      password,
      redirect: false,
      callbackUrl,
    });
    setPending(false);
    if (res?.error) {
      setError("Invalid username or password.");
      return;
    }
    router.push(res?.url ?? callbackUrl);
    router.refresh();
  }

  return (
    <div className="w-full max-w-md px-4">
      <div className="space-y-8 rounded-2xl border border-amber-900/30 bg-gradient-to-b from-zinc-950/95 via-zinc-950/90 to-red-950/10 p-8 shadow-2xl shadow-black/50 ring-1 ring-black/40 backdrop-blur-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-amber-500/90">Member access</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-50">Sign in</h1>
          <p className="mt-2 text-sm text-zinc-500">Use the username and password the house sent you.</p>
          {sessionNotice ? (
            <p className="mt-3 rounded-lg border border-zinc-700/80 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300">
              Your previous sign-in is no longer valid (for example after a database reset). Sign in again with your
              username and password.
            </p>
          ) : null}
          {blockedNotice ? (
            <p className="mt-3 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
              This account has been suspended. Contact the operator if you think that is a mistake.
            </p>
          ) : null}
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-zinc-300">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2.5 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2.5 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
              required
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 py-3 text-sm font-bold text-black shadow-lg shadow-amber-950/30 transition hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
