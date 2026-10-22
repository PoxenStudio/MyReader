import { useCallback, useEffect, useRef, useState } from 'react';
import { useBookProgress } from '@/store/readerProgressStore';
import { useReaderStore } from '@/store/readerStore';
import {
  createPreviousLocationTracker,
  updatePreviousLocationTracker,
} from '@/app/reader/utils/previousLocation';

/**
 * Tracks deliberate chapter switches so the reader can offer a one-tap return
 * to the position they left. The prompt survives consecutive chapter switches
 * (the original position is kept) and expires after a few page turns.
 */
export const useBackToPreviousLocation = (bookKey: string) => {
  const progress = useBookProgress(bookKey);
  const getView = useReaderStore((s) => s.getView);
  const trackerRef = useRef(createPreviousLocationTracker());
  const [location, setLocation] = useState<string | null>(null);

  useEffect(() => {
    if (!progress) return;
    const renderer = getView(bookKey)?.renderer;
    const sectionPage =
      renderer && renderer.pages > 0 ? { page: renderer.page, pages: renderer.pages } : undefined;
    const tracker = updatePreviousLocationTracker(trackerRef.current, progress, sectionPage);
    trackerRef.current = tracker;
    setLocation(tracker.location);
  }, [progress, bookKey, getView]);

  const handleBack = useCallback(() => {
    const target = trackerRef.current.location;
    const view = getView(bookKey);
    if (!target || !view) return;

    // Reset before navigating so the relocate caused by the jump doesn't
    // immediately offer to go back again.
    trackerRef.current = createPreviousLocationTracker();
    setLocation(null);

    const resolved = view.resolveNavigation(target);
    view.renderer.goTo?.(resolved);
  }, [bookKey, getView]);

  return { location, handleBack };
};
