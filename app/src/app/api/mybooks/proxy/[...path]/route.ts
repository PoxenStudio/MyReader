import { NextRequest } from 'next/server';

async function proxyRequest(request: NextRequest, method: string): Promise<Response> {
  const url = new URL(request.url);
  const host = url.searchParams.get('host');

  if (!host) {
    return new Response('host parameter required', { status: 400 });
  }

  const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
  // /api/mybooks/proxy/<path…>  →  slice off the first 4 segments
  const apiPath = url.pathname.split('/').slice(4).join('/');

  const targetUrl = new URL(`${normalizedHost}/api/${apiPath}`);
  url.searchParams.forEach((value, key) => {
    if (key !== 'host') targetUrl.searchParams.set(key, value);
  });

  const forwardHeaders: Record<string, string> = {
    Cookie: request.headers.get('cookie') ?? '',
  };

  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const ct = request.headers.get('content-type');
    if (ct) forwardHeaders['Content-Type'] = ct;
    body = await request.arrayBuffer();
  }

  const upstream = await fetch(targetUrl.toString(), {
    method,
    headers: forwardHeaders,
    body,
  });

  const responseHeaders = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) responseHeaders.set('content-type', ct);

  // Forward Set-Cookie headers, stripping Domain so the cookie is scoped to
  // the Readest origin instead of the MyReader server origin.
  type HeadersWithGetSetCookie = Headers & { getSetCookie(): string[] };
  const upstreamHeaders = upstream.headers as HeadersWithGetSetCookie;
  const rawCookies: string[] =
    typeof upstreamHeaders.getSetCookie === 'function'
      ? upstreamHeaders.getSetCookie()
      : upstreamHeaders.get('set-cookie')
        ? [upstreamHeaders.get('set-cookie')!]
        : [];

  for (const cookie of rawCookies) {
    const rewritten = cookie
      .split(';')
      .filter((part) => !part.trim().toLowerCase().startsWith('domain='))
      .join(';');
    responseHeaders.append('set-cookie', rewritten);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest) {
  return proxyRequest(request, 'GET');
}

export async function POST(request: NextRequest) {
  return proxyRequest(request, 'POST');
}
