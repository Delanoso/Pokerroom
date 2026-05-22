import Link from "next/link";
import { Suspense } from "react";
import { PokerChrome } from "@/components/poker-chrome";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const navRight = (
    <Link href="/" className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100">
      Home
    </Link>
  );

  return (
    <PokerChrome navRight={navRight}>
      <div className="flex flex-1 flex-col items-center justify-center py-12">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-12 py-16 text-sm text-zinc-500">
              Loading…
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </PokerChrome>
  );
}
