/**
 * User-configured MyDict server provider (poxenstudio/mydict).
 *
 * Same API as the built-in MyBooks dictionary (`GET /api/v1/query?word=`,
 * bearer token); see `myDictQuery.ts` for the Tauri / web request paths.
 */
import type { DictionaryProvider, DictionaryLookupOutcome, MyDictEntry } from '../types';
import { renderMyBooksResults } from './myBooksDictProvider';
import { queryMyDict } from './myDictQuery';

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
