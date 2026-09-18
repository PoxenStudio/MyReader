import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AppService } from '@/types/system';

// StatisticsDb.open() memoizes its open promise at module scope; reset the
// module between tests so each one starts from a clean sharedDb.
describe('StatisticsDb.open', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not permanently cache a rejected open (transient "not loaded" race, READEST-6)', async () => {
    const { StatisticsDb } = await import('@/services/statistics/statisticsDb');
    let calls = 0;
    const appService = {
      openDatabase: vi.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) throw new Error('database sqlite:/data/statistics.db not loaded');
        return {};
      }),
    } as unknown as AppService;

    await expect(StatisticsDb.open(appService)).rejects.toThrow('not loaded');

    const db = await StatisticsDb.open(appService);
    expect(db).toBeInstanceOf(StatisticsDb);
    expect(appService.openDatabase).toHaveBeenCalledTimes(2);
  });
});
