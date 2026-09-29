import { NextRequest, NextResponse } from 'next/server';
import { buildMyDictVocabUrl } from '@/services/dictionaries/providers/myDictUrl';
import { upstreamJsonPost } from '../_upstreamPost';

/**
 * Save a word to the wordbook of the MyDict server configured **on this
 * deployment** (`MYDICT_SERVER_URL` / `MYDICT_SERVER_TOKEN`) — the server-side
 * half of the "server dictionary" provider, whose credentials must never
 * reach a browser. The reader sends only the word; address and token are read
 * here. Mirrors the sibling `/api/mybooks/mydict/server-query` route.
 *
 * Which notebook the word lands in is decided by that token's owner on the
 * MyDict side: a user-bound token writes the user's web wordbook, a plain
 * token a notebook of its own.
 */
export async function POST(request: NextRequest) {
  const configured = process.env['MYDICT_SERVER_URL']?.trim() ?? '';
  if (!configured) {
    return NextResponse.json(
      { error: 'MyDict server is not configured on this deployment' },
      { status: 404 },
    );
  }

  let word: unknown, dictionaryId: unknown, note: unknown;
  try {
    ({ word, dictionary_id: dictionaryId, note } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof word !== 'string' || !word.trim()) {
    return NextResponse.json({ error: 'Missing word' }, { status: 400 });
  }

  const token = process.env['MYDICT_SERVER_TOKEN']?.trim() ?? '';
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const vocabUrl = buildMyDictVocabUrl(configured);
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
    console.error(`[MyDict Server Vocab] ${vocabUrl}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
