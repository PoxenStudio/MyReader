/**
 * Site dictionary provider: a MyDict server configured by the MyBooks admin
 * (see `siteDictionaries.ts`).
 *
 * MyBooks runs the lookup itself (`/api/reader/dict/<siteId>/query`, relayed
 * through `/api/mybooks/site-dict/<host>/…`), so the browser sends only the
 * word — the server address and its token stay in MyBooks. Entry resources
 * are relayed the same way, via `<base>/<siteId>/res/dict-res/…`.
 *
 * Web-embed only: the Tauri apps report it unsupported.
 */
import { isWebAppPlatform } from '@/services/environment';
import type { DictionaryLookupOutcome, DictionaryProvider, SiteDictEntry } from '../types';
import { getSiteDictApiBase } from '../siteDictionaries';
import { renderMyBooksResults } from './myBooksDictProvider';
import type { MyDictQueryResponse } from './myDictQuery';

export const createSiteDictProvider = (entry: SiteDictEntry): DictionaryProvider => ({
  id: entry.id,
  kind: 'builtin',
  label: entry.name,
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    const base = isWebAppPlatform() ? getSiteDictApiBase() : null;
    if (!base) return { ok: false, reason: 'unsupported' };
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    const dictBase = `${base}/${encodeURIComponent(entry.siteId)}`;
    try {
      const response = await fetch(`${dictBase}/query?word=${encodeURIComponent(trimmed)}`, {
        credentials: 'include',
        signal: ctx.signal,
      });
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
});
