import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { baiduBaikeProvider } from '@/services/dictionaries/providers/baiduBaikeProvider';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';

const { tauriFetchMock } = vi.hoisted(() => ({ tauriFetchMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetchMock }));

const sampleHtml = `<!DOCTYPE html><html><head>
<title>苹果（蔷薇科苹果属植物）_百度百科</title>
<meta property="og:title" content="苹果" />
<meta property="og:description" content="苹果是蔷薇科苹果属植物。" />
<meta property="og:image" content="https://bkimg.example/pic.jpg" />
</head><body></body></html>`;

describe('Baidu Baike provider', () => {
  beforeEach(() => {
    tauriFetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has the expected provider id', () => {
    expect(baiduBaikeProvider.id).toBe(BUILTIN_PROVIDER_IDS.baiduBaike);
  });

  it('requests the mobile search endpoint with the Android Chrome UA and renders the result', async () => {
    tauriFetchMock.mockResolvedValueOnce({
      ok: true,
      url: 'https://wapbaike.baidu.com/item/%E8%8B%B9%E6%9E%9C/14822460',
      text: async () => sampleHtml,
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await baiduBaikeProvider.lookup('苹果', {
      signal: controller.signal,
      container,
    });

    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = tauriFetchMock.mock.calls[0]!;
    expect(url).toBe('https://baike.baidu.com/search/word?pic=1&enc=utf-8&word=%E8%8B%B9%E6%9E%9C');
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('Android');
    expect(outcome.ok).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('苹果');
    expect(container.textContent).toContain('蔷薇科苹果属植物');
    const link = container.querySelector<HTMLAnchorElement>('a');
    expect(link?.href).toBe('https://wapbaike.baidu.com/item/%E8%8B%B9%E6%9E%9C/14822460');
  });

  it('reports an empty outcome when the entry is not found', async () => {
    tauriFetchMock.mockResolvedValueOnce({
      ok: true,
      url: 'https://wapbaike.baidu.com/search/word?word=zzz',
      text: async () => '<html><body>百度百科尚未收录词条 "zzz"</body></html>',
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await baiduBaikeProvider.lookup('zzznotaword', {
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('reports an error outcome when Baidu serves the verification page', async () => {
    tauriFetchMock.mockResolvedValueOnce({
      ok: true,
      url: 'https://baike.baidu.com/search/word?word=x',
      text: async () => '<html><head><title>验证</title></head><body></body></html>',
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await baiduBaikeProvider.lookup('x', {
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });

  it('reports an error outcome on HTTP failure', async () => {
    tauriFetchMock.mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await baiduBaikeProvider.lookup('苹果', {
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });
});
