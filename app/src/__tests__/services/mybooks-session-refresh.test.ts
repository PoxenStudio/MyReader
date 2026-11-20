import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { fetchMyBooks } from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';

const sysInfo = (version: string) => ({
  title: 'MyBooks',
  books: 0,
  version,
  upgrable: '',
  defaultPageSize: 20,
  aiEnabled: false,
});

const setLoggedIn = (version: string) => {
  localStorage.setItem('mybooks_host', 'http://mybooks.local');
  localStorage.setItem('token', 'session-token');
  useMyBooksStatusStore.setState({ sysInfo: sysInfo(version) });
};

const jsonResponse = (body: unknown): Response =>
  ({ status: 200, json: async () => body }) as Response;

describe('MyBooks session auto refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    useMyBooksStatusStore.setState({ sysInfo: null, isOffline: false });
    vi.restoreAllMocks();
  });

  it('refreshes the session and replays the request when the server reports need_login', async () => {
    setLoggedIn('v4.8.0');
    let foldersCalls = 0;
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/user/refresh')) return jsonResponse({ err: 'ok' });
      foldersCalls++;
      return jsonResponse(
        foldersCalls === 1 ? { err: 'user.need_login' } : { err: 'ok', folders: [] },
      );
    });

    const rsp = await fetchMyBooks('/folders');

    expect(rsp.err).toBe('ok');
    expect(foldersCalls).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/user/refresh'))).toBe(true);
  });

  it('refreshes when /user/info reports a logged-out user', async () => {
    setLoggedIn('v4.8.0');
    let infoCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/user/refresh')) return jsonResponse({ err: 'ok' });
      infoCalls++;
      return jsonResponse(
        infoCalls === 1
          ? { err: 'ok', user: { is_login: false, is_guest: false } }
          : { err: 'ok', user: { is_login: true, is_guest: false } },
      );
    });

    const rsp = await fetchMyBooks('/user/info');

    expect(rsp.user?.is_login).toBe(true);
    expect(infoCalls).toBe(2);
  });

  it('refreshes when an expired session is reported as a guest', async () => {
    setLoggedIn('v4.8.0');
    let infoCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/user/refresh')) return jsonResponse({ err: 'ok' });
      infoCalls++;
      return jsonResponse(
        infoCalls === 1
          ? { err: 'ok', user: { is_login: false, is_guest: true } }
          : { err: 'ok', user: { is_login: true, is_guest: false } },
      );
    });

    const rsp = await fetchMyBooks('/user/info');

    expect(rsp.user?.is_login).toBe(true);
    expect(infoCalls).toBe(2);
  });

  it('does not refresh against servers older than v4.8.0', async () => {
    setLoggedIn('v4.7.0');
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ err: 'user.need_login' }));

    await expect(fetchMyBooks('/folders')).rejects.toMatchObject({ err: 'user.need_login' });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/user/refresh'))).toBe(false);
  });

  it('does not refresh in guest mode', async () => {
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    localStorage.setItem('token', 'guest');
    localStorage.setItem('mybooks_is_guest', 'true');
    useMyBooksStatusStore.setState({ sysInfo: sysInfo('v4.8.0') });
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ err: 'user.need_login' }));

    await expect(fetchMyBooks('/folders')).rejects.toMatchObject({ err: 'user.need_login' });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/user/refresh'))).toBe(false);
  });

  it('does not retry more than once when the refreshed session is still rejected', async () => {
    setLoggedIn('v4.8.0');
    let foldersCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/user/refresh')) return jsonResponse({ err: 'ok' });
      foldersCalls++;
      return jsonResponse({ err: 'user.need_login' });
    });

    await expect(fetchMyBooks('/folders')).rejects.toMatchObject({ err: 'user.need_login' });

    expect(foldersCalls).toBe(2);
  });
});
