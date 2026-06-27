import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { pullSync, pushSync, SyncApiError } from '@/services/mybooks/syncClient';

describe('syncClient', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
  });

  it('pullSync builds the proxy URL with since/type/book on web', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({ books: [], notes: null, configs: null }),
      } as Response);

    await pullSync(123, { type: 'configs', book: 'abcd' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/mybooks\/proxy\/sync\?/);
    expect(String(url)).toContain('host=http%3A%2F%2Fmybooks.local');
    expect(String(url)).toContain('since=123');
    expect(String(url)).toContain('type=configs');
    expect(String(url)).toContain('book=abcd');
    expect(options).toMatchObject({ method: 'GET' });
  });

  it('pullSync hits the mybooks host directly on Tauri', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    const tauriFetchMock = vi
      .mocked(tauriFetch)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ books: null, notes: null, configs: [] }),
      } as Response);

    await pullSync(0);

    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    const [url] = tauriFetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://mybooks.local/api/sync?since=0');
  });

  it('pushSync POSTs a JSON body and returns the merged envelope', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ books: null, notes: null, configs: [{ id: '1' }] }),
    } as Response);

    const result = await pushSync({ configs: [{ id: '1', updatedAt: 1 }] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    expect(options).toMatchObject({ method: 'POST' });
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      configs: [{ id: '1', updatedAt: 1 }],
    });
    expect(result.configs).toEqual([{ id: '1' }]);
  });

  it('throws SyncApiError with the server-provided message on non-2xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Forbidden',
      json: async () => ({ err: 'permission.denied' }),
    } as Response);

    await expect(pullSync(0)).rejects.toThrow(SyncApiError);
    await expect(pullSync(0)).rejects.toThrow('permission.denied');
  });

  it('throws SyncApiError when no mybooks host is configured', async () => {
    localStorage.clear();
    await expect(pullSync(0)).rejects.toThrow('MyBooks host is not configured');
  });
});
