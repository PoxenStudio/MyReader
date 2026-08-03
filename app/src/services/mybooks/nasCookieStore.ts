/**
 * Per-host cookie jar for NAS remote-access sessions.
 *
 * Cookies captured from the embedded NAS login webview live in a different
 * cookie store than `@tauri-apps/plugin-http`'s internal jar (the webview
 * uses the system browser engine; plugin-http uses its own reqwest-based
 * client) — see `nasWebviewBridge.ts`. We persist them here, keyed by host,
 * so `fetchMyBooks` can attach them as an explicit `Cookie` header.
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

/**
 * Cookie names if need to filter out
 */
const EXCLUDED_COOKIE_NAMES = new Set([]);

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
  const filtered = cookies.filter((c) => !EXCLUDED_COOKIE_NAMES.has(c.name));
  const records = readAll();
  const key = normalizeHostKey(host);
  records[key] = { cookies: filtered, capturedAt: Date.now() };
  writeAll(records);
  const preview = filtered
    .map((c) => `${c.name}=${c.value} (${c.domain ? `domain=${c.domain}` : 'host-only'})`)
    .join('; ');
  console.log(`[nas-cookie-store] saved ${filtered.length} cookies for host "${key}": ${preview}`);
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
 * Looks up cookies for `host`, then its parent domains (`a.b.c.com` ->
 * `b.c.com` -> `c.com` -> ...) — mirrors how a browser applies a cookie set
 * on a parent domain to its subdomains. The NAS login URL's host and the
 * mybooks server's host are often different subdomains of the same NAS
 * device (e.g. login at `horkynas.fnos.net`, mybooks served from
 * `6289a9567efa-0.horkynas.fnos.net`), so an exact-host-only lookup would
 * never find the cookies captured at login.
 *
 * Once a stored record is found, only the cookies whose own scope actually
 * covers `host` are included — a host-only cookie captured at the login
 * host is excluded when `host` is a different (sub)domain.
 */
export function getNasCookies(host: string): string | null {
  const requestedHost = normalizeHostKey(host);
  const records = readAll();
  let candidate = requestedHost;
  for (;;) {
    const record = records[candidate];
    if (record) {
      const applicable = record.cookies.filter(
        (c) =>
          !EXCLUDED_COOKIE_NAMES.has(c.name) && cookieAppliesToHost(c, requestedHost, candidate),
      );
      const cookieHeader = applicable.length
        ? applicable.map((c) => `${c.name}=${c.value}`).join('; ')
        : null;
      console.log(
        `[nas-cookie-store] read cookies for host "${requestedHost}" (matched record "${candidate}", ${applicable.length}/${record.cookies.length} cookies applicable): ${cookieHeader ?? 'none'}`,
      );
      return cookieHeader;
    }
    const dotIndex = candidate.indexOf('.');
    if (dotIndex === -1) break;
    candidate = candidate.slice(dotIndex + 1);
  }
  console.log(`[nas-cookie-store] read cookies for host "${requestedHost}": none`);
  return null;
}

export function clearNasCookies(host: string): void {
  const records = readAll();
  delete records[normalizeHostKey(host)];
  writeAll(records);
}
