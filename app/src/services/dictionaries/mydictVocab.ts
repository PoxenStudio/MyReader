/**
 * Wordbook (生词本) client for MyDict-API servers.
 *
 * The notebook lives on the server and its records are **entry-scoped** —
 * `(word, dictionary_id)`: one row per dictionary per word, so the same word
 * can be saved from several dictionaries without conflict. Which notebook a
 * row lands in is decided by the token (`api/v1/vocab.py::_owner`): a token
 * bound to a MyDict user writes that user's web wordbook, a plain token gets
 * a notebook of its own.
 *
 * Three operations, each mirrored by a same-origin relay on the web build and
 * by `@tauri-apps/plugin-http` for direct servers:
 *
 *   listSaved(word)  → `GET    /api/v1/vocab?search=…`  (dictionaryId → itemId)
 *   addEntry(ref)    → `POST   /api/v1/vocab`           `{word, dictionary_id}`
 *   removeItem(id)   → `DELETE /api/v1/vocab/{id}`
 *
 * The server looks the entry up itself and snapshots its phonetic/definition
 * (following `@@@LINK=` redirects), so the client sends only the headword —
 * MyDict matches queries by prefix/fuzziness, so anything picked from a
 * lookup must be the entry's own `word`, never the reader's selection.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import type { MyDictEntry, VocabCapability, VocabEntryRef, VocabResult } from './types';
import { buildMyDictVocabUrl } from './providers/myDictUrl';

/** Our own relays; web build only (see the module comment). */
const RELAY_URL = '/api/mybooks/mydict/vocab';
const SERVER_RELAY_URL = '/api/mybooks/mydict/server-vocab';

/** `/api/v1/vocab` row, as far as this client looks at it. */
interface VocabListItem {
  id: number;
  word: string;
  dictionary_id: number | null;
}

type VocabAction = 'list' | 'add' | 'remove';

interface RelayBody {
  action: VocabAction;
  word?: string;
  dictionary_id?: number;
  item_id?: number;
  /** 只有 user-configured 那条中继需要：它按这两个字段重建上游请求 */
  url?: string;
  token?: string;
}

/** The server's error envelope: `{code, message, detail}`. */
const serverMessage = (body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') return undefined;
  const { message, detail, error } = body as Record<string, unknown>;
  const text = [message, detail, error].find((v) => typeof v === 'string' && v.trim());
  return typeof text === 'string' ? text : undefined;
};

/**
 * Map an HTTP status + body onto the UI-facing result. `409` is the server's
 * "already saved in this dictionary / notebook full" (it sends the reason as
 * a message); `401`/`403` mean the token is missing, wrong, or not allowed to
 * write — worth telling apart, since the fix is on the settings side.
 */
const resultFromResponse = async (response: Response): Promise<VocabResult> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.ok) return { status: 'ok' };
  if (response.status === 409) return { status: 'duplicate', message: serverMessage(body) };
  if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
  return { status: 'error', message: serverMessage(body) ?? `HTTP ${response.status}` };
};

const failure = (error: unknown): VocabResult => ({
  status: 'error',
  message: error instanceof Error ? error.message : String(error),
});

/** 已收藏列表 → `Map<dictionaryId, itemId>`（只认词头完全相同的那些行）。 */
const savedMap = (items: VocabListItem[], word: string): Map<number, number> => {
  const wanted = word.trim().toLowerCase();
  const map = new Map<number, number>();
  for (const item of items) {
    if (item.dictionary_id == null) continue;
    if ((item.word ?? '').trim().toLowerCase() !== wanted) continue;
    map.set(item.dictionary_id, item.id);
  }
  return map;
};

const authHeaders = (token: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

/** Wordbook of a MyDict server the user configured (URL + token in settings). */
export const createMyDictVocab = (
  entry: Pick<MyDictEntry, 'url' | 'token'>,
  label: string,
): VocabCapability => {
  const token = (entry.token ?? '').trim();

  /** 三条动作共用一个中继契约：`{action, …}` 由中继翻译成对应的上游请求。 */
  const relay = async (body: RelayBody): Promise<Response> =>
    fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, url: entry.url, token }),
    });

  return {
    label,
    async listSaved(word) {
      if (isTauriAppPlatform()) {
        try {
          const url = new URL(buildMyDictVocabUrl(entry.url));
          url.searchParams.set('search', word.trim());
          url.searchParams.set('page_size', '50');
          const response = await tauriFetch(url.toString(), { headers: authHeaders(token) });
          if (!response.ok) return new Map();
          const body = (await response.json()) as { items?: VocabListItem[] };
          return savedMap(body.items ?? [], word);
        } catch {
          // 列已收藏失败不该挡住查询本身：当作「都没收藏」，点击时再报错
          return new Map();
        }
      }
      try {
        const response = await relay({ action: 'list', word });
        if (!response.ok) return new Map();
        const body = (await response.json()) as { items?: VocabListItem[] };
        return savedMap(body.items ?? [], word);
      } catch {
        return new Map();
      }
    },
    async addEntry(ref) {
      try {
        if (isTauriAppPlatform()) {
          const response = await tauriFetch(buildMyDictVocabUrl(entry.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
            body: JSON.stringify({ word: ref.word, dictionary_id: ref.dictionaryId }),
          });
          return await resultFromResponse(response);
        }
        return await resultFromResponse(
          await relay({ action: 'add', word: ref.word, dictionary_id: ref.dictionaryId }),
        );
      } catch (error) {
        return failure(error);
      }
    },
    async removeItem(itemId) {
      try {
        if (isTauriAppPlatform()) {
          const response = await tauriFetch(`${buildMyDictVocabUrl(entry.url)}/${itemId}`, {
            method: 'DELETE',
            headers: authHeaders(token),
          });
          return await resultFromResponse(response);
        }
        return await resultFromResponse(await relay({ action: 'remove', item_id: itemId }));
      } catch (error) {
        return failure(error);
      }
    },
  };
};

/**
 * Wordbook of the MyDict server configured on the deployment itself
 * (`MYDICT_SERVER_URL` / `MYDICT_SERVER_TOKEN`): the relay adds the
 * credentials server-side, so they never reach the browser. Web-embed only,
 * like the provider that exposes it.
 */
export const createServerVocab = (label: string): VocabCapability => {
  const relay = async (body: RelayBody): Promise<Response> =>
    fetch(SERVER_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    label,
    async listSaved(word) {
      try {
        const response = await relay({ action: 'list', word });
        if (!response.ok) return new Map();
        const body = (await response.json()) as { items?: VocabListItem[] };
        return savedMap(body.items ?? [], word);
      } catch {
        return new Map();
      }
    },
    async addEntry(ref) {
      try {
        return await resultFromResponse(
          await relay({ action: 'add', word: ref.word, dictionary_id: ref.dictionaryId }),
        );
      } catch (error) {
        return failure(error);
      }
    },
    async removeItem(itemId) {
      try {
        return await resultFromResponse(await relay({ action: 'remove', item_id: itemId }));
      } catch (error) {
        return failure(error);
      }
    },
  };
};

export type { VocabEntryRef };
