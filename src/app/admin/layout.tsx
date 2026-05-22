import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Operator console</h1>
          <p className="mt-1 text-sm text-zinc-400">Manage players, account history, house revenue, and bot fleet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            Lobby
          </Link>
          <SignOutButton />
        </div>
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
