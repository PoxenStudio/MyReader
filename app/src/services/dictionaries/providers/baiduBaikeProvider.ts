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
 * Tauri-only, for the same reason as `myBooksDictProvider`: the page sends
 * no CORS headers and a browser `fetch` can't override `User-Agent` anyway,
 * so this only works via `@tauri-apps/plugin-http`'s native request path.
 * The registry only instantiates this provider when `isTauriAppPlatform()`
 * is true.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { DictionaryProvider, DictionaryLookupOutcome } from '../types';
import { BUILTIN_PROVIDER_IDS } from '../types';
import { stubTranslation as _ } from '@/utils/misc';

const BAIKE_SEARCH_URL = 'https://baike.baidu.com/search/word';

// Mirrors MyBooks' `CHROME_MOBILE_HEADERS` — a desktop UA (or no UA) gets a
// "百度安全验证" captcha page instead of the article.
const BAIKE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; U; Android 16;) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
};

const NOT_FOUND_MARKER = '百度百科尚未收录词条';

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
      const url = new URL(BAIKE_SEARCH_URL);
      url.searchParams.set('pic', '1');
      url.searchParams.set('enc', 'utf-8');
      url.searchParams.set('word', trimmed);
      const response = await tauriFetch(url.toString(), {
        headers: BAIKE_HEADERS,
        signal: ctx.signal,
      });
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
      link.href = response.url || url.toString();
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
