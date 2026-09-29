/**
 * User-configured MyDict server provider (poxenstudio/mydict).
 *
 * Same API as the built-in MyBooks dictionary (`GET /api/v1/query?word=`,
 * bearer token); see `myDictQuery.ts` for the Tauri / web request paths.
 */
import type { DictionaryProvider, DictionaryLookupOutcome, MyDictEntry } from '../types';
import { createMyDictVocab } from '../mydictVocab';
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
  // 该服务器的生词本（服务端会快照音标/释义；归属由 token 决定）
  vocab: createMyDictVocab(entry, entry.name),
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    try {
      const data = await queryMyDict(entry, trimmed, ctx.signal);
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (!data.results || data.results.length === 0) return { ok: false, reason: 'empty' };
      renderMyBooksResults(data.results, ctx.container, {
        // Entry resources come back root-relative (`/dict-res/…`), so they must
        // be re-anchored to this server, not to the reader's own origin.
        baseUrl: entry.url,
        onNavigate: ctx.onNavigate,
        _: ctx._,
        lang: ctx.lang,
        isDarkMode: ctx.isDarkMode,
      });
      return {
        ok: true,
        headword: trimmed,
        sourceLabel: entry.name,
        // 首个命中所属词典：生词本按 (dictionary_id, word) 精确定位，避免语言路由把
        // 日语词丢到中文词典里查不到。
        dictionaryId: data.results[0]?.dictionary_id,
      };
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
