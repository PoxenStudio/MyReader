import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

import ReadingStatsCard from '@/components/user/ReadingStatsCard';
import { getReadingStats } from '@/services/mybooksService';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/services/mybooksService', () => ({
  getReadingStats: vi.fn(),
}));

const mockedGetReadingStats = vi.mocked(getReadingStats);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReadingStatsCard', () => {
  it('renders nothing while closed — does not fetch', () => {
    render(<ReadingStatsCard isOpen={false} />);
    expect(mockedGetReadingStats).not.toHaveBeenCalled();
  });

  it('renders nothing when the feature is disabled/unavailable (null result)', async () => {
    mockedGetReadingStats.mockResolvedValue(null);
    const { container } = render(<ReadingStatsCard isOpen={true} />);
    await waitFor(() => expect(mockedGetReadingStats).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the fetch throws (e.g. permission denied)', async () => {
    mockedGetReadingStats.mockRejectedValue(new Error('permission denied'));
    const { container } = render(<ReadingStatsCard isOpen={true} />);
    await waitFor(() => expect(mockedGetReadingStats).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
    expect(container.textContent).toBe('');
  });

  it('shows total hours and a chart point per week on success', async () => {
    mockedGetReadingStats.mockResolvedValue({
      totals: { total_reading_seconds: 7200, download_count: 1, push_count: 0 },
      weekly: [
        { week_start: '2026-07-13', reading_seconds: 3600, download_count: 0, push_count: 0 },
        { week_start: '2026-07-20', reading_seconds: 0, download_count: 0, push_count: 0 },
        { week_start: '2026-07-27', reading_seconds: 1800, download_count: 0, push_count: 0 },
      ],
      book_status: { reading: 1, to_read: 2, finished: 3 },
    });

    render(<ReadingStatsCard isOpen={true} />);

    // 7200s = 2.0 hours
    await screen.findByText('2');
    screen.getByText('.0');
    screen.getByText('Reading Stats');
    screen.getByText('07-13');
    screen.getByText('07-27');
    expect(document.querySelectorAll('circle')).toHaveLength(3);
  });
});
