import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMyDictVocab, createServerVocab } from '@/services/dictionaries/mydictVocab';

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

  it('posts the word to the server wordbook and maps 200 to added (Tauri)', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    tauriFetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 7, word: '人気' }));

    const result = await createMyDictVocab(
      { url: 'https://dict.example', token: 'sk-abc' },
      'MyDict',
    ).addWord('人気');

    expect(result).toEqual({ status: 'added' });
    const [url, init] = tauriFetchMock.mock.calls[0]!;
    // 端点固定为 /api/v1/vocab（不带查询串），token 走 Bearer
    expect(url).toBe('https://dict.example/api/v1/vocab');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-abc');
    expect(JSON.parse(String(init.body))).toEqual({ word: '人気' });
  });

  it('forwards the optional dictionary id', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    tauriFetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

    await createMyDictVocab({ url: 'https://dict.example', token: '' }, 'MyDict').addWord('apple', {
      dictionaryId: 59,
    });

    const [, init] = tauriFetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toEqual({ word: 'apple', dictionary_id: 59 });
    // 空 token 不发送 Authorization 头
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('maps 409 to duplicate and surfaces the server message', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    tauriFetchMock.mockResolvedValueOnce(
      jsonResponse(409, { code: 'conflict', message: '已收藏该单词', detail: null }),
    );

    expect(
      (await createMyDictVocab({ url: 'https://d', token: 't' }, 'D').addWord('x')).status,
    ).toBe('duplicate');

    tauriFetchMock.mockResolvedValueOnce(
      jsonResponse(409, { code: 'conflict', message: '生词本已达上限（100 条）' }),
    );
    const capped = await createMyDictVocab({ url: 'https://d', token: 't' }, 'D').addWord('x');
    expect(capped).toEqual({ status: 'duplicate', message: '生词本已达上限（100 条）' });
  });

  it('maps 401/403 to unauthorized and other failures to error', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    const target = createMyDictVocab({ url: 'https://d', token: 'bad' }, 'D');

    tauriFetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'unauthorized' }));
    expect(await target.addWord('x')).toEqual({ status: 'unauthorized' });

    tauriFetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    expect(await target.addWord('x')).toEqual({ status: 'unauthorized' });

    tauriFetchMock.mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }));
    expect(await target.addWord('x')).toEqual({ status: 'error', message: 'boom' });

    tauriFetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await target.addWord('x')).toEqual({ status: 'error', message: 'network down' });
  });

  it('goes through the same-origin relay on the web build', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { id: 3 }));

    const result = await createMyDictVocab(
      { url: 'http://lan.example:4815', token: 'sk-xyz' },
      'MyDict',
    ).addWord('apple');

    expect(result).toEqual({ status: 'added' });
    expect(tauriFetchMock).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/mybooks/mydict/vocab');
    expect(init!.method).toBe('POST');
    // 浏览器不带 token——由中继按 body 里的 url/token 重建请求
    expect(JSON.stringify(init!.body)).not.toContain('sk-xyz');
  });

  it('sends only the word through the deployment relay (credentials stay server-side)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { id: 4 }));

    expect(await createServerVocab('MyDict Service').addWord('人気')).toEqual({ status: 'added' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/mybooks/mydict/server-vocab');
    expect(JSON.parse(String(init!.body))).toEqual({ word: '人気' });
  });
});
