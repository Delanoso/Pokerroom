"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export type OpenTableOption = {
  id: string;
  name: string;
  kind: string;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  emptySeats: number[];
  startsAt: string | null;
  tournamentGroupId: string | null;
  tournamentEntryFeeZar: number;
  tournamentFlightStatus: string | null;
};

type BotSeat = {
  seatIndex: number;
  stackChips: number;
  tableId: string;
  tableName: string;
  tableKind: string;
};

type BotRow = {
  id: string;
  username: string;
  email: string;
  blockedAt: string | null;
  createdAt: string;
  bankrollChips: number;
  availableChips: number;
  seats: BotSeat[];
  registeredTournamentTableIds: string[];
};

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/30";

const selectClass =
  "rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500/30";

function tableOptionLabel(t: OpenTableOption): string {
  if (t.kind === "TOURNAMENT") {
    const fee =
      t.tournamentEntryFeeZar > 0
        ? `${t.tournamentEntryFeeZar.toLocaleString()} Zar entry`
        : "free entry";
    const when = t.startsAt
      ? new Date(t.startsAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
      : "unscheduled";
    return `${t.name} (Tournament) · ${fee} · starts ${when}`;
  }
  const free = t.emptySeats.length;
  const seats = free === 0 ? "full" : `${free} seat${free === 1 ? "" : "s"} free`;
  return `${t.name} (Cash) · ${seats} · ${t.minBuyIn.toLocaleString()}–${t.maxBuyIn.toLocaleString()}`;
}

function BotTableControls({
  bot,
  openTables,
  pending,
  onSeat,
  onRegister,
}: {
  bot: BotRow;
  openTables: OpenTableOption[];
  pending: boolean;
  onSeat: (tableId: string, seatIndex: number, buyInChips: number) => Promise<void>;
  onRegister: (tableId: string) => Promise<void>;
}) {
  const cashTables = openTables.filter((t) => t.kind !== "TOURNAMENT");
  const tournamentTables = openTables.filter((t) => t.kind === "TOURNAMENT");
  const firstOpen =
    tournamentTables[0] ?? cashTables.find((t) => t.emptySeats.length > 0) ?? openTables[0];
  const [tableId, setTableId] = useState(firstOpen?.id ?? "");
  const [seatIndex, setSeatIndex] = useState<number | "">("");
  const [buyIn, setBuyIn] = useState("");

  const table = openTables.find((t) => t.id === tableId);
  const isTournament = table?.kind === "TOURNAMENT";
  const emptySeats = table?.emptySeats ?? [];
  const alreadyRegistered =
    !!table && bot.registeredTournamentTableIds.includes(table.id);

  useEffect(() => {
    if (!table || isTournament) return;
    setBuyIn(String(table.minBuyIn));
    setSeatIndex(table.emptySeats[0] ?? "");
  }, [tableId, table, isTournament]);

  if (openTables.length === 0) {
    return <span className="text-xs text-zinc-500">No open tables</span>;
  }

  const canSeat =
    !isTournament && table && emptySeats.length > 0 && seatIndex !== "" && buyIn.trim() !== "";
  const canRegister = isTournament && table && !alreadyRegistered;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-zinc-500">
        Table
        <select
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
          className={`${selectClass} max-w-[14rem]`}
          disabled={pending}
        >
          {openTables.map((t) => (
            <option
              key={t.id}
              value={t.id}
              disabled={t.kind !== "TOURNAMENT" && t.emptySeats.length === 0}
            >
              {tableOptionLabel(t)}
            </option>
          ))}
        </select>
      </label>
      {isTournament ? (
        <>
          {table && table.tournamentEntryFeeZar > 0 ? (
            <span className="text-xs text-zinc-500">
              Fee {table.tournamentEntryFeeZar.toLocaleString()} Zar
            </span>
          ) : null}
          <button
            type="button"
            disabled={pending || !canRegister}
            onClick={() => {
              if (!table) return;
              void onRegister(table.id);
            }}
            className="rounded border border-amber-700/80 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-100 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {alreadyRegistered ? "Registered" : "Register"}
          </button>
          <span className="text-[10px] text-zinc-600">Auto-seated at start</span>
        </>
      ) : (
        <>
          {emptySeats.length > 1 ? (
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              Seat
              <select
                value={seatIndex === "" ? "" : String(seatIndex)}
                onChange={(e) => setSeatIndex(Number.parseInt(e.target.value, 10))}
                className={selectClass}
                disabled={pending || emptySeats.length === 0}
              >
                {emptySeats.map((idx) => (
                  <option key={idx} value={idx}>
                    #{idx + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            Buy-in
            <input
              type="number"
              min={table?.minBuyIn ?? 1}
              max={table?.maxBuyIn}
              value={buyIn}
              onChange={(e) => setBuyIn(e.target.value)}
              className={`${selectClass} w-24 tabular-nums`}
              disabled={pending || !table || emptySeats.length === 0}
            />
          </label>
          <button
            type="button"
            disabled={pending || !canSeat}
            onClick={() => {
              if (!table || seatIndex === "") return;
              const buyInChips = Number.parseInt(buyIn, 10);
              void onSeat(table.id, seatIndex, buyInChips);
            }}
            className="rounded border border-cyan-800/80 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-950/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Seat
          </button>
        </>
      )}
    </div>
  );
}

export function AdminBotsPanel({ openTables }: { openTables: OpenTableOption[] }) {
  const router = useRouter();
  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [seatPendingId, setSeatPendingId] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [startingChips, setStartingChips] = useState("100000");
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);

  const loadBots = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/bots");
    const data = (await res.json().catch(() => ({}))) as { bots?: BotRow[]; error?: string };
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to load bots");
      return;
    }
    setBots(data.bots ?? []);
  }, []);

  useEffect(() => {
    void loadBots();
  }, [loadBots]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setCreatedPassword(null);
    const chips = Number.parseInt(startingChips, 10);
    if (!username.trim() || !Number.isFinite(chips) || chips < 0) {
      setError("Enter a username and valid starting chips.");
      return;
    }
    setCreatePending(true);
    const res = await fetch("/api/admin/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.trim(),
        password: password.trim() || undefined,
        startingChips: chips,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      password?: string;
      bot?: { username: string };
    };
    setCreatePending(false);
    if (!res.ok) {
      setError(data.error ?? "Create failed");
      return;
    }
    setMessage(`Created bot @${data.bot?.username ?? username}.`);
    setCreatedPassword(data.password ?? null);
    setUsername("");
    setPassword("");
    await loadBots();
    router.refresh();
  }

  async function adjustChips(botId: string, direction: "add" | "remove") {
    const raw = window.prompt(
      direction === "add" ? "Chips to add:" : "Chips to remove:",
      "10000",
    );
    if (raw === null) return;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive whole number.");
      return;
    }
    setError(null);
    setMessage(null);
    const res = await fetch("/api/admin/adjust-balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: botId,
        amountChips: direction === "remove" ? -n : n,
        note: direction === "add" ? "Bot fleet top-up" : "Bot fleet debit",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; newBalance?: number };
    if (!res.ok) {
      setError(data.error ?? "Balance update failed");
      return;
    }
    setMessage(`Bankroll updated. New balance: ${data.newBalance?.toLocaleString() ?? "?"} chips.`);
    await loadBots();
    router.refresh();
  }

  async function seatBot(bot: BotRow, tableId: string, seatIndex: number, buyInChips: number) {
    const table = openTables.find((t) => t.id === tableId);
    if (!table) {
      setError("Unknown table.");
      return;
    }
    if (!table.emptySeats.includes(seatIndex)) {
      setError("That seat is no longer empty. Refresh and try again.");
      return;
    }
    if (!Number.isFinite(buyInChips) || buyInChips < table.minBuyIn || buyInChips > table.maxBuyIn) {
      setError(`Buy-in must be between ${table.minBuyIn.toLocaleString()} and ${table.maxBuyIn.toLocaleString()}.`);
      return;
    }

    setError(null);
    setMessage(null);
    setSeatPendingId(bot.id);
    const res = await fetch(`/api/admin/bots/${bot.id}/sit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId: table.id, seatIndex, buyInChips }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setSeatPendingId(null);
    if (!res.ok) {
      setError(data.error ?? "Could not seat bot");
      return;
    }
    setMessage(`@${bot.username} seated at ${table.name} (seat ${seatIndex + 1}) — bot fleet will play automatically.`);
    await loadBots();
    router.refresh();
  }

  async function registerBotForTournament(bot: BotRow, tableId: string) {
    const table = openTables.find((t) => t.id === tableId);
    if (!table || table.kind !== "TOURNAMENT") {
      setError("Choose a tournament table.");
      return;
    }

    setError(null);
    setMessage(null);
    setSeatPendingId(bot.id);
    const res = await fetch(`/api/admin/bots/${bot.id}/tournament-register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      already?: boolean;
    };
    setSeatPendingId(null);
    if (!res.ok) {
      setError(data.error ?? "Could not register bot");
      return;
    }
    setMessage(
      data.already
        ? `@${bot.username} is already registered for ${table.name}. They will be seated automatically when the tournament starts.`
        : `@${bot.username} registered for ${table.name} — entry fee debited from available balance. Auto-seated at start.`,
    );
    await loadBots();
    router.refresh();
  }

  async function leaveBot(bot: BotRow, tableId?: string) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/admin/bots/${bot.id}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tableId ? { tableId } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not remove bot from table");
      return;
    }
    setMessage(`@${bot.username} left the table.`);
    await loadBots();
    router.refresh();
  }

  async function deleteBot(bot: BotRow) {
    if (
      !window.confirm(
        `Delete bot @${bot.username}? This removes the account permanently.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/admin/bots/${bot.id}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Delete failed");
      return;
    }
    setMessage(`Deleted @${bot.username}.`);
    await loadBots();
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-cyan-900/50 bg-cyan-950/20 px-4 py-4">
      <h2 className="text-sm font-semibold text-cyan-200">Bot fleet</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Create bot accounts. For cash games use <strong className="text-zinc-400">Seat</strong>; for
        tournaments use <strong className="text-zinc-400">Register</strong> — all registered players are
        seated automatically at start. Bots play when{" "}
        <span className="font-mono text-zinc-400">npm run dev</span> is running.
      </p>

      <form onSubmit={onCreate} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="bot-username" className="block text-xs font-medium text-zinc-400">
            Username
          </label>
          <input
            id="bot-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="bot_bravo"
            className={inputClass}
            required
          />
        </div>
        <div>
          <label htmlFor="bot-password" className="block text-xs font-medium text-zinc-400">
            Password (optional)
          </label>
          <input
            id="bot-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Auto-generated if empty"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="bot-chips" className="block text-xs font-medium text-zinc-400">
            Starting chips
          </label>
          <input
            id="bot-chips"
            type="number"
            min={0}
            value={startingChips}
            onChange={(e) => setStartingChips(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={createPending}
            className="w-full rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-60"
          >
            {createPending ? "Creating…" : "Create bot"}
          </button>
        </div>
      </form>

      {createdPassword ? (
        <p className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          Save this password now (shown once): <strong className="font-mono">{createdPassword}</strong>
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-emerald-400">{message}</p> : null}

      {loading ? (
        <p className="mt-4 text-sm text-zinc-500">Loading bots…</p>
      ) : bots.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No bots yet. Create one above.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-800 text-sm">
          {bots.map((bot) => (
            <li
              key={bot.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
            >
              <div>
                <span className="font-medium text-zinc-100">@{bot.username}</span>
                <span className="ml-2 text-xs text-zinc-500">{bot.email}</span>
                  <div className="mt-1 text-xs text-zinc-400">
                    Bankroll:{" "}
                    <span className="tabular-nums text-emerald-400">{bot.bankrollChips.toLocaleString()}</span>
                    {bot.availableChips !== bot.bankrollChips ? (
                      <span className="text-zinc-600">
                        {" "}
                        · available {bot.availableChips.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  {bot.seats.length > 0 ? (
                    <div className="mt-1 text-xs text-cyan-300/90">
                      Seated:{" "}
                      {bot.seats.map((s) => (
                        <span key={`${s.tableId}-${s.seatIndex}`} className="mr-2">
                          {s.tableName} (seat {s.seatIndex + 1}, {s.stackChips.toLocaleString()} stack)
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {bot.registeredTournamentTableIds.length > 0 ? (
                    <div className="mt-1 text-xs text-amber-300/90">
                      Registered:{" "}
                      {bot.registeredTournamentTableIds
                        .map((tid) => openTables.find((t) => t.id === tid)?.name ?? tid.slice(-6))
                        .join(", ")}
                      {" "}
                      (auto-seat at start)
                    </div>
                  ) : null}
                  {bot.seats.length === 0 && bot.registeredTournamentTableIds.length === 0 ? (
                    <div className="mt-1 text-xs text-zinc-600">Not seated or registered</div>
                  ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void adjustChips(bot.id, "add")}
                  className="rounded border border-emerald-800/80 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/50"
                >
                  Add chips
                </button>
                <button
                  type="button"
                  onClick={() => void adjustChips(bot.id, "remove")}
                  className="rounded border border-amber-800/80 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950/50"
                >
                  Remove chips
                </button>
                <BotTableControls
                  bot={bot}
                  openTables={openTables}
                  pending={seatPendingId === bot.id}
                  onSeat={(tableId, seatIndex, buyInChips) => seatBot(bot, tableId, seatIndex, buyInChips)}
                  onRegister={(tableId) => registerBotForTournament(bot, tableId)}
                />
                {bot.seats.map((s) => (
                  <button
                    key={s.tableId}
                    type="button"
                    onClick={() => void leaveBot(bot, s.tableId)}
                    className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    Leave {s.tableName}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void deleteBot(bot)}
                  className="rounded border border-red-900/80 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}