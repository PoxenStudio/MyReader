/**
 * Wordbook (生词本) client for MyDict-API servers.
 *
 * `POST <base>/api/v1/vocab` with `{word, dictionary_id?, note?}` (bearer
 * token) saves the word and returns the stored item; the server looks the
 * entry up itself and snapshots its phonetic/definition, so the reader never
 * sends markup. `409` means the word is already saved (or the notebook hit
 * its cap) and the body carries the server's own message.
 *
 * Which notebook a word lands in is decided by the token
 * (`api/v1/vocab.py::_owner`): a token bound to a MyDict user writes that
 * user's web wordbook — the one the MyDict web UI shows — while a plain
 * token gets a notebook of its own.
 *
 * Transports mirror `myDictQuery.ts`: Tauri calls the server directly through
 * `@tauri-apps/plugin-http` (no CORS, self-signed certs tolerated), the web
 * build goes through our own relay, and the deployment-configured server
 * (whose token must not reach the browser) through a second relay that adds
 * the credentials server-side.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import type { MyDictEntry, VocabAddResult, VocabCapability } from './types';
import { buildMyDictVocabUrl } from './providers/myDictUrl';

/** Our own relays; web build only (see the module comment). */
const RELAY_URL = '/api/mybooks/mydict/vocab';
const SERVER_RELAY_URL = '/api/mybooks/mydict/server-vocab';

interface VocabRequestBody {
  word: string;
  dictionary_id?: number;
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
 * "already saved / notebook full" (it sends the reason as a message), and
 * `401`/`403` mean the token is missing, wrong, or not allowed to write —
 * worth telling apart, since the fix is on the settings side.
 */
const resultFromResponse = async (response: Response): Promise<VocabAddResult> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.ok) return { status: 'added' };
  if (response.status === 409) return { status: 'duplicate', message: serverMessage(body) };
  if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
  const message = serverMessage(body) ?? `HTTP ${response.status}`;
  return { status: 'error', message };
};

const postVocab = async (
  url: string,
  body: VocabRequestBody,
  headers: Record<string, string>,
): Promise<VocabAddResult> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return resultFromResponse(response);
};

/** Wordbook of a MyDict server the user configured (URL + token in settings). */
export const createMyDictVocab = (
  entry: Pick<MyDictEntry, 'url' | 'token'>,
  label: string,
): VocabCapability => {
  const token = (entry.token ?? '').trim();
  return {
    label,
    async addWord(word, options) {
      const body: VocabRequestBody = { word, dictionary_id: options?.dictionaryId };
      try {
        if (isTauriAppPlatform()) {
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const response = await tauriFetch(buildMyDictVocabUrl(entry.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
          });
          return await resultFromResponse(response);
        }
        // The web build can't call the server directly (mixed content + no
        // CORS) — the relay rebuilds the request from the same fields.
        return await postVocab(RELAY_URL, body, {});
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
};

/**
 * Wordbook of the MyDict server configured on the deployment itself
 * (`MYDICT_SERVER_URL` / `MYDICT_SERVER_TOKEN`): the reader only sends the
 * word, the relay adds the credentials, so they never reach the browser.
 * Web-embed only, like the provider that exposes it.
 */
export const createServerVocab = (label: string): VocabCapability => ({
  label,
  async addWord(word, options) {
    const body: VocabRequestBody = { word, dictionary_id: options?.dictionaryId };
    try {
      return await postVocab(SERVER_RELAY_URL, body, {});
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  },
});
