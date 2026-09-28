import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serverDictProvider } from '@/services/dictionaries/providers/serverDictProvider';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';

describe('Server dictionary provider', () => {
  const originalPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

  beforeEach(() => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlatform === undefined) delete process.env['NEXT_PUBLIC_APP_PLATFORM'];
    else process.env['NEXT_PUBLIC_APP_PLATFORM'] = originalPlatform;
  });

  it('has the expected provider id', () => {
    expect(serverDictProvider.id).toBe(BUILTIN_PROVIDER_IDS.mydictServer);
  });

  it('sends only the word — the address and token stay server-side', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              dictionary_id: 9,
              dictionary_name: '千篇汉语词典2023',
              word: '天性',
              phonetic: null,
              definition: '<p>天性</p><img src="/dict-res/9/res/imgs/qphy.png">',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const container = document.createElement('div');

    const outcome = await serverDictProvider.lookup('天性', {
      signal: new AbortController().signal,
      container,
    });

    expect(outcome.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/mybooks/mydict/server-query');
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({ word: '天性' });
    // 资源经由 server 哨兵中继，浏览器不需要知道词典服务的地址
    const src = container
      .querySelector('div')
      ?.shadowRoot?.querySelector('img')
      ?.getAttribute('src');
    expect(src).toBe('/api/mybooks/mydict/res/server/dict-res/9/res/imgs/qphy.png');
  });

  it('reports unsupported off the web build (no backing route there)', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const outcome = await serverDictProvider.lookup('天性', {
      signal: new AbortController().signal,
      container: document.createElement('div'),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unsupported');
  });

  it('reports unsupported when the deployment has no server configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'MyDict server is not configured on this deployment' }),
        {
          status: 404,
        },
      ),
    );
    const container = document.createElement('div');

    const outcome = await serverDictProvider.lookup('天性', {
      signal: new AbortController().signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unsupported');
  });

  it('reports an empty outcome when the server has no hits', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const container = document.createElement('div');

    const outcome = await serverDictProvider.lookup('zzznotaword', {
      signal: new AbortController().signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });
});
