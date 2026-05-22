import { collectSetCookiesFromResponse, cookieHeaderValue, mergeSetCookieHeaders, type CookieJar } from "./cookie-jar";

export type CredentialsSignInResult = {
  jar: CookieJar;
};

/**
 * Performs the same flow as `signIn("credentials", { login, password, redirect: false })`
 * so subsequent `fetch` calls can send the session cookie jar.
 */
export async function signInWithCredentials(
  appOrigin: string,
  login: string,
  password: string,
): Promise<CredentialsSignInResult> {
  const origin = appOrigin.replace(/\/$/, "");
  const jar: CookieJar = new Map();

  const csrfRes = await fetch(`${origin}/api/auth/csrf`, {
    headers: { cookie: cookieHeaderValue(jar) },
  });
  mergeSetCookieHeaders(jar, collectSetCookiesFromResponse(csrfRes));
  const csrfJson = (await csrfRes.json()) as { csrfToken?: string };
  const csrfToken = csrfJson.csrfToken;
  if (!csrfToken) {
    throw new Error("NextAuth CSRF response missing csrfToken");
  }

  const body = new URLSearchParams({
    csrfToken,
    callbackUrl: `${origin}/dashboard`,
    login,
    password,
  });

  const signInRes = await fetch(`${origin}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
      cookie: cookieHeaderValue(jar),
    },
    body,
  });
  mergeSetCookieHeaders(jar, collectSetCookiesFromResponse(signInRes));

  const data = (await signInRes.json()) as { url?: string };
  if (!signInRes.ok) {
    throw new Error(`Credentials sign-in failed (${signInRes.status}): ${JSON.stringify(data)}`);
  }
  if (!data.url || data.url.includes("error=")) {
    throw new Error(`Credentials sign-in rejected: ${data.url ?? "no url"}`);
  }

  return { jar };
}
