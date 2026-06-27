import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { PiUserCircle } from 'react-icons/pi';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import UserAvatar from '@/components/UserAvatar';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('UserAvatar', () => {
  beforeEach(() => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
  });

  it('never renders a direct cross-origin <img src> in Tauri mode (avoids CORP-blocked loads)', async () => {
    const directUrl = 'http://127.0.0.1:8082/avatar/1.png';
    vi.mocked(tauriFetch).mockImplementation(
      () => new Promise(() => {}) as unknown as ReturnType<typeof tauriFetch>,
    );

    const { container } = render(
      <UserAvatar url={directUrl} size={48} DefaultIcon={PiUserCircle} />,
    );

    const img = container.querySelector('img');
    expect(img).toBeNull();
  });

  it('fetches the avatar via tauriFetch (not a markup-triggered request) in Tauri mode', async () => {
    const directUrl = 'http://127.0.0.1:8082/avatar/1.png';
    const blob = new Blob(['fake-bytes'], { type: 'image/png' });
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      blob: async () => blob,
    } as unknown as Response);

    const { container } = render(
      <UserAvatar url={directUrl} size={48} DefaultIcon={PiUserCircle} />,
    );

    await waitFor(() => {
      expect(tauriFetch).toHaveBeenCalledWith(directUrl);
    });
    await waitFor(() => {
      expect(container.querySelector('img')).toBeTruthy();
    });
  });

  it('keeps showing the default icon (and does not cache) when tauriFetch returns a non-image response', async () => {
    const directUrl = 'http://127.0.0.1:8082/avatar/1.png';
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'text/html' }),
      blob: async () => new Blob(['<html>login</html>'], { type: 'text/html' }),
    } as unknown as Response);

    const { container } = render(
      <UserAvatar url={directUrl} size={48} DefaultIcon={PiUserCircle} />,
    );

    await waitFor(() => {
      expect(tauriFetch).toHaveBeenCalled();
    });
    expect(container.querySelector('img')).toBeNull();
    expect(
      localStorage.getItem(`avatar_${btoa(directUrl).replace(/[^a-zA-Z0-9]/g, '')}`),
    ).toBeNull();
  });

  it('discards a stale non-image cache entry and refetches instead of getting stuck on the default icon', async () => {
    const directUrl = 'http://127.0.0.1:8082/avatar/1.png';
    const storageKey = `avatar_${btoa(directUrl).replace(/[^a-zA-Z0-9]/g, '')}`;
    // Simulates a cache entry written before response validation existed —
    // a data URI of an HTML login page rather than an actual image.
    localStorage.setItem(storageKey, 'data:application/octet-stream;base64,PCFkb2N0eXBlIGh0bWw+');

    const blob = new Blob(['fake-bytes'], { type: 'image/png' });
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      blob: async () => blob,
    } as unknown as Response);

    const { container } = render(
      <UserAvatar url={directUrl} size={48} DefaultIcon={PiUserCircle} />,
    );

    await waitFor(() => {
      expect(tauriFetch).toHaveBeenCalledWith(directUrl);
    });
    await waitFor(() => {
      expect(container.querySelector('img')).toBeTruthy();
    });
  });

  it('uses plain fetch with the proxy URL on web', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    const proxyUrl = '/api/mybooks/avatar/avatar/1.png?host=http%3A%2F%2F127.0.0.1%3A8082';
    const blob = new Blob(['fake-bytes'], { type: 'image/png' });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      blob: async () => blob,
    } as unknown as Response);

    render(<UserAvatar url={proxyUrl} size={48} DefaultIcon={PiUserCircle} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(proxyUrl, { referrerPolicy: 'no-referrer' });
    });
  });
});
