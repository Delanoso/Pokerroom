"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const inputClass =
  "mt-1 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/30";

export function AdminCreatePlayerForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setPending(true);
    const res = await fetch("/api/admin/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.trim(),
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      password?: string;
      player?: { username: string; displayUsername: string | null };
    };
    setPending(false);
    if (!res.ok) {
      setError(data.error ?? "Could not create player");
      return;
    }
    const loginName = data.player?.displayUsername ?? data.player?.username ?? username.trim();
    setCreated({ username: loginName, password: data.password ?? "" });
    setUsername("");
    setFirstName("");
    setLastName("");
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-emerald-900/40 bg-emerald-950/15 p-5">
      <h2 className="text-sm font-semibold text-emerald-100">Create player account</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">
        After someone contacts you, pick a username here. A random 10-digit password is generated once — copy it
        and send it to them. They sign in on the login page with username and password only.
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="new-username" className="block text-xs font-medium text-zinc-400">
            Username
          </label>
          <input
            id="new-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            required
            minLength={3}
            maxLength={32}
            autoComplete="off"
            pattern="[a-zA-Z0-9_.-]+"
          />
        </div>
        <div>
          <label htmlFor="new-first" className="block text-xs font-medium text-zinc-400">
            First name <span className="text-zinc-600">(optional)</span>
          </label>
          <input
            id="new-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
            maxLength={100}
          />
        </div>
        <div>
          <label htmlFor="new-last" className="block text-xs font-medium text-zinc-400">
            Last name <span className="text-zinc-600">(optional)</span>
          </label>
          <input
            id="new-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
            maxLength={100}
          />
        </div>
        <button
          type="submit"
          disabled={pending || !username.trim()}
          className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create player"}
        </button>
      </form>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      {created ? (
        <div className="mt-4 rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium">Send these credentials once (password is not shown again):</p>
          <p className="mt-2">
            Username: <strong className="font-mono text-zinc-50">{created.username}</strong>
          </p>
          <p>
            Password: <strong className="font-mono text-zinc-50">{created.password}</strong>
          </p>
        </div>
      ) : null}
    </section>
  );
}
