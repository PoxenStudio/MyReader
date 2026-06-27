/**
 * `/api/sync` 客户端 —— Readest Native Sync 的 Legacy Record Sync 部分。
 * 协议细节见 document/MyBooks_Sync_API.md §1、document/MyBooks_Sync_WS_Design.md §11。
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { BookRecord, BookNoteRecord, BookConfigRecord } from '@/types/book';

export interface SyncEnvelope {
  books: BookRecord[] | null;
  notes: BookNoteRecord[] | null;
  configs: BookConfigRecord[] | null;
}

export interface SyncPushPayload {
  books?: Partial<BookRecord>[];
  notes?: Partial<BookNoteRecord>[];
  configs?: Partial<BookConfigRecord>[];
}

export type SyncRecordType = 'books' | 'notes' | 'configs';

export class SyncApiError extends Error {}

function buildSyncRequest(params?: Record<string, string | number>): {
  url: string;
  fetchFn: typeof fetch;
} {
  const host = typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null;
  if (!host) {
    throw new SyncApiError('MyBooks host is not configured');
  }

  let url: URL;
  let fetchFn: typeof fetch;
  if (isTauriAppPlatform()) {
    // Tauri: direct request — the Tauri HTTP plugin manages cookies natively,
    // mirroring fetchMyBooks's Tauri branch in mybooksService.ts.
    const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
    url = new URL(`${normalizedHost}/api/sync`);
    fetchFn = tauriFetch as unknown as typeof fetch;
  } else {
    // Web: route through the existing Next.js proxy so the browser cookie
    // (set on the MyReader origin) is forwarded with the Cookie header.
    url = new URL('/api/mybooks/proxy/sync', window.location.origin);
    url.searchParams.set('host', host);
    fetchFn = fetch;
  }

  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  }

  return { url: url.toString(), fetchFn };
}

async function parseSyncResponse(response: Response): Promise<SyncEnvelope> {
  const json = (await response.json()) as SyncEnvelope & { err?: string };
  if (!response.ok) {
    throw new SyncApiError(json.err || response.statusText || 'Sync request failed');
  }
  return {
    books: json.books ?? null,
    notes: json.notes ?? null,
    configs: json.configs ?? null,
  };
}

/**
 * `GET /api/sync?since=&type=&book=` —— 拉取自 `since`（毫秒时间戳）之后的增量变更。
 */
export async function pullSync(
  since: number,
  options?: { type?: SyncRecordType; book?: string },
): Promise<SyncEnvelope> {
  const params: Record<string, string | number> = { since };
  if (options?.type) params['type'] = options.type;
  if (options?.book) params['book'] = options.book;

  const { url, fetchFn } = buildSyncRequest(params);
  const response = await fetchFn(url, { method: 'GET', credentials: 'include' });
  return parseSyncResponse(response);
}

/**
 * `POST /api/sync` —— 推送本地变更，返回服务端合并后的最终状态。
 */
export async function pushSync(payload: SyncPushPayload): Promise<SyncEnvelope> {
  const { url, fetchFn } = buildSyncRequest();
  const response = await fetchFn(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseSyncResponse(response);
}
