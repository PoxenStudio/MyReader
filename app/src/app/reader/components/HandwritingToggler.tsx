import React from 'react';
import { PiScribbleLoop } from 'react-icons/pi';

import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface HandwritingTogglerProps {
  bookKey: string;
}

/**
 * Header entry into drawing mode. It sits beside the bookmark button rather
 * than inside the instant-annotation dropdown, so turning that preference off
 * does not take handwriting away.
 */
const HandwritingToggler: React.FC<HandwritingTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const drawingEnabled = useReaderStore((state) => !!state.viewStates[bookKey]?.drawingEnabled);
  const setDrawingEnabled = useReaderStore((state) => state.setDrawingEnabled);

  return (
    <Button
      icon={<PiScribbleLoop className='text-base-content' size={iconSize18} />}
      onClick={() => setDrawingEnabled(bookKey, !drawingEnabled)}
      label={drawingEnabled ? _('Close') : _('Draw')}
    />
  );
};

export default HandwritingToggler;
