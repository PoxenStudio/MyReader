import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAllNasCookies,
  getNasCookies,
  setNasCookies,
} from '@/services/mybooks/nasCookieStore';

describe('nasCookieStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('finds a cookie by its own domain scope even when unrelated to the login host it was captured under', () => {
    // Reproduces a real capture: login started at `ug.link`, but the login
    // flow redirected through unrelated domains before landing on
    // `app-8082-mybooks.cn57.ugdocker.link`, where the session cookie was
    // actually set. That host shares no suffix with the storage key
    // ("ug.link"), so a parent-domain walk from the storage key can never
    // reach it.
    setNasCookies('ug.link', [
      {
        name: 'ugreen-proxy-token',
        value: '25c9841e-9c94-435b-a32c-de00f7786159',
        domain: 'app-8082-mybooks.cn57.ugdocker.link',
      },
    ]);

    expect(getNasCookies('app-8082-mybooks.cn57.ugdocker.link')).toBe(
      'ugreen-proxy-token=25c9841e-9c94-435b-a32c-de00f7786159',
    );
  });

  it('still finds cookies via the classic same-lineage case (login host is a parent of the request host)', () => {
    setNasCookies('horkynas.fnos.net', [
      // No leading dot: the native side already strips it (see
      // `get_webview_cookies` in `commands.rs`) before this ever reaches JS.
      { name: 'session', value: 'abc', domain: 'horkynas.fnos.net' },
    ]);

    expect(getNasCookies('6289a9567efa-0.horkynas.fnos.net')).toBe('session=abc');
  });

  it('excludes a host-only cookie from a different record when the request host does not match that record’s login host', () => {
    setNasCookies('login.example.com', [{ name: 'token', value: 'xyz', domain: null }]);

    expect(getNasCookies('other.example.com')).toBeNull();
  });

  it('returns null when nothing applies', () => {
    expect(getNasCookies('nowhere.example.com')).toBeNull();
  });

  it('skips a record left over from an older storage schema instead of throwing', () => {
    // The very first shipped schema stored `{ cookieHeader, capturedAt }`
    // (no `cookies` array at all) — a device that captured NAS cookies on
    // that build still has a record like this sitting in `localStorage`.
    localStorage.setItem(
      'mybooks_nas_cookies',
      JSON.stringify({
        'legacy.example.com': { cookieHeader: 'token=old', capturedAt: 0 },
      }),
    );

    expect(() => getNasCookies('legacy.example.com')).not.toThrow();
    expect(getNasCookies('legacy.example.com')).toBeNull();
  });
});

describe('clearAllNasCookies', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('wipes every stored record, not just one host', () => {
    setNasCookies('a.example.com', [{ name: 'x', value: '1', domain: null }]);
    setNasCookies('b.example.com', [{ name: 'y', value: '2', domain: null }]);

    clearAllNasCookies();

    expect(getNasCookies('a.example.com')).toBeNull();
    expect(getNasCookies('b.example.com')).toBeNull();
  });
});
