import { NextRequest, NextResponse } from 'next/server';
import { buildMyDictVocabUrl } from '@/services/dictionaries/providers/myDictUrl';
import { httpGetText, httpJsonRequest } from '@/app/api/mybooks/_shared/upstream';

/**
 * Server-side relay for the wordbook (生词本) of a **user-configured** MyDict
 * server on the web build — one route for the three actions the popup needs:
 *
 *   `{action: 'list', word}`                → GET    `/api/v1/vocab?search=`
 *   `{action: 'add', word, dictionary_id}`  → POST   `/api/v1/vocab`
 *   `{action: 'remove', item_id}`           → DELETE `/api/v1/vocab/{id}`
 *
 * Same trust model as the sibling `/api/mybooks/mydict/query` relay: the host
 * and token come from the client (they are the server the user configured),
 * but every path is built from `/api/v1/vocab` here — the client can't turn
 * this into a general-purpose proxy. Upstream 4xx (409 already saved, 401 bad
 * token) is forwarded as-is so the popup can phrase it correctly.
 */
const TIMEOUT_MS = 15000;

export async function POST(request: NextRequest) {
  let action: unknown, url: unknown, token: unknown;
  let word: unknown, dictionaryId: unknown, itemId: unknown;
  try {
    ({
      action,
      url,
      token,
      word,
      dictionary_id: dictionaryId,
      item_id: itemId,
    } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
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
    let result: { status: number; text: string };
    if (action === 'list') {
      if (typeof word !== 'string' || !word.trim()) {
        return NextResponse.json({ error: 'Missing word' }, { status: 400 });
      }
      const search = new URL(vocabUrl);
      search.searchParams.set('search', word.trim());
      search.searchParams.set('page_size', '50');
      result = await httpGetText(search.toString(), headers, TIMEOUT_MS);
    } else if (action === 'add') {
      if (typeof word !== 'string' || !word.trim() || typeof dictionaryId !== 'number') {
        return NextResponse.json({ error: 'Missing word or dictionary_id' }, { status: 400 });
      }
      result = await httpJsonRequest(
        'POST',
        vocabUrl,
        { word: word.trim(), dictionary_id: dictionaryId },
        headers,
        TIMEOUT_MS,
      );
    } else if (action === 'remove') {
      if (typeof itemId !== 'number') {
        return NextResponse.json({ error: 'Missing item_id' }, { status: 400 });
      }
      result = await httpJsonRequest(
        'DELETE',
        `${vocabUrl}/${itemId}`,
        undefined,
        headers,
        TIMEOUT_MS,
      );
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    return NextResponse.json(result.text ? JSON.parse(result.text) : {}, {
      status: result.status >= 200 && result.status < 300 ? 200 : result.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[MyDict Vocab Proxy] ${vocabUrl}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
