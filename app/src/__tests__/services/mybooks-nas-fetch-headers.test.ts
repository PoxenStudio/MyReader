import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => true),
}));

const tauriFetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => tauriFetchMock(...args),
}));

import { fetchMyBooks } from '@/services/mybooksService';
import { useSettingsStore } from '@/store/settingsStore';
import { setNasCookies } from '@/services/mybooks/nasCookieStore';
import {
  setTauriMyBooksCookie,
  clearTauriMyBooksCookie,
} from '@/services/mybooks/tauriCookieStore';
import { SystemSettings, NasDeviceSettings } from '@/types/settings';

const makeNasSettings = (overrides: Partial<NasDeviceSettings> = {}): NasDeviceSettings => ({
  enabled: true,
  vendor: 'other',
  loginUrl: 'https://nas.example.com/login',
  expiryMinutes: 60,
  autoPromptOnExpiry: false,
  lastLoginAt: Date.now(),
  ...overrides,
});

describe('fetchMyBooks NAS cookie header (Tauri only)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'https://mybooks.example.com');
    clearTauriMyBooksCookie();
    tauriFetchMock.mockReset();
    tauriFetchMock.mockResolvedValue({ json: async () => ({ err: 'ok' }) });
    useSettingsStore.setState({ settings: {} as SystemSettings });
  });

  it('merges the regular MyBooks session cookie with the NAS relay cookie, instead of dropping the session cookie', async () => {
    // Setting a `Cookie` header at all suppresses plugin-http's own
    // automatic one for this request, so the session cookie (normally
    // replayed from plugin-http's jar without any help) has to be included
    // explicitly here too, alongside the NAS relay cookie — otherwise a
    // NAS-gated request authenticates at the relay but arrives at MyBooks
    // itself with no session cookie, and the server treats it as logged out.
    setTauriMyBooksCookie('session=abc123');
    setNasCookies('nas.example.com', [
      { name: 'nas-token', value: 'xyz', domain: 'mybooks.example.com' },
    ]);
    useSettingsStore.setState({
      settings: { nas: makeNasSettings() } as SystemSettings,
    });

    await fetchMyBooks('/search');

    expect(tauriFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/search'),
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session=abc123; nas-token=xyz' }),
      }),
    );
  });

  it('sends only the NAS cookie when no MyBooks session cookie has been captured yet', async () => {
    setNasCookies('nas.example.com', [
      { name: 'nas-token', value: 'xyz', domain: 'mybooks.example.com' },
    ]);
    useSettingsStore.setState({
      settings: { nas: makeNasSettings() } as SystemSettings,
    });

    await fetchMyBooks('/search');

    expect(tauriFetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'nas-token=xyz' }) }),
    );
  });

  it('does not attach a Cookie header at all when NAS login is disabled, leaving plugin-http free to use its own jar', async () => {
    setTauriMyBooksCookie('session=abc123');
    useSettingsStore.setState({
      settings: { nas: makeNasSettings({ enabled: false }) } as SystemSettings,
    });

    await fetchMyBooks('/search');

    const [, options] = tauriFetchMock.mock.calls[0]!;
    expect((options as RequestInit).headers).toBeUndefined();
  });
});
