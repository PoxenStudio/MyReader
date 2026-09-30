import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMyDictVocab,
  createServerVocab,
  createSiteVocab,
} from '@/services/dictionaries/mydictVocab';

const { tauriFetchMock } = vi.hoisted(() => ({ tauriFetchMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetchMock }));

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

describe('mydictVocab', () => {
  const originalPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

  beforeEach(() => {
    tauriFetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlatform === undefined) delete process.env['NEXT_PUBLIC_APP_PLATFORM'];
    else process.env['NEXT_PUBLIC_APP_PLATFORM'] = originalPlatform;
  });

  describe('direct server (Tauri)', () => {
    beforeEach(() => {
      process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    });

    it('lists saved entries as a dictionaryId → itemId map (exact headword only)', async () => {
      tauriFetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          items: [
            { id: 42, word: 'ran', dictionary_id: 4 },
            { id: 43, word: 'ranch', dictionary_id: 9 }, // 前缀命中的别的词，不算这个词
            { id: 44, word: 'ran', dictionary_id: null }, // 词典被删：无处可挂
          ],
        }),
      );

      const saved = await createMyDictVocab(
        { url: 'https://d', token: 'sk-abc' },
        'MyDict',
      ).listSaved('ran');

      expect([...saved]).toEqual([[4, 42]]);
      const [url, init] = tauriFetchMock.mock.calls[0]!;
      expect(url).toBe('https://d/api/v1/vocab?search=ran&page_size=50');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-abc');
    });

    it('adds an entry with the dictionary id and maps 409/401 to duplicate/unauthorized', async () => {
      const target = createMyDictVocab({ url: 'https://d', token: 'sk-abc' }, 'MyDict');
      const ref = { dictionaryId: 59, word: 'mockingbird' };

      tauriFetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 7 }));
      expect(await target.addEntry(ref)).toEqual({ status: 'ok' });
      const [url, init] = tauriFetchMock.mock.calls[0]!;
      expect(url).toBe('https://d/api/v1/vocab');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ word: 'mockingbird', dictionary_id: 59 });

      tauriFetchMock.mockResolvedValueOnce(
        jsonResponse(409, { code: 'conflict', message: '该词典下已收藏该单词' }),
      );
      expect(await target.addEntry(ref)).toEqual({
        status: 'duplicate',
        message: '该词典下已收藏该单词',
      });

      tauriFetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'unauthorized' }));
      expect(await target.addEntry(ref)).toEqual({ status: 'unauthorized' });
    });

    it('removes an entry by item id', async () => {
      tauriFetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      expect(await createMyDictVocab({ url: 'https://d', token: 't' }, 'D').removeItem(42)).toEqual(
        {
          status: 'ok',
        },
      );
      const [url, init] = tauriFetchMock.mock.calls[0]!;
      expect(url).toBe('https://d/api/v1/vocab/42');
      expect(init.method).toBe('DELETE');
    });

    it('treats a failed list as "nothing saved" instead of failing the lookup', async () => {
      tauriFetchMock.mockRejectedValueOnce(new Error('network down'));
      expect(
        await createMyDictVocab({ url: 'https://d', token: 't' }, 'D').listSaved('ran'),
      ).toEqual(new Map());
    });
  });

  describe('web relay (user-configured server)', () => {
    beforeEach(() => {
      process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
    });

    it('carries url + token + action in the relay body', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          jsonResponse(200, { items: [{ id: 3, word: 'x', dictionary_id: 8 }] }),
        );

      const saved = await createMyDictVocab(
        { url: 'http://lan.example:4815', token: 'sk-xyz' },
        'MyDict',
      ).listSaved('x');
      expect([...saved]).toEqual([[8, 3]]);

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/mybooks/mydict/vocab');
      expect(JSON.parse(String(init!.body))).toEqual({
        action: 'list',
        word: 'x',
        url: 'http://lan.example:4815',
        token: 'sk-xyz',
      });
      expect(tauriFetchMock).not.toHaveBeenCalled();
    });

    it('sends add/remove through the same route', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(200, { id: 5 }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const target = createMyDictVocab({ url: 'http://lan:4815', token: 'sk-xyz' }, 'MyDict');
      expect(await target.addEntry({ dictionaryId: 8, word: 'x' })).toEqual({ status: 'ok' });
      expect(await target.removeItem(5)).toEqual({ status: 'ok' });

      expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
        action: 'add',
        word: 'x',
        dictionary_id: 8,
      });
      expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({
        action: 'remove',
        item_id: 5,
      });
    });
  });

  describe('deployment server', () => {
    it('sends only the action and word — credentials stay server-side', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(200, { id: 4 }));

      expect(
        await createServerVocab('MyDict Service').addEntry({ dictionaryId: 8, word: '人気' }),
      ).toEqual({ status: 'ok' });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/mybooks/mydict/server-vocab');
      expect(JSON.parse(String(init!.body))).toEqual({
        action: 'add',
        word: '人気',
        dictionary_id: 8,
      });
    });
  });
});

describe('createSiteVocab (MyBooks-configured MyDict, always via MyBooks)', () => {
  const originalPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];
  const entry = { id: 'server:abc', siteId: 'abc', name: 'Han' };

  beforeEach(() => {
    tauriFetchMock.mockReset();
    localStorage.setItem('mybooks_host', 'https://books.example.com/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('mybooks_host');
    if (originalPlatform === undefined) delete process.env['NEXT_PUBLIC_APP_PLATFORM'];
    else process.env['NEXT_PUBLIC_APP_PLATFORM'] = originalPlatform;
  });

  it('web: lists, adds and removes through the site-dict relay', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: 42, word: 'ran', dictionary_id: 4 }] })),
      )
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}'));
    const vocab = createSiteVocab(entry);
    const relay = '/api/mybooks/site-dict/https%3A%2F%2Fbooks.example.com/abc/vocab';

    expect([...(await vocab.listSaved('ran'))]).toEqual([[4, 42]]);
    expect(await vocab.addEntry({ dictionaryId: 4, word: 'ran' })).toEqual({ status: 'ok' });
    expect(await vocab.removeItem(42)).toEqual({ status: 'ok' });

    const calls = fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET']);
    expect(calls).toEqual([
      [`${relay}?search=ran`, 'GET'],
      [relay, 'POST'],
      [`${relay}/42`, 'DELETE'],
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({
      word: 'ran',
      dictionary_id: 4,
    });
    expect(tauriFetchMock).not.toHaveBeenCalled();
  });

  it('tauri: goes to MyBooks, never to the MyDict server', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    tauriFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'dup' }), { status: 409 }),
    );
    const result = await createSiteVocab(entry).addEntry({ dictionaryId: 4, word: 'ran' });
    expect(result).toEqual({ status: 'duplicate', message: 'dup' });
    const [url, init] = tauriFetchMock.mock.calls[0]!;
    expect(url).toBe('https://books.example.com/api/reader/dict/abc/vocab');
    expect(init.method).toBe('POST');
  });
});
