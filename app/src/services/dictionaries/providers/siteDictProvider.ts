/**
 * Site dictionary provider: a MyDict server configured by the MyBooks admin
 * (see `siteDictionaries.ts`).
 *
 * MyBooks runs the lookup itself (`/api/reader/dict/<siteId>/query`), so the
 * client sends only the word — the server address and its token stay in
 * MyBooks. Entry resources come the same way, via `<base>/res/dict-res/…`.
 * The web build goes through `/api/mybooks/site-dict/<host>/…`; Tauri calls
 * MyBooks directly.
 */
import type { DictionaryLookupOutcome, DictionaryProvider, SiteDictEntry } from '../types';
import { fetchSiteDict, getSiteDictBase } from '../siteDictionaries';
import { createSiteVocab } from '../mydictVocab';
import { renderMyBooksResults } from './myBooksDictProvider';
import type { MyDictQueryResponse } from './myDictQuery';

export const createSiteDictProvider = (entry: SiteDictEntry): DictionaryProvider => {
  // Wordbook of the token MyBooks holds for this dictionary; relayed by MyBooks too.
  const vocab = createSiteVocab(entry);
  return {
    id: entry.id,
    kind: 'builtin',
    label: entry.name,
    vocab,
    async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
      const dictBase = getSiteDictBase(entry.siteId);
      if (!dictBase) return { ok: false, reason: 'unsupported' };
      const trimmed = word.trim();
      if (!trimmed) return { ok: false, reason: 'empty' };
      try {
        const response = await fetchSiteDict(
          `${dictBase}/query?word=${encodeURIComponent(trimmed)}`,
          { signal: ctx.signal },
        );
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        // 404 = the admin deleted this dictionary since the settings were last
        // reconciled; nothing to show rather than an error card.
        if (response.status === 404) return { ok: false, reason: 'unsupported' };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as MyDictQueryResponse;
        if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        if (!data.results || data.results.length === 0) return { ok: false, reason: 'empty' };

        renderMyBooksResults(data.results, ctx.container, {
          baseUrl: `${dictBase}/res`,
          vocab,
          onNavigate: ctx.onNavigate,
          _: ctx._,
          lang: ctx.lang,
          isDarkMode: ctx.isDarkMode,
        });
        return { ok: true, headword: trimmed, sourceLabel: entry.name };
      } catch (error) {
        if (ctx.signal.aborted || (error as { name?: string }).name === 'AbortError') {
          return { ok: false, reason: 'error', message: 'aborted' };
        }
        console.error(`Site dictionary lookup failed (${entry.siteId}): ${String(error)}`);
        return {
          ok: false,
          reason: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
};
