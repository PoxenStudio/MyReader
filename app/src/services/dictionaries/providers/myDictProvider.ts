/**
 * User-configured MyDict server provider (poxenstudio/mydict).
 *
 * Same API as the built-in MyBooks dictionary (`GET /api/v1/query?word=`,
 * bearer token). Tauri-only; requests go through `@tauri-apps/plugin-http`
 * with certificate validation disabled, since self-hosted servers are often
 * plain http or use self-signed https certificates.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { DictionaryProvider, DictionaryLookupOutcome, MyDictEntry } from '../types';
import { renderMyBooksResults, type MyBooksResponse } from './myBooksDictProvider';

export const buildMyDictQueryUrl = (baseUrl: string, word: string): string => {
  let base = baseUrl.trim().replace(/\/+$/, '');
  if (!/\/api\/v1\/query$/.test(base)) base += '/api/v1/query';
  const url = new URL(base);
  url.searchParams.set('word', word);
  return url.toString();
};

const queryMyDict = async (
  entry: Pick<MyDictEntry, 'url' | 'token'>,
  word: string,
  signal?: AbortSignal,
): Promise<MyBooksResponse> => {
  const response = await tauriFetch(buildMyDictQueryUrl(entry.url, word), {
    headers: { Authorization: `Bearer ${entry.token}` },
    signal,
    danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
      if ((error as { name?: string }).name === 'AbortError') {
        return { ok: false, reason: 'error', message: 'aborted' };
      }
      console.error('MyDict lookup failed', error);
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
