import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { fetchMyBooks, checkMyBooksConnectivity } from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';

describe('MyBooks offline tracking', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    useMyBooksStatusStore.setState({ isOffline: false });
  });

  it('marks the store offline when the host is unreachable', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    await expect(fetchMyBooks('/anything')).rejects.toThrow('Failed to fetch');

    expect(useMyBooksStatusStore.getState().isOffline).toBe(true);
  });

  it('clears the offline flag once a request reaches the server again', async () => {
    useMyBooksStatusStore.setState({ isOffline: true });
    vi.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ err: 'ok' }) } as Response);

    await fetchMyBooks('/anything');

    expect(useMyBooksStatusStore.getState().isOffline).toBe(false);
  });

  it('does not affect offline state when no host is configured', async () => {
    localStorage.removeItem('mybooks_host');
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    await expect(fetchMyBooks('/anything')).rejects.toThrow('Failed to fetch');

    expect(useMyBooksStatusStore.getState().isOffline).toBe(false);
  });
});

describe('checkMyBooksConnectivity', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('reports online and logged in when /user/info succeeds with is_login true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', user: { is_login: true } }),
    } as Response);

    expect(await checkMyBooksConnectivity()).toEqual({ online: true, needsLogin: false });
  });

  it('reports needsLogin when /user/info succeeds with is_login false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', user: { is_login: false } }),
    } as Response);

    expect(await checkMyBooksConnectivity()).toEqual({ online: true, needsLogin: true });
  });

  it('reports offline when the server cannot be reached', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    expect(await checkMyBooksConnectivity()).toEqual({ online: false, needsLogin: false });
  });

  it('reports online + needsLogin when the server responds with a logical error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'fail', msg: 'session expired' }),
    } as Response);

    expect(await checkMyBooksConnectivity()).toEqual({ online: true, needsLogin: true });
  });
});
