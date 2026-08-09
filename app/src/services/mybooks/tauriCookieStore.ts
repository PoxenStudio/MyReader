/**
 * Self-managed Cookie storage for the Tauri WS sync channel.
 *
 * `@tauri-apps/plugin-http`'s `fetch` manages cookies in its own internal
 * (and unreadable from outside the plugin) cookie jar, so REST calls keep
 * working without this. But `@tauri-apps/plugin-websocket` is a separate
 * native client that does not share that jar — it only sends a `Cookie`
 * header if we pass one explicitly. Unlike a browser, Tauri's `plugin-http`
 * intentionally exposes `Set-Cookie` on fetch responses (see its source),
 * so we capture it once at login and reuse it for the WS handshake.
 * See document/MyBooks_Sync_WS_Design.md §4.1.
 */

const STORAGE_KEY = 'mybooks_tauri_cookie';

export function setTauriMyBooksCookie(cookie: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, cookie);
}

export function getTauriMyBooksCookie(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function clearTauriMyBooksCookie(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

const parseCookiePairs = (header: string): Map<string, string> => {
  const pairs = new Map<string, string>();
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    pairs.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return pairs;
};

/**
 * Adds `cookie`'s name=value pairs to whatever is already stored, instead of
 * replacing it outright — a same-named pair in `cookie` wins. Unlike a plain
 * `setTauriMyBooksCookie`, this doesn't erase a cookie captured by an earlier
 * response (e.g. the `invited` cookie from `/api/access`) when a later
 * response (e.g. sign-in, which doesn't resend it) is captured afterward.
 */
export function mergeTauriMyBooksCookie(cookie: string): void {
  if (typeof window === 'undefined') return;
  const existing = getTauriMyBooksCookie();
  if (!existing) {
    setTauriMyBooksCookie(cookie);
    return;
  }
  const merged = parseCookiePairs(existing);
  for (const [name, value] of parseCookiePairs(cookie)) {
    merged.set(name, value);
  }
  const joined = Array.from(merged.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  setTauriMyBooksCookie(joined);
}

type HeadersWithGetSetCookie = Headers & { getSetCookie?: () => string[] };

/**
 * Build a `Cookie` request-header value from a response's `Set-Cookie`
 * header(s) — strips attributes (Path/HttpOnly/Max-Age/...), keeping only
 * the `name=value` pairs, joined the way a `Cookie` request header expects.
 * Returns `null` when the response carried no `Set-Cookie` at all.
 */
export function extractCookieHeaderFromResponse(response: Response): string | null {
  const headers = response.headers as HeadersWithGetSetCookie;
  const rawCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (() => {
          const single = response.headers.get('set-cookie');
          return single ? [single] : [];
        })();
  if (rawCookies.length === 0) return null;
  const pairs = rawCookies.map((raw) => raw.split(';', 1)[0]!.trim()).filter(Boolean);
  return pairs.length > 0 ? pairs.join('; ') : null;
}
