import Link from "next/link";

export function HandRankingsChartButton() {
  return (
    <Link
      href="/hand-rankings"
      className="rounded-lg border border-zinc-600/80 bg-zinc-900/60 px-3 py-2 text-sm font-medium text-zinc-200 ring-1 ring-zinc-700/50 hover:border-amber-700/50 hover:bg-zinc-800/80 hover:text-amber-100"
    >
      Hand rankings
    </Link>
  );
}
