/**
 * MyReader API 服务封装
 * 提供与 MyReader 后端 API 的交互能力
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';

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

export interface MyBooksSysInfo {
  title: string;
  books: number;
  version: string;
  upgrable: string;
  defaultPageSize: number;
  aiEnabled: boolean;
  allow?: {
    register?: boolean;
    download?: boolean;
    upload?: boolean;
    physical_books?: boolean;
    read?: boolean;
    sync?: boolean;
  };
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
}

// Thrown when MyReader responded but reported a logical error (e.g. not logged
// in). Distinguishes this from network failures so callers can tell "the
// server told us the real current state" apart from "we couldn't reach it".
export class MyBooksApiError extends Error {}

/**
 * 通用请求方法
 */
export async function fetchMyBooks<T>(
  endpoint: string,
  params?: Record<string, string | number>,
  method: string = 'GET',
  body?: BodyInit | null,
  contentType?: string,
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

  let result: MyBooksResponse<T>;
  try {
    const response = await fetchFn(url.toString(), fetchOptions);
    result = await response.json();
  } catch (error) {
    // Couldn't reach the configured MyBooks host at all (network down, server
    // unreachable, etc.) — surface this as "offline" rather than an error.
    if (host) useMyBooksStatusStore.getState().setOffline(true);
    throw error;
  }
  if (host) useMyBooksStatusStore.getState().setOffline(false);

  if (result.err !== 'ok') {
    throw new MyBooksApiError(result.msg || 'Failed to fetch from MyReader');
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
    return { online: true, needsLogin: !response.user?.is_login };
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

export async function getUserInfo(): Promise<MyBooksUserInfo | null> {
  try {
    const response = await fetchMyBooks('/user/info');
    updateSysInfo(response.sys);
    const user = response.user;
    if (typeof window !== 'undefined') {
      if (user?.is_login) {
        localStorage.setItem(MYBOOKS_USER_INFO_CACHE_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(MYBOOKS_USER_INFO_CACHE_KEY);
      }
    }
    if (!user?.is_login) return null;
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
 * @param action - add 或 remove
 */
export async function toggleWants(id: number, action: 'add' | 'remove'): Promise<void> {
  await fetchMyBooks(`/book/${id}/wants`, { action }, 'POST');
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

export async function getUserDetailInfo(): Promise<MyBooksUserDetailResult | null> {
  const response = await fetchMyBooks('/user/info', { detail: 1 });
  updateSysInfo(response.sys);
  if (!response.user?.is_login) return null;
  return { user: response.user as MyBooksUserDetailInfo, sys: response.sys ?? null };
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
