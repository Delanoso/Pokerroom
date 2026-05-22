import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Auth.js session cookie names (http + secure variants). */
const AUTH_SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "__Host-authjs.session-token",
];

export function clearAuthSessionCookies(res: NextResponse): void {
  for (const name of AUTH_SESSION_COOKIES) {
    res.cookies.set(name, "", { maxAge: 0, path: "/" });
  }
}

export function redirectToLogin(
  req: NextRequest,
  error?: "blocked" | "session",
): NextResponse {
  const url = new URL("/login", req.nextUrl.origin);
  if (error) url.searchParams.set("error", error);
  const res = NextResponse.redirect(url);
  clearAuthSessionCookies(res);
  return res;
}
