import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { getBookReadingStats, getReadingStats } from '@/services/mybooksService';

describe('getReadingStats', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('GETs /user/reading_stats with no uid for the current user', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        err: 'ok',
        enabled: true,
        totals: { total_reading_seconds: 3600, download_count: 1, push_count: 0 },
        weekly: [
          { week_start: '2026-08-03', reading_seconds: 1200, download_count: 0, push_count: 0 },
        ],
        book_status: { reading: 1, to_read: 2, finished: 3 },
      }),
    } as Response);

    const stats = await getReadingStats();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/user\/reading_stats/);
    expect(String(url)).not.toContain('uid=');
    expect(stats).toEqual({
      totals: { total_reading_seconds: 3600, download_count: 1, push_count: 0 },
      weekly: [
        { week_start: '2026-08-03', reading_seconds: 1200, download_count: 0, push_count: 0 },
      ],
      book_status: { reading: 1, to_read: 2, finished: 3 },
    });
  });

  it('forwards uid as a query param when provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', enabled: false }),
    } as Response);

    await getReadingStats(7);

    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('uid=7');
  });

  it('returns null when the feature is disabled server-side', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', enabled: false }),
    } as Response);

    const stats = await getReadingStats();

    expect(stats).toBeNull();
  });
});

describe('getBookReadingStats', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('GETs /book/<id>/reading_stats with the format filter applied', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        err: 'ok',
        stats: [
          {
            format: 'epub',
            state: 0,
            total_seconds: 5460,
            progress_current: 128,
            progress_total: 320,
            progress_percent: 40.0,
            start_time: '2026-08-20T09:12:33Z',
            finish_time: null,
            start_count: 2,
            update_time: '2026-08-30T13:05:11Z',
          },
        ],
      }),
    } as Response);

    const stats = await getBookReadingStats(42, 'epub');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/book\/42\/reading_stats/);
    expect(String(url)).toContain('format=epub');
    expect(stats).toEqual([
      {
        format: 'epub',
        state: 0,
        total_seconds: 5460,
        progress_current: 128,
        progress_total: 320,
        progress_percent: 40.0,
        start_time: '2026-08-20T09:12:33Z',
        finish_time: null,
        start_count: 2,
        update_time: '2026-08-30T13:05:11Z',
      },
    ]);
  });

  it('returns an empty array when the format has no stats', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', stats: [] }),
    } as Response);

    const stats = await getBookReadingStats(42, 'pdf');

    expect(stats).toEqual([]);
  });
});
