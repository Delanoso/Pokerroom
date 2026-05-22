import { auth, signOut } from "@/auth";
import { PlayerTopNav } from "@/components/player-top-nav";
import { PokerChrome } from "@/components/poker-chrome";
import { formatZar } from "@/lib/format-currency";
import { getAvailableChipBalance, getChipBalance, getPendingWithdrawalHold } from "@/lib/wallet";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const [ledgerBalance, pendingHold, available] = await Promise.all([
    getChipBalance(session.user.id),
    getPendingWithdrawalHold(session.user.id),
    getAvailableChipBalance(session.user.id),
  ]);

  const isAdmin = session.user.role === "ADMIN";

  const navRight = (
    <>
      <span className="hidden text-xs text-zinc-500 sm:inline">
        <span className="text-zinc-400">{session.user.name}</span>
      </span>
      <PlayerTopNav isAdmin={isAdmin} />
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          Sign out
        </button>
      </form>
    </>
  );

  return (
    <PokerChrome navRight={navRight}>
      <div className="flex flex-col gap-10">
        <header className="border-b border-zinc-800/80 pb-8">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-amber-500/90">Lobby</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">Welcome back</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Signed in as <span className="text-zinc-300">{session.user.name}</span>
            <span className="text-zinc-600"> · </span>
            <span className="text-zinc-400">{session.user.email}</span>
          </p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          <section className="relative overflow-hidden rounded-2xl border border-amber-900/20 bg-gradient-to-br from-zinc-950/90 via-zinc-950/70 to-red-950/20 p-6 shadow-xl ring-1 ring-black/40">
            <div className="pointer-events-none absolute -right-8 -top-8 text-8xl opacity-[0.06]" aria-hidden>
              ♠
            </div>
            <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">Balance (Zar)</h2>
            <p className="mt-3 text-4xl font-bold tabular-nums text-amber-300 sm:text-5xl">{formatZar(available)}</p>
            <p className="mt-1 text-sm font-medium text-amber-700/80">available to play & register</p>
            {pendingHold > 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                Ledger total <span className="tabular-nums text-zinc-400">{ledgerBalance.toLocaleString()}</span>
                {" · "}
                <span className="text-amber-200/90">{pendingHold.toLocaleString()}</span> pending withdrawal
              </p>
            ) : (
              <p className="mt-2 text-xs text-zinc-600">Ledger matches playable balance.</p>
            )}
            <p className="mt-4 text-sm leading-relaxed text-zinc-500">
              Buy-ins move chips from here to your stack at the table between hands.
            </p>
          </section>

          <section className="flex flex-col justify-between rounded-2xl border border-red-900/25 bg-gradient-to-br from-red-950/40 to-zinc-950/80 p-6 shadow-xl ring-1 ring-red-950/30">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-red-400/90">Live felts</h2>
              <p className="mt-3 text-lg font-semibold text-zinc-100">Open tables</p>
              <p className="mt-2 text-sm text-zinc-500">Cash games and tournaments the house has opened.</p>
            </div>
            <Link
              href="/tables"
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-red-700 to-red-900 px-4 py-3 text-center text-sm font-bold text-white shadow-lg shadow-red-950/40 transition hover:brightness-110 sm:w-auto sm:px-8"
            >
              Browse tables →
            </Link>
          </section>
        </div>

        {isAdmin ? (
          <Link
            href="/admin"
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-amber-800/40 bg-amber-950/25 px-5 py-3 text-sm font-semibold text-amber-200 transition hover:border-amber-600/50 hover:bg-amber-950/40"
          >
            <span aria-hidden>⚙</span> Operator console
          </Link>
        ) : null}
      </div>
    </PokerChrome>
  );
}
