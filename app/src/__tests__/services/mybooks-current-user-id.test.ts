import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

const jsonResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  }) as unknown as Response;

// Importing the stores pulls in i18n, which fetches the locale JSON; only
// count the whoami requests themselves.
const countWhoamiCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([input]) => String(input).includes('/user/whoami')).length;

describe('ensureCurrentUserId', () => {
  beforeEach(() => {
    // Module-level throttle/promise state must not leak between cases.
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('resolves the id from /user/whoami and mirrors it into the store', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ err: 'ok', userId: 7 }));

    const { ensureCurrentUserId } = await import('@/services/mybooksService');
    const { useMyBooksStatusStore } = await import('@/store/mybooksStatusStore');
    useMyBooksStatusStore.setState({ currentUserId: null });

    expect(await ensureCurrentUserId()).toBe(7);
    expect(useMyBooksStatusStore.getState().currentUserId).toBe(7);
    expect(countWhoamiCalls(fetchSpy)).toBe(1);
    expect(
      String(fetchSpy.mock.calls.find(([input]) => String(input).includes('/user/whoami'))![0]),
    ).toContain('/api/mybooks/proxy/user/whoami');
  });

  it('caches the resolved id into mybooks_user_info for the next launch', async () => {
    localStorage.setItem(
      'mybooks_user_info',
      JSON.stringify({ is_login: true, username: 'alice' }),
    );
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ err: 'ok', userId: 7 }));

    const { ensureCurrentUserId } = await import('@/services/mybooksService');
    await ensureCurrentUserId();

    expect(JSON.parse(localStorage.getItem('mybooks_user_info')!)).toMatchObject({
      id: 7,
      username: 'alice',
    });
  });

  it('returns the already-known id without another request', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const { ensureCurrentUserId } = await import('@/services/mybooksService');
    const { useMyBooksStatusStore } = await import('@/store/mybooksStatusStore');
    useMyBooksStatusStore.setState({ currentUserId: 3 });

    expect(await ensureCurrentUserId()).toBe(3);
    expect(countWhoamiCalls(fetchSpy)).toBe(0);
  });

  it('returns null and keeps the store unchanged when the lookup fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ err: 'user.need_login', msg: 'login required' }),
    );
    const { ensureCurrentUserId } = await import('@/services/mybooksService');
    const { useMyBooksStatusStore } = await import('@/store/mybooksStatusStore');
    useMyBooksStatusStore.setState({ currentUserId: null });

    expect(await ensureCurrentUserId()).toBeNull();
    expect(useMyBooksStatusStore.getState().currentUserId).toBeNull();
  });

  it('throttles retries after a failed lookup', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ err: 'user.need_login', msg: 'login required' }));
    const { ensureCurrentUserId } = await import('@/services/mybooksService');

    expect(await ensureCurrentUserId()).toBeNull();
    expect(await ensureCurrentUserId()).toBeNull();
    expect(countWhoamiCalls(fetchSpy)).toBe(1);
  });
});
