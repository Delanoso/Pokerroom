"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin/players", label: "Players" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/records", label: "Records" },
  { href: "/admin/bots", label: "Bots" },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 border-b border-zinc-800 pb-4">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              active
                ? "bg-emerald-900/50 text-emerald-100 ring-1 ring-emerald-700/60"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      <Link
        href="/tables"
        className="ml-auto rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-emerald-400"
      >
        Tables
      </Link>
      <Link href="/dashboard" className="rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-emerald-400">
        Lobby
      </Link>
    </nav>
  );
}
