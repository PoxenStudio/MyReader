import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const isRemoteCoverUrlMock = vi.fn().mockReturnValue(false);
const fetchRemoteCoverObjectUrlMock = vi.fn();
vi.mock('@/components/BookCover', () => ({
  isRemoteCoverUrl: (...args: unknown[]) => isRemoteCoverUrlMock(...args),
  fetchRemoteCoverObjectUrl: (...args: unknown[]) => fetchRemoteCoverObjectUrlMock(...args),
}));

vi.mock('@/utils/coverObjectUrlCache', () => ({
  getOrCreateCoverObjectUrl: (_key: string, create: () => Promise<string>) => create(),
  peekCachedCoverObjectUrl: () => undefined,
}));

import { useResolvedCoverUrl } from '@/hooks/useResolvedCoverUrl';

describe('useResolvedCoverUrl', () => {
  beforeEach(() => {
    isRemoteCoverUrlMock.mockReset().mockReturnValue(false);
    fetchRemoteCoverObjectUrlMock.mockReset();
  });

  it('returns null when there is no cover url', () => {
    const { result } = renderHook(() => useResolvedCoverUrl(null, 'Dune', '5'));
    expect(result.current).toBeNull();
  });

  it('returns the url as-is when it does not need the Tauri fetch/blob path', () => {
    isRemoteCoverUrlMock.mockReturnValue(false);
    const { result } = renderHook(() =>
      useResolvedCoverUrl('/api/mybooks/proxy/cover/5.jpg', 'Dune', '5'),
    );
    expect(result.current).toBe('/api/mybooks/proxy/cover/5.jpg');
  });

  it('resolves a remote Tauri cover via fetchRemoteCoverObjectUrl instead of a bare <img src>', async () => {
    isRemoteCoverUrlMock.mockReturnValue(true);
    fetchRemoteCoverObjectUrlMock.mockResolvedValue('blob:mock-cover');

    const { result } = renderHook(() =>
      useResolvedCoverUrl('http://mybooks.local/get/thumb/5.jpg', 'Dune', '5'),
    );

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('blob:mock-cover'));
    expect(fetchRemoteCoverObjectUrlMock).toHaveBeenCalledWith(
      'http://mybooks.local/get/thumb/5.jpg',
      'Dune',
      '5',
    );
  });
});
