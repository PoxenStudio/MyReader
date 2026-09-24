/**
 * User-configured MyDict server provider (poxenstudio/mydict).
 *
 * Same API as the built-in MyBooks dictionary (`GET /api/v1/query?word=`,
 * bearer token). On Tauri, requests go through `@tauri-apps/plugin-http`
 * with certificate validation disabled, since self-hosted servers are often
 * plain http or use self-signed https certificates. On the web build
 * (embedded MyReader) MyDict sends no CORS headers, so lookups are relayed
 * through the same-origin `/api/mydict/query` route instead.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getAPIBaseUrl, isTauriAppPlatform } from '@/services/environment';
import type { DictionaryProvider, DictionaryLookupOutcome, MyDictEntry } from '../types';
import { renderMyBooksResults, type MyBooksResponse } from './myBooksDictProvider';
import { buildMyDictQueryUrl } from './myDictUrl';

const queryMyDictViaProxy = async (
  entry: Pick<MyDictEntry, 'url' | 'token'>,
  word: string,
  signal?: AbortSignal,
): Promise<MyBooksResponse> => {
  const response = await fetch(`${getAPIBaseUrl()}/mydict/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: entry.url, token: entry.token, word }),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error || `HTTP ${response.status}`);
  }
  return data as MyBooksResponse;
};

const queryMyDict = async (
  entry: Pick<MyDictEntry, 'url' | 'token'>,
  word: string,
  signal?: AbortSignal,
): Promise<MyBooksResponse> => {
  if (!isTauriAppPlatform()) return queryMyDictViaProxy(entry, word, signal);
  const queryUrl = buildMyDictQueryUrl(entry.url, word);
  console.log(`[MyDict] GET ${queryUrl}`);
  const response = await tauriFetch(queryUrl, {
    headers: entry.token ? { Authorization: `Bearer ${entry.token}` } : {},
    signal,
    danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
  });
  console.log(`[MyDict] ${response.status} ${queryUrl}`);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${detail}`.trim());
  }
  return (await response.json()) as MyBooksResponse;
};

/** Connectivity/token check for the settings dialog. Throws on failure. */
export const testMyDictConnection = async (
  entry: Pick<MyDictEntry, 'url' | 'token'>,
): Promise<void> => {
  const data = await queryMyDict(entry, 'test');
  if (!data || !Array.isArray(data.results)) throw new Error('Invalid response');
};

export const createMyDictProvider = (entry: MyDictEntry): DictionaryProvider => ({
  id: entry.id,
  kind: 'builtin',
  label: entry.name,
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    try {
      const data = await queryMyDict(entry, trimmed, ctx.signal);
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (!data.results || data.results.length === 0) return { ok: false, reason: 'empty' };
      renderMyBooksResults(data.results, ctx.container);
      return { ok: true, headword: trimmed, sourceLabel: entry.name };
    } catch (error) {
      // plugin-http throws a plain `Error('Request cancelled')` (not an
      // AbortError) when the caller's signal fires, so check the signal too.
      if (ctx.signal.aborted || (error as { name?: string }).name === 'AbortError') {
        return { ok: false, reason: 'error', message: 'aborted' };
      }
      console.error(`MyDict lookup failed (${entry.url}): ${String(error)}`);
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
