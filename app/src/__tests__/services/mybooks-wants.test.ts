import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { toggleWants } from '@/services/mybooksService';

describe('toggleWants', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('POSTs a JSON body with a boolean wants flag, not a query param', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({ json: async () => ({ err: 'ok' }) } as Response);

    await toggleWants(42, true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(String(url)).not.toContain('wants=');
    expect(String(url)).not.toContain('action=');
    expect(String(url)).toMatch(/\/book\/42\/wants/);
    expect(options).toMatchObject({ method: 'POST' });
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ wants: true });
  });

  it('supports cancelling wants with false', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({ json: async () => ({ err: 'ok' }) } as Response);

    await toggleWants(42, false);

    const [, options] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ wants: false });
  });
});
