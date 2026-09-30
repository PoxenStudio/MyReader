import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSiteDictProvider } from '@/services/dictionaries/providers/siteDictProvider';

const tauriFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetchMock }));

const RESULT = {
  results: [
    {
      dictionary_id: 9,
      dictionary_name: 'Han',
      word: '天性',
      phonetic: null,
      definition: '<p>天性</p><img src="/dict-res/9/res/imgs/qphy.png">',
    },
  ],
};

const lookup = (container: HTMLElement) =>
  createSiteDictProvider({ id: 'server:a', siteId: 'a', name: 'Han' }).lookup('天性', {
    signal: new AbortController().signal,
    container,
  });

const imgSrc = (container: HTMLElement) =>
  container.querySelector('div')?.shadowRoot?.querySelector('img')?.getAttribute('src');

describe('Site dictionary provider', () => {
  const originalPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('mybooks_host', 'https://books.example.com/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('mybooks_host');
    if (originalPlatform === undefined) delete process.env['NEXT_PUBLIC_APP_PLATFORM'];
    else process.env['NEXT_PUBLIC_APP_PLATFORM'] = originalPlatform;
  });

  it('web: queries through the same-origin relay', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(RESULT)));
    const container = document.createElement('div');

    const outcome = await lookup(container);

    expect(outcome.ok).toBe(true);
    const relay = '/api/mybooks/site-dict/https%3A%2F%2Fbooks.example.com/a';
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${relay}/query?word=${encodeURIComponent('天性')}`,
    );
    expect(imgSrc(container)).toBe(`${relay}/res/dict-res/9/res/imgs/qphy.png`);
  });

  it('tauri: queries MyBooks directly and loads resources from it', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    tauriFetchMock.mockResolvedValueOnce(new Response(JSON.stringify(RESULT)));
    const container = document.createElement('div');

    const outcome = await lookup(container);

    expect(outcome.ok).toBe(true);
    const base = 'https://books.example.com/api/reader/dict/a';
    expect(String(tauriFetchMock.mock.calls[0]![0])).toBe(
      `${base}/query?word=${encodeURIComponent('天性')}`,
    );
    expect(imgSrc(container)).toBe(`${base}/res/dict-res/9/res/imgs/qphy.png`);
  });

  it('reports unsupported without a MyBooks connection', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
    localStorage.removeItem('mybooks_host');

    const outcome = await lookup(document.createElement('div'));

    expect(tauriFetchMock).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unsupported');
  });
});
