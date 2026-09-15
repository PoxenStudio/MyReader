import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key);
  },
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) => (
    <div role='dialog'>
      {header}
      {children}
    </div>
  ),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

const selectTrackMock = vi.fn();
const toggleplayMock = vi.fn();
const previousMock = vi.fn();
const nextMock = vi.fn();
const seekToMock = vi.fn();
const setRateMock = vi.fn();
const configureAppServiceMock = vi.fn();
const setSleepTimerMock = vi.fn();
let sleepTimer: { timeoutSec: number; firesAt: number } | null = null;
vi.mock('@/services/audiobook/audiobookSessionManager', () => ({
  audiobookSessionManager: {
    selectTrack: (...a: unknown[]) => selectTrackMock(...a),
    togglePlay: (...a: unknown[]) => toggleplayMock(...a),
    previous: (...a: unknown[]) => previousMock(...a),
    next: (...a: unknown[]) => nextMock(...a),
    seekTo: (...a: unknown[]) => seekToMock(...a),
    setRate: (...a: unknown[]) => setRateMock(...a),
    configureAppService: (...a: unknown[]) => configureAppServiceMock(...a),
    setSleepTimer: (...a: unknown[]) => setSleepTimerMock(...a),
    getSleepTimer: () => sleepTimer,
  },
}));

const closeSheetMock = vi.fn();
let sheetOpen = true;
vi.mock('@/store/audiobookUIStore', () => ({
  useAudiobookUIStore: (selector: (s: unknown) => unknown) =>
    selector({ isSheetOpen: sheetOpen, closeSheet: closeSheetMock, openSheet: vi.fn() }),
}));

const track1 = { filename: '0001_ch1', url: '/api/audio/5/0001_ch1.mp3', size: 100 };
const track2 = { filename: '0002_ch2', url: '/api/audio/5/0002_ch2.mp3', size: 200 };

let session: unknown = {
  bookId: 5,
  meta: { title: 'Dune', author: 'Frank Herbert', coverImageUrl: null },
  tracks: [track1, track2],
  currentTrackIndex: 0,
};
let isPlaying = false;
const playbackInfo: unknown = {
  trackIndex: 0,
  position: 10,
  duration: 100,
  isPlaying: false,
  rate: 1,
  currentSubtitle: null,
};
vi.mock('@/app/library/hooks/useAudiobookSession', () => ({
  useAudiobookSession: () => ({ session, isPlaying, playbackInfo }),
}));

const downloadAllMock = vi.fn();
const downloadTrackMock = vi.fn();
const deleteLocalMock = vi.fn();
vi.mock('@/app/library/hooks/useAudiobookDownloads', () => ({
  useAudiobookDownloads: () => ({
    statusOf: () => 'none',
    progressOf: () => 0,
    downloadedBytes: 0,
    totalBytes: 300,
    hasAnyLocal: false,
    downloadTrack: downloadTrackMock,
    downloadAll: downloadAllMock,
    deleteLocal: deleteLocalMock,
  }),
}));

import AudiobookPlayerSheet from '@/app/library/components/audiobook/AudiobookPlayerSheet';

describe('AudiobookPlayerSheet', () => {
  beforeEach(() => {
    sheetOpen = true;
    isPlaying = false;
    sleepTimer = null;
    session = {
      bookId: 5,
      meta: { title: 'Dune', author: 'Frank Herbert', coverImageUrl: null },
      tracks: [track1, track2],
      currentTrackIndex: 0,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when there is no active session', () => {
    session = null;
    const { container } = render(<AudiobookPlayerSheet />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the book title/author and track list', () => {
    render(<AudiobookPlayerSheet />);
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getByText('Frank Herbert')).toBeTruthy();
    expect(screen.getByText('ch1')).toBeTruthy();
    expect(screen.getByText('ch2')).toBeTruthy();
  });

  it('clicking a track selects it via the session manager', () => {
    render(<AudiobookPlayerSheet />);
    fireEvent.click(screen.getByText('ch2'));
    expect(selectTrackMock).toHaveBeenCalledWith(1);
  });

  it('play/pause button toggles playback', () => {
    render(<AudiobookPlayerSheet />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(toggleplayMock).toHaveBeenCalled();
  });

  it('prev/next buttons call the session manager, respecting bounds', () => {
    render(<AudiobookPlayerSheet />);
    expect((screen.getByLabelText('Previous chapter') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Next chapter'));
    expect(nextMock).toHaveBeenCalled();
  });

  it('"Download all" calls the downloads hook', () => {
    render(<AudiobookPlayerSheet />);
    fireEvent.click(screen.getByText('Download all'));
    expect(downloadAllMock).toHaveBeenCalled();
  });

  it('close button closes the sheet', () => {
    render(<AudiobookPlayerSheet />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(closeSheetMock).toHaveBeenCalled();
  });

  it('selecting a sleep timer option arms it on the session manager', () => {
    render(<AudiobookPlayerSheet />);
    fireEvent.click(screen.getByLabelText('Sleep Timer'));
    fireEvent.click(screen.getByText('10 minutes'));
    expect(setSleepTimerMock).toHaveBeenCalledWith(600);
  });

  it('shows a live countdown on the sleep timer button once armed', () => {
    sleepTimer = { timeoutSec: 600, firesAt: Date.now() + 600_000 };
    render(<AudiobookPlayerSheet />);
    expect(screen.getByLabelText('Sleep Timer').textContent).toMatch(/\d+:\d{2}/);
  });
});
