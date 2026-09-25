/**
 * Built-in Baidu Baike (百度百科) provider.
 *
 * Baidu's desktop `baike.baidu.com/item/<word>` page returns a "百度安全验证"
 * (security verification) captcha page for any non-browser-looking request —
 * confirmed by live testing with several desktop and mobile `User-Agent`
 * strings. The `/search/word` endpoint with an Android Chrome mobile UA does
 * not trigger it and redirects straight to the mobile item page
 * (`wapbaike.baidu.com/item/...`); this is the same request shape MyBooks'
 * own Baidu Baike scraper uses server-side
 * (`webserver/plugins/meta/baike/baidubaike/baidubaike.py`,
 * `CHROME_MOBILE_HEADERS`), reused here as the reference implementation.
 *
 * The page sends no CORS headers and a browser `fetch` can't override
 * `User-Agent` anyway, so native builds go through `@tauri-apps/plugin-http`
 * and the web build relays through the same-origin `/api/mybooks/baike` route.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import type { DictionaryProvider, DictionaryLookupOutcome } from '../types';
import { BUILTIN_PROVIDER_IDS } from '../types';
import { stubTranslation as _ } from '@/utils/misc';
import { BAIKE_HEADERS, BAIKE_URL_HEADER, buildBaikeSearchUrl } from './baiduBaikeRequest';

const NOT_FOUND_MARKER = '百度百科尚未收录词条';

/** Returns the response plus the final (post-redirect) item URL for the link. */
const fetchBaike = async (word: string, signal: AbortSignal) => {
  const searchUrl = buildBaikeSearchUrl(word);
  if (isTauriAppPlatform()) {
    const response = await tauriFetch(searchUrl, { headers: BAIKE_HEADERS, signal });
    return { response, itemUrl: response.url || searchUrl };
  }
  // Same-origin relative path: in the embedded deployment nginx only routes
  // `/api/mybooks/*` to MyReader (other `/api/*` goes to MyBooks).
  const response = await fetch(`/api/mybooks/baike?word=${encodeURIComponent(word)}`, { signal });
  return { response, itemUrl: response.headers.get(BAIKE_URL_HEADER) || searchUrl };
};

const getMetaContent = (doc: Document, property: string): string | undefined =>
  doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? undefined;

export const baiduBaikeProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.baiduBaike,
  kind: 'builtin',
  label: _('Baidu Baike'),
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    try {
      const { response, itemUrl } = await fetchBaike(trimmed, ctx.signal);
      if (!response.ok) {
        return { ok: false, reason: 'error', message: `HTTP ${response.status}` };
      }
      const html = await response.text();
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (html.includes(NOT_FOUND_MARKER)) return { ok: false, reason: 'empty' };

      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (doc.title === '验证') {
        return { ok: false, reason: 'error', message: 'Baidu verification page' };
      }

      const description = getMetaContent(doc, 'og:description');
      if (!description) return { ok: false, reason: 'empty' };
      const title = getMetaContent(doc, 'og:title') ?? trimmed;
      const image = getMetaContent(doc, 'og:image');
      // `doc.title` looks like "苹果（蔷薇科苹果属植物）_百度百科" — the
      // parenthesized part is a short descriptor, mirrored on Wikipedia's
      // one-line `data.description` subtitle.
      const descriptor = doc.title.match(/[（(]([^）)]*)[）)]/)?.[1];

      const hgroup = document.createElement('hgroup');
      hgroup.style.color = 'white';
      hgroup.style.backgroundPosition = 'center center';
      hgroup.style.backgroundSize = 'cover';
      hgroup.style.backgroundColor = 'rgba(0, 0, 0, .4)';
      hgroup.style.backgroundBlendMode = 'darken';
      hgroup.style.borderRadius = '6px';
      hgroup.style.padding = '12px';
      hgroup.style.marginBottom = '12px';
      hgroup.style.minHeight = '100px';
      if (image) hgroup.style.backgroundImage = `url("${image}")`;

      const h1 = document.createElement('h1');
      h1.textContent = title;
      h1.className = 'text-lg font-bold';
      hgroup.append(h1);
      if (descriptor) {
        const p = document.createElement('p');
        p.textContent = descriptor;
        hgroup.appendChild(p);
      }
      ctx.container.append(hgroup);

      const content = document.createElement('p');
      content.textContent = description;
      content.className = 'p-2 text-sm';
      ctx.container.append(content);

      const linkWrapper = document.createElement('p');
      linkWrapper.className = 'mt-3 px-2 text-sm';
      const link = document.createElement('a');
      link.href = itemUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'not-eink:text-primary underline';
      link.textContent = _('Read on Baidu Baike →');
      linkWrapper.appendChild(link);
      ctx.container.append(linkWrapper);

      return { ok: true, headword: title, sourceLabel: 'Baidu Baike' };
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return { ok: false, reason: 'error', message: 'aborted' };
      }
      console.error('Baidu Baike lookup failed', error);
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
