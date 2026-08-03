import { describe, expect, it, beforeEach } from 'vitest';
import { getNasCookies, setNasCookies, clearNasCookies } from '@/services/mybooks/nasCookieStore';

describe('nasCookieStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null for a host with no stored cookies', () => {
    expect(getNasCookies('nas.example.com')).toBeNull();
  });

  it('persists and retrieves cookies keyed by host', () => {
    setNasCookies('nas.example.com', 'sid=abc123; token=xyz');
    expect(getNasCookies('nas.example.com')).toBe('sid=abc123; token=xyz');
    expect(getNasCookies('other.example.com')).toBeNull();
  });

  it('overwrites a previous record for the same host', () => {
    setNasCookies('nas.example.com', 'sid=old');
    setNasCookies('nas.example.com', 'sid=new');
    expect(getNasCookies('nas.example.com')).toBe('sid=new');
  });

  it('clears cookies only for the given host', () => {
    setNasCookies('nas.example.com', 'sid=abc123');
    setNasCookies('other.example.com', 'sid=def456');
    clearNasCookies('nas.example.com');
    expect(getNasCookies('nas.example.com')).toBeNull();
    expect(getNasCookies('other.example.com')).toBe('sid=def456');
  });

  it('normalizes host casing so lookups are case-insensitive', () => {
    setNasCookies('NAS.Example.com', 'sid=abc123');
    expect(getNasCookies('nas.example.com')).toBe('sid=abc123');
  });
});
