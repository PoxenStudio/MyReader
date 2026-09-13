import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { fetchMyBooks } from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';

describe('MyBooks request retry', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    useMyBooksStatusStore.setState({ isOffline: false });
  });

  const isMyBooksRequest = (url: unknown) =>
    typeof url === 'string' && url.includes('/api/mybooks/proxy/');

  it('recovers after transient network failures within the retry budget', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      calls++;
      if (calls < 3) return Promise.reject(new Error('Failed to fetch'));
      return Promise.resolve({ json: async () => ({ err: 'ok' }) } as Response);
    });
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);

    const result = await fetchMyBooks('/anything');

    expect(result.err).toBe('ok');
    expect(calls).toBe(3);
    expect(useMyBooksStatusStore.getState().isOffline).toBe(false);
  });

  it('gives up after 3 retries and reports offline', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      calls++;
      return Promise.reject(new Error('Failed to fetch'));
    });
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);

    await expect(fetchMyBooks('/anything')).rejects.toThrow('Failed to fetch');

    expect(calls).toBe(4);
    expect(useMyBooksStatusStore.getState().isOffline).toBe(true);
  });
});
