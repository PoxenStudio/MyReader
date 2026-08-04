import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import {
  fetchMyBooks,
  getUserDetailInfo,
  getCachedUserDetailInfo,
} from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';

describe('MyBooks request timeout', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    useMyBooksStatusStore.setState({ isOffline: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a hung request after 5s and reports offline', async () => {
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch').mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        (opts as RequestInit)?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const promise = fetchMyBooks('/anything');
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(useMyBooksStatusStore.getState().isOffline).toBe(true);
  });
});

describe('MyBooks user detail cache', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('returns null when nothing has been cached yet', () => {
    expect(getCachedUserDetailInfo()).toBeNull();
  });

  it('caches the detail result after a successful fetch for instant reuse on next open', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        err: 'ok',
        user: { is_login: true, nickname: 'Alice', podcast_token: 'tok' },
      }),
    } as Response);

    const result = await getUserDetailInfo();
    expect(result?.user.nickname).toBe('Alice');

    const cached = getCachedUserDetailInfo();
    expect(cached?.user.nickname).toBe('Alice');
  });
});
