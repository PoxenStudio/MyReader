/**
 * Baidu Baike request shape, shared by the client provider and the
 * same-origin relay route (`/api/mybooks/baike`).
 *
 * Baidu serves the desktop `baike.baidu.com/item/<word>` page behind a
 * 「百度安全验证」 captcha for anything that doesn't look like a browser. The
 * `/search/word` endpoint, called with Android Chrome mobile headers, does not
 * trigger it and redirects straight to the mobile item page
 * (`wapbaike.baidu.com/item/...`). These are the same headers MyBooks' own
 * scraper sends server-side
 * (`webserver/constants.py` → `CHROME_MOBILE_HEADERS`), reused here as the
 * reference implementation.
 */

/** The one request shape Baidu's bot check lets through. */
const CHROME_MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; U; Android 16;) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36';

export const BAIKE_HEADERS: Record<string, string> = {
  'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'User-Agent': CHROME_MOBILE_USER_AGENT,
};

/**
 * Response header the web relay uses to hand back the final (post-redirect)
 * item URL. A browser can't read the upstream `Response.url` through a
 * same-origin proxy, so the relay mirrors it into this header.
 */
export const BAIKE_URL_HEADER = 'X-Baike-Url';

/** Builds `https://baike.baidu.com/search/word?pic=1&enc=utf-8&word=<word>`. */
export const buildBaikeSearchUrl = (word: string): string => {
  const params = new URLSearchParams({ pic: '1', enc: 'utf-8', word });
  return `https://baike.baidu.com/search/word?${params.toString()}`;
};
