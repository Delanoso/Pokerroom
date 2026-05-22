import { auth } from "@/auth";
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
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Operator console</h1>
        <p className="mt-1 text-sm text-zinc-400">Manage players, account history, house revenue, and bot fleet.</p>
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
