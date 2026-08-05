import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrCreateCoverObjectUrl,
  peekCachedCoverObjectUrl,
  __resetCoverObjectUrlCacheForTests,
} from '@/utils/coverObjectUrlCache';

beforeEach(() => {
  __resetCoverObjectUrlCacheForTests();
  vi.stubGlobal('URL', { ...URL, revokeObjectURL: vi.fn() });
});

describe('coverObjectUrlCache', () => {
  it('resolves to the object URL produced by the factory', async () => {
    const url = await getOrCreateCoverObjectUrl('cover-1', async () => 'blob:one');
    expect(url).toBe('blob:one');
  });

  it('reuses a previously resolved object URL instead of calling the factory again', async () => {
    const factory = vi.fn(async () => 'blob:one');
    await getOrCreateCoverObjectUrl('cover-1', factory);
    await getOrCreateCoverObjectUrl('cover-1', factory);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('makes a resolved URL visible via peekCachedCoverObjectUrl for synchronous reads', async () => {
    expect(peekCachedCoverObjectUrl('cover-1')).toBeUndefined();
    await getOrCreateCoverObjectUrl('cover-1', async () => 'blob:one');
    expect(peekCachedCoverObjectUrl('cover-1')).toBe('blob:one');
  });

  it('dedupes concurrent requests for the same key into a single factory call', async () => {
    let resolveFactory: (url: string) => void;
    const factory = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFactory = resolve;
        }),
    );

    const first = getOrCreateCoverObjectUrl('cover-1', factory);
    const second = getOrCreateCoverObjectUrl('cover-1', factory);

    resolveFactory!('blob:one');

    expect(await first).toBe('blob:one');
    expect(await second).toBe('blob:one');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed factory call, so a later call retries', async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce('blob:one');

    await expect(getOrCreateCoverObjectUrl('cover-1', factory)).rejects.toThrow('network error');
    expect(peekCachedCoverObjectUrl('cover-1')).toBeUndefined();

    const url = await getOrCreateCoverObjectUrl('cover-1', factory);
    expect(url).toBe('blob:one');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('evicts and revokes the oldest entry once the cache exceeds its size limit', async () => {
    const revokeSpy = vi.fn();
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: revokeSpy });

    for (let i = 0; i < 301; i++) {
      await getOrCreateCoverObjectUrl(`cover-${i}`, async () => `blob:${i}`);
    }

    expect(peekCachedCoverObjectUrl('cover-0')).toBeUndefined();
    expect(revokeSpy).toHaveBeenCalledWith('blob:0');
    expect(peekCachedCoverObjectUrl('cover-300')).toBe('blob:300');
  });
});
