import * as React from 'react';
import { useState } from 'react';
import clsx from 'clsx';
import Image from 'next/image';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useSettingsStore } from '@/store/settingsStore';
import { navigateToLogin } from '@/utils/nav';

interface LibraryEmptyStateProps {
  onImport: () => void;
  onImportBooksFromDirectory?: () => void;
  onSyncReadingBooks?: () => void;
  source?: 'local' | 'cloud';
}

const LibraryEmptyState: React.FC<LibraryEmptyStateProps> = ({
  onImport,
  onImportBooksFromDirectory,
  onSyncReadingBooks,
  source = 'local',
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const router = useAppRouter();
  const isMobile = appService?.isMobile ?? false;
  const isCloud = source === 'cloud';
  const showSyncReadingBooks = !!user && !settings.autoSyncReadingBooks && !!onSyncReadingBooks;
  const [isSyncingReadingBooks, setIsSyncingReadingBooks] = useState(false);

  const handleSyncReadingBooks = () => {
    // One-shot: once triggered, stay disabled rather than re-enabling when
    // the sync settles — the queued downloads keep running in the
    // background regardless, and re-clicking would just re-run the same
    // diff against the cloud "reading" list for no benefit.
    setIsSyncingReadingBooks(true);
    onSyncReadingBooks?.();
  };

  return (
    <div className='hero-content text-neutral-content text-center'>
      <div className='flex max-w-md flex-col items-center'>
        <Image
          src='/images/bookshelf_icon.png'
          alt=''
          aria-hidden
          width={128}
          height={128}
          className='mb-10'
        />
        <h1 className='mb-5 text-balance text-4xl font-semibold leading-tight tracking-tight'>
          {isCloud ? _('Nothing here yet') : _('Start your library')}
        </h1>
        {!isCloud && (
          <>
            <p className='text-base-content/70 mb-12 text-pretty text-base leading-relaxed'>
              {isMobile
                ? _('Pick a book from your device to add it to your library.')
                : _('Drop a book anywhere on this window, or pick one from your computer.')}
            </p>
            <div className='flex w-full max-w-xs flex-col gap-3'>
              <button
                type='button'
                className='btn btn-primary h-11 min-h-11 rounded-lg'
                onClick={onImport}
              >
                {_('Import Books')}
              </button>
              {onImportBooksFromDirectory && (
                <button
                  type='button'
                  className='btn btn-primary h-11 min-h-11 rounded-lg'
                  onClick={onImportBooksFromDirectory}
                >
                  {_('From Directory')}
                </button>
              )}
              {showSyncReadingBooks && (
                <button
                  type='button'
                  className={clsx(
                    'btn btn-primary h-11 min-h-11 rounded-lg',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                  disabled={isSyncingReadingBooks}
                  onClick={handleSyncReadingBooks}
                >
                  {isSyncingReadingBooks ? _('Syncing…') : _('Sync Reading Books from Library')}
                </button>
              )}
              {/* TODO: add a 'Browse free catalogs' secondary action that opens the
                  OPDS dialog (handleShowOPDSDialog) once we settle on placement. */}
              {!user && (
                <button
                  type='button'
                  className={clsx(
                    'text-base-content/70 hover:text-base-content mt-1 py-2 text-sm font-medium',
                    'underline underline-offset-4',
                    'focus-visible:text-base-content focus-visible:outline-none',
                  )}
                  onClick={() => navigateToLogin(router)}
                >
                  {_('Sign in to sync your library')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default LibraryEmptyState;
