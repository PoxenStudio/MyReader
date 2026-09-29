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
  // 中日共用汉字表意文字，服务端按单一优先语言路由时另一侧的词典整组不参与
  // （读日文书查「政府」看不到中文词典）。all_langs 让全部启用词典一视同仁。
  // 不支持该参数的老服务端会忽略它，行为不变。
  url.searchParams.set('all_langs', 'true');
  return url.toString();
};

/**
 * Builds `<base>/api/v1/vocab` — the wordbook (生词本) endpoint. The server
 * looks the entry up itself and snapshots its phonetic/definition, so the
 * client only sends the word (plus an optional dictionary id).
 */
export const buildMyDictVocabUrl = (baseUrl: string): string => {
  let base = baseUrl.trim().replace(/\/+$/, '');
  if (!/\/api\/v1\/vocab$/.test(base)) base += '/api/v1/vocab';
  return base;
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
  // 幂等保护（两次都真实发生过）：
  //  - 绝对 http(s) URL 是最终地址，不需要也不允许走中继；
  //  - 已经带中继前缀的路径不能再包一层——发音点击绑定发生在
  //    absolutizeResourceRefs 把词条 href 改写成中继 URL 之后，直接 resolve
  //    会得到 /res/server/api/.../res/server/... 的双前缀（上游 400）。
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
