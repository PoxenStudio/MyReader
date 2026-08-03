import { describe, expect, it, beforeEach } from 'vitest';
import { getNasCookies, setNasCookies, clearNasCookies } from '@/services/mybooks/nasCookieStore';
import { NasCookieEntry } from '@/utils/bridge';

const hostOnly = (name: string, value: string): NasCookieEntry => ({ name, value, domain: null });
const domainScoped = (name: string, value: string, domain: string): NasCookieEntry => ({
  name,
  value,
  domain,
});

describe('nasCookieStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null for a host with no stored cookies', () => {
    expect(getNasCookies('nas.example.com')).toBeNull();
  });

  it('persists and retrieves host-only cookies for the exact host', () => {
    setNasCookies('nas.example.com', [hostOnly('sid', 'abc123'), hostOnly('token', 'xyz')]);
    expect(getNasCookies('nas.example.com')).toBe('sid=abc123; token=xyz');
    expect(getNasCookies('other.example.com')).toBeNull();
  });

  it('overwrites a previous record for the same host', () => {
    setNasCookies('nas.example.com', [hostOnly('sid', 'old')]);
    setNasCookies('nas.example.com', [hostOnly('sid', 'new')]);
    expect(getNasCookies('nas.example.com')).toBe('sid=new');
  });

  it('clears cookies only for the given host', () => {
    setNasCookies('nas.example.com', [hostOnly('sid', 'abc123')]);
    setNasCookies('other.example.com', [hostOnly('sid', 'def456')]);
    clearNasCookies('nas.example.com');
    expect(getNasCookies('nas.example.com')).toBeNull();
    expect(getNasCookies('other.example.com')).toBe('sid=def456');
  });

  it('normalizes host casing so lookups are case-insensitive', () => {
    setNasCookies('NAS.Example.com', [hostOnly('sid', 'abc123')]);
    expect(getNasCookies('nas.example.com')).toBe('sid=abc123');
  });

  it('replays a domain-scoped cookie to a subdomain of the capture host', () => {
    setNasCookies('horkynas.fnos.net', [
      domainScoped('entry-token', 'tok123', 'horkynas.fnos.net'),
    ]);
    expect(getNasCookies('6289a9567efa-0.horkynas.fnos.net')).toBe('entry-token=tok123');
  });

  it('excludes a host-only cookie when the requested host is a different subdomain', () => {
    // Mirrors what a real NAS login sets: some cookies host-only to the
    // login host, one domain-scoped to cover the dynamic relay subdomain.
    setNasCookies('horkynas.fnos.net', [
      hostOnly('sid', 'abc'),
      domainScoped('entry-token', 'tok123', 'horkynas.fnos.net'),
    ]);
    expect(getNasCookies('6289a9567efa-0.horkynas.fnos.net')).toBe('entry-token=tok123');
    expect(getNasCookies('horkynas.fnos.net')).toBe('sid=abc; entry-token=tok123');
  });

  it('does not match unrelated sibling subdomains via the parent-domain fallback', () => {
    setNasCookies('nas.example.com', [hostOnly('sid', 'abc123')]);
    expect(getNasCookies('other.example.com')).toBeNull();
  });

  it('never stores fnos-long-token, even when the webview captured it', () => {
    setNasCookies('horkynas.fnos.net', [
      hostOnly('fnos-long-token', 'shouldnotbesaved'),
      domainScoped('entry-token', 'tok123', 'horkynas.fnos.net'),
    ]);
    expect(getNasCookies('horkynas.fnos.net')).toBe('entry-token=tok123');
  });

  it('filters excluded cookie names out of records saved before the exclusion existed', () => {
    // Simulates localStorage data written by an older version of this
    // module, before `fnos-long-token` (and friends) were excluded.
    localStorage.setItem(
      'mybooks_nas_cookies',
      JSON.stringify({
        'horkynas.fnos.net': {
          cookies: [
            hostOnly('fnos-long-token', 'stale'),
            hostOnly('fnos-token', 'stale'),
            domainScoped('entry-token', 'tok123', 'horkynas.fnos.net'),
          ],
          capturedAt: Date.now(),
        },
      }),
    );
    expect(getNasCookies('horkynas.fnos.net')).toBe('entry-token=tok123');
  });
});
