/** Minimal cookie store for server-side fetch against NextAuth + app APIs. */

export type CookieJar = Map<string, string>;

function parseSetCookieLine(line: string): { name: string; value: string } | null {
  const part = line.split(";")[0]?.trim();
  if (!part || !part.includes("=")) return null;
  const eq = part.indexOf("=");
  const name = part.slice(0, eq).trim();
  const value = part.slice(eq + 1).trim();
  if (!name) return null;
  return { name, value };
}

export function mergeSetCookieHeaders(jar: CookieJar, setCookieLines: string[]): void {
  for (const line of setCookieLines) {
    const parsed = parseSetCookieLine(line);
    if (!parsed) continue;
    jar.set(parsed.name, parsed.value);
  }
}

export function collectSetCookiesFromResponse(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const multi = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : undefined;
  if (multi && multi.length > 0) return multi;
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

export function cookieHeaderValue(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
