/**
 * Built-in MyBooks dictionary provider.
 *
 * Queries the user's self-hosted MyBooks dictionary API (ECDICT + Chinese
 * dictionaries) — `GET /api/v1/query?word=...` with a fixed bearer token.
 * Same API as user-added MyDict servers, so it shares `queryMyDict` — native
 * builds go through `@tauri-apps/plugin-http`, the web build relays through
 * `/api/mybooks/mydict/query` (the API sends no CORS headers).
 */
import type { DictionaryProvider, DictionaryLookupOutcome } from '../types';
import { BUILTIN_PROVIDER_IDS } from '../types';
import { stubTranslation as _ } from '@/utils/misc';
import { queryMyDict } from './myDictQuery';

const MYBOOKS_DICT_URL = 'https://mybooks.top/dict';

// MyBooks词典服务分配的token, 限流控制
const MYBOOKS_DICT_TOKEN = 'sk-ut5X97HcuelppOw90x3rcPuyyO5oYZLFCBAxE6LA6_g';

export interface MyBooksResult {
  dictionary_name: string;
  word: string;
  phonetic: string | null;
  definition: string;
}

export interface MyBooksResponse {
  results: MyBooksResult[];
}

/** Renders MyDict-API results (shared by the built-in and user-added servers). */
export const renderMyBooksResults = (results: MyBooksResult[], container: HTMLElement): void => {
  const hgroup = document.createElement('hgroup');
  const h1 = document.createElement('h1');
  h1.textContent = results[0]!.word;
  h1.className = 'text-lg font-bold';
  hgroup.append(h1);
  container.append(hgroup);

  results.forEach(({ dictionary_name, phonetic, definition }) => {
    const h2 = document.createElement('h2');
    h2.textContent = phonetic ? `${dictionary_name} · ${phonetic}` : dictionary_name;
    h2.className = 'text-base font-semibold mt-4';
    container.appendChild(h2);

    const p = document.createElement('p');
    p.textContent = definition;
    p.className = 'whitespace-pre-wrap text-sm';
    container.appendChild(p);
  });
};

export const myBooksDictProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.myBooks,
  kind: 'builtin',
  label: _('MyBooks Dictionary'),
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    try {
      const data = await queryMyDict(
        { url: MYBOOKS_DICT_URL, token: MYBOOKS_DICT_TOKEN },
        trimmed,
        ctx.signal,
      );
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (!data.results || data.results.length === 0) {
        return { ok: false, reason: 'empty' };
      }

      renderMyBooksResults(data.results, ctx.container);

      return { ok: true, headword: trimmed, sourceLabel: 'MyBooks' };
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return { ok: false, reason: 'error', message: 'aborted' };
      }
      console.error('MyBooks dictionary lookup failed', error);
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
