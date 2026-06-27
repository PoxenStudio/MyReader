import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { updateReadState } from '@/services/mybooksService';

describe('updateReadState', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('POSTs a JSON body with read_state, not a query param', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({ json: async () => ({ err: 'ok' }) } as Response);

    await updateReadState(42, 2);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(String(url)).not.toContain('state=');
    expect(String(url)).toMatch(/\/book\/42\/readstate/);
    expect(options).toMatchObject({ method: 'POST' });
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ read_state: 2 });
  });
});
