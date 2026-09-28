import { NextRequest, NextResponse } from 'next/server';
import { resolveMyBooksInternalOrigin } from '@/utils/mybooksInternalOrigin';

/**
 * Relay for MyBooks' site-dictionary API (see
 * `services/dictionaries/siteDictionaries.ts`), used by the embedded web
 * reader:
 *
 *   /api/mybooks/site-dict/<host>/config                 → <host>/api/reader/dict-config
 *   /api/mybooks/site-dict/<host>/<siteId>/query?word=   → <host>/api/reader/dict/<siteId>/query
 *   /api/mybooks/site-dict/<host>/<siteId>/res/<path…>   → <host>/api/reader/dict/<siteId>/res/<path…>
 *
 * MyBooks does the actual dictionary requests (it holds the MyDict addresses
 * and tokens); this route only forwards the browser's MyBooks cookie, so it
 * works whether MyReader shares MyBooks' origin or not — the same reason
 * `/api/mybooks/proxy` exists. It is kept separate from that proxy because
 * the MyBooks host must ride in the **path**: entry stylesheets reference
 * their fonts and images relatively, and a relative URL drops the query
 * string the generic proxy carries the host in.
 *
 * Only the three shapes above are forwarded — this is not a general proxy.
 */
const TIMEOUT_MS = 20000;
const SITE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const upstreamPath = (rest: string[]): string | null => {
  if (rest.length === 1 && rest[0] === 'config') return '/api/reader/dict-config';
  const [siteId, action, ...resPath] = rest;
  if (!siteId || !SITE_ID_RE.test(siteId)) return null;
  if (action === 'query' && resPath.length === 0) return `/api/reader/dict/${siteId}/query`;
  if (action === 'res' && resPath.length > 0) {
    const encoded = resPath.map((segment) => encodeURIComponent(segment)).join('/');
    return `/api/reader/dict/${siteId}/res/${encoded}`;
  }
  return null;
};

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const [host, ...rest] = path ?? [];
  if (!host || !/^https?:\/\//i.test(host)) {
    return NextResponse.json({ error: 'Invalid MyBooks host' }, { status: 400 });
  }
  const target = upstreamPath(rest);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const origin = resolveMyBooksInternalOrigin(host).replace(/\/+$/, '');
  const url = new URL(`${origin}${target}`);
  if (rest[1] === 'query') {
    const word = request.nextUrl.searchParams.get('word');
    if (word) url.searchParams.set('word', word);
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Cookie: request.headers.get('cookie') ?? '' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Site Dict] ${url.toString()}: ${message}`);
    return NextResponse.json({ error: 'MyBooks unreachable' }, { status: 502 });
  }

  const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
  for (const name of ['content-type', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
