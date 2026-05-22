import { HandRankingsChartButton } from "@/components/hand-rankings-chart";
import Link from "next/link";

const navLink =
  "rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900/80 hover:text-zinc-100";
const tablesLink =
  "rounded-lg bg-red-900/50 px-3 py-2 text-sm font-semibold text-red-100 ring-1 ring-red-800/60 hover:bg-red-800/60";
const lobbyLink =
  "rounded-lg border border-zinc-600/80 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 hover:border-amber-700/50 hover:text-amber-100";

export function PlayerTopNav({
  isAdmin,
  showLobby = false,
  showTables = true,
  active,
}: {
  isAdmin: boolean;
  showLobby?: boolean;
  showTables?: boolean;
  active?: "tables" | "lobby";
}) {
  return (
    <>
      {showLobby ? (
        <Link href="/dashboard" className={active === "lobby" ? lobbyLink : navLink}>
          ← Lobby
        </Link>
      ) : null}
      {showTables ? (
        <Link href="/tables" className={active === "tables" ? tablesLink : navLink}>
          Tables
        </Link>
      ) : null}
      <HandRankingsChartButton />
      {isAdmin ? (
        <Link
          href="/admin"
          className="rounded-lg px-3 py-2 text-sm text-amber-400/90 hover:bg-zinc-900/80 hover:text-amber-300"
        >
          Operator
        </Link>
      ) : null}
    </>
  );
}
