import { NextRequest, NextResponse } from 'next/server';
import { resolveMyBooksInternalOrigin } from '@/utils/mybooksInternalOrigin';
import { relayResourceHeaders } from '@/app/api/mybooks/_shared/upstream';

/**
 * Relay for MyBooks' site-dictionary API (see
 * `services/dictionaries/siteDictionaries.ts`), used by the embedded web
 * reader:
 *
 *   /api/mybooks/site-dict/<host>/config                 → <host>/api/reader/dict-config
 *   /api/mybooks/site-dict/<host>/<siteId>/query?word=   → <host>/api/reader/dict/<siteId>/query
 *   /api/mybooks/site-dict/<host>/<siteId>/res/<path…>   → <host>/api/reader/dict/<siteId>/res/<path…>
 *   GET|POST /api/mybooks/site-dict/<host>/<siteId>/vocab → <host>/api/reader/dict/<siteId>/vocab
 *   DELETE /api/mybooks/site-dict/<host>/<siteId>/vocab/<n> → <host>/api/reader/dict/<siteId>/vocab/<n>
 *
 * MyBooks does the actual dictionary requests (it holds the MyDict addresses
 * and tokens); this route only forwards the browser's MyBooks cookie, so it
 * works whether MyReader shares MyBooks' origin or not — the same reason
 * `/api/mybooks/proxy` exists. It is kept separate from that proxy because
 * the MyBooks host must ride in the **path**: entry stylesheets reference
 * their fonts and images relatively, and a relative URL drops the query
 * string the generic proxy carries the host in.
 *
 * Only the shapes above are forwarded — this is not a general proxy. Writes
 * (the wordbook's POST / DELETE) reach MyBooks only on the `vocab` paths.
 *
 * Any host is allowed, but the cookie only goes to the internal origin or a
 * host on this request's own origin — never to a foreign host.
 */
const TIMEOUT_MS = 20000;
/** A wordbook add is `{word, dictionary_id}`; anything bigger isn't one. */
const MAX_BODY_BYTES = 4096;
const SITE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** First hop of a possibly comma-separated forwarding header. */
const firstHop = (value: string | null): string | undefined =>
  value?.split(',')[0]?.trim() || undefined;

const requestOrigin = (request: NextRequest): string | null => {
  const host = firstHop(request.headers.get('x-forwarded-host')) ?? request.headers.get('host');
  if (!host) return null;
  const proto =
    firstHop(request.headers.get('x-forwarded-proto')) ?? request.nextUrl.protocol.slice(0, -1);
  try {
    return new URL(`${proto}://${host}`).origin.toLowerCase();
  } catch {
    return null;
  }
};

/** Whether the browser's cookie may ride along to `host`. */
const mayForwardCookie = (request: NextRequest, host: string): boolean => {
  if (process.env['MYBOOKS_INTERNAL_ORIGIN']) return true;
  try {
    return new URL(host).origin.toLowerCase() === requestOrigin(request);
  } catch {
    return false;
  }
};

type Method = 'GET' | 'POST' | 'DELETE';

const upstreamPath = (rest: string[], method: Method): string | null => {
  const [siteId, action, ...resPath] = rest;
  if (action === 'vocab' && siteId && SITE_ID_RE.test(siteId)) {
    if (method === 'DELETE') {
      const [itemId, ...extra] = resPath;
      return itemId && /^[1-9]\d{0,17}$/.test(itemId) && extra.length === 0
        ? `/api/reader/dict/${siteId}/vocab/${itemId}`
        : null;
    }
    return resPath.length === 0 ? `/api/reader/dict/${siteId}/vocab` : null;
  }
  if (method !== 'GET') return null;
  if (rest.length === 1 && rest[0] === 'config') return '/api/reader/dict-config';
  if (!siteId || !SITE_ID_RE.test(siteId)) return null;
  if (action === 'query' && resPath.length === 0) return `/api/reader/dict/${siteId}/query`;
  if (action === 'res' && resPath.length > 0) {
    const encoded = resPath.map((segment) => encodeURIComponent(segment)).join('/');
    return `/api/reader/dict/${siteId}/res/${encoded}`;
  }
  return null;
};

type Context = { params: Promise<{ path: string[] }> };

export const GET = (request: NextRequest, context: Context) => relay(request, context, 'GET');
export const POST = (request: NextRequest, context: Context) => relay(request, context, 'POST');
export const DELETE = (request: NextRequest, context: Context) => relay(request, context, 'DELETE');

async function relay(request: NextRequest, context: Context, method: Method) {
  const { path } = await context.params;
  const [host, ...rest] = path ?? [];
  if (!host || !/^https?:\/\//i.test(host)) {
    return NextResponse.json({ error: 'Invalid MyBooks host' }, { status: 400 });
  }
  const target = upstreamPath(rest, method);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const origin = resolveMyBooksInternalOrigin(host).replace(/\/+$/, '');
  const url = new URL(`${origin}${target}`);
  const param = rest[1] === 'query' ? 'word' : rest[1] === 'vocab' ? 'search' : null;
  const value = param && method === 'GET' ? request.nextUrl.searchParams.get(param) : null;
  if (param && value) url.searchParams.set(param, value);

  const requestHeaders: Record<string, string> = mayForwardCookie(request, host)
    ? { Cookie: request.headers.get('cookie') ?? '' }
    : {};
  let body: string | undefined;
  if (method === 'POST') {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Body too large' }, { status: 413 });
    }
    requestHeaders['Content-Type'] = 'application/json';
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Site Dict] ${url.toString()}: ${message}`);
    return NextResponse.json({ error: 'MyBooks unreachable' }, { status: 502 });
  }

  if (rest[1] === 'res') {
    const headers = relayResourceHeaders(
      upstream.headers.get('content-type'),
      upstream.headers.get('cache-control'),
    );
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  });
  for (const name of ['content-type', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
