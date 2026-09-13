/**
 * Built-in MyBooks dictionary provider.
 *
 * Queries the user's self-hosted MyBooks dictionary API (ECDICT + Chinese
 * dictionaries) — `GET /api/v1/query?word=...` with a fixed bearer token.
 * Tauri-only: the API sends no `Access-Control-Allow-Origin` header, so a
 * web-build `fetch` would be blocked by CORS; native builds go through
 * `@tauri-apps/plugin-http`, whose requests are sent from the Rust side and
 * never touch the webview's network stack. The registry only instantiates
 * this provider when `isTauriAppPlatform()` is true (see `registry.ts`).
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { DictionaryProvider, DictionaryLookupOutcome } from '../types';
import { BUILTIN_PROVIDER_IDS } from '../types';
import { stubTranslation as _ } from '@/utils/misc';

const MYBOOKS_DICT_URL = 'https://mybooks.top/dict/api/v1/query';

// MyBooks词典服务分配的token, 限流控制
const MYBOOKS_DICT_TOKEN = 'sk-ut5X97HcuelppOw90x3rcPuyyO5oYZLFCBAxE6LA6_g';

interface MyBooksResult {
  dictionary_name: string;
  word: string;
  phonetic: string | null;
  definition: string;
}

interface MyBooksResponse {
  results: MyBooksResult[];
}

export const myBooksDictProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.myBooks,
  kind: 'builtin',
  label: _('MyBooks Dictionary'),
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    try {
      const url = new URL(MYBOOKS_DICT_URL);
      url.searchParams.set('word', trimmed);
      const response = await tauriFetch(url.toString(), {
        headers: { Authorization: `Bearer ${MYBOOKS_DICT_TOKEN}` },
        signal: ctx.signal,
      });
      if (!response.ok) {
        return { ok: false, reason: 'error', message: `HTTP ${response.status}` };
      }
      const data = (await response.json()) as MyBooksResponse;
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (!data.results || data.results.length === 0) {
        return { ok: false, reason: 'empty' };
      }

      const hgroup = document.createElement('hgroup');
      const h1 = document.createElement('h1');
      h1.textContent = data.results[0]!.word;
      h1.className = 'text-lg font-bold';
      hgroup.append(h1);
      ctx.container.append(hgroup);

      data.results.forEach(({ dictionary_name, phonetic, definition }) => {
        const h2 = document.createElement('h2');
        h2.textContent = phonetic ? `${dictionary_name} · ${phonetic}` : dictionary_name;
        h2.className = 'text-base font-semibold mt-4';
        ctx.container.appendChild(h2);

        const p = document.createElement('p');
        p.textContent = definition;
        p.className = 'whitespace-pre-wrap text-sm';
        ctx.container.appendChild(p);
      });

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
