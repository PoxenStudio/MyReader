import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Book } from '@/types/book';

let capturedOnContextMenu: ((e: { clientX: number; clientY: number }) => void) | null = null;

vi.mock('@/hooks/useLongPress', () => ({
  useLongPress: (opts: { onContextMenu?: (e: { clientX: number; clientY: number }) => void }) => {
    capturedOnContextMenu = opts.onContextMenu ?? null;
    return { pressing: false, handlers: {} };
  },
}));

vi.mock('@/utils/nav', () => ({
  navigateToReader: vi.fn(),
  showReaderWindow: vi.fn(),
  navigateToLogin: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user' } }),
}));

const existsMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const deleteLocalAudiobookMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const queueAudiobookTracksMock = vi.hoisted(() => vi.fn());
const getAudioBookDetailMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ audios: [{ filename: 'ch1', url: '/api/audio/1.mp3', size: 10 }] }),
);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      hasContextMenu: true,
      isBookAvailable: vi.fn().mockResolvedValue(false),
      exists: (...args: unknown[]) => existsMock(...args),
    },
  }),
}));

vi.mock('@/services/audiobook/audiobookDownloader', () => ({
  audiobookDir: (bookId: number) => `audiobooks/${bookId}`,
  deleteLocalAudiobook: (...args: unknown[]) => deleteLocalAudiobookMock(...args),
}));

vi.mock('@/services/audiobook/audiobookService', () => ({
  getAudioBookDetail: (...args: unknown[]) => getAudioBookDetailMock(...args),
}));

vi.mock('@/services/transferManager', () => ({
  transferManager: {
    queueAudiobookTracks: (...args: unknown[]) => queueAudiobookTracksMock(...args),
  },
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ updateBook: vi.fn(), getBookByHash: vi.fn() }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { openBookInNewWindow: false, localBooksDir: '' } }),
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({}),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const appendedTexts: string[] = vi.hoisted(() => []);
type AppendedMenuItem = { text: string; action?: () => unknown; items?: AppendedMenuItem[] };
const appendedItems: AppendedMenuItem[] = vi.hoisted(() => []);
const popupMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: {
    new: vi.fn().mockResolvedValue({
      append: (item: AppendedMenuItem) => {
        appendedTexts.push(item.text);
        appendedItems.push(item);
      },
      popup: popupMock,
    }),
  },
  MenuItem: {
    new: vi.fn().mockImplementation(async (opts: { text: string; action?: () => unknown }) => opts),
  },
  Submenu: {
    new: vi.fn().mockImplementation(async (opts: { text: string }) => opts),
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    innerSize: async () => ({ width: 1280, height: 800 }),
    scaleFactor: async () => 1,
  }),
  LogicalPosition: class {
    readonly type = 'Logical';
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

import BookshelfItem from '@/app/library/components/BookshelfItem';

const audiobook: Book = {
  hash: 'cloud-1',
  bookId: 1,
  format: 'EPUB',
  title: 'Dune',
  author: 'Frank Herbert',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  storageType: 'cloud',
} as unknown as Book;

describe('BookshelfItem context menu on the audiobook shelf', () => {
  beforeEach(() => {
    capturedOnContextMenu = null;
    appendedTexts.length = 0;
    appendedItems.length = 0;
    popupMock.mockClear();
    existsMock.mockReset().mockResolvedValue(false);
    deleteLocalAudiobookMock.mockClear();
    queueAudiobookTracksMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  const openMenu = (props: Partial<React.ComponentProps<typeof BookshelfItem>> = {}) =>
    render(
      <BookshelfItem
        mode='grid'
        item={audiobook}
        coverFit='crop'
        isSelectMode={false}
        itemSelected={false}
        transferProgress={null}
        setLoading={vi.fn()}
        toggleSelection={vi.fn()}
        handleGroupBooks={vi.fn()}
        handleBookDownload={vi.fn()}
        handleBookUpload={vi.fn()}
        handleBookDelete={vi.fn()}
        handleSetSelectMode={vi.fn()}
        handleShowDetailsBook={vi.fn()}
        handleLibraryNavigation={vi.fn()}
        handleUpdateReadingStatus={vi.fn()}
        isCloudLibrary={true}
        isAudiobookShelf={true}
        showTimeRemaining={false}
        {...props}
      />,
    );

  it('never shows "Send to Device" or the ebook "Download Book" action', async () => {
    openMenu();
    capturedOnContextMenu!({ clientX: 0, clientY: 0 });
    await waitFor(() => expect(popupMock).toHaveBeenCalled());

    expect(appendedTexts).not.toContain('Send to Device');
    expect(appendedTexts).not.toContain('Download Book');
  });

  it('offers "Download Audiobook" when nothing is downloaded yet, and queues all tracks', async () => {
    existsMock.mockResolvedValue(false);
    openMenu();
    capturedOnContextMenu!({ clientX: 0, clientY: 0 });
    await waitFor(() => expect(popupMock).toHaveBeenCalled());

    expect(appendedTexts).toContain('Download Audiobook');
    expect(appendedTexts).not.toContain('Delete Local Download');

    const item = appendedItems.find((i) => i.text === 'Download Audiobook')!;
    await item.action!();
    expect(getAudioBookDetailMock).toHaveBeenCalledWith(1);
    expect(queueAudiobookTracksMock).toHaveBeenCalledWith(1, [
      { filename: 'ch1', url: '/api/audio/1.mp3', size: 10 },
    ]);
  });

  it('offers "Delete Local Download" when the book is already downloaded', async () => {
    existsMock.mockResolvedValue(true);
    openMenu();
    capturedOnContextMenu!({ clientX: 0, clientY: 0 });
    await waitFor(() => expect(popupMock).toHaveBeenCalled());

    expect(appendedTexts).toContain('Delete Local Download');
    expect(appendedTexts).not.toContain('Download Audiobook');

    const item = appendedItems.find((i) => i.text === 'Delete Local Download')!;
    await item.action!();
    expect(deleteLocalAudiobookMock).toHaveBeenCalledWith(expect.anything(), 1);
  });
});
