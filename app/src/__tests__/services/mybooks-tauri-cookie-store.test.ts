import { describe, expect, it, beforeEach } from 'vitest';
import {
  extractCookieHeaderFromResponse,
  getTauriMyBooksCookie,
  setTauriMyBooksCookie,
  clearTauriMyBooksCookie,
} from '@/services/mybooks/tauriCookieStore';

describe('tauriCookieStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and clears the cookie value', () => {
    expect(getTauriMyBooksCookie()).toBeNull();
    setTauriMyBooksCookie('user_id=abc123');
    expect(getTauriMyBooksCookie()).toBe('user_id=abc123');
    clearTauriMyBooksCookie();
    expect(getTauriMyBooksCookie()).toBeNull();
  });

  it('extracts name=value pairs via getSetCookie(), dropping attributes', () => {
    const response = {
      headers: {
        getSetCookie: () => ['user_id=abc123; Path=/; HttpOnly', 'admin_id=0; Path=/'],
        get: () => null,
      },
    } as unknown as Response;

    expect(extractCookieHeaderFromResponse(response)).toBe('user_id=abc123; admin_id=0');
  });

  it('falls back to a single set-cookie header when getSetCookie is unavailable', () => {
    const response = {
      headers: {
        get: (name: string) => (name === 'set-cookie' ? 'user_id=abc123; Path=/' : null),
      },
    } as unknown as Response;

    expect(extractCookieHeaderFromResponse(response)).toBe('user_id=abc123');
  });

  it('returns null when there is no Set-Cookie header', () => {
    const response = {
      headers: { get: () => null },
    } as unknown as Response;

    expect(extractCookieHeaderFromResponse(response)).toBeNull();
  });
});
