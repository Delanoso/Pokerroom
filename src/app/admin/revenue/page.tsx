import {
  aggregateLedgerByTypeSql,
  LEDGER_DEALER_TIP_RECEIVED,
  LEDGER_HOUSE_RAKE_CASH_POT,
  LEDGER_TOURNAMENT_ENTRY_FEE_PAID,
  LEDGER_TOURNAMENT_FEE_RECEIVED,
  listOpenTablesWithFeesSql,
  listRecentHouseRevenueEntriesSql,
} from "@/lib/house-fees-sql";
import { prisma } from "@/lib/prisma";
import { PokerTableKind } from "@prisma/client";
import Link from "next/link";
import { listOpenTournamentFlights } from "@/lib/tournament-revenue";
import { AdminRevenueClear } from "../admin-revenue-clear";
import { AdminTournamentFlights } from "../admin-tournament-flights";

function formatBps(bps: number): string {
  if (bps <= 0) return "0%";
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

export default async function AdminRevenuePage() {
  const [
    rakeGlobal,
    tournamentFeeGlobal,
    dealerTipsGlobal,
    entryFeesPaidGlobal,
    recentHouseEntries,
    openTablesWithFees,
    openTournamentFlights,
  ] = await Promise.all([
    aggregateLedgerByTypeSql(prisma, LEDGER_HOUSE_RAKE_CASH_POT),
    aggregateLedgerByTypeSql(prisma, LEDGER_TOURNAMENT_FEE_RECEIVED),
    aggregateLedgerByTypeSql(prisma, LEDGER_DEALER_TIP_RECEIVED),
    aggregateLedgerByTypeSql(prisma, LEDGER_TOURNAMENT_ENTRY_FEE_PAID),
    listRecentHouseRevenueEntriesSql(40),
    listOpenTablesWithFeesSql(30),
    listOpenTournamentFlights(),
  ]);

  const tournamentRegisteredTotal = openTournamentFlights.reduce((s, f) => s + f.registeredCount, 0);
  const tournamentEntryPoolTotal = openTournamentFlights.reduce((s, f) => s + f.entryPoolZar, 0);

  const rakeChips = rakeGlobal.sumChips;
  const rakeEvents = rakeGlobal.count;
  const tournamentFeeChips = tournamentFeeGlobal.sumChips;
  const tournamentFeeEvents = tournamentFeeGlobal.count;
  const tipsChips = dealerTipsGlobal.sumChips;
  const tipsEvents = dealerTipsGlobal.count;
  const entryFeesPaidChips = Math.abs(entryFeesPaidGlobal.sumChips);
  const houseTotalChips = rakeChips + tournamentFeeChips + tipsChips;

  const feeTypeLabel: Record<string, string> = {
    HOUSE_RAKE_CASH_POT: "Cash rake",
    TOURNAMENT_FEE_RECEIVED: "Tournament entry",
    DEALER_TIP_RECEIVED: "Dealer tip",
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 px-4 py-4">
        <h2 className="text-sm font-semibold text-emerald-200">House revenue (all time)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Credits to table hosts from rake, tournament entry fees, and dealer tips.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs uppercase text-zinc-500">Total to hosts</dt>
            <dd className="tabular-nums text-xl font-semibold text-emerald-200">{houseTotalChips.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Cash pot rake</dt>
            <dd className="tabular-nums text-lg font-semibold text-zinc-100">{rakeChips.toLocaleString()}</dd>
            <dd className="text-xs text-zinc-500">{rakeEvents.toLocaleString()} hands</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Tournament entry fees</dt>
            <dd className="tabular-nums text-lg font-semibold text-zinc-100">{tournamentFeeChips.toLocaleString()}</dd>
            <dd className="text-xs text-zinc-500">
              {tournamentFeeEvents.toLocaleString()} ledger credits · {entryFeesPaidChips.toLocaleString()} Zar from
              players
            </dd>
            <dd className="mt-1 text-xs text-amber-200/80">
              Open flights: {tournamentRegisteredTotal.toLocaleString()} registered ·{" "}
              {tournamentEntryPoolTotal.toLocaleString()} Zar entry pool
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Dealer tips</dt>
            <dd className="tabular-nums text-lg font-semibold text-violet-100">{tipsChips.toLocaleString()}</dd>
            <dd className="text-xs text-zinc-500">{tipsEvents.toLocaleString()} tips</dd>
          </div>
        </dl>
        <AdminRevenueClear />
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-4">
        <h2 className="text-sm font-semibold text-zinc-200">Open tournaments — entry & prizes</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Registration counts and entry pool per flight. Adjust place prizes before start based on field size.
        </p>
        <AdminTournamentFlights flights={openTournamentFlights} />
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-4">
        <h2 className="text-sm font-semibold text-zinc-200">Open tables — fee settings</h2>
        {openTablesWithFees.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No open tables.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-800 text-sm">
            {openTablesWithFees.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link href={`/tables/${t.id}`} className="font-medium text-emerald-400 hover:text-emerald-300">
                    {t.name}
                  </Link>
                  <span className="ml-2 text-xs text-zinc-500">
                    {t.kind === PokerTableKind.CASH
                      ? "Cash"
                      : t.kind === PokerTableKind.SIT_AND_GO
                        ? "Sit & Go"
                        : "Tournament"}{" "}
                    · @{t.hostUsername} · {t.smallBlind}/
                    {t.bigBlind}
                  </span>
                </div>
                <span className="text-xs text-zinc-400">
                  {t.kind === PokerTableKind.CASH
                    ? t.rakePercentBps > 0
                      ? `Rake ${formatBps(t.rakePercentBps)}${t.rakeCapChips > 0 ? `, cap ${t.rakeCapChips}` : ""}`
                      : "No rake"
                    : t.tournamentEntryFeeChips > 0
                      ? `Entry fee ${t.tournamentEntryFeeChips.toLocaleString()}`
                      : "No entry fee"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-4">
        <h2 className="text-sm font-semibold text-zinc-200">Recent fee events</h2>
        {recentHouseEntries.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No fee events yet.</p>
        ) : (
          <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto text-xs text-zinc-400">
            {recentHouseEntries.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-zinc-800/60 py-1.5">
                <span>
                  <span className="text-zinc-300">{feeTypeLabel[e.type] ?? e.type}</span>
                  {" · "}
                  <span className="text-zinc-500">@{e.username}</span>
                  {e.note ? <span className="text-zinc-600"> — {e.note}</span> : null}
                </span>
                <span className="tabular-nums text-amber-200/90">+{e.amountChips.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
