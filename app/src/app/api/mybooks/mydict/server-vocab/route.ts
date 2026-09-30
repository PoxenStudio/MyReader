import { NextRequest, NextResponse } from 'next/server';
import { buildMyDictVocabUrl } from '@/services/dictionaries/providers/myDictUrl';
import { httpGetText, httpJsonRequest } from '@/app/api/mybooks/_shared/upstream';

/**
 * Wordbook (生词本) of the MyDict server configured **on this deployment**
 * (`MYDICT_SERVER_URL` / `MYDICT_SERVER_TOKEN`) — the server-side half of the
 * "server dictionary" provider, whose credentials must never reach a browser.
 * The reader sends only the action and the word; address and token are read
 * here. Mirrors the sibling `/api/mybooks/mydict/server-query` route.
 *
 * Actions (same contract as the user-configured relay, minus url/token):
 *
 *   `{action: 'list', word}`                → GET    `/api/v1/vocab?search=`
 *   `{action: 'add', word, dictionary_id}`  → POST   `/api/v1/vocab`
 *   `{action: 'remove', item_id}`           → DELETE `/api/v1/vocab/{id}`
 *
 * Which notebook a row lands in is decided by that token's owner on the MyDict
 * side: a user-bound token writes the user's web wordbook, a plain token a
 * notebook of its own.
 */
const TIMEOUT_MS = 15000;

export async function POST(request: NextRequest) {
  const configured = process.env['MYDICT_SERVER_URL']?.trim() ?? '';
  if (!configured) {
    return NextResponse.json(
      { error: 'MyDict server is not configured on this deployment' },
      { status: 404 },
    );
  }

  let action: unknown, word: unknown, dictionaryId: unknown, itemId: unknown;
  try {
    ({ action, word, dictionary_id: dictionaryId, item_id: itemId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = process.env['MYDICT_SERVER_TOKEN']?.trim() ?? '';
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const vocabUrl = buildMyDictVocabUrl(configured);

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
    console.error(`[MyDict Server Vocab] ${vocabUrl}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
