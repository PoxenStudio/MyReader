import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { deleteBookFromMyBooks, MyBooksApiError } from '@/services/mybooksService';

describe('deleteBookFromMyBooks', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('POSTs to /book/<id>/delete', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({ json: async () => ({ err: 'ok' }) } as Response);

    await deleteBookFromMyBooks(42);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/book\/42\/delete/);
    expect(options).toMatchObject({ method: 'POST' });
  });

  it('throws a MyBooksApiError carrying the server msg when err is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'permission.denied', msg: '需要管理员权限' }),
    } as Response);

    await expect(deleteBookFromMyBooks(42)).rejects.toThrow(MyBooksApiError);
    await expect(deleteBookFromMyBooks(42)).rejects.toThrow('需要管理员权限');
  });
});
