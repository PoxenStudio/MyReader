import { describe, expect, it, vi, beforeEach } from 'vitest';

const { isTauriAppPlatform } = vi.hoisted(() => ({ isTauriAppPlatform: vi.fn(() => true) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform }));

const tauriFetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => tauriFetchMock(...args),
}));

// The feature is currently disabled via SILENT_ACCESS_CODE_REFRESH_ENABLED
// (see mybooks/constants.ts). Force it on here so the tests below can still
// exercise the actual re-validation/merge behavior.
vi.mock('@/services/mybooks/constants', () => ({
  SILENT_ACCESS_CODE_REFRESH_ENABLED: true,
}));

import { refreshTauriAccessCodeCookie } from '@/services/mybooks/accessCodeRefresh';
import {
  getTauriMyBooksCookie,
  clearTauriMyBooksCookie,
} from '@/services/mybooks/tauriCookieStore';
import {
  setStoredMyBooksAccessCode,
  clearStoredMyBooksAccessCode,
} from '@/utils/credentialStorage';

describe('refreshTauriAccessCodeCookie', () => {
  beforeEach(() => {
    localStorage.clear();
    clearTauriMyBooksCookie();
    clearStoredMyBooksAccessCode();
    tauriFetchMock.mockReset();
    isTauriAppPlatform.mockReturnValue(true);
  });

  it('does nothing when no access code was remembered', async () => {
    await refreshTauriAccessCodeCookie('https://mybooks.example.com');

    expect(tauriFetchMock).not.toHaveBeenCalled();
  });

  it('silently re-validates the remembered code and merges the invited cookie in', async () => {
    setStoredMyBooksAccessCode('my-code');
    tauriFetchMock.mockResolvedValue({
      json: async () => ({ err: 'ok' }),
      headers: { getSetCookie: () => ['invited=170000; Path=/'] },
    });

    await refreshTauriAccessCodeCookie('https://mybooks.example.com');

    expect(tauriFetchMock).toHaveBeenCalledWith(
      'https://mybooks.example.com/api/access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ invite_code: 'my-code' }),
      }),
    );
    expect(getTauriMyBooksCookie()).toBe('invited=170000');
  });

  it('does not clobber an already-stored session cookie', async () => {
    setStoredMyBooksAccessCode('my-code');
    const { setTauriMyBooksCookie } = await import('@/services/mybooks/tauriCookieStore');
    setTauriMyBooksCookie('user_id=abc123');
    tauriFetchMock.mockResolvedValue({
      json: async () => ({ err: 'ok' }),
      headers: { getSetCookie: () => ['invited=170000; Path=/'] },
    });

    await refreshTauriAccessCodeCookie('https://mybooks.example.com');

    expect(getTauriMyBooksCookie()).toBe('user_id=abc123; invited=170000');
  });

  it('does nothing on the web platform', async () => {
    isTauriAppPlatform.mockReturnValue(false);
    setStoredMyBooksAccessCode('my-code');

    await refreshTauriAccessCodeCookie('https://mybooks.example.com');

    expect(tauriFetchMock).not.toHaveBeenCalled();
  });

  it('swallows a failed re-validation without throwing', async () => {
    setStoredMyBooksAccessCode('my-code');
    tauriFetchMock.mockResolvedValue({
      json: async () => ({ err: 'params.invalid', msg: '访问码无效' }),
      headers: { getSetCookie: () => [] },
    });

    await expect(
      refreshTauriAccessCodeCookie('https://mybooks.example.com'),
    ).resolves.toBeUndefined();
    expect(getTauriMyBooksCookie()).toBeNull();
  });

  it('swallows a network error without throwing', async () => {
    setStoredMyBooksAccessCode('my-code');
    tauriFetchMock.mockRejectedValue(new Error('offline'));

    await expect(
      refreshTauriAccessCodeCookie('https://mybooks.example.com'),
    ).resolves.toBeUndefined();
  });
});
