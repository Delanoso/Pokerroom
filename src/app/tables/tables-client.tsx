"use client";

import { formatChips, formatZar } from "@/lib/format-currency";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UNREGISTER_CUTOFF_MS } from "@/lib/tournament-constants";
import { formatTournamentPrizeLine, type TournamentPrizes } from "@/lib/tournament-prizes";
import { openTableWindow, tablePlayUrl, tableWindowTarget } from "@/lib/poker/open-table-window";
import { MyTablesBar } from "./my-tables-bar";

export type LobbyTab = "CASH" | "TOURNAMENT" | "SIT_AND_GO";

export type TableRow = {
  id: string;
  name: string;
  kind: "CASH" | "TOURNAMENT" | "SIT_AND_GO";
  startsAt: string | null;
  tournamentListingVisibility: "PUBLIC" | "PRIVATE" | null;
  tournamentGroupId: string | null;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  createdAt: string;
  hostUsername: string;
  seatedCount: number;
  registrationCount: number;
  registrationCap: number;
  tournamentEntryFeeZar: number;
  tournamentStartingStackChips: number;
  tournamentPrizes: TournamentPrizes;
  viewerRegistered: boolean;
  registrationWindowOpen: boolean;
  unregisterWindowOpen: boolean;
  tournamentMinPlayersToStart: number;
  tournamentFlightStatus: "SCHEDULED" | "RUNNING" | "COMPLETED" | "CANCELLED" | null;
  tournamentEscalatingBlinds: boolean;
};

export type InviteUserOption = {
  id: string;
  username: string;
  displayUsername: string | null;
};

function toDatetimeLocalValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultTournamentStartLocal(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  if (d.getTime() <= Date.now()) {
    d.setHours(d.getHours() + 1);
  }
  return toDatetimeLocalValue(d);
}

export function TablesClient({
  initialTables,
  isAdmin,
  inviteUserOptions = [],
  serverNowMs,
  viewerAvailableBalance: initialViewerBalance,
}: {
  initialTables: TableRow[];
  isAdmin: boolean;
  inviteUserOptions?: InviteUserOption[];
  serverNowMs: number;
  viewerAvailableBalance: number;
}) {
  const router = useRouter();
  const tables = initialTables;
  const [activeTab, setActiveTab] = useState<LobbyTab>("CASH");
  const visibleTables = tables.filter((t) => t.kind === activeTab);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [regBusyId, setRegBusyId] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [viewerAvailableBalance, setViewerAvailableBalance] = useState(initialViewerBalance);
  const [nowMs, setNowMs] = useState(serverNowMs);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const [form, setForm] = useState({
    name: "Friday Hold'em",
    kind: "CASH" as "CASH" | "TOURNAMENT" | "SIT_AND_GO",
    startsAtLocal: defaultTournamentStartLocal(),
    tournamentListing: "PUBLIC" as "PUBLIC" | "PRIVATE",
    invitedUserIds: [] as string[],
    smallBlind: "10",
    bigBlind: "20",
    maxSeats: "6",
    minBuyIn: "2000",
    maxBuyIn: "10000",
    rakePercent: "5",
    rakeCapChips: "30",
    tournamentEntryFeeZar: "100",
    tournamentStartingStackChips: "10000",
    tournamentPrize1stZar: "5000",
    tournamentPrize2ndZar: "",
    tournamentPrize3rdZar: "",
    tournamentMinPlayersToStart: "6",
    tournamentEscalatingBlinds: false,
    tournamentBlindLevelMinutes: "10",
    tournamentBlindMultiplier: "2" as "1.5" | "2",
  });

  function toggleInvite(userId: string) {
    setForm((f) => {
      const has = f.invitedUserIds.includes(userId);
      return {
        ...f,
        invitedUserIds: has ? f.invitedUserIds.filter((id) => id !== userId) : [...f.invitedUserIds, userId],
      };
    });
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    const body: Record<string, unknown> = {
      name: form.name,
      kind: form.kind,
      smallBlind: Number(form.smallBlind),
      bigBlind: Number(form.bigBlind),
      maxSeats: Number(form.maxSeats),
      minBuyIn: Number(form.minBuyIn),
      maxBuyIn: Number(form.maxBuyIn),
    };
    if (form.kind === "TOURNAMENT") {
      body.startsAt = new Date(form.startsAtLocal).toISOString();
      body.tournamentListingVisibility = form.tournamentListing;
      body.tournamentEntryFeeChips = Number(form.tournamentEntryFeeZar) || 0;
      body.tournamentStartingStackChips = Number(form.tournamentStartingStackChips) || 0;
      body.tournamentPrize1stZar = Number(form.tournamentPrize1stZar) || 0;
      body.tournamentPrize2ndZar = Number(form.tournamentPrize2ndZar) || 0;
      body.tournamentPrize3rdZar = Number(form.tournamentPrize3rdZar) || 0;
      body.tournamentMinPlayersToStart = Number(form.tournamentMinPlayersToStart) || 2;
      if (form.tournamentEscalatingBlinds) {
        body.tournamentEscalatingBlinds = true;
        body.tournamentBlindLevelMinutes = Number(form.tournamentBlindLevelMinutes) || 10;
        body.tournamentBlindLevelMultiplierBps =
          form.tournamentBlindMultiplier === "1.5" ? 15_000 : 20_000;
      }
      body.minBuyIn = body.tournamentStartingStackChips;
      body.maxBuyIn = body.tournamentStartingStackChips;
      if (form.tournamentListing === "PRIVATE") {
        body.invitedUserIds = form.invitedUserIds;
      }
    } else if (form.kind === "SIT_AND_GO") {
      const buyIn = Number(form.minBuyIn) || 0;
      body.tournamentStartingStackChips = Number(form.tournamentStartingStackChips) || 0;
      body.tournamentPrize1stZar = Number(form.tournamentPrize1stZar) || 0;
      body.minBuyIn = buyIn;
      body.maxBuyIn = buyIn;
    } else {
      const pct = Number.parseFloat(form.rakePercent);
      body.rakePercentBps = Number.isFinite(pct) && pct > 0 ? Math.round(pct * 100) : 0;
      body.rakeCapChips = Number(form.rakeCapChips) || 0;
    }
    const res = await fetch("/api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      id?: string;
      tableIds?: string[];
      details?: unknown;
    };
    setCreating(false);
    if (!res.ok) {
      const details = data.details as Record<string, string[] | undefined> | undefined;
      const detailLine = details
        ? Object.entries(details)
            .map(([k, v]) => `${k}: ${(v ?? []).join(", ")}`)
            .join(" · ")
        : "";
      setFormError(
        [data.error ?? "Could not create table", detailLine].filter(Boolean).join(" — "),
      );
      return;
    }
    const firstId = data.id ?? data.tableIds?.[0];
    if (firstId) {
      openTableWindow(firstId);
    }
    router.refresh();
  }

  function lobbyUnregisterOpen(t: TableRow): boolean {
    if (!t.startsAt) return false;
    return new Date(t.startsAt).getTime() - nowMs > UNREGISTER_CUTOFF_MS;
  }

  async function setTournamentRegistration(tableId: string, register: boolean) {
    setRegError(null);
    setRegBusyId(tableId);
    const res = await fetch(`/api/tables/${tableId}/tournament/register`, {
      method: register ? "POST" : "DELETE",
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; viewerBalance?: number };
    setRegBusyId(null);
    if (!res.ok) {
      setRegError(data.error ?? (register ? "Could not register" : "Could not unregister"));
      return;
    }
    if (typeof data.viewerBalance === "number") {
      setViewerAvailableBalance(data.viewerBalance);
    }
    router.refresh();
  }

  async function closeTable(id: string) {
    setListError(null);
    if (
      !window.confirm(
        "Close this table? All stacks are returned to player bankrolls and the table is removed from the lobby.",
      )
    ) {
      return;
    }
    setClosingId(id);
    const res = await fetch(`/api/tables/${id}/close`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setClosingId(null);
    if (!res.ok) {
      setListError(data.error ?? "Could not close table");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex w-full flex-col gap-12">
      <header className="border-b border-zinc-800/80 pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-500/90">Table room</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">Tables</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
          {isAdmin
            ? "Open cash games or scheduled tournaments. Players only see tables you list here."
            : "Pick a felt the house has opened—sit and buy in when you are ready to play."}
        </p>
      </header>

      {isAdmin ? (
        <section className="relative overflow-hidden rounded-2xl border border-red-900/35 bg-gradient-to-br from-red-950/30 via-zinc-950/80 to-zinc-950/60 p-6 shadow-xl ring-1 ring-black/30">
          <div className="pointer-events-none absolute -right-6 top-4 text-7xl opacity-[0.07]" aria-hidden>
            ♦
          </div>
          <h2 className="text-lg font-bold text-zinc-100">Open a new table</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Cash games auto-deal when enough players are ready. Tournaments start at a scheduled time with registration
            windows. Sit &amp; Go tables start automatically once every seat is taken — cash buy-in, fixed chip stacks.
          </p>
          <form onSubmit={onCreate} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 flex flex-wrap gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                <input
                  type="radio"
                  name="kind"
                  checked={form.kind === "CASH"}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      kind: "CASH",
                      tournamentListing: "PUBLIC",
                      invitedUserIds: [],
                      tournamentTableCount: "1",
                    }))
                  }
                  className="border-zinc-600 text-red-600 focus:ring-red-500"
                />
                Cash game
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                <input
                  type="radio"
                  name="kind"
                  checked={form.kind === "TOURNAMENT"}
                  onChange={() => setForm((f) => ({ ...f, kind: "TOURNAMENT" }))}
                  className="border-zinc-600 text-red-600 focus:ring-red-500"
                />
                Tournament (scheduled start)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                <input
                  type="radio"
                  name="kind"
                  checked={form.kind === "SIT_AND_GO"}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      kind: "SIT_AND_GO",
                      tournamentListing: "PUBLIC",
                      invitedUserIds: [],
                    }))
                  }
                  className="border-zinc-600 text-red-600 focus:ring-red-500"
                />
                Sit &amp; Go (starts when full)
              </label>
            </div>
            {form.kind === "SIT_AND_GO" ? (
              <div className="sm:col-span-2">
                <p className="text-xs text-zinc-500">
                  Players pay the buy-in from their bankroll and receive the starting chip stack you set. The hand starts
                  automatically when all seats are filled — no scheduled start time.
                </p>
              </div>
            ) : null}
            {form.kind === "TOURNAMENT" ? (
              <div className="sm:col-span-2">
                <label className="block text-sm text-zinc-400">Tournament start (your local time)</label>
                <input
                  type="datetime-local"
                  required
                  value={form.startsAtLocal}
                  onChange={(e) => setForm((f) => ({ ...f, startsAtLocal: e.target.value }))}
                  className="mt-1 w-full max-w-md rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                />
              </div>
            ) : null}
            {form.kind === "TOURNAMENT" ? (
              <div className="sm:col-span-2 flex flex-wrap gap-6">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                  <input
                    type="radio"
                    name="listing"
                    checked={form.tournamentListing === "PUBLIC"}
                    onChange={() => setForm((f) => ({ ...f, tournamentListing: "PUBLIC", invitedUserIds: [] }))}
                    className="border-zinc-600 text-amber-600 focus:ring-amber-500"
                  />
                  Public (everyone can see & register)
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                  <input
                    type="radio"
                    name="listing"
                    checked={form.tournamentListing === "PRIVATE"}
                    onChange={() => setForm((f) => ({ ...f, tournamentListing: "PRIVATE" }))}
                    className="border-zinc-600 text-amber-600 focus:ring-amber-500"
                  />
                  Private (only invited players see the tournament; you are always included)
                </label>
              </div>
            ) : null}
            {form.kind === "TOURNAMENT" && form.tournamentListing === "PRIVATE" ? (
              <div className="sm:col-span-2">
                <label className="block text-sm text-zinc-400">Invite players</label>
                <p className="mt-0.5 text-xs text-zinc-600">Uninvited accounts will not see this tournament in the lobby.</p>
                <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-zinc-800 bg-black/30 p-2">
                  {inviteUserOptions.length === 0 ? (
                    <p className="text-xs text-zinc-500">No users loaded.</p>
                  ) : (
                    <ul className="space-y-1">
                      {inviteUserOptions.map((u) => (
                        <li key={u.id}>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={form.invitedUserIds.includes(u.id)}
                              onChange={() => toggleInvite(u.id)}
                              className="rounded border-zinc-600 text-amber-600"
                            />
                            <span>{u.displayUsername ?? u.username}</span>
                            <span className="text-zinc-600">@{u.username}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
            {form.kind === "TOURNAMENT" ? (
              <div className="sm:col-span-2">
                <p className="text-xs text-zinc-500">
                  Tables scale with registrations (&lt;6 → 1 table, 6–12 → 2, 13–18 → 3). Empty tables close as the field shrinks.
                </p>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <label className="block text-sm text-zinc-400">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">Small blind</label>
              <input
                type="number"
                min={1}
                value={form.smallBlind}
                onChange={(e) => setForm((f) => ({ ...f, smallBlind: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">Big blind</label>
              <input
                type="number"
                min={1}
                value={form.bigBlind}
                onChange={(e) => setForm((f) => ({ ...f, bigBlind: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                required
              />
            </div>
            {form.kind === "TOURNAMENT" ? (
              <div className="sm:col-span-2 rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={form.tournamentEscalatingBlinds}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, tournamentEscalatingBlinds: e.target.checked }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-zinc-100">Increasing blinds</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      Small and big blind rise on a timer after the tournament starts (level 1 uses the
                      blinds above).
                    </span>
                  </span>
                </label>
                {form.tournamentEscalatingBlinds ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm text-zinc-400">Minutes per level</label>
                      <input
                        type="number"
                        min={1}
                        max={240}
                        value={form.tournamentBlindLevelMinutes}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, tournamentBlindLevelMinutes: e.target.value }))
                        }
                        className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-zinc-400">Blind increase each level</label>
                      <select
                        value={form.tournamentBlindMultiplier}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            tournamentBlindMultiplier: e.target.value as "1.5" | "2",
                          }))
                        }
                        className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                      >
                        <option value="2">Double (2×)</option>
                        <option value="1.5">Multiply by 1.5×</option>
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div>
              <label className="block text-sm text-zinc-400">Seats</label>
              <select
                value={form.maxSeats}
                onChange={(e) => setForm((f) => ({ ...f, maxSeats: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
              >
                {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <option key={n} value={n}>
                    {n} max
                  </option>
                ))}
              </select>
            </div>
            {form.kind === "CASH" ? (
              <>
                <div>
                  <label className="block text-sm text-zinc-400">Min buy-in (Zar)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.minBuyIn}
                    onChange={(e) => setForm((f) => ({ ...f, minBuyIn: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">Max buy-in (Zar)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.maxBuyIn}
                    onChange={(e) => setForm((f) => ({ ...f, maxBuyIn: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                    required
                  />
                </div>
              </>
            ) : null}
            {form.kind === "CASH" ? (
              <>
                <div>
                  <label className="block text-sm text-zinc-400">Pot rake (%)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">House share of each pot when a hand completes. 0 = no rake.</p>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={form.rakePercent}
                    onChange={(e) => setForm((f) => ({ ...f, rakePercent: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">Rake cap (Zar)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">Max rake per pot. 0 = no cap.</p>
                  <input
                    type="number"
                    min={0}
                    value={form.rakeCapChips}
                    onChange={(e) => setForm((f) => ({ ...f, rakeCapChips: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                  />
                </div>
              </>
            ) : null}
            {form.kind === "SIT_AND_GO" ? (
              <>
                <div>
                  <label className="block text-sm text-zinc-400">Buy-in (Zar)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">Deducted from each player&apos;s bankroll when they sit.</p>
                  <input
                    type="number"
                    min={1}
                    value={form.minBuyIn}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, minBuyIn: e.target.value, maxBuyIn: e.target.value }))
                    }
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">Starting stack (chips)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">Play chips at the table (can differ from buy-in amount).</p>
                  <input
                    type="number"
                    min={1}
                    value={form.tournamentStartingStackChips}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentStartingStackChips: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">1st place prize (Zar)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    Paid automatically to the winner when the Sit &amp; Go ends; table then closes.
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={form.tournamentPrize1stZar}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentPrize1stZar: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                    required
                  />
                </div>
              </>
            ) : null}
            {form.kind === "TOURNAMENT" ? (
              <>
                <div>
                  <label className="block text-sm text-zinc-400">Minimum players to start</label>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    If fewer register before start, the tournament is cancelled and entry fees refunded.
                  </p>
                  <input
                    type="number"
                    min={2}
                    max={500}
                    value={form.tournamentMinPlayersToStart}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentMinPlayersToStart: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">Registration fee (Zar)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">Charged when a player registers. Refunded if they unregister before start.</p>
                  <input
                    type="number"
                    min={0}
                    value={form.tournamentEntryFeeZar}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentEntryFeeZar: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">Starting stack (chips)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.tournamentStartingStackChips}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentStartingStackChips: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">1st place prize (Zar)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.tournamentPrize1stZar}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentPrize1stZar: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">2nd place prize (Zar)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">Optional — leave empty to hide.</p>
                  <input
                    type="number"
                    min={0}
                    value={form.tournamentPrize2ndZar}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentPrize2ndZar: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">3rd place prize (Zar)</label>
                  <p className="mt-0.5 text-xs text-zinc-600">Optional — leave empty to hide.</p>
                  <input
                    type="number"
                    min={0}
                    value={form.tournamentPrize3rdZar}
                    onChange={(e) => setForm((f) => ({ ...f, tournamentPrize3rdZar: e.target.value }))}
                    className="mt-1 w-full max-w-xs rounded-lg border border-zinc-700/90 bg-black/40 px-3 py-2 text-zinc-100 outline-none focus:border-amber-600/60 focus:ring-2 focus:ring-amber-600/25"
                  />
                </div>
              </>
            ) : null}
            {formError ? <p className="text-sm text-red-400 sm:col-span-2">{formError}</p> : null}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 px-5 py-2.5 text-sm font-bold text-black shadow-lg shadow-amber-950/30 transition hover:brightness-110 disabled:opacity-60"
              >
                {creating
                  ? "Creating…"
                  : form.kind === "TOURNAMENT"
                    ? "Create tournament"
                    : form.kind === "SIT_AND_GO"
                      ? "Create Sit & Go"
                      : "Create cash table"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <MyTablesBar />

      <section className="relative">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-amber-500/80">Felts</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-50">
          {isAdmin ? "Active tables" : "Tables you can join"}
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { id: "CASH" as const, label: "Cash Games" },
              { id: "TOURNAMENT" as const, label: "Tournaments" },
              { id: "SIT_AND_GO" as const, label: "Sit & Go" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (isAdmin) {
                  setForm((f) => ({ ...f, kind: tab.id }));
                }
              }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab.id
                  ? "bg-amber-600 text-black shadow-md shadow-amber-950/30"
                  : "border border-zinc-700/90 bg-black/30 text-zinc-300 hover:border-amber-700/50 hover:text-amber-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {listError ? <p className="mt-2 text-sm text-red-400">{listError}</p> : null}
        {regError ? <p className="mt-2 text-sm text-red-400">{regError}</p> : null}
        <p className="mt-2 text-xs text-zinc-500">
          Available balance: <span className="tabular-nums font-medium text-amber-200/90">{formatZar(viewerAvailableBalance)}</span>
          {activeTab === "TOURNAMENT"
            ? " · Entry fees are deducted when you register."
            : activeTab === "SIT_AND_GO"
              ? " · Buy-in is deducted when you take a seat."
              : " · Buy-in is deducted when you sit at a cash table."}
        </p>
        <ul className="mt-5 space-y-3">
          {visibleTables.length === 0 ? (
            <li className="rounded-xl border border-zinc-800/80 bg-zinc-950/30 px-4 py-8 text-center text-sm text-zinc-500">
              {isAdmin
                ? `No ${activeTab === "CASH" ? "cash games" : activeTab === "TOURNAMENT" ? "tournaments" : "Sit & Go tables"} yet — create one above.`
                : `No ${activeTab === "CASH" ? "cash games" : activeTab === "TOURNAMENT" ? "tournaments" : "Sit & Go tables"} are open yet.`}
            </li>
          ) : null}
          {visibleTables.map((t) => (
            <li key={t.id} className="flex flex-wrap items-stretch gap-2">
              <a
                href={tablePlayUrl(t.id)}
                target={tableWindowTarget(t.id)}
                rel="noopener noreferrer"
                className="group relative flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl border border-amber-900/15 bg-gradient-to-r from-zinc-950/70 via-zinc-950/40 to-red-950/15 px-4 py-3 shadow-sm ring-1 ring-black/20 transition hover:border-amber-600/35 hover:shadow-md hover:shadow-amber-950/10"
              >
                <div>
                  <p className="font-medium text-zinc-100">{t.name}</p>
                  <p className="text-xs text-zinc-500">
                    {t.kind === "TOURNAMENT" && t.startsAt ? (
                      <>
                        <span className="font-medium text-red-400">Tournament</span>
                        {t.tournamentListingVisibility === "PRIVATE" ? (
                          <span className="font-medium text-amber-300/90"> · Private</span>
                        ) : null}
                        {" · starts "}
                        {new Date(t.startsAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {" · "}
                        <span className="tabular-nums text-zinc-400">
                          {t.registrationCount}/{t.registrationCap} registered (min {t.tournamentMinPlayersToStart})
                        </span>
                        {t.tournamentFlightStatus === "CANCELLED" ? (
                          <span className="font-medium text-red-400/90"> · Cancelled</span>
                        ) : null}
                        {" · "}
                      </>
                    ) : t.kind === "SIT_AND_GO" ? (
                      <>
                        <span className="font-medium text-emerald-400/90">Sit &amp; Go</span>
                        {" · starts when full · "}
                      </>
                    ) : (
                      <span className="text-zinc-400">Cash · </span>
                    )}
                    Blinds {t.smallBlind}/{t.bigBlind}
                    {t.kind === "TOURNAMENT" && t.tournamentEscalatingBlinds ? " · increasing" : ""} ·{" "}
                    {t.seatedCount}/{t.maxSeats} seated
                    {t.kind === "TOURNAMENT" ? (
                      <>
                        {" · "}
                        {formatChips(t.tournamentStartingStackChips)} start
                        {t.tournamentEntryFeeZar > 0 ? ` · ${formatZar(t.tournamentEntryFeeZar)} entry` : " · free entry"}
                        {formatTournamentPrizeLine(t.tournamentPrizes, formatZar)
                          ? ` · ${formatTournamentPrizeLine(t.tournamentPrizes, formatZar)}`
                          : ""}
                      </>
                    ) : t.kind === "SIT_AND_GO" ? (
                      <>
                        {" · "}
                        {formatZar(t.minBuyIn)} buy-in · {formatChips(t.tournamentStartingStackChips)} chips
                        {t.tournamentPrizes.firstZar > 0
                          ? ` · ${formatZar(t.tournamentPrizes.firstZar)} 1st`
                          : ""}
                      </>
                    ) : (
                      <>
                        {" · "}
                        {formatZar(t.minBuyIn)}–{formatZar(t.maxBuyIn)} buy-in
                      </>
                    )}
                  </p>
                </div>
                <span className="text-sm font-semibold text-amber-400/90 transition group-hover:text-amber-300">
                  Open table ↗
                </span>
              </a>
              {t.kind === "TOURNAMENT" && t.startsAt && t.tournamentFlightStatus !== "CANCELLED" ? (
                t.viewerRegistered ? (
                  lobbyUnregisterOpen(t) ? (
                    <button
                      type="button"
                      disabled={regBusyId === t.id}
                      onClick={() => void setTournamentRegistration(t.id, false)}
                      className="shrink-0 self-center rounded-lg border border-zinc-600 bg-black/30 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:bg-zinc-900/80 disabled:opacity-50"
                    >
                      {regBusyId === t.id ? "…" : "Unregister"}
                    </button>
                  ) : null
                ) : t.registrationWindowOpen &&
                  new Date(t.startsAt).getTime() - nowMs > UNREGISTER_CUTOFF_MS ? (
                  <button
                    type="button"
                    disabled={regBusyId === t.id || t.registrationCount >= t.registrationCap}
                    onClick={() => void setTournamentRegistration(t.id, true)}
                    className="shrink-0 self-center rounded-lg border border-amber-600/70 bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
                  >
                    {regBusyId === t.id
                      ? "…"
                      : t.registrationCount >= t.registrationCap
                        ? "Full"
                        : "Register"}
                  </button>
                ) : null
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  disabled={closingId === t.id}
                  onClick={() => void closeTable(t.id)}
                  className="shrink-0 self-center rounded-lg border border-zinc-700/90 bg-black/30 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-red-800/50 hover:bg-red-950/30 hover:text-red-200 disabled:opacity-50"
                >
                  {closingId === t.id ? "Closing…" : "Close"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}



