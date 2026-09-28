import http from 'node:http';
import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';
import { buildMyDictQueryUrl } from '@/services/dictionaries/providers/myDictUrl';

/**
 * Query the MyDict server configured **on this deployment**, on behalf of the
 * embedded reader's "server dictionary" provider.
 *
 * This is the server-side half of zero-configuration dictionaries: the browser
 * sends only the word. The MyDict address (`MYDICT_SERVER_URL`) and its token
 * (`MYDICT_SERVER_TOKEN`) are read here, server-side, and never reach any
 * browser — which is exactly what the per-browser settings storage cannot
 * offer (see `customDictionaryStore.ts`: user-added MyDict servers live in
 * each browser's IndexedDB and are excluded from settings sync).
 *
 * Same transport notes as the sibling `/api/mybooks/mydict/query` relay:
 * `node:http(s)` with certificate validation off (self-signed certs are the
 * norm on a home server), the query URL is built from the configured base via
 * `buildMyDictQueryUrl` (so `full_style=true` is always requested), and the
 * path is never taken from the client.
 */
const TIMEOUT_MS = 15000;

const httpGet = (url: string, headers: Record<string, string>) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers, rejectUnauthorized: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });

export async function POST(request: NextRequest) {
  const configured = process.env['MYDICT_SERVER_URL']?.trim() ?? '';
  if (!configured) {
    return NextResponse.json(
      { error: 'MyDict server is not configured on this deployment' },
      { status: 404 },
    );
  }

  let word: unknown;
  try {
    ({ word } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof word !== 'string' || !word.trim()) {
    return NextResponse.json({ error: 'Missing word' }, { status: 400 });
  }

  const token = process.env['MYDICT_SERVER_TOKEN']?.trim() ?? '';
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const queryUrl = buildMyDictQueryUrl(configured, word.trim());
    const { status, text } = await httpGet(queryUrl, headers);
    if (status < 200 || status >= 300) {
      return NextResponse.json(
        { error: `HTTP ${status} ${text.slice(0, 200)}`.trim() },
        { status: status >= 400 && status < 500 ? status : 502 },
      );
    }
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: 'Invalid response' }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MyDict Server] ${configured}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
