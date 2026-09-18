import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => null,
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (s: unknown) => unknown) => selector({ getBookData: () => null }),
}));

const openError = vi.hoisted(() => new Error('database sqlite:/data/statistics.db not loaded'));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: vi.fn().mockRejectedValue(openError) },
}));

import ReadingStatsTracker from '@/app/reader/components/ReadingStatsTracker';

describe('ReadingStatsTracker', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('a rejected StatisticsDb.open() is handled, not an unhandled rejection', async () => {
    render(<ReadingStatsTracker bookKey='book-1' />);

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith('[stats] failed to open statistics DB:', openError),
    );
  });
});
