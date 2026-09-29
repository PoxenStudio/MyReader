import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { SERVER_DICT_RESOURCE_BASE } from '@/services/dictionaries/providers/myDictUrl';
import { openUpstream, relayResourceHeaders } from '@/app/api/mybooks/_shared/upstream';

/**
 * Server-side relay for a MyDict server's entry resources
 * (`<base>/dict-res/<dictionary_id>/res/…` — images, fonts, the dictionaries'
 * own stylesheets and audio), on the web build.
 *
 * Two reasons this can't just be a direct `<img src>`:
 *
 *  - **Mixed content.** The embedded reader is normally reached over HTTPS
 *    (through the host's reverse proxy) while a self-hosted MyDict on the LAN
 *    is plain HTTP. Browsers block `http://` stylesheets/images/fonts on an
 *    HTTPS page, so the dictionaries' CSS and images would silently not load.
 *  - **Certificates.** Self-signed certs are the norm on a home server, which
 *    is why this uses `node:http(s)` with validation off rather than `fetch`.
 *
 * The URL **mirrors the server's own path layout** — `res/<server>/<path…>`
 * rather than `res?u=<server>&p=<path>` — because a dictionary's CSS refers to
 * its fonts and images relatively (`url("KaiXinSong2.1.ttf")`,
 * `url(font/qianp.eot)`). Under a query-string URL those resolve against
 * `/api/mybooks/mydict/` and 404; mirroring the path keeps them resolving to
 * the right sibling.
 *
 * Same trust model as the sibling `/api/mybooks/mydict/query` relay: the target
 * host comes from the client (it is the server the user configured), but the
 * resolved path must stay under the `/dict-res/` prefix the server itself
 * generates, so this is not a general-purpose proxy. Only GET is issued.
 *
 * The host is not restricted, so the response is hardened instead
 * (`relayResourceHeaders`).
 */
const TIMEOUT_MS = 20000;
/** Prefix the MyDict server puts on every entry resource URL. */
const ALLOWED_PATH_PREFIX = '/dict-res/';

export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path || path.length < 2) {
    return NextResponse.json({ error: 'Missing server or path' }, { status: 400 });
  }
  const [serverOrSentinel, ...rest] = path;

  // The `server` sentinel stands for the MyDict server configured on this
  // deployment (`MYDICT_SERVER_URL`): the "server dictionary" provider queries
  // it without ever learning its address, so its resources must resolve the
  // same way.
  let base = serverOrSentinel!;
  if (base === SERVER_DICT_RESOURCE_BASE) {
    base = process.env['MYDICT_SERVER_URL']?.trim() ?? '';
    if (!base) {
      return NextResponse.json(
        { error: 'MyDict server is not configured on this deployment' },
        { status: 404 },
      );
    }
  }

  let target: URL;
  try {
    target = new URL(base);
    target.pathname = `/${rest.join('/')}`;
  } catch {
    return NextResponse.json({ error: 'Invalid server or path' }, { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol)) {
    return NextResponse.json({ error: 'Only http(s) URLs are supported' }, { status: 400 });
  }
  // Checked *after* URL normalisation, so `/dict-res/../../x` cannot escape.
  if (!target.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    return NextResponse.json({ error: 'Only dictionary resources are relayed' }, { status: 400 });
  }

  try {
    const upstream = await openUpstream(target, TIMEOUT_MS);
    const status = upstream.statusCode ?? 502;
    if (status < 200 || status >= 300) {
      upstream.resume();
      // Report the upstream's own status: a dictionary that never shipped the
      // file the CSS asks for is a 404, not a relay failure — and the reader
      // logs it as such.
      return NextResponse.json(
        { error: `HTTP ${status}` },
        { status: status >= 400 && status < 500 ? status : 502 },
      );
    }
    // The server marks these `public, max-age=86400`; keep that so the
    // browser doesn't re-fetch every image on every lookup.
    const headers = relayResourceHeaders(
      upstream.headers['content-type'],
      upstream.headers['cache-control'],
    );
    return new NextResponse(Readable.toWeb(upstream) as ReadableStream, { status, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MyDict Resource] ${target.toString()}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
