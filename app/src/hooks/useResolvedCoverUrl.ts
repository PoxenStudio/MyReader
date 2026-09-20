import { useEffect, useState } from 'react';
import { isRemoteCoverUrl, fetchRemoteCoverObjectUrl } from '@/components/BookCover';
import { getOrCreateCoverObjectUrl, peekCachedCoverObjectUrl } from '@/utils/coverObjectUrlCache';

// Resolves a MyBooks cover URL for display outside the main library grid
// (mini player, player sheet, ...). On Tauri a direct MyBooks cover URL
// can't be used as a bare <img src> — see BookCover.tsx's
// fetchRemoteCoverObjectUrl — so it's fetched via tauriFetch and cached as
// a blob object URL instead.
export function useResolvedCoverUrl(
  coverUrl: string | null | undefined,
  title: string,
  key: string,
): string | null {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!coverUrl) return null;
    if (!isRemoteCoverUrl(coverUrl)) return coverUrl;
    return peekCachedCoverObjectUrl(coverUrl) ?? null;
  });

  useEffect(() => {
    if (!coverUrl) {
      setResolved(null);
      return;
    }
    if (!isRemoteCoverUrl(coverUrl)) {
      setResolved(coverUrl);
      return;
    }
    let cancelled = false;
    getOrCreateCoverObjectUrl(coverUrl, () => fetchRemoteCoverObjectUrl(coverUrl, title, key))
      .then((url) => {
        if (!cancelled) setResolved(url);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [coverUrl, title, key]);

  return resolved;
}
