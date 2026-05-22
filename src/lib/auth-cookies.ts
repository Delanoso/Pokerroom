import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Auth.js session cookie names (http + secure variants). */
const AUTH_SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "__Host-authjs.session-token",
  "authjs.csrf-token",
  "__Secure-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
];

function isAuthCookieName(name: string): boolean {
  return (
    AUTH_SESSION_COOKIE_NAMES.includes(name) ||
    name.startsWith("authjs.session-token.") ||
    name.startsWith("__Secure-authjs.session-token.")
  );
}

/** Clear every Auth.js cookie on the response (including chunked session tokens). */
export function clearAuthSessionCookies(res: NextResponse, req?: NextRequest): void {
  const names = new Set<string>(AUTH_SESSION_COOKIE_NAMES);
  if (req) {
    for (const c of req.cookies.getAll()) {
      if (isAuthCookieName(c.name)) names.add(c.name);
    }
  }
  for (const name of names) {
    res.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
  }
}

export function redirectToLogin(
  req: NextRequest,
  error?: "blocked" | "session",
): NextResponse {
  const url = new URL("/login", req.nextUrl.origin);
  if (error) url.searchParams.set("error", error);
  const res = NextResponse.redirect(url);
  clearAuthSessionCookies(res, req);
  return res;
}
