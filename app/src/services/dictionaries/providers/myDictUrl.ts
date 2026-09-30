import { isTauriAppPlatform } from '@/services/environment';

/**
 * Builds `<base>/api/v1/query?word=&full_style=true` for a MyDict server
 * (client + API route — the web relay rebuilds the URL through this same
 * function, so the query params live in exactly one place).
 *
 * `full_style=true` asks the server for the entry's original HTML instead of
 * the plain-text it falls back to by default; `renderMyBooksResults` renders
 * that markup (and sanitizes it first).
 */
export const buildMyDictQueryUrl = (baseUrl: string, word: string): string => {
  let base = baseUrl.trim().replace(/\/+$/, '');
  if (!/\/api\/v1\/query$/.test(base)) base += '/api/v1/query';
  const url = new URL(base);
  url.searchParams.set('word', word);
  url.searchParams.set('full_style', 'true');
  // Chinese and Japanese share ideographs: when the server routes by a single
  // preferred language, the other side's dictionaries drop out entirely
  // (looking up 「政府」 in a Japanese book shows no Chinese dictionary).
  // `all_langs` treats every enabled dictionary alike; older servers that
  // don't know the parameter ignore it and behave as before.
  url.searchParams.set('all_langs', 'true');
  return url.toString();
};

/**
 * Builds `<base>/api/v1/vocab` — the wordbook (生词本) endpoint. The server
 * looks the entry up itself and snapshots its phonetic/definition, so the
 * client only sends the word (plus the dictionary id it came from).
 */
export const buildMyDictVocabUrl = (baseUrl: string): string => {
  // The configured URL may already point at `/api/v1/query` (accepted by
  // buildMyDictQueryUrl), so strip either endpoint before appending.
  const base = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v1\/(?:query|vocab)$/, '');
  return `${base}/api/v1/vocab`;
};

/** Same-origin relay that streams a MyDict server's entry resources. */
const MYDICT_RESOURCE_RELAY = '/api/mybooks/mydict/res';

/**
 * Resource base for the provider that queries the MyDict server configured on
 * the MyBooks deployment itself (`MYDICT_SERVER_URL`). The client never learns
 * that address — it passes this sentinel and the relay resolves it against the
 * configured server. Kept short so resource URLs stay readable.
 *
 * Transitional: superseded by the site dictionaries below, kept working for
 * deployments already configured through the environment variables.
 */
export const SERVER_DICT_RESOURCE_BASE = 'server';

/**
 * Prefix of the site dictionaries' relay (`siteDictProvider.ts`). Their
 * resource base is already a same-origin relay path, e.g.
 * `/api/mybooks/site-dict/<host>/<siteId>/res`, so resources are appended to
 * it as-is instead of being wrapped in {@link MYDICT_RESOURCE_RELAY}.
 */
const SITE_DICT_RELAY = '/api/mybooks/site-dict/';

/**
 * Builds the URL a rendered entry should load one of its resources from —
 * images, fonts, the dictionary's own CSS, audio.
 *
 * On the web build this goes through our own relay: the embedded reader is
 * served over HTTPS while a self-hosted MyDict is usually plain HTTP on the
 * LAN, and a browser refuses to load `http://` stylesheets/images/fonts from
 * an HTTPS page. (Tauri talks to the server directly.)
 *
 * The relay path mirrors the server's own layout, so the relative `url(…)`
 * references inside a dictionary's CSS keep resolving to their siblings once
 * the stylesheet is served from our origin.
 */
export const buildMyDictResourceUrl = (baseUrl: string, resourcePath: string): string => {
  // Idempotence guards (both cases happened in practice):
  //  - an absolute http(s) URL is already final and must not be relayed;
  //  - a path that already carries a relay prefix must not be wrapped again —
  //    pronunciation clicks are bound after absolutizeResourceRefs has
  //    rewritten entry hrefs to relay URLs, and resolving those again yields
  //    a doubled /res/server/api/.../res/server/... prefix (upstream 400).
  if (/^https?:\/\//i.test(resourcePath)) return resourcePath;
  if (resourcePath.startsWith(`${MYDICT_RESOURCE_RELAY}/`)) return resourcePath;
  if (resourcePath.startsWith(SITE_DICT_RELAY)) return resourcePath;
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (isTauriAppPlatform()) return `${base}${resourcePath}`;
  const encodedPath = resourcePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  if (base.startsWith(SITE_DICT_RELAY)) return `${base}${encodedPath}`;
  return `${MYDICT_RESOURCE_RELAY}/${encodeURIComponent(base)}${encodedPath}`;
};
