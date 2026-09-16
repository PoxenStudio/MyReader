import clsx from 'clsx';
import { useEffect } from 'react';
import { MdClose, MdPauseCircleFilled, MdPlayCircleFilled } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { audiobookSessionManager } from '@/services/audiobook/audiobookSessionManager';
import { useAudiobookUIStore } from '@/store/audiobookUIStore';
import { useAudiobookSession } from '../../hooks/useAudiobookSession';
import { useResolvedCoverUrl } from '@/hooks/useResolvedCoverUrl';

interface AudiobookMiniBarProps {
  isSelectMode: boolean;
}

// Collapsed pill shown on the library page while an audiobook session is
// alive but the full player sheet is closed — same visual language and
// mount scope as NowPlayingBar (the TTS equivalent), and mutually exclusive
// with it in practice since the two playback kinds stop each other (§5.7).
const AudiobookMiniBar = ({ isSelectMode }: AudiobookMiniBarProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const isSheetOpen = useAudiobookUIStore((s) => s.isSheetOpen);
  const openSheet = useAudiobookUIStore((s) => s.openSheet);
  const { session, isPlaying } = useAudiobookSession();
  const size20 = useResponsiveSize(20);
  const size30 = useResponsiveSize(30);
  const coverImageUrl = useResolvedCoverUrl(
    session?.meta.coverImageUrl,
    session?.meta.title ?? '',
    String(session?.bookId ?? ''),
  );

  // Hands the manager an AppService once so #loadTrack can prefer an
  // already-downloaded local file over the remote URL (see
  // configureAppService's doc comment).
  useEffect(() => {
    audiobookSessionManager.configureAppService(appService ?? null);
  }, [appService]);

  const visible = !!session && !isSheetOpen && !isSelectMode;
  if (!visible) return null;

  const title = session.meta.title;

  return (
    <div
      role='status'
      aria-label={`${_('Audiobook')}: ${title}`}
      className={clsx('fixed bottom-0 start-1/2 z-40 -translate-x-1/2 rtl:translate-x-1/2')}
      style={{ paddingBottom: `${(safeAreaInsets?.bottom ?? 0) / 4 + 16}px` }}
    >
      <div
        role='button'
        tabIndex={0}
        onClick={openSheet}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openSheet();
        }}
        aria-label={`${_('Open Audiobook Player')}: ${title}`}
        className={clsx(
          'not-eink:bg-base-300 eink-bordered flex items-center gap-2 rounded-full shadow-lg',
          'h-14 max-w-[calc(100vw-2rem)] min-w-[60vw] sm:min-w-0 cursor-pointer px-2',
          'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        {coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt=''
            className='h-10 w-10 shrink-0 rounded-full object-cover'
          />
        ) : null}
        <span className='min-w-0 flex-1 truncate text-sm'>{title}</span>
        <button
          type='button'
          className='touch-target shrink-0 p-1 focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none'
          aria-label={isPlaying ? _('Pause') : _('Play')}
          onClick={(e) => {
            e.stopPropagation();
            audiobookSessionManager.togglePlay();
          }}
        >
          {isPlaying ? <MdPauseCircleFilled size={size30} /> : <MdPlayCircleFilled size={size30} />}
        </button>
        <button
          type='button'
          className='touch-target shrink-0 p-1 focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none'
          aria-label={_('Stop')}
          onClick={(e) => {
            e.stopPropagation();
            audiobookSessionManager.stop();
          }}
        >
          <MdClose size={size20} />
        </button>
      </div>
    </div>
  );
};

export default AudiobookMiniBar;
