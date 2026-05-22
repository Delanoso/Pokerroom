import { auth } from "@/auth";
import { PokerChrome } from "@/components/poker-chrome";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TableWindowsLauncher } from "./table-windows-launcher";

export default async function TableWindowsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const navRight = (
    <>
      <Link href="/tables" className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100">
        ← Tables
      </Link>
      <Link href="/dashboard" className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100">
        Lobby
      </Link>
    </>
  );

  return (
    <PokerChrome navRight={navRight}>
      <Suspense fallback={<p className="py-8 text-center text-sm text-zinc-500">Loading…</p>}>
        <TableWindowsLauncher />
      </Suspense>
    </PokerChrome>
  );
}
