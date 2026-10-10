import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdFileUpload } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useFileSelector } from '@/hooks/useFileSelector';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { useTranslation } from '@/hooks/useTranslation';

interface UploadFabProps {
  bottomOffset?: number;
}

const UploadFab: React.FC<UploadFabProps> = ({ bottomOffset = 0 }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const safeBottom = useThemeStore((state) => state.safeAreaInsets?.bottom ?? 0) / 4;
  const { selectFiles } = useFileSelector(appService, _);
  const { queueFileUploads } = useTransferQueue();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  // Uploading is owned by the TransferManager queue; this only picks files and enqueues them.
  const handleClick = async () => {
    if (!appService) return;
    const result = await selectFiles({ type: 'books', multiple: true });
    if (result.error || result.files.length === 0) return;
    const ids = queueFileUploads(
      result.files.map((f) => ({ path: f.path, file: f.file, name: f.name ?? f.file?.name ?? '' })),
    );
    if (ids.length > 0) setMessage(_('Added to upload queue'));
  };

  return (
    <>
      {message && (
        <div
          role='status'
          className='bg-success fixed right-4 z-10 max-w-[80vw] rounded-lg px-3 py-2 text-sm text-white shadow-lg'
          style={{ bottom: `calc(1rem + ${safeBottom}px + ${bottomOffset}px + 4.5rem)` }}
        >
          {message}
        </div>
      )}
      <button
        type='button'
        aria-label={_('Upload')}
        onClick={handleClick}
        className={clsx(
          'fixed right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full',
          'bg-[#e91e63] text-white shadow-lg active:opacity-80',
        )}
        style={{ bottom: `calc(1rem + ${safeBottom}px + ${bottomOffset}px)` }}
      >
        <MdFileUpload className='h-6 w-6' />
      </button>
    </>
  );
};

export default UploadFab;
