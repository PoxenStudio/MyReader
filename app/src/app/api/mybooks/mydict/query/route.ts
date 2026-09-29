import { NextRequest, NextResponse } from 'next/server';
import { buildMyDictQueryUrl } from '@/services/dictionaries/providers/myDictUrl';
import { httpGetText } from '@/app/api/mybooks/_shared/upstream';

/**
 * Server-side relay for user-configured MyDict servers on the web build
 * (embedded MyReader). MyDict sends no CORS headers, so the browser can't
 * query it directly; Tauri builds use `@tauri-apps/plugin-http` instead.
 *
 * Like the Tauri path, certificate validation is disabled (self-hosted
 * servers often use self-signed https), which is why this uses
 * `node:http(s)` rather than `fetch`.
 *
 * LAN / private hosts are intentionally allowed — a self-hosted MyDict next
 * to MyBooks is the normal setup. To keep this from being a general-purpose
 * SSRF relay, the target path is always forced to `/api/v1/query` (built
 * here, not taken from the client), only GET is issued, redirects are not
 * followed, and only a JSON body is passed back.
 */
const TIMEOUT_MS = 15000;

export async function POST(request: NextRequest) {
  let url: unknown, token: unknown, word: unknown;
  try {
    ({ url, token, word } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof url !== 'string' || typeof word !== 'string' || !word.trim()) {
    return NextResponse.json({ error: 'Missing url or word' }, { status: 400 });
  }

  let queryUrl: string;
  try {
    queryUrl = buildMyDictQueryUrl(url, word);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }
  if (!/^https?:$/.test(new URL(queryUrl).protocol)) {
    return NextResponse.json({ error: 'Only http(s) URLs are supported' }, { status: 400 });
  }

  try {
    const { status, text } = await httpGetText(
      queryUrl,
      typeof token === 'string' && token ? { Authorization: `Bearer ${token}` } : {},
      TIMEOUT_MS,
    );
    if (status < 200 || status >= 300) {
      return NextResponse.json(
        { error: `HTTP ${status} ${text.slice(0, 200)}`.trim() },
        { status: 502 },
      );
    }
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: 'Invalid response' }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MyDict Proxy] ${queryUrl}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
