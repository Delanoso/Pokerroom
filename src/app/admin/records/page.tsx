import { AdminAccountHistory } from "@/components/admin-account-history";
import { formatZar } from "@/lib/format-currency";
import { listTournamentRecords } from "@/lib/tournament-records";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Suspense } from "react";

function statusLabel(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "RUNNING":
      return "Running";
    case "SCHEDULED":
      return "Scheduled";
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "text-emerald-300/90";
    case "CANCELLED":
      return "text-red-300/90";
    default:
      return "text-zinc-400";
  }
}

export default async function AdminRecordsPage() {
  const [records, accountUsers] = await Promise.all([
    listTournamentRecords(prisma, 80),
    prisma.user.findMany({
      orderBy: [{ isBot: "asc" }, { username: "asc" }],
      select: { id: true, username: true, firstName: true, lastName: true, isBot: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading account history…</p>}>
        <AdminAccountHistory users={accountUsers} />
      </Suspense>

      <section className="flex flex-col gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Tournament records</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Completed and cancelled flights with placements. Prize payouts also appear in each player&apos;s account
            history above as &quot;Tournament prize won&quot;.
          </p>
        </div>

        {records.length === 0 ? (
          <p className="text-sm text-zinc-500">No tournament records yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {records.map((r) => (
              <article
                key={r.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-zinc-50">{r.tableName}</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {r.completedAt.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {" · "}
                      <span className={statusClass(r.status)}>{statusLabel(r.status)}</span>
                      {" · "}
                      {r.registrationCount} entrant{r.registrationCount === 1 ? "" : "s"}
                      {r.entryFeeZar > 0 ? ` · entry ${formatZar(r.entryFeeZar)}` : ""}
                    </p>
                    {(r.prize1stZar > 0 || r.prize2ndZar > 0 || r.prize3rdZar > 0) && (
                      <p className="mt-1 text-xs text-amber-200/80">
                        Prizes{" "}
                        {[
                          r.prize1stZar > 0 ? `1st ${formatZar(r.prize1stZar)}` : null,
                          r.prize2ndZar > 0 ? `2nd ${formatZar(r.prize2ndZar)}` : null,
                          r.prize3rdZar > 0 ? `3rd ${formatZar(r.prize3rdZar)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  {r.status === "COMPLETED" && r.anchorTableId ? (
                    <Link
                      href={`/tables/${r.anchorTableId}`}
                      className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      Table
                    </Link>
                  ) : null}
                </div>

                {r.topFive.length > 0 ? (
                  <ol className="mt-3 space-y-1.5 border-t border-zinc-800/80 pt-3">
                    {r.topFive.map((p) => (
                      <li
                        key={`${r.flightKey}-${p.place}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                      >
                        <span className="text-zinc-200">
                          <span className="mr-2 inline-block w-6 tabular-nums font-semibold text-amber-200/90">
                            #{p.place}
                          </span>
                          <Link
                            href={`/admin/records?user=${encodeURIComponent(p.userId)}`}
                            className="text-emerald-400/90 hover:text-emerald-300"
                          >
                            @{p.username}
                          </Link>
                          {p.displayName !== p.username ? (
                            <span className="ml-1 text-zinc-500">({p.displayName})</span>
                          ) : null}
                        </span>
                        <span className="text-xs text-zinc-400">
                          {p.prizeZar > 0 ? (
                            <span className="tabular-nums text-emerald-300/90">{formatZar(p.prizeZar)}</span>
                          ) : (
                            "—"
                          )}
                          {p.paidAt ? (
                            <span className="ml-1 text-zinc-600">paid</span>
                          ) : p.prizeZar > 0 ? (
                            <span className="ml-1 text-zinc-600">unpaid</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 border-t border-zinc-800/80 pt-3 text-xs text-zinc-500">No placements recorded.</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
