import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import BookReadingStatsBanner from '@/components/metadata/BookReadingStatsBanner';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const { getBookReadingStatsMock } = vi.hoisted(() => ({
  getBookReadingStatsMock: vi.fn(),
}));

vi.mock('@/services/mybooksService', () => ({
  getBookReadingStats: getBookReadingStatsMock,
}));

const makeStat = (overrides?: Partial<Record<string, unknown>>) => ({
  format: 'epub',
  state: 0,
  total_seconds: 300,
  progress_current: 128,
  progress_total: 320,
  progress_percent: 40.0,
  start_time: '2026-08-20T09:12:33Z',
  finish_time: null,
  start_count: 2,
  update_time: '2026-08-30T13:05:11Z',
  ...overrides,
});

afterEach(() => {
  cleanup();
  getBookReadingStatsMock.mockReset();
});

describe('BookReadingStatsBanner', () => {
  it('shows the duration in bold minutes when under an hour', async () => {
    getBookReadingStatsMock.mockResolvedValue([makeStat({ total_seconds: 300 })]);

    render(<BookReadingStatsBanner bookId={42} format='epub' />);

    await waitFor(() => {
      expect(getBookReadingStatsMock).toHaveBeenCalledWith(42, 'epub');
    });

    // 300s / 60 = 5 minutes, rendered bold, no hours shown
    const minutes = await screen.findByText('5');
    expect(minutes.tagName).toBe('SPAN');
    expect(minutes.className).toMatch(/font-bold/);
    expect(screen.queryByText('0', { selector: 'span.font-bold' })).toBeNull();
  });

  it('shows hours and minutes, both bold, once the duration reaches an hour', async () => {
    // 5460s = 91 minutes = 1h 31m
    getBookReadingStatsMock.mockResolvedValue([makeStat({ total_seconds: 5460 })]);

    render(<BookReadingStatsBanner bookId={42} format='epub' />);

    await waitFor(() => {
      expect(getBookReadingStatsMock).toHaveBeenCalledWith(42, 'epub');
    });

    const hours = await screen.findByText('1');
    const minutes = await screen.findByText('31');
    expect(hours.className).toMatch(/font-bold/);
    expect(minutes.className).toMatch(/font-bold/);
  });

  it('shows the start date on the right', async () => {
    getBookReadingStatsMock.mockResolvedValue([
      makeStat({ total_seconds: 300, start_time: '2026-08-20T09:12:33Z' }),
    ]);

    render(<BookReadingStatsBanner bookId={42} format='epub' />);

    const dateText = await screen.findByText(/Started/);
    expect(dateText.textContent).toContain('Started');
  });

  it('renders nothing when there are no stats for the current format', async () => {
    getBookReadingStatsMock.mockResolvedValue([]);

    const { container } = render(<BookReadingStatsBanner bookId={42} format='pdf' />);

    await waitFor(() => {
      expect(getBookReadingStatsMock).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when bookId is not resolvable', () => {
    const { container } = render(<BookReadingStatsBanner bookId={0} format='epub' />);
    expect(getBookReadingStatsMock).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });
});
