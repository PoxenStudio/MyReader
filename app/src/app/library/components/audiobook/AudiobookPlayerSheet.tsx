import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  MdOutlinePause,
  MdPlayArrow,
  MdSkipPrevious,
  MdSkipNext,
  MdOutlineFileDownload,
  MdDownloadForOffline,
  MdOfflinePin,
  MdArrowBackIosNew,
  MdAlarm,
  MdCheck,
} from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { formatPlaybackTime } from '@/utils/time';
import { formatBytes } from '@/utils/book';
import Dialog from '@/components/Dialog';
import SpeedRuler, { formatRate } from '@/app/reader/components/tts/SpeedRuler';
import { getTTSTimeoutOptions } from '@/app/reader/components/tts/TTSPlayerSheet';
import { useCountdownLabel } from '@/app/reader/components/tts/useCountdownLabel';
import { audiobookSessionManager } from '@/services/audiobook/audiobookSessionManager';
import { useAudiobookUIStore } from '@/store/audiobookUIStore';
import { useAudiobookSession } from '../../hooks/useAudiobookSession';
import { useAudiobookDownloads } from '../../hooks/useAudiobookDownloads';
import { useResolvedCoverUrl } from '@/hooks/useResolvedCoverUrl';

type SheetView = 'main' | 'speed' | 'timer';

// 章节文件名去掉后端约定的 4 位序号前缀（0001_第一章 -> 第一章），参考
// mybooks 前端播放器 audio/_id.vue 的 getDisplayName。
const displayTrackName = (filename: string) => filename.replace(/^\d{4}_/, '');

// 全局唯一的有声书播放面板：切换书籍/曲目都在同一个 Dialog 实例里完成，不会
// 因此重新创建。挂载点见 library/page.tsx（与 NowPlayingBar/AudiobookMiniBar
// 同级）。布局参考 audio/_id.vue（封面+曲目列表 / 播放控制条两段式），控件
// 视觉语言对齐 TTSPlayerSheet。
const AudiobookPlayerSheet = () => {
  const _ = useTranslation();
  const isSheetOpen = useAudiobookUIStore((s) => s.isSheetOpen);
  const closeSheet = useAudiobookUIStore((s) => s.closeSheet);
  const { session, isPlaying, playbackInfo } = useAudiobookSession();
  const [view, setView] = useState<SheetView>('main');
  const iconSize18 = useResponsiveSize(18);
  const iconSize24 = useResponsiveSize(24);
  const iconSize28 = useResponsiveSize(28);
  const iconSize32 = useResponsiveSize(32);

  const tracks = session?.tracks ?? [];
  const downloads = useAudiobookDownloads(session?.bookId ?? null, tracks);
  const coverImageUrl = useResolvedCoverUrl(
    session?.meta.coverImageUrl,
    session?.meta.title ?? '',
    String(session?.bookId ?? ''),
  );

  // Sleep timer lives in the session manager (survives sheet unmount); resync
  // local display state whenever a (possibly different) book is opened.
  const [sleepTimer, setSleepTimerState] = useState(() => audiobookSessionManager.getSleepTimer());
  useEffect(() => {
    setSleepTimerState(audiobookSessionManager.getSleepTimer());
  }, [session?.bookId]);
  const timerLabel = useCountdownLabel(sleepTimer?.firesAt ?? 0);
  const timerCaption = sleepTimer && timerLabel ? timerLabel : _('Sleep Timer');
  const timeoutOptions = getTTSTimeoutOptions(_);

  const handleSelectTimeout = (value: number) => {
    audiobookSessionManager.setSleepTimer(value);
    setSleepTimerState(
      value > 0 ? { timeoutSec: value, firesAt: Date.now() + value * 1000 } : null,
    );
  };

  if (!session) return null;

  const { meta, currentTrackIndex } = session;
  const position = playbackInfo?.position ?? 0;
  const duration = playbackInfo?.duration ?? 0;
  const progressPct = duration > 0 ? Math.min((position / duration) * 100, 100) : 0;

  const handleClose = () => closeSheet();

  const header =
    view === 'main' ? (
      <button
        type='button'
        aria-label={_('Close')}
        onClick={handleClose}
        className='bg-base-300/65 btn btn-ghost btn-circle absolute end-3 top-1 z-10 hidden h-6 min-h-6 w-6 focus:outline-none sm:flex'
      >
        <svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 24 24'>
          <path
            fill='currentColor'
            d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
          />
        </svg>
      </button>
    ) : (
      <div className='relative flex h-11 w-full items-center px-1'>
        <button
          type='button'
          aria-label={_('Go Back')}
          onClick={() => setView('main')}
          className='btn btn-ghost btn-circle z-10 flex h-8 min-h-8 w-8 hover:bg-transparent focus:outline-none'
        >
          <MdArrowBackIosNew size={iconSize24 * 0.8} className='rtl:rotate-180' />
        </button>
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <span className='line-clamp-1 text-center font-bold'>
            {view === 'timer' ? _('Sleep Timer') : _('Speed')}
          </span>
        </div>
      </div>
    );

  return (
    <Dialog
      id='audiobook_player_sheet'
      isOpen={isSheetOpen}
      snapHeight={0.8}
      title={_('Audiobook Player')}
      header={header}
      boxClassName='sm:!h-auto sm:!max-h-[85%] sm:!w-[520px] sm:!min-w-0'
      contentClassName='!px-4 sm:!px-4 mt-[-4px]'
      onClose={handleClose}
    >
      {view === 'main' && (
        <div className='flex w-full flex-col gap-3 pb-4 sm:pt-4'>
          <div className='flex items-center gap-3'>
            {coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverImageUrl}
                alt=''
                className='not-eink:shadow-lg eink-bordered hidden h-20 w-auto shrink-0 rounded-lg object-cover sm:block'
              />
            ) : null}
            <div className='flex min-w-0 flex-col gap-0.5'>
              <span className='line-clamp-1 font-semibold'>{meta.title}</span>
              {meta.author && (
                <span className='text-base-content/70 line-clamp-1 text-sm'>{meta.author}</span>
              )}
              <span className='text-base-content/60 text-xs tabular-nums'>
                {_('{{current}}/{{total}}', {
                  current: currentTrackIndex + 1,
                  total: tracks.length,
                })}
              </span>
            </div>
          </div>

          <div className='flex max-h-52 w-full flex-col overflow-y-auto rounded-xl'>
            <div className='flex items-center justify-between px-1 py-1'>
              <span className='text-base-content/60 text-xs tabular-nums'>
                {downloads.totalBytes > 0
                  ? `${formatBytes(downloads.downloadedBytes)} / ${formatBytes(downloads.totalBytes)}`
                  : ''}
              </span>
              <div className='flex items-center gap-3'>
                {downloads.hasAnyLocal && (
                  <button
                    type='button'
                    className='text-error text-xs font-medium'
                    onClick={() => void downloads.deleteLocal()}
                  >
                    {_('Delete local download')}
                  </button>
                )}
                <button
                  type='button'
                  className='text-primary text-xs font-medium'
                  onClick={downloads.downloadAll}
                >
                  {_('Download all')}
                </button>
              </div>
            </div>
            {tracks.map((track, index) => {
              const status = downloads.statusOf(track);
              const isActive = index === currentTrackIndex;
              return (
                <div
                  key={`${track.url}-${track.start_time ?? index}`}
                  role='button'
                  tabIndex={0}
                  onClick={() => audiobookSessionManager.selectTrack(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      audiobookSessionManager.selectTrack(index);
                  }}
                  className={clsx(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-start',
                    isActive ? 'bg-primary/10 text-primary' : 'not-eink:hover:bg-base-200',
                  )}
                >
                  <span className='w-5 shrink-0 text-xs tabular-nums opacity-60'>{index + 1}</span>
                  <span className='line-clamp-1 min-w-0 flex-1 text-sm'>
                    {displayTrackName(track.filename)}
                  </span>
                  <button
                    type='button'
                    aria-label={
                      status === 'complete'
                        ? _('Downloaded')
                        : status === 'downloading'
                          ? _('Downloading')
                          : _('Download')
                    }
                    disabled={status !== 'none'}
                    onClick={(e) => {
                      e.stopPropagation();
                      downloads.downloadTrack(track);
                    }}
                    className='shrink-0 rounded-full p-1'
                  >
                    {status === 'complete' ? (
                      <MdOfflinePin size={iconSize24 * 0.75} className='text-primary' />
                    ) : status === 'downloading' ? (
                      <MdDownloadForOffline
                        size={iconSize24 * 0.75}
                        className='text-base-content/70 animate-pulse'
                      />
                    ) : (
                      <MdOutlineFileDownload
                        size={iconSize24 * 0.75}
                        className='text-base-content/60'
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className='flex w-full flex-col gap-1'>
            <input
              type='range'
              min={0}
              max={100}
              value={progressPct}
              onChange={(e) => {
                if (duration > 0) {
                  audiobookSessionManager.seekTo((Number(e.target.value) / 100) * duration);
                }
              }}
              className='range range-primary range-xs w-full'
            />
            <div className='text-base-content/60 flex justify-between text-xs tabular-nums'>
              <span>{formatPlaybackTime(position)}</span>
              <span>{formatPlaybackTime(duration)}</span>
            </div>
          </div>

          {playbackInfo?.currentSubtitle && (
            <div className='bg-base-200 line-clamp-2 w-full rounded-lg px-3 py-2 text-center text-sm'>
              {playbackInfo.currentSubtitle}
            </div>
          )}

          <div dir='ltr' className='flex items-center justify-center gap-2'>
            <button
              type='button'
              className='rounded-full p-2 disabled:opacity-30'
              aria-label={_('Previous chapter')}
              disabled={currentTrackIndex <= 0}
              onClick={() => audiobookSessionManager.previous()}
            >
              <MdSkipPrevious size={iconSize28} />
            </button>
            <button
              type='button'
              className='btn btn-primary btn-circle mx-2 h-14 min-h-14 w-14'
              aria-label={isPlaying ? _('Pause') : _('Play')}
              onClick={() => audiobookSessionManager.togglePlay()}
            >
              {isPlaying ? <MdOutlinePause size={iconSize32} /> : <MdPlayArrow size={iconSize32} />}
            </button>
            <button
              type='button'
              className='rounded-full p-2 disabled:opacity-30'
              aria-label={_('Next chapter')}
              disabled={currentTrackIndex >= tracks.length - 1}
              onClick={() => audiobookSessionManager.next()}
            >
              <MdSkipNext size={iconSize28} />
            </button>
          </div>

          <div className='flex w-full gap-2'>
            <button
              type='button'
              aria-label={_('Speed')}
              onClick={() => setView('speed')}
              className='not-eink:bg-base-200 eink-bordered flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl'
            >
              <span className='text-sm font-semibold tabular-nums'>
                {formatRate(playbackInfo?.rate ?? 1)}
              </span>
              <span className='text-base-content/60 max-w-full truncate px-1 text-xs'>
                {_('Speed')}
              </span>
            </button>
            <button
              type='button'
              aria-label={_('Sleep Timer')}
              onClick={() => setView('timer')}
              className='not-eink:bg-base-200 eink-bordered flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl'
            >
              <MdAlarm size={iconSize18} />
              <span className='text-base-content/60 max-w-full truncate px-1 text-xs tabular-nums'>
                {timerCaption}
              </span>
            </button>
          </div>
        </div>
      )}
      {view === 'speed' && (
        <div className='flex w-full flex-col items-center pb-4 pt-2'>
          <SpeedRuler
            rate={playbackInfo?.rate ?? 1}
            onSelect={(rate) => audiobookSessionManager.setRate(rate)}
          />
        </div>
      )}
      {view === 'timer' && (
        <div className='flex w-full flex-col pb-4'>
          {timeoutOptions.map((option) => (
            <button
              key={option.value}
              type='button'
              onClick={() => handleSelectTimeout(option.value)}
              className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start'
            >
              <span className='flex h-6 w-6 items-center justify-center'>
                {(sleepTimer?.timeoutSec ?? 0) === option.value && (
                  <MdCheck className='text-base-content' />
                )}
              </span>
              <span className='text-base sm:text-sm'>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
};

export default AudiobookPlayerSheet;
