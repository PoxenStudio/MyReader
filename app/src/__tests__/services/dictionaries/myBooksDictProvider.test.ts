import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { myBooksDictProvider } from '@/services/dictionaries/providers/myBooksDictProvider';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';

const { tauriFetchMock } = vi.hoisted(() => ({ tauriFetchMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetchMock }));

describe('MyBooks dictionary provider', () => {
  beforeEach(() => {
    tauriFetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has the expected provider id', () => {
    expect(myBooksDictProvider.id).toBe(BUILTIN_PROVIDER_IDS.myBooks);
  });

  it('queries the MyBooks endpoint with the bearer token and renders results', async () => {
    tauriFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            dictionary_id: 1,
            dictionary_name: 'ECDICT英汉词典',
            word: 'apple',
            phonetic: "'æpl",
            definition: 'n. 苹果',
          },
        ],
      }),
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await myBooksDictProvider.lookup('apple', {
      signal: controller.signal,
      container,
    });

    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = tauriFetchMock.mock.calls[0]!;
    expect(url).toBe('https://mybooks.top/dict/api/v1/query?word=apple');
    expect((init.headers as Record<string, string>)['Authorization']).toMatch(/^Bearer sk-/);
    expect(outcome.ok).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('apple');
    expect(container.textContent).toContain('ECDICT英汉词典');
    expect(container.textContent).toContain('n. 苹果');
  });

  it('reports an empty outcome when results is empty', async () => {
    tauriFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await myBooksDictProvider.lookup('zzznotaword', {
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('reports an error outcome on HTTP failure', async () => {
    tauriFetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await myBooksDictProvider.lookup('apple', {
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });
});
