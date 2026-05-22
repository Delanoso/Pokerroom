import { auth } from "@/auth";
import { HandRankingsGallery } from "@/components/hand-rankings-gallery";
import { PlayerTopNav } from "@/components/player-top-nav";
import { PokerChrome } from "@/components/poker-chrome";
import Link from "next/link";

export const metadata = {
  title: "Hand rankings",
  description: "Texas Hold’em hand strength reference with examples.",
};

export default async function HandRankingsPage() {
  const session = await auth();

  const navRight = (
    <>
      {session?.user ? (
        <PlayerTopNav isAdmin={session.user.role === "ADMIN"} showLobby />
      ) : (
        <Link
          href="/"
          className="rounded-lg border border-zinc-600/80 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
        >
          Home
        </Link>
      )}
      {!session?.user ? (
        <Link
          href="/login"
          className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/50"
        >
          Sign in
        </Link>
      ) : null}
    </>
  );

  return (
    <PokerChrome fullBleed navRight={navRight}>
      <div className="mx-auto flex h-[calc(100dvh-4.75rem)] max-w-6xl flex-col overflow-hidden px-3 pb-3 pt-2 sm:px-4 sm:pb-4 sm:pt-3">
        <header className="shrink-0 border-b border-amber-900/20 pb-2 sm:pb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber-500/90">Reference</p>
          <h1 className="mt-0.5 text-lg font-bold tracking-tight text-zinc-50 sm:text-xl">Poker hand rankings</h1>
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 sm:text-xs">
            No-limit Hold’em — best five-card hand wins at showdown. Kickers break ties within the same category;
            suits never rank.
          </p>
        </header>

        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden sm:mt-3">
          <HandRankingsGallery />
        </div>
      </div>
    </PokerChrome>
  );
}
