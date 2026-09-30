/**
 * The MyDict server configured on the MyBooks deployment itself
 * (`MYDICT_SERVER_URL` / `MYDICT_SERVER_TOKEN` on the embedded-reader
 * container).
 *
 * Zero per-browser configuration is the whole point: a user adding a MyDict
 * server by hand has to repeat it in every browser (the settings live in that
 * browser's IndexedDB and are deliberately excluded from settings sync), and
 * the token would end up in each of them. Here the lookup goes through the
 * app's own route with just the word — the address and the token never leave
 * the host.
 *
 * Web-embed only: the backing route lives in the embedded Next server, which
 * does not exist on desktop/mobile builds, so the provider reports itself
 * unsupported there rather than surfacing an error card.
 */
import { isWebAppPlatform } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { BUILTIN_PROVIDER_IDS } from '../types';
import type { DictionaryLookupOutcome, DictionaryProvider } from '../types';
import { createServerVocab } from '../mydictVocab';
import { renderMyBooksResults } from './myBooksDictProvider';
import type { MyDictResult } from './myDictQuery';
import { SERVER_DICT_RESOURCE_BASE } from './myDictUrl';

const SERVER_QUERY_URL = '/api/mybooks/mydict/server-query';

/** 生词本走服务端中继（token 不出容器）；由渲染层在每个词典分组头画星标。 */
const SERVER_VOCAB = createServerVocab(_('MyDict Service'));

let configuredProbe: Promise<boolean> | null = null;

/** Whether this deployment set `MYDICT_SERVER_URL`; always false off web. */
export const isServerDictConfigured = (): Promise<boolean> => {
  if (!isWebAppPlatform()) return Promise.resolve(false);
  configuredProbe ??= fetch(SERVER_QUERY_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { configured?: boolean } | null) => data?.configured === true)
    .catch(() => {
      configuredProbe = null;
      return false;
    });
  return configuredProbe;
};

export const serverDictProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.mydictServer,
  kind: 'builtin',
  label: _('MyDict Service'),
  vocab: SERVER_VOCAB,
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    if (!isWebAppPlatform()) return { ok: false, reason: 'unsupported' };
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    try {
      const response = await fetch(SERVER_QUERY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: trimmed }),
        signal: ctx.signal,
      });
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      // 404 = the deployment has no MYDICT_SERVER_URL — same "nothing to
      // show here" treatment as a platform that lacks the feature.
      if (response.status === 404) return { ok: false, reason: 'unsupported' };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { results?: MyDictResult[] };
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (!data.results || data.results.length === 0) return { ok: false, reason: 'empty' };

      renderMyBooksResults(data.results, ctx.container, {
        // Resources are re-anchored through the same relay with this sentinel
        // instead of a server address the client doesn't know.
        baseUrl: SERVER_DICT_RESOURCE_BASE,
        vocab: SERVER_VOCAB,
        onNavigate: ctx.onNavigate,
        _: ctx._,
        lang: ctx.lang,
        isDarkMode: ctx.isDarkMode,
      });
      return {
        ok: true,
        headword: trimmed,
        sourceLabel: ctx._ ? ctx._('MyDict Service') : 'MyDict Service',
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return { ok: false, reason: 'error', message: 'aborted' };
      }
      console.error('Server dictionary lookup failed', error);
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
