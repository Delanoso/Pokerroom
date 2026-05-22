import Link from "next/link";

export function PokerChrome({
  children,
  navRight,
  /** Skip inner max-width wrapper (hero landing). */
  fullBleed = false,
}: {
  children: React.ReactNode;
  navRight?: React.ReactNode;
  fullBleed?: boolean;
}) {
  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#06080b] text-zinc-100">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-950/45 via-[#0a0f12] to-zinc-950"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_62%_at_50%_-10%,rgba(220,38,38,0.38),transparent_52%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_42%_at_50%_102%,rgba(194,65,12,0.16),transparent_48%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)`,
          backgroundSize: "48px 48px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-28 top-[20%] h-[28rem] w-[28rem] rounded-full bg-red-600/22 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-20 bottom-[-5%] h-[22rem] w-[22rem] rounded-full bg-amber-500/18 blur-3xl"
        aria-hidden
      />

      <header className="relative z-20 border-b border-amber-900/25 bg-black/50 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-2 py-2.5 sm:px-4 sm:py-3.5">
          <Link href="/" className="group flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/40 bg-gradient-to-br from-red-800 via-red-950 to-zinc-950 text-base shadow-lg shadow-red-950/50 sm:h-10 sm:w-10 sm:text-lg">
              <span className="text-amber-100 drop-shadow" aria-hidden>
                ♠
              </span>
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-amber-500/95">Private club</span>
              <span className="text-lg font-bold tracking-tight text-zinc-50 group-hover:text-amber-50 sm:text-xl">
                Poker-room
              </span>
            </div>
          </Link>
          <nav className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">{navRight}</nav>
        </div>
      </header>

      <div
        className={
          fullBleed
            ? "relative z-10 flex min-h-0 flex-1 flex-col"
            : "relative z-10 mx-auto flex w-full min-h-0 max-w-6xl flex-1 flex-col px-4 py-10"
        }
      >
        {children}
      </div>
    </div>
  );
}