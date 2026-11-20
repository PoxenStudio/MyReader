/** MyBooks v4.8.0 起下发长效 refresh cookie（rt）与 POST /api/user/refresh。 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import { buildMyBooksCookieHeaders } from '@/services/mybooks/cookieHeaders';
import {
  mergeTauriMyBooksCookie,
  extractCookieHeaderFromResponse,
} from '@/services/mybooks/tauriCookieStore';

/** 首个提供 /api/user/refresh 的 MyBooks 版本。 */
const MIN_REFRESH_VERSION: [number, number, number] = [4, 8, 0];

type Version = [number, number, number];

const parseVersion = (version?: string | null): Version | null => {
  if (!version) return null;
  const match = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
};

export const supportsSessionRefresh = (version?: string | null): boolean => {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  for (let i = 0; i < MIN_REFRESH_VERSION.length; i++) {
    if (parsed[i] !== MIN_REFRESH_VERSION[i]) return parsed[i]! > MIN_REFRESH_VERSION[i]!;
  }
  return true;
};

/** 仅当本地已登录且服务端版本支持时续期，版本取自 sysInfo.version。 */
export const canRefreshMyBooksSession = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!localStorage.getItem('mybooks_host')) return false;
  if (localStorage.getItem('mybooks_is_guest') === 'true') return false;
  const token = localStorage.getItem('token');
  if (!token || token === 'guest') return false;
  return supportsSessionRefresh(useMyBooksStatusStore.getState().sysInfo?.version);
};

/** 会话过期：user.need_login 或 /user/info 的 is_login=false。
 *  is_guest 不可靠：允许访客阅读的站点会把过期登录用户标成访客。 */
export const isSessionExpiredResponse = (
  endpoint: string,
  result: { err?: string; user?: { is_login?: boolean } },
): boolean => {
  if (result.err === 'user.need_login') return true;
  return endpoint.split('?')[0] === '/user/info' && !!result.user && result.user.is_login === false;
};

async function performRefresh(): Promise<boolean> {
  const host = localStorage.getItem('mybooks_host');
  if (!host) return false;
  const normalizedHost = host.replace(/\/+$/, '');
  const isTauri = isTauriAppPlatform();
  const url = isTauri
    ? `${normalizedHost}/api/user/refresh`
    : `/api/mybooks/proxy/user/refresh?host=${encodeURIComponent(normalizedHost)}`;
  // 只有 NAS 中转需要显式 Cookie 头，其余场景由 plugin-http 的 cookie jar 处理。
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (isTauri) Object.assign(headers, buildMyBooksCookieHeaders(url));

  try {
    const fetchFn = isTauri ? (tauriFetch as unknown as typeof fetch) : fetch;
    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      ...(!isTauri && { credentials: 'include' as RequestCredentials }),
    });
    const result = (await response.json()) as { err?: string };
    if (result.err !== 'ok') return false;
    if (isTauri) {
      const cookie = extractCookieHeaderFromResponse(response as unknown as Response);
      if (cookie) mergeTauriMyBooksCookie(cookie);
    }
    return true;
  } catch (e) {
    console.error('[mybooks] session refresh failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

let inFlight: Promise<boolean> | null = null;

/** 续期会话；并发调用合并为一次请求，返回是否成功以便重放原请求。 */
export function refreshMyBooksSession(): Promise<boolean> {
  if (!canRefreshMyBooksSession()) return Promise.resolve(false);
  if (!inFlight) {
    inFlight = performRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
