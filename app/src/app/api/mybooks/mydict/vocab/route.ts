import { NextRequest, NextResponse } from 'next/server';
import { buildMyDictVocabUrl } from '@/services/dictionaries/providers/myDictUrl';
import { upstreamJsonPost } from '../_upstreamPost';

/**
 * Server-side relay for saving a word to a **user-configured** MyDict
 * server's wordbook (生词本) on the web build.
 *
 * Same trust model as the sibling `/api/mybooks/mydict/query` relay: the host
 * and token come from the client (they are the server the user configured),
 * but the path is always forced to `/api/v1/vocab`, only POST is issued, and
 * only a JSON body is passed back. Upstream 4xx (409 "already saved", 401 bad
 * token) is forwarded as-is so the popup can phrase it correctly.
 */
export async function POST(request: NextRequest) {
  let url: unknown, token: unknown, word: unknown, dictionaryId: unknown, note: unknown;
  try {
    ({ url, token, word, dictionary_id: dictionaryId, note } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof url !== 'string' || typeof word !== 'string' || !word.trim()) {
    return NextResponse.json({ error: 'Missing url or word' }, { status: 400 });
  }

  let vocabUrl: string;
  try {
    vocabUrl = buildMyDictVocabUrl(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }
  if (!/^https?:$/.test(new URL(vocabUrl).protocol)) {
    return NextResponse.json({ error: 'Only http(s) URLs are supported' }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  if (typeof token === 'string' && token.trim())
    headers['Authorization'] = `Bearer ${token.trim()}`;

  try {
    const { status, text } = await upstreamJsonPost(
      vocabUrl,
      { word: word.trim(), dictionary_id: dictionaryId, note },
      headers,
    );
    return NextResponse.json(text ? JSON.parse(text) : {}, {
      status: status >= 200 && status < 300 ? 200 : status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MyDict Vocab Proxy] ${vocabUrl}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
