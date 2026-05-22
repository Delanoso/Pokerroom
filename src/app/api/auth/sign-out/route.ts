import { signOut } from "@/auth";
import { clearAuthSessionCookies } from "@/lib/auth-cookies";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

/** Fallback sign-out (GET) — clears Auth.js cookies and redirects home. */
export async function GET(req: NextRequest) {
  try {
    await signOut({ redirect: false });
  } catch {
    /* still clear cookies below */
  }

  const res = NextResponse.redirect(new URL("/", req.nextUrl.origin));
  clearAuthSessionCookies(res, req);

  const jar = await cookies();
  for (const c of jar.getAll()) {
    if (c.name.includes("authjs")) {
      res.cookies.set(c.name, "", {
        maxAge: 0,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
      });
    }
  }

  return res;
}
