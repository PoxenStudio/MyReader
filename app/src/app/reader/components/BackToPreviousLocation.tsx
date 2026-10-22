import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBackToPreviousLocation } from '@/app/reader/hooks/useBackToPreviousLocation';

interface BackToPreviousLocationProps {
  bookKey: string;
}

/**
 * Floating pill shown after a chapter switch that returns the reader to the
 * position they left. Mirrors the "Back to TTS Location" control and hides
 * itself once the reader settles into the new chapter.
 */
const BackToPreviousLocation: React.FC<BackToPreviousLocationProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const ttsEnabled = useReaderStore((s) => s.viewStates[bookKey]?.ttsEnabled ?? false);
  const { location, handleBack } = useBackToPreviousLocation(bookKey);

  const [shouldMount, setShouldMount] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TTS owns the same spot while a session is active, so the two pills never
  // overlap; the TTS control already offers a way back to the spoken position.
  const shouldShow = !!location && !ttsEnabled;

  useEffect(() => {
    if (shouldShow) {
      setShouldMount(true);
      const fadeInTimeout = setTimeout(() => setIsVisible(true), 10);
      return () => clearTimeout(fadeInTimeout);
    }
    setIsVisible(false);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setShouldMount(false), 300);
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [shouldShow]);

  if (!shouldMount) return null;

  return (
    <div
      className={clsx(
        'absolute left-1/2 top-0 z-50 -translate-x-1/2',
        'transition-opacity duration-300',
        isVisible ? 'opacity-100' : 'opacity-0',
        safeAreaInsets?.top ? '' : 'py-1',
      )}
      style={{ top: `${safeAreaInsets?.top || 0}px` }}
    >
      <button
        onClick={handleBack}
        className={clsx(
          'not-eink:bg-base-300 eink-bordered whitespace-nowrap rounded-full px-4 py-2 font-sans text-sm shadow-lg',
          safeAreaInsets?.top ? 'h-11' : 'h-9',
        )}
      >
        {_('Back to Previous Location')}
      </button>
    </div>
  );
};

export default BackToPreviousLocation;
