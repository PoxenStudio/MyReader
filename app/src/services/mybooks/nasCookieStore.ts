/**
 * Per-host cookie jar for NAS remote-access sessions.
 *
 * Cookies captured from the embedded NAS login webview live in a different
 * cookie store than `@tauri-apps/plugin-http`'s internal jar (the webview
 * uses the system browser engine; plugin-http uses its own reqwest-based
 * client) — see `nasWebviewBridge.ts`. We persist them here, one record per
 * login (keyed by the login URL's host, just for storage/eviction purposes —
 * see `getNasCookies` for why lookups don't rely on that key), so
 * `fetchMyBooks` can attach them as an explicit `Cookie` header.
 *
 * Cookies are stored with their `domain` scope (see `NasCookieEntry`) so a
 * lookup for a *different* host than the one they were captured at (e.g. a
 * dynamic NAS relay subdomain) only replays the cookies that would actually
 * apply there — a host-only cookie captured at `horkynas.fnos.net` must not
 * be sent to `<id>.horkynas.fnos.net`, only a domain cookie scoped to
 * `.horkynas.fnos.net` (or broader) should be.
 */

import { NasCookieEntry } from '@/utils/bridge';

const STORAGE_KEY = 'mybooks_nas_cookies';

/**
 * `tauriFetch`'s reqwest-based client defaults to a plain `reqwest/x.y`
 * User-Agent — nothing like a browser's. NAS relay/reverse-proxy gateways
 * (the ones fronting these NAS-cookie-gated hosts) sometimes gate or
 * fingerprint on the User-Agent along with the relay cookies, so requests
 * carrying a NAS cookie masquerade as a desktop Chrome browser to match what
 * actually captured those cookies (the login webview).
 */
export const NAS_CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface NasCookieRecord {
  cookies: NasCookieEntry[];
  capturedAt: number;
}

const normalizeHostKey = (host: string): string => host.trim().toLowerCase();

const readAll = (): Record<string, NasCookieRecord> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, NasCookieRecord>) : {};
  } catch {
    return {};
  }
};

const writeAll = (records: Record<string, NasCookieRecord>): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
};

export function setNasCookies(host: string, cookies: NasCookieEntry[]): void {
  const records = readAll();
  const key = normalizeHostKey(host);
  records[key] = { cookies, capturedAt: Date.now() };
  writeAll(records);
  const preview = cookies
    .map((c) => `${c.name}=${c.value} (${c.domain ? `domain=${c.domain}` : 'host-only'})`)
    .join('; ');
  console.log(`[nas-cookie-store] saved ${cookies.length} cookies for host "${key}": ${preview}`);
}

/** Whether `entry` would actually be sent to `requestedHost` per RFC 6265 domain matching. */
const cookieAppliesToHost = (
  entry: NasCookieEntry,
  requestedHost: string,
  capturedHost: string,
): boolean => {
  if (entry.domain == null) return requestedHost === capturedHost;
  const domain = entry.domain.toLowerCase();
  return requestedHost === domain || requestedHost.endsWith(`.${domain}`);
};

/**
 * Looks up cookies for `host` across *every* stored record, not just the one
 * (if any) keyed by `host` or one of its parent domains.
 *
 * Records are still keyed by the login URL's host (see `setNasCookies`), but
 * a captured cookie's own `domain` scope routinely has nothing to do with
 * that key — `get_webview_cookies` (native side) now captures the login
 * popup's *entire* cookie jar, since the login flow can redirect through
 * several unrelated domains before the session cookie is actually set (e.g.
 * a login started at `ug.link` landing on `app-8082-mybooks.cn57.ugdocker.link`,
 * which shares no domain suffix with `ug.link` at all). A parent-domain walk
 * from the storage key can never reach a host like that, so instead every
 * record's cookies are checked against `host` directly via
 * `cookieAppliesToHost`, and only host-only cookies (no `domain`) stay
 * pinned to the record they were captured under (via `capturedHost`) — the
 * same fallback as before, just no longer gating which records get looked at
 * in the first place.
 */
export function getNasCookies(host: string): string | null {
  const requestedHost = normalizeHostKey(host);
  const records = readAll();
  const applicable: NasCookieEntry[] = [];
  for (const [capturedHost, record] of Object.entries(records)) {
    // Guards against records left over from an older storage schema (the
    // very first version stored `{ cookieHeader, capturedAt }`, no `cookies`
    // array) still sitting in a returning user's `localStorage`.
    if (!Array.isArray(record.cookies)) continue;
    for (const entry of record.cookies) {
      if (cookieAppliesToHost(entry, requestedHost, capturedHost)) applicable.push(entry);
    }
  }
  const cookieHeader = applicable.length
    ? applicable.map((c) => `${c.name}=${c.value}`).join('; ')
    : null;
  console.log(
    `[nas-cookie-store] read cookies for host "${requestedHost}" (${applicable.length} cookies applicable): ${cookieHeader ?? 'none'}`,
  );
  return cookieHeader;
}

export function clearNasCookies(host: string): void {
  const records = readAll();
  delete records[normalizeHostKey(host)];
  writeAll(records);
}
