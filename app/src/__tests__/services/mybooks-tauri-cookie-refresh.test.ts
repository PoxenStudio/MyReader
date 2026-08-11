import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => true),
}));

const tauriFetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => tauriFetchMock(...args),
}));

import { fetchMyBooks } from '@/services/mybooksService';
import {
  getTauriMyBooksCookie,
  clearTauriMyBooksCookie,
} from '@/services/mybooks/tauriCookieStore';

describe('fetchMyBooks opportunistically refreshes the Tauri cookie store', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'https://mybooks.example.com');
    clearTauriMyBooksCookie();
    tauriFetchMock.mockReset();
  });

  it('merges a Set-Cookie from any successful Tauri response into mybooks_tauri_cookie', async () => {
    // Regular (non-login, non-access-code) calls — e.g. /user/info — are the
    // only signal that the session is still alive after `mybooks_tauri_cookie`
    // was wiped out from under an otherwise-still-logged-in session (a "clear
    // app data" only clears localStorage, not plugin-http's own cookie jar or
    // the server-side session), so they need to opportunistically refresh it
    // too, not just login/access-code.
    tauriFetchMock.mockResolvedValue({
      json: async () => ({ err: 'ok' }),
      headers: {
        getSetCookie: () => ['user_id=abc123; Path=/; HttpOnly', 'invited=170000; Path=/'],
      },
    });

    await fetchMyBooks('/user/info');

    expect(getTauriMyBooksCookie()).toBe('user_id=abc123; invited=170000');
  });

  it('does nothing when the response carries no Set-Cookie', async () => {
    tauriFetchMock.mockResolvedValue({
      json: async () => ({ err: 'ok' }),
      headers: { getSetCookie: () => [] },
    });

    await fetchMyBooks('/user/info');

    expect(getTauriMyBooksCookie()).toBeNull();
  });
});
