import { describe, expect, it, beforeEach } from 'vitest';
import {
  extractCookieHeaderFromResponse,
  getTauriMyBooksCookie,
  setTauriMyBooksCookie,
  clearTauriMyBooksCookie,
  mergeTauriMyBooksCookie,
  hasTauriMyBooksCookieNamed,
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

describe('mergeTauriMyBooksCookie', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores the cookie when nothing was persisted yet', () => {
    mergeTauriMyBooksCookie('invited=170000');
    expect(getTauriMyBooksCookie()).toBe('invited=170000');
  });

  it('adds new cookie pairs without dropping previously captured ones', () => {
    // e.g. the "invited" cookie captured from /api/access, followed later by
    // the session cookie captured at sign-in — neither capture should erase
    // the other.
    setTauriMyBooksCookie('invited=170000');
    mergeTauriMyBooksCookie('user_id=abc123');
    expect(getTauriMyBooksCookie()).toBe('invited=170000; user_id=abc123');
  });

  it('overwrites a cookie with the same name instead of duplicating it', () => {
    setTauriMyBooksCookie('invited=170000; user_id=abc123');
    mergeTauriMyBooksCookie('user_id=xyz789');
    expect(getTauriMyBooksCookie()).toBe('invited=170000; user_id=xyz789');
  });
});

describe('hasTauriMyBooksCookieNamed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false when nothing is stored', () => {
    expect(hasTauriMyBooksCookieNamed('invited')).toBe(false);
  });

  it('returns false when the named cookie is absent', () => {
    setTauriMyBooksCookie('user_id=abc123');
    expect(hasTauriMyBooksCookieNamed('invited')).toBe(false);
  });

  it('returns true when the named cookie is present', () => {
    setTauriMyBooksCookie('user_id=abc123; invited=170000');
    expect(hasTauriMyBooksCookieNamed('invited')).toBe(true);
  });

  it('does not match a name that is only a substring of another cookie name', () => {
    setTauriMyBooksCookie('not_invited_marker=1');
    expect(hasTauriMyBooksCookieNamed('invited')).toBe(false);
  });
});
