/**
 * MyReader API 服务封装
 * 提供与 MyReader 后端 API 的交互能力
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useNasDeviceStore } from '@/store/nasDeviceStore';
import { NAS_CHROME_USER_AGENT, getNasCookies } from '@/services/mybooks/nasCookieStore';
import {
  getTauriMyBooksCookie,
  mergeTauriMyBooksCookie,
  extractCookieHeaderFromResponse,
} from '@/services/mybooks/tauriCookieStore';
import { shouldAutoPromptNasLogin } from '@/services/mybooks/nasSession';

export interface MyBooksBook {
  id: number;
  title: string;
  rating: number;
  timestamp: string;
  pubdate: string;
  author: string;
  authors: string[];
  author_sort: string;
  tag: string;
  tags: string[];
  publisher: string;
  comments: string;
  series: string;
  series_index: number;
  languages: string[];
  isbn: string;
  img: string;
  thumb: string;
  collector: string;
  count_visit: number;
  count_download: number;
  sole: boolean;
  has_audio: number;
  book_type: number;
  book_count: number;
  state: {
    favorite: number;
    favorite_date: string | null;
    wants: number;
    wants_date: string | null;
    read_state: number;
    read_date: string | null;
    online_read: number;
    download: number;
  };
  category: string;
  ext_link: string;
  files: Array<{ format: string; size: number; href: string }>;
  dynamic_cover: number;
}

export interface MyBooksMetaItem {
  name: string;
  count: number;
}

export interface MyBooksUserInfo {
  id: number;
  username: string;
  nickname: string;
  email: string;
  avatar: string;
  is_admin: boolean;
  is_login: boolean;
  is_guest: boolean;
  show_other_annotations?: boolean;
}

export interface MyBooksUserDetailInfo extends MyBooksUserInfo {
  is_active: boolean;
  podcast_token: string;
  vipquota?: number;
  vip_expire?: string;
  extra?: {
    allow_sending_mail?: boolean;
  };
}

export interface MyBooksUpdateSettings {
  nickname?: string;
  password0?: string;
  password1?: string;
  password2?: string;
  podcast_token?: string;
  show_other_annotations?: boolean;
}

// 设备类型，参见 document/MyBooks_WebAPI.md 2.6 用户设备管理
export type MyBooksDeviceType =
  | 'kindle'
  | 'duokan'
  | 'ireader'
  | 'hanwang'
  | 'boox'
  | 'dangdang'
  | 'purelibro'
  | 'ftp';

export interface MyBooksDevice {
  name: string;
  type: MyBooksDeviceType;
  ip: string;
  port: number;
  schema: string;
  mailbox: string;
  ftp_username?: string;
  ftp_password?: string;
  ftp_path?: string;
}

export interface MyBooksSendToDeviceParams {
  device_type: MyBooksDeviceType;
  device_url?: string;
  mailbox?: string;
  ftp_path?: string;
  ftp_username?: string;
  ftp_password?: string;
}

export interface MyBooksReview {
  id: number;
  book_id: number;
  reader_id: number;
  nickname: string;
  avatar: string;
  rating: number; // 0-10
  comment: string;
  status: string;
  update_time: string | null;
  is_own: boolean;
}

export interface MyBooksSysInfo {
  title: string;
  books: number;
  version: string;
  upgrable: string;
  defaultPageSize: number;
  aiEnabled: boolean;
  // Whether the site has invite-code mode on. A successful /user/info doesn't
  // mean the client's own explicit `mybooks_tauri_cookie` store actually has
  // `invited` in it — see accessCodeRefresh.ts / LibraryHeader.tsx.
  invited_enabled?: boolean;
  allow?: {
    register?: boolean;
    download?: boolean;
    upload?: boolean;
    physical_books?: boolean;
    read?: boolean;
    sync?: boolean;
    book_review?: boolean;
  };
}

export interface MyBooksReadingStatsTotals {
  total_reading_seconds: number;
  download_count: number;
  push_count: number;
}

export interface MyBooksReadingStatsWeek {
  week_start: string;
  reading_seconds: number;
  download_count: number;
  push_count: number;
}

export interface MyBooksReadingStatsBookStatus {
  reading: number;
  to_read: number;
  finished: number;
}

// /book/<id>/reading_stats — document/MyBooks_WebAPI.md §3.49
export interface MyBooksBookReadingStat {
  format: string;
  state: 0 | 1;
  total_seconds: number;
  progress_current: number | null;
  progress_total: number | null;
  progress_percent: number | null;
  start_time: string | null;
  finish_time: string | null;
  start_count: number;
  update_time: string;
}

export interface MyBooksResponse<T = unknown> {
  err: string;
  msg?: string;
  data?: T;
  total?: number;
  books?: MyBooksBook[];
  book?: MyBooksBook;
  categories?: MyBooksMetaItem[];
  tags?: MyBooksMetaItem[];
  authors?: MyBooksMetaItem[];
  items?: MyBooksMetaItem[];
  pins?: MyBooksMetaItem[];
  user?: MyBooksUserInfo | MyBooksUserDetailInfo;
  sys?: MyBooksSysInfo;
  avatar_url?: string;
  book_id?: number;
  devices?: MyBooksDevice[];
  review?: MyBooksReview | null;
  reviews?: MyBooksReview[];
  // /user/reading_stats — document/MyBooks_WebAPI.md §2.10
  enabled?: boolean;
  totals?: MyBooksReadingStatsTotals;
  weekly?: MyBooksReadingStatsWeek[];
  book_status?: MyBooksReadingStatsBookStatus;
  // /book/<id>/reading_stats — document/MyBooks_WebAPI.md §3.49
  stats?: MyBooksBookReadingStat[];
}

// Thrown when MyReader responded but reported a logical error (e.g. not logged
// in). Distinguishes this from network failures so callers can tell "the
// server told us the real current state" apart from "we couldn't reach it".
// `err` carries the server's machine-readable error code (e.g. 'not_invited')
// so callers can react to specific cases instead of only the human message.
export class MyBooksApiError extends Error {
  err: string;
  constructor(err: string, message?: string) {
    super(message || err);
    this.err = err;
  }
}

/**
 * 通用请求方法
 */
const MYBOOKS_REQUEST_TIMEOUT_MS = 5000;

export async function fetchMyBooks<T>(
  endpoint: string,
  params?: Record<string, string | number>,
  method: string = 'GET',
  body?: BodyInit | null,
  contentType?: string,
  timeoutMs: number = MYBOOKS_REQUEST_TIMEOUT_MS,
): Promise<MyBooksResponse<T>> {
  const host = typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null;

  let url: URL;
  let fetchFn: typeof fetch;

  if (host && isTauriAppPlatform()) {
    // Tauri: direct request — the Tauri HTTP plugin manages cookies natively.
    const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
    url = new URL(`${normalizedHost}/api${endpoint}`);
    fetchFn = tauriFetch as unknown as typeof fetch;
  } else if (host) {
    // Web mode: route through the Next.js proxy so the browser cookie is set
    // on the Readest origin and CORS / mixed-content issues are bypassed.
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    url = new URL(`/api/mybooks/proxy/${cleanEndpoint}`, window.location.origin);
    url.searchParams.set('host', host);
    fetchFn = fetch;
  } else {
    url = new URL(
      `/api${endpoint}`,
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
    );
    fetchFn = fetch;
  }

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
  }

  const fetchOptions: RequestInit = { credentials: 'include', method };
  if (body) fetchOptions.body = body;
  if (contentType) fetchOptions.headers = { 'Content-Type': contentType };

  // Tauri only: plugin-http's cookie jar is separate from the system
  // WebView's, so cookies captured from the NAS login webview (a different
  // engine — see nasCookieStore.ts) never reach plugin-http on their own.
  // Attach them explicitly, and — if the NAS session looks expired — ask
  // the root-mounted NasSessionPrompt to re-open the login webview. This
  // doesn't block the in-flight request; it just arms the next one.
  //
  // Setting a `Cookie` header at all suppresses plugin-http's own automatic
  // one for this request (reqwest's cookie store only fills it in when the
  // request doesn't already have one), so the regular MyBooks session
  // cookie — normally replayed from plugin-http's jar without any help —
  // has to be merged in here explicitly too, the same way
  // `downloadMyBooksUrl` (cloudService.ts) already does. Without this, a
  // NAS-gated request would authenticate at the relay but arrive at MyBooks
  // itself with no session cookie at all, failing as "not logged in" even
  // though the user is.
  if (host && isTauriAppPlatform()) {
    const nasSettings = useSettingsStore.getState().settings.nas;
    if (nasSettings?.enabled) {
      try {
        const sessionCookie = getTauriMyBooksCookie();
        const nasCookie = getNasCookies(new URL(url).host);
        // Defensive: a raw HTTP header value must not contain CR/LF (or it's
        // rejected outright, at the Rust/reqwest layer for plugin-http's
        // IPC-based fetch — surfacing here as a generic, unhelpful "Failed
        // to fetch" with no indication it was ever about a header). Captured
        // cookie values should never legitimately contain these, but the NAS
        // popup's cookie jar isn't scoped to just the login flow (see
        // `get_webview_cookies` in commands.rs) and gets replayed as-is, so
        // strip defensively rather than let one bad stored value take down
        // every NAS-gated request.
        const sanitize = (v: string) => v.replace(/[\r\n]/g, '');
        const cookie = [sessionCookie, nasCookie]
          .filter((v): v is string => !!v)
          .map(sanitize)
          .join('; ');
        fetchOptions.headers = {
          ...fetchOptions.headers,
          ...(cookie && { Cookie: cookie }),
          'User-Agent': NAS_CHROME_USER_AGENT,
        };
      } catch (e) {
        console.error('[fetchMyBooks] Failed to build NAS cookie header:', e);
      }
      if (shouldAutoPromptNasLogin(nasSettings)) {
        useNasDeviceStore.getState().requestPrompt();
      }
    }
  }

  const controller = new AbortController();
  fetchOptions.signal = controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let result: MyBooksResponse<T>;
  try {
    const response = await fetchFn(url.toString(), fetchOptions);
    // Opportunistically keep `mybooks_tauri_cookie` (the store the native
    // downloader and WS sync channel read explicitly — see
    // tauriCookieStore.ts) in sync with whatever session is actually live,
    // not just at login/access-code time. Without this, a `mybooks_tauri_cookie`
    // that was wiped independently of the real session (e.g. app data
    // cleared — that clears localStorage but not plugin-http's own cookie
    // jar or the server-side session) stays empty forever: every *other*
    // Tauri call keeps working fine via plugin-http's automatic jar, so
    // nothing ever prompts a fresh login to repopulate it, and the native
    // downloader silently sends no cookie at all until it does.
    if (host && isTauriAppPlatform()) {
      try {
        const cookie = extractCookieHeaderFromResponse(response as unknown as Response);
        if (cookie) mergeTauriMyBooksCookie(cookie);
      } catch (e) {
        console.error('[fetchMyBooks] Failed to refresh the Tauri cookie store:', e);
      }
    }
    result = await response.json();
  } catch (error) {
    // Couldn't reach the configured MyBooks host at all (network down, server
    // unreachable, timed out, etc.) — surface this as "offline" rather than an error.
    // Logged here (not just left to bubble up) because WebKit's Error
    // objects carry only enumerable `line`/`column` own properties — a
    // caller that logs the caught error object directly (e.g. via a
    // template literal) gets a useless `{"line":0,"column":0}` with no
    // `message` at all, so the real reason never makes it into the log.
    console.error(
      `[fetchMyBooks] Request to ${url.toString()} failed:`,
      error instanceof Error ? error.message : error,
    );
    if (host) useMyBooksStatusStore.getState().setOffline(true);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (host) useMyBooksStatusStore.getState().setOffline(false);

  if (result.err !== 'ok') {
    throw new MyBooksApiError(result.err, result.msg || 'Failed to fetch from MyReader');
  }

  return result;
}

/**
 * 检测与 MyBooks 服务器的连接性
 * 通过请求 /user/info 来判断网络是否可达，以及当前登录状态是否仍然有效
 */
export async function checkMyBooksConnectivity(): Promise<{
  online: boolean;
  needsLogin: boolean;
}> {
  try {
    const response = await fetchMyBooks('/user/info');
    return { online: true, needsLogin: !response.user?.is_login && !response.user?.is_guest };
  } catch (error) {
    // The server responded but reported a logical error (e.g. session
    // expired) — we did reach it, so this isn't "offline".
    if (error instanceof MyBooksApiError) return { online: true, needsLogin: true };
    return { online: false, needsLogin: false };
  }
}

/**
 * 获取书籍列表
 * @param type - 书籍类型：all, favorites, wants, reading, read-done, hot, printbooks, audiobooks, soledbooks
 * @param page - 页码（从1开始）
 * @param num - 每页数量
 * @param name - 可选的名称过滤（如分类名、作者名等）
 */
export async function getBooksByType(
  type: string,
  page: number = 1,
  num: number = 20,
  name?: string,
): Promise<{ books: MyBooksBook[]; total: number }> {
  // Special handling for categories - use search interface with #category:= prefix
  if (type === 'categories' && name) {
    // Build search query: #category:=分类名
    const searchQuery = `#category:=${name}`;
    const response = await fetchMyBooks<{ books: MyBooksBook[]; total: number }>('/search', {
      name: searchQuery,
      start: (page - 1) * num,
      size: num,
      order: 'title',
    });

    return {
      books: response.books || [],
      total: response.total || 0,
    };
  }

  let endpoint = `/${type}`;
  if (name) {
    endpoint = `/${type}/${encodeURIComponent(name)}`;
  }

  const response = await fetchMyBooks<{ books: MyBooksBook[]; total: number }>(endpoint, {
    start: (page - 1) * num,
    size: num,
  });

  return {
    books: response.books || [],
    total: response.total || 0,
  };
}

/**
 * 获取分类列表
 */
export async function getCategories(): Promise<{
  items: MyBooksMetaItem[];
  pins?: MyBooksMetaItem[];
  total: number;
}> {
  const response = await fetchMyBooks<{
    categories: MyBooksMetaItem[];
    pins?: MyBooksMetaItem[];
    total: number;
  }>('/categories');
  return {
    items: response.categories || [],
    pins: response.pins,
    total: response.total || response.categories?.length || 0,
  };
}

/**
 * 获取标签列表
 * @param q - 搜索关键词（可选）
 * @param limit - 返回数量限制
 */
export async function getTags(
  q?: string,
  limit: number = 20,
): Promise<{ items: MyBooksMetaItem[]; pins?: MyBooksMetaItem[]; total: number }> {
  const params: Record<string, string | number> = {};
  if (q) {
    params['q'] = q;
  }
  if (limit) {
    params['limit'] = limit;
  }

  const endpoint = q ? '/tags/search' : '/tag';
  const response = await fetchMyBooks<{
    items: MyBooksMetaItem[];
    pins?: MyBooksMetaItem[];
    total: number;
  }>(endpoint, params);
  return {
    items: response.items || response.tags || [],
    pins: response.pins,
    total: response.total || response.items?.length || response.tags?.length || 0,
  };
}

/**
 * 获取作者列表
 */
export async function getAuthors(): Promise<{
  items: MyBooksMetaItem[];
  pins?: MyBooksMetaItem[];
  total: number;
}> {
  const response = await fetchMyBooks<{
    items: MyBooksMetaItem[];
    pins?: MyBooksMetaItem[];
    total: number;
  }>('/author');
  return {
    items: response.items || response.authors || [],
    pins: response.pins,
    total: response.total || response.items?.length || response.authors?.length || 0,
  };
}

/**
 * 获取出版社列表
 */
export async function getPublishers(): Promise<{
  items: MyBooksMetaItem[];
  pins?: MyBooksMetaItem[];
  total: number;
}> {
  const response = await fetchMyBooks<{
    items: MyBooksMetaItem[];
    pins?: MyBooksMetaItem[];
    total: number;
  }>('/publisher');
  return {
    items: response.items || [],
    pins: response.pins,
    total: response.total || response.items?.length || 0,
  };
}

/**
 * 获取系列列表
 */
export async function getSeries(): Promise<{
  items: MyBooksMetaItem[];
  pins?: MyBooksMetaItem[];
  total: number;
}> {
  const response = await fetchMyBooks<{
    items: MyBooksMetaItem[];
    pins?: MyBooksMetaItem[];
    total: number;
  }>('/series');
  return {
    items: response.items || [],
    pins: response.pins,
    total: response.total || response.items?.length || 0,
  };
}

/**
 * 获取语言列表
 */
export async function getLanguages(): Promise<{
  items: MyBooksMetaItem[];
  pins?: MyBooksMetaItem[];
  total: number;
}> {
  const response = await fetchMyBooks<{
    items: MyBooksMetaItem[];
    pins?: MyBooksMetaItem[];
    total: number;
  }>('/language');
  return {
    items: response.items || [],
    pins: response.pins,
    total: response.total || response.items?.length || 0,
  };
}

/**
 * 获取评分列表
 */
export async function getRatings(): Promise<{
  items: MyBooksMetaItem[];
  pins?: MyBooksMetaItem[];
  total: number;
}> {
  const response = await fetchMyBooks<{
    items: MyBooksMetaItem[];
    pins?: MyBooksMetaItem[];
    total: number;
  }>('/rating');
  return {
    items: response.items || [],
    pins: response.pins,
    total: response.total || response.items?.length || 0,
  };
}

const MYBOOKS_USER_INFO_CACHE_KEY = 'mybooks_user_info';

function updateSysInfo(sys?: MyBooksSysInfo): void {
  if (!sys) return;
  // Merge rather than overwrite: different /user/info call sites (plain vs.
  // ?detail=1) can return a `sys` object with a different subset of fields,
  // and a full overwrite would let a leaner response clobber fields (e.g.
  // `version`) already known from an earlier, fuller response.
  const current = useMyBooksStatusStore.getState().sysInfo;
  useMyBooksStatusStore.getState().setSysInfo({ ...current, ...sys });
}

// Mirrors the logged-in user's `show_other_annotations` preference and
// numeric id into mybooksStatusStore, so the reader (useNativeSync.ts) and
// ownership checks (BooknoteItem, Notebook) have them without a
// component-local fetch. Called from every `/user/info` call site — see
// getUserInfo/getUserDetailInfo below.
function updateUserPrefs(user?: MyBooksUserInfo): void {
  if (!user?.is_login) return;
  const store = useMyBooksStatusStore.getState();
  store.setCurrentUserId(user.id);
  if (user.show_other_annotations !== undefined) {
    store.setShowOtherAnnotations(user.show_other_annotations);
  }
}

export async function getUserInfo(): Promise<MyBooksUserInfo | null> {
  try {
    const response = await fetchMyBooks('/user/info');
    updateSysInfo(response.sys);
    const user = response.user;
    updateUserPrefs(user);
    if (typeof window !== 'undefined') {
      if (user?.is_login || user?.is_guest) {
        localStorage.setItem(MYBOOKS_USER_INFO_CACHE_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(MYBOOKS_USER_INFO_CACHE_KEY);
      }
    }
    if (!user?.is_login && !user?.is_guest) return null;
    return user;
  } catch (error) {
    // The server responded and told us the real current state (e.g. an
    // explicit error) — trust that over a possibly stale cache.
    if (error instanceof MyBooksApiError) throw error;

    const cached =
      typeof window !== 'undefined' ? localStorage.getItem(MYBOOKS_USER_INFO_CACHE_KEY) : null;
    if (cached) {
      return JSON.parse(cached) as MyBooksUserInfo;
    }
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await fetchMyBooks('/user/sign_out', undefined, 'GET');
  if (typeof window !== 'undefined') {
    const remember = localStorage.getItem('mybooks_remember') === 'true';
    if (!remember) {
      localStorage.removeItem('mybooks_username');
      localStorage.removeItem('mybooks_password');
    }
  }
}

/**
 * 搜索书籍
 * @param query - 搜索关键词
 * @param page - 页码
 * @param num - 每页数量
 */
export async function searchBooks(
  query: string,
  page: number = 1,
  num: number = 20,
): Promise<{ books: MyBooksBook[]; total: number }> {
  const response = await fetchMyBooks<{ books: MyBooksBook[]; total: number }>('/search', {
    name: query,
    start: (page - 1) * num,
    size: num,
  });

  return {
    books: response.books || [],
    total: response.total || 0,
  };
}

/**
 * 获取图书详情
 * @param id - 图书ID
 */
export async function getBookDetail(id: number): Promise<MyBooksBook | null> {
  const response = await fetchMyBooks<{ book: MyBooksBook }>(`/book/${id}`);
  return response.data?.book || response.book || null;
}

/**
 * 删除图书（需要管理员权限）
 * @param id - 图书ID
 */
export async function deleteBookFromMyBooks(id: number): Promise<void> {
  await fetchMyBooks(`/book/${id}/delete`, undefined, 'POST');
}

/**
 * 添加/取消收藏
 * @param id - 图书ID
 * @param action - add 或 remove
 */
export async function toggleFavorite(id: number, action: 'add' | 'remove'): Promise<void> {
  await fetchMyBooks(`/book/${id}/favorite`, { action }, 'POST');
}

/**
 * 添加/取消待读
 * @param id - 图书ID
 * @param wants - true 为标记待读，false 为取消待读
 */
export async function toggleWants(id: number, wants: boolean): Promise<void> {
  await fetchMyBooks(
    `/book/${id}/wants`,
    undefined,
    'POST',
    JSON.stringify({ wants }),
    'application/json',
  );
}

/**
 * 更新阅读状态
 * @param id - 图书ID
 * @param state - 阅读状态（0=未读，1=在读，2=已读）
 */
export async function updateReadState(id: number, state: 0 | 1 | 2): Promise<void> {
  await fetchMyBooks(
    `/book/${id}/readstate`,
    undefined,
    'POST',
    JSON.stringify({ read_state: state }),
    'application/json',
  );
}

export interface MyBooksUserDetailResult {
  user: MyBooksUserDetailInfo;
  sys: MyBooksSysInfo | null;
}

const MYBOOKS_USER_DETAIL_CACHE_KEY = 'mybooks_user_detail_info';

// Lets the settings dialog show the last known profile immediately on open
// instead of blocking on a fresh request, then refresh in the background.
export function getCachedUserDetailInfo(): MyBooksUserDetailResult | null {
  if (typeof window === 'undefined') return null;
  const cached = localStorage.getItem(MYBOOKS_USER_DETAIL_CACHE_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as MyBooksUserDetailResult;
  } catch {
    return null;
  }
}

export async function getUserDetailInfo(): Promise<MyBooksUserDetailResult | null> {
  const response = await fetchMyBooks('/user/info', { detail: 1 });
  updateSysInfo(response.sys);
  updateUserPrefs(response.user);
  if (!response.user?.is_login && !response.user?.is_guest) return null;
  const result = { user: response.user as MyBooksUserDetailInfo, sys: response.sys ?? null };
  if (typeof window !== 'undefined') {
    localStorage.setItem(MYBOOKS_USER_DETAIL_CACHE_KEY, JSON.stringify(result));
  }
  return result;
}

export async function updateUserSettings(settings: MyBooksUpdateSettings): Promise<void> {
  await fetchMyBooks(
    '/user/update',
    undefined,
    'POST',
    JSON.stringify(settings),
    'application/json',
  );
}

export interface MyBooksReadingStats {
  totals: MyBooksReadingStatsTotals;
  weekly: MyBooksReadingStatsWeek[];
  book_status: MyBooksReadingStatsBookStatus;
}

/**
 * 获取阅读统计（首页“阅读统计”Banner 的数据源）
 * 参见 document/MyBooks_WebAPI.md 2.10 首页阅读统计
 *
 * Returns null when the feature is off server-side (`enabled: false`) —
 * callers should hide the stats UI silently rather than showing an error,
 * same as MyBooks' own ReadingStatsBanner.
 */
export async function getReadingStats(uid?: number): Promise<MyBooksReadingStats | null> {
  const response = await fetchMyBooks('/user/reading_stats', uid ? { uid } : undefined);
  if (!response.enabled || !response.totals || !response.weekly || !response.book_status) {
    return null;
  }
  return { totals: response.totals, weekly: response.weekly, book_status: response.book_status };
}

/**
 * 获取当前用户的设备列表
 * 参见 document/MyBooks_WebAPI.md 2.6 用户设备管理
 */
export async function getUserDevices(): Promise<MyBooksDevice[]> {
  const response = await fetchMyBooks<{ devices: MyBooksDevice[] }>('/user/devices');
  return response.devices || [];
}

/**
 * 全量覆盖保存当前用户的设备列表
 */
export async function updateUserDevices(devices: MyBooksDevice[]): Promise<void> {
  await fetchMyBooks(
    '/user/devices',
    undefined,
    'POST',
    JSON.stringify({ devices }),
    'application/json',
  );
}

/**
 * 推送图书到指定设备
 * 参见 document/MyBooks_WebAPI.md 3.15 推送图书到设备
 */
export async function sendBookToDevice(
  id: number,
  params: MyBooksSendToDeviceParams,
): Promise<void> {
  await fetchMyBooks(
    `/book/${id}/send_to_device`,
    undefined,
    'POST',
    JSON.stringify(params),
    'application/json',
  );
}

/**
 * 获取当前用户对某本书的评价（用于评价对话框预填充）
 */
export async function getOwnReview(id: number): Promise<MyBooksReview | null> {
  const response = await fetchMyBooks<{ review: MyBooksReview | null }>(`/book/${id}/review`);
  return response.review ?? null;
}

/**
 * 提交（新建或更新）对某本书的评价
 */
export async function submitReview(
  id: number,
  rating: number,
  comment: string,
): Promise<MyBooksReview> {
  const response = await fetchMyBooks<{ review: MyBooksReview }>(
    `/book/${id}/review`,
    undefined,
    'POST',
    JSON.stringify({ rating, comment }),
    'application/json',
  );
  return response.review as MyBooksReview;
}

/**
 * 获取某本书的评价列表（最近更新的最多 50 条，含自己未通过审核的评价）
 */
export async function getBookReviews(
  id: number,
): Promise<{ reviews: MyBooksReview[]; total: number }> {
  const response = await fetchMyBooks<{ reviews: MyBooksReview[]; total: number }>(
    `/book/${id}/reviews`,
  );
  return { reviews: response.reviews || [], total: response.total || 0 };
}

/**
 * 获取某本书按格式分别统计的阅读数据，参见 document/MyBooks_WebAPI.md 3.49
 * @param format - 只查询指定格式，不传则返回该书籍下所有格式的统计
 */
export async function getBookReadingStats(
  id: number,
  format?: string,
): Promise<MyBooksBookReadingStat[]> {
  const response = await fetchMyBooks<{ stats: MyBooksBookReadingStat[] }>(
    `/book/${id}/reading_stats`,
    format ? { format } : undefined,
  );
  return response.stats || [];
}

/**
 * 上传图书文件
 * 参见 document/MyBooks_WebAPI.md 3.47 上传图书：POST /api/book/upload，字段名 ebook
 */
export async function uploadBookToMyBooks(file: Blob, filename: string): Promise<number> {
  const formData = new FormData();
  formData.append('ebook', file, filename);
  const response = await fetchMyBooks('/book/upload', undefined, 'POST', formData);
  return response.book_id ?? 0;
}

export async function uploadUserAvatar(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('avatar', file, 'avatar.png');
  const response = await fetchMyBooks('/user/avatar', undefined, 'POST', formData);
  return response.avatar_url || '';
}

export function getMyBooksAvatarUrl(avatar: string): string {
  if (!avatar) return '';
  const host = typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null;
  if (!host) return avatar;

  const isFullUrl = avatar.startsWith('http://') || avatar.startsWith('https://');
  let avatarPath: string;
  if (isFullUrl) {
    try {
      const parsed = new URL(avatar);
      avatarPath = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
    } catch {
      return avatar;
    }
  } else {
    avatarPath = avatar.startsWith('/') ? avatar.slice(1) : avatar;
  }

  const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
  if (isTauriAppPlatform()) {
    // Tauri has no API routes in production (static export) and the session
    // cookie lives in the HTTP plugin's own native jar, invisible to the
    // webview. Fetch the upstream URL directly via tauriFetch instead — the
    // plugin attaches the cookie automatically. See UserAvatar.tsx.
    return `${normalizedHost}/${avatarPath}`;
  }

  // Web mode: proxy through the Next.js API route to avoid browser CORS.
  // The proxy uses server-side fetch which has no CORS restrictions.
  return `/api/mybooks/avatar/${avatarPath}?host=${encodeURIComponent(host)}`;
}
