import { describe, expect, it } from 'vitest';
import { isNasSessionExpired, shouldAutoPromptNasLogin } from '@/services/mybooks/nasSession';
import { NasDeviceSettings } from '@/types/settings';

describe('isNasSessionExpired', () => {
  it('treats a never-logged-in session (null) as expired', () => {
    expect(isNasSessionExpired(null, 10, 0)).toBe(true);
  });

  it('is not expired well before the expiry window', () => {
    const lastLoginAt = 0;
    const now = 3 * 60_000; // 3 minutes in, expiry 10 min => not expired
    expect(isNasSessionExpired(lastLoginAt, 10, now)).toBe(false);
  });

  it('treats the last 2 minutes before expiry as expired (lead time)', () => {
    const lastLoginAt = 0;
    const now = 9 * 60_000; // 9 minutes in, expiry 10 min, lead 2 min => threshold at 8 min
    expect(isNasSessionExpired(lastLoginAt, 10, now)).toBe(true);
  });

  it('is expired once past the raw expiry time', () => {
    const lastLoginAt = 0;
    const now = 11 * 60_000;
    expect(isNasSessionExpired(lastLoginAt, 10, now)).toBe(true);
  });
});

describe('shouldAutoPromptNasLogin', () => {
  const base: NasDeviceSettings = {
    enabled: true,
    vendor: 'other',
    loginUrl: 'https://nas.example.com',
    expiryMinutes: 10,
    autoPromptOnExpiry: true,
    lastLoginAt: 0,
  };

  it('returns false when NAS access is disabled', () => {
    expect(shouldAutoPromptNasLogin({ ...base, enabled: false }, 11 * 60_000)).toBe(false);
  });

  it('returns false when auto-prompt is off, even if expired', () => {
    expect(shouldAutoPromptNasLogin({ ...base, autoPromptOnExpiry: false }, 11 * 60_000)).toBe(
      false,
    );
  });

  it('returns true when enabled, auto-prompt is on, and the session is expired', () => {
    expect(shouldAutoPromptNasLogin(base, 11 * 60_000)).toBe(true);
  });

  it('returns false when enabled, auto-prompt is on, but the session is still fresh', () => {
    expect(shouldAutoPromptNasLogin(base, 1 * 60_000)).toBe(false);
  });
});
