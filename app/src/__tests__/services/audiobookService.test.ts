import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { getAudiobooks, getAudioBookDetail } from '@/services/audiobook/audiobookService';

describe('getAudiobooks', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('hits /audiobooks with start/size pagination params', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', books: [{ id: 1 }], total: 1 }),
    } as Response);

    const result = await getAudiobooks(2, 10);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/audiobooks(\?|$)/);
    expect(String(url)).toContain('start=10');
    expect(String(url)).toContain('size=10');
    expect(result).toEqual({ books: [{ id: 1 }], total: 1 });
  });
});

describe('getAudioBookDetail', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
  });

  it('fetches /audio/<id> and normalizes the response', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        err: 'ok',
        audios: [{ filename: 'ch1', url: '/api/audio/5/ch1.mp3', size: 123 }],
        total_files: 1,
        is_paid: true,
      }),
    } as Response);

    const detail = await getAudioBookDetail(5);

    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/\/audio\/5(\?|$)/);
    expect(detail).toEqual({
      audios: [{ filename: 'ch1', url: '/api/audio/5/ch1.mp3', size: 123 }],
      total_files: 1,
      is_paid: true,
    });
  });

  it('defaults missing fields to empty/safe values', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok' }),
    } as Response);

    const detail = await getAudioBookDetail(5);

    expect(detail).toEqual({ audios: [], total_files: 0, is_paid: true });
  });
});
