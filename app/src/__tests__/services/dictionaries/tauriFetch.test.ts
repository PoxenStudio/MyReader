import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tauriFetchMock, cancelMock } = vi.hoisted(() => ({
  tauriFetchMock: vi.fn(),
  cancelMock: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetchMock }));

import { fetchWithAbort } from '@/services/dictionaries/tauriFetch';

describe('fetchWithAbort', () => {
  beforeEach(() => {
    cancelMock.mockReset();
    // Mirrors plugin-http: it cancels through the signal even after the request finished.
    tauriFetchMock.mockReset().mockImplementation(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', cancelMock);
      const res = new Response('{"ok":1}', { status: 200 });
      Object.defineProperty(res, 'url', { value: 'https://final.test/x' });
      return res;
    });
  });

  it('does not reach the plugin when aborted after completion', async () => {
    const controller = new AbortController();
    const res = await fetchWithAbort('https://a.test', { signal: controller.signal });
    controller.abort();

    expect(cancelMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: 1 });
    expect(res.url).toBe('https://final.test/x');
  });

  it('still cancels an in-flight request', async () => {
    const controller = new AbortController();
    tauriFetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            cancelMock();
            reject(new Error('Request cancelled'));
          });
        }),
    );
    const pending = fetchWithAbort('https://a.test', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow('Request cancelled');
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});
