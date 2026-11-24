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

  it('verifies a cached id against whoami once, then short-circuits', async () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify({ id: 7, is_login: true }));
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ err: 'ok', userId: 7 }));
    const { ensureCurrentUserId } = await import('@/services/mybooksService');
    const { useMyBooksStatusStore } = await import('@/store/mybooksStatusStore');
    // Restored from the cache at module init, but not yet verified.
    expect(useMyBooksStatusStore.getState().currentUserId).toBe(7);

    expect(await ensureCurrentUserId()).toBe(7);
    await ensureCurrentUserId();
    expect(countWhoamiCalls(fetchSpy)).toBe(1);
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

  it('rejects the guest sentinel id', async () => {
    // Share/guest access answers `{userId: 999999, is_guest: true}`. Adopting
    // it would make the real account's own notes look foreign.
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ err: 'ok', userId: 999999, is_guest: true }),
    );
    const { ensureCurrentUserId } = await import('@/services/mybooksService');
    const { useMyBooksStatusStore } = await import('@/store/mybooksStatusStore');
    useMyBooksStatusStore.setState({ currentUserId: null });
    localStorage.setItem(
      'mybooks_user_info',
      JSON.stringify({ id: 1, is_login: true, username: 'alice' }),
    );

    expect(await ensureCurrentUserId()).toBeNull();
    expect(useMyBooksStatusStore.getState().currentUserId).toBeNull();
    // The cache must not be poisoned with the sentinel either.
    expect(JSON.parse(localStorage.getItem('mybooks_user_info')!)).toMatchObject({ id: 1 });
  });

  it('rejects an id that is not a positive safe integer', async () => {
    const body = { err: 'ok', userId: 7.5 as unknown };
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('/user/whoami') ? jsonResponse(body) : jsonResponse({}),
      );
    const { ensureCurrentUserId, resetCurrentUserId } = await import('@/services/mybooksService');

    expect(await ensureCurrentUserId()).toBeNull();

    resetCurrentUserId();
    body.userId = '7';
    expect(await ensureCurrentUserId()).toBeNull();
    expect(countWhoamiCalls(fetchSpy)).toBe(2);
  });

  it('coalesces concurrent lookups into one request', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ err: 'ok', userId: 7 }));
    const { ensureCurrentUserId } = await import('@/services/mybooksService');

    const [a, b] = await Promise.all([ensureCurrentUserId(), ensureCurrentUserId()]);
    expect([a, b]).toEqual([7, 7]);
    expect(countWhoamiCalls(fetchSpy)).toBe(1);
  });

  it('lets the freshly resolved id win over a stale cached one', async () => {
    // The cached `mybooks_user_info` may belong to a previous account; the
    // whoami answer for the current session is authoritative.
    localStorage.setItem(
      'mybooks_user_info',
      JSON.stringify({ id: 1, is_login: true, username: 'previous' }),
    );
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ err: 'ok', userId: 7 }));
    const { ensureCurrentUserId } = await import('@/services/mybooksService');

    expect(await ensureCurrentUserId()).toBe(7);
    expect(JSON.parse(localStorage.getItem('mybooks_user_info')!)).toMatchObject({
      id: 7,
      username: 'previous',
    });
  });

  it('resetCurrentUserId clears the id, the cache and the throttle', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ err: 'ok', userId: 7 }));
    const { ensureCurrentUserId, resetCurrentUserId } = await import('@/services/mybooksService');
    const { useMyBooksStatusStore } = await import('@/store/mybooksStatusStore');
    localStorage.setItem(
      'mybooks_user_info',
      JSON.stringify({ id: 1, is_login: true, username: 'previous' }),
    );

    expect(await ensureCurrentUserId()).toBe(7);
    resetCurrentUserId();
    expect(useMyBooksStatusStore.getState().currentUserId).toBeNull();
    expect(localStorage.getItem('mybooks_user_info')).toBeNull();

    // No 30s throttle after a reset: a login switch resolves immediately.
    expect(await ensureCurrentUserId()).toBe(7);
    expect(countWhoamiCalls(fetchSpy)).toBe(2);
  });
});
