/**
 * Shared transport for MyDict-API servers — the built-in MyBooks dictionary
 * and user-added MyDict servers (`poxenstudio/mydict`).
 *
 * The server answers `GET <base>/api/v1/query?word=…` (bearer token) and sends
 * no CORS headers, so the browser can't call it directly. Two transports:
 *
 *   - Tauri: `@tauri-apps/plugin-http` — no CORS preflight, and self-signed
 *     certificates (common on a self-hosted box) are tolerated.
 *   - Web (embedded reader): POST to our own relay
 *     `/api/mybooks/mydict/query`, which rebuilds the request server-side from
 *     the same `buildMyDictQueryUrl` (so the query params stay in one place)
 *     and forces the path to `/api/v1/query`.
 *
 * The request always asks for `full_style=true`: the API strips entry HTML to
 * plain text unless asked, and this client renders the markup — see
 * `renderMyBooksResults`.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import type { MyDictEntry } from '../types';
import { buildMyDictQueryUrl } from './myDictUrl';

/**
 * One dictionary's hit for a word, as returned by `/api/v1/query`.
 *
 * Optional fields are optional because they only arrived with newer servers —
 * an older MyDict simply omits them.
 */
export interface MyDictResult {
  /**
   * Entry primary key. One dictionary may hold several homographs under the
   * same headword (MDict allows it, and the 搜韵 词典 has 82 entries for
   * 「毛泽东」), so it is the only safe per-entry key.
   */
  id?: number;
  dictionary_id: number;
  dictionary_name: string;
  word: string;
  phonetic?: string | null;
  /** Entry HTML (the server sends raw markup for `full_style=true`). */
  definition: string;
  /**
   * Whether the dictionary's language direction matches the query. `false`
   * means the server fell back to other languages because nothing matched in
   * the preferred ones — worth flagging, since language detection at import
   * time can be wrong.
   */
  lang_match?: boolean;
  /** Source language of the matching dictionary (zh-Hans/ja/…), used for language tabs and grouping. */
  lang_from?: string | null;
}

export interface MyDictQueryResponse {
  results: MyDictResult[];
}

/** Our own relay route; only used on the web build (see the module comment). */
const RELAY_URL = '/api/mybooks/mydict/query';

export const queryMyDict = async (
  entry: Pick<MyDictEntry, 'url' | 'token'>,
  word: string,
  signal?: AbortSignal,
): Promise<MyDictQueryResponse> => {
  const token = (entry.token ?? '').trim();

  if (isTauriAppPlatform()) {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await tauriFetch(buildMyDictQueryUrl(entry.url, word), {
      headers,
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as MyDictQueryResponse;
  }

  const response = await fetch(RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: entry.url, token, word }),
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as MyDictQueryResponse;
};
