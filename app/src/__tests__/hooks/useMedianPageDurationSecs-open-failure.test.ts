import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

const openError = vi.hoisted(() => new Error('database sqlite:/data/statistics.db not loaded'));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: vi.fn().mockRejectedValue(openError) },
}));

import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';

describe('useMedianPageDurationSecs', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a rejected StatisticsDb.open() is handled, not an unhandled rejection', async () => {
    const { result } = renderHook(() => useMedianPageDurationSecs('md5-1'));

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        '[stats] failed to load median page duration:',
        openError,
      ),
    );
    expect(result.current).toBeNull();
  });
});
