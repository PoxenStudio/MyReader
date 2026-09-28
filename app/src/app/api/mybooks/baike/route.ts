import { NextRequest, NextResponse } from 'next/server';
import {
  BAIKE_HEADERS,
  BAIKE_URL_HEADER,
  buildBaikeSearchUrl,
} from '@/services/dictionaries/providers/baiduBaikeRequest';

/**
 * Server-side relay for the Baidu Baike dictionary on the web build
 * (embedded MyReader). Baidu sends no CORS headers and a browser `fetch`
 * can't set the mobile `User-Agent` that avoids its captcha page; Tauri
 * builds use `@tauri-apps/plugin-http` instead. The target is fixed to
 * `baike.baidu.com`, only `word` comes from the client. The HTML is returned
 * as-is (parsed client-side, same as on Tauri), with the final item URL in
 * `X-Baike-Url` for the "Read on Baidu Baike" link.
 */
export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get('word')?.trim();
  if (!word) return NextResponse.json({ error: 'Missing word' }, { status: 400 });

  try {
    const response = await fetch(buildBaikeSearchUrl(word), {
      headers: BAIKE_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        [BAIKE_URL_HEADER]: response.url,
      },
    });
  } catch (error) {
    console.error(`[Baike Proxy] ${word}: ${String(error)}`);
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }
}
