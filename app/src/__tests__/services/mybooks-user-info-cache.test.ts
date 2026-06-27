import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { getUserInfo } from '@/services/mybooksService';

const user = {
  id: 1,
  username: 'alice',
  nickname: 'Alice',
  email: 'alice@example.com',
  avatar: '/avatars/alice.png',
  is_admin: false,
  is_login: true,
};

describe('getUserInfo caching for offline fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('caches the user info to localStorage on a successful fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', user }),
    } as Response);

    const result = await getUserInfo();

    expect(result).toEqual(user);
    expect(JSON.parse(localStorage.getItem('mybooks_user_info')!)).toEqual(user);
  });

  it('falls back to the cached user info when the mybooks server is unreachable', async () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify(user));
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    const result = await getUserInfo();

    expect(result).toEqual(user);
  });

  it('rethrows when the server is unreachable and there is no cached info', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    await expect(getUserInfo()).rejects.toThrow('Failed to fetch');
  });

  it('does not fall back to the cache when the server explicitly reports an API error', async () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify(user));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'fail', msg: 'session expired' }),
    } as Response);

    await expect(getUserInfo()).rejects.toThrow('session expired');
  });

  it('clears the cache once the server explicitly reports the user is logged out', async () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify(user));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', user: { is_login: false } }),
    } as Response);

    const result = await getUserInfo();

    expect(result).toBeNull();
    expect(localStorage.getItem('mybooks_user_info')).toBeNull();
  });
});
