import Link from "next/link";
import { auth } from "@/auth";
import { PokerChrome } from "@/components/poker-chrome";
import { SignOutButton } from "@/components/sign-out-button";

export default async function Home() {
  const session = await auth();

  const navRight = session?.user ? (
    <>
      <SignOutButton />
      <Link
        href="/dashboard"
        className="rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2 text-sm font-semibold text-black shadow-md shadow-amber-900/30 hover:from-amber-500 hover:to-amber-400"
      >
        Enter lobby
      </Link>
    </>
  ) : (
    <Link
      href="/login"
      className="rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 px-4 py-2 text-sm font-semibold text-black shadow-md shadow-amber-900/30 hover:from-amber-500 hover:to-amber-400"
    >
      Sign in
    </Link>
  );

  return (
    <PokerChrome navRight={navRight} fullBleed>
      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-16 sm:py-24">
        <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center opacity-[0.07]" aria-hidden>
          <span className="text-[12rem] font-serif leading-none text-white sm:text-[16rem]">♠</span>
        </div>

        <div className="relative z-[1] mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.45em] text-amber-500/90 sm:text-sm">No-limit hold&apos;em · play chips</p>
          <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-zinc-50 sm:text-6xl sm:leading-[1.08]">
            Your table.
            <span className="mt-2 block bg-gradient-to-r from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent">
              Your club.
            </span>
          </h1>
          <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Real accounts, house-controlled play-money bankrolls, and live felts for cash games and scheduled tournaments—built
            for friends who take the game seriously.
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-3 text-3xl opacity-40 sm:text-4xl" aria-hidden>
            <span className="text-zinc-300">♠</span>
            <span className="text-red-500/90">♥</span>
            <span className="text-zinc-300">♣</span>
            <span className="text-red-500/90">♦</span>
          </div>

          <div className="mt-12 flex flex-wrap justify-center gap-4">
            {session?.user ? (
              <Link
                href="/dashboard"
                className="inline-flex min-w-[12rem] items-center justify-center rounded-xl border border-amber-500/50 bg-gradient-to-b from-amber-500 to-amber-700 px-8 py-3.5 text-base font-bold text-black shadow-xl shadow-amber-950/40 transition hover:brightness-110"
              >
                Open lobby →
              </Link>
            ) : (
              <Link
                href="/login"
                className="inline-flex min-w-[11rem] items-center justify-center rounded-xl border border-amber-500/50 bg-gradient-to-b from-amber-500 to-amber-700 px-8 py-3.5 text-base font-bold text-black shadow-xl shadow-amber-950/40 transition hover:brightness-110"
              >
                Sign in
              </Link>
            )}
          </div>

          <p className="mt-14 text-xs text-zinc-600 sm:text-sm">
            Texas Hold&apos;em · private tables · operator-funded chip pool
          </p>
        </div>

        <div
          className="pointer-events-none absolute bottom-0 left-1/2 h-[42%] w-[min(110vw,52rem)] -translate-x-1/2 rounded-[50%] border border-red-800/55 bg-gradient-to-b from-red-900/40 via-red-950/22 to-transparent opacity-90"
          aria-hidden
        />
      </main>
    </PokerChrome>
  );
}
