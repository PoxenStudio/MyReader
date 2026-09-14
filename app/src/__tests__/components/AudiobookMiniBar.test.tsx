import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { bottom: 0 } }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

const togglePlayMock = vi.fn();
const stopMock = vi.fn();
const configureAppServiceMock = vi.fn();
vi.mock('@/services/audiobook/audiobookSessionManager', () => ({
  audiobookSessionManager: {
    togglePlay: (...a: unknown[]) => togglePlayMock(...a),
    stop: (...a: unknown[]) => stopMock(...a),
    configureAppService: (...a: unknown[]) => configureAppServiceMock(...a),
  },
}));

const openSheetMock = vi.fn();
let sheetOpen = false;
vi.mock('@/store/audiobookUIStore', () => ({
  useAudiobookUIStore: (selector: (s: unknown) => unknown) =>
    selector({ isSheetOpen: sheetOpen, openSheet: openSheetMock, closeSheet: vi.fn() }),
}));

let session: unknown = {
  bookId: 5,
  meta: { title: 'Dune', author: 'Frank Herbert', coverImageUrl: null },
  tracks: [],
  currentTrackIndex: 0,
};
let isPlaying = false;
vi.mock('@/app/library/hooks/useAudiobookSession', () => ({
  useAudiobookSession: () => ({ session, isPlaying, playbackInfo: null }),
}));

import AudiobookMiniBar from '@/app/library/components/audiobook/AudiobookMiniBar';

describe('AudiobookMiniBar', () => {
  beforeEach(() => {
    sheetOpen = false;
    isPlaying = false;
    session = {
      bookId: 5,
      meta: { title: 'Dune', author: 'Frank Herbert', coverImageUrl: null },
      tracks: [],
      currentTrackIndex: 0,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing without an active session', () => {
    session = null;
    const { container } = render(<AudiobookMiniBar isSelectMode={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing while the full sheet is open', () => {
    sheetOpen = true;
    const { container } = render(<AudiobookMiniBar isSelectMode={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing in select mode', () => {
    const { container } = render(<AudiobookMiniBar isSelectMode />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the title and opens the sheet on tap', () => {
    render(<AudiobookMiniBar isSelectMode={false} />);
    expect(screen.getByText('Dune')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open Audiobook Player/ }));
    expect(openSheetMock).toHaveBeenCalled();
  });

  it('play/pause and stop buttons call the session manager without opening the sheet', () => {
    render(<AudiobookMiniBar isSelectMode={false} />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(togglePlayMock).toHaveBeenCalled();
    expect(openSheetMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Stop'));
    expect(stopMock).toHaveBeenCalled();
  });

  it('configures the session manager with the current AppService', () => {
    render(<AudiobookMiniBar isSelectMode={false} />);
    expect(configureAppServiceMock).toHaveBeenCalledWith(null);
  });
});
