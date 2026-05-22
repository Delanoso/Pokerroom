import { signOut } from "@/auth";

const defaultClassName =
  "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200";

export function SignOutButton({ className = defaultClassName }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
