import { useSettingsStore } from '@/store/settingsStore';
import { getTauriMyBooksCookie } from '@/services/mybooks/tauriCookieStore';
import { NAS_CHROME_USER_AGENT, getNasCookies } from '@/services/mybooks/nasCookieStore';

// A raw HTTP header value must not contain CR/LF (it's rejected outright at
// the reqwest layer, surfacing as a generic "Failed to fetch"). The NAS login
// webview's cookie jar is replayed as-is, so strip defensively.
const sanitize = (v: string) => v.replace(/[\r\n]/g, '');

/**
 * Explicit `Cookie` / `User-Agent` headers for Tauri requests to MyBooks that
 * can't (or shouldn't) rely on plugin-http's internal cookie jar.
 *
 * - NAS relay enabled: setting a `Cookie` header at all suppresses
 *   plugin-http's automatic one, and the jar never sees the NAS login
 *   webview's cookies, so the MyBooks session cookie
 *   (`mybooks_tauri_cookie`) and the NAS relay cookie are merged explicitly,
 *   with a browser User-Agent to satisfy gateways that fingerprint on it.
 * - NAS disabled: nothing is returned by default (plugin-http's jar handles
 *   it). Callers whose network stack has no jar at all (the native
 *   downloader) pass `alwaysSession` to still get the session cookie.
 */
export function buildMyBooksCookieHeaders(
  url: string,
  options: { alwaysSession?: boolean } = {},
): Record<string, string> {
  const sessionCookie = getTauriMyBooksCookie();
  const nasEnabled = !!useSettingsStore.getState().settings.nas?.enabled;
  if (!nasEnabled) {
    return options.alwaysSession && sessionCookie ? { Cookie: sanitize(sessionCookie) } : {};
  }
  const headers: Record<string, string> = { 'User-Agent': NAS_CHROME_USER_AGENT };
  try {
    const nasCookie = getNasCookies(new URL(url).host);
    const cookie = [sessionCookie, nasCookie]
      .filter((v): v is string => !!v)
      .map(sanitize)
      .join('; ');
    if (cookie) headers['Cookie'] = cookie;
  } catch (e) {
    console.error('[cookieHeaders] Failed to build NAS cookie header:', e);
  }
  return headers;
}
