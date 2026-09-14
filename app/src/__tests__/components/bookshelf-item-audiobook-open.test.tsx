import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Book } from '@/types/book';

let capturedOnTap: (() => void) | null = null;

vi.mock('@/hooks/useLongPress', () => ({
  useLongPress: (opts: { onTap?: () => void }) => {
    capturedOnTap = opts.onTap ?? null;
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

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { hasContextMenu: false, isBookAvailable: async () => false },
  }),
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

const openBookMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/audiobook/audiobookSessionManager', () => ({
  audiobookSessionManager: { openBook: (...args: unknown[]) => openBookMock(...args) },
}));

const openSheetMock = vi.fn();
vi.mock('@/store/audiobookUIStore', () => ({
  useAudiobookUIStore: { getState: () => ({ openSheet: openSheetMock }) },
}));

import BookshelfItem from '@/app/library/components/BookshelfItem';

const audiobook: Book = {
  hash: 'cloud-42',
  bookId: 42,
  format: 'EPUB',
  title: 'Dune (Audiobook)',
  author: 'Frank Herbert',
  coverImageUrl: 'https://example.com/cover.jpg',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  storageType: 'cloud',
} as unknown as Book;

describe('BookshelfItem on the audiobook shelf', () => {
  beforeEach(() => {
    capturedOnTap = null;
    openBookMock.mockClear();
    openSheetMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the audiobook player instead of the reader', async () => {
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
        isAudiobookShelf
      />,
    );

    expect(capturedOnTap).not.toBeNull();
    capturedOnTap!();

    await waitFor(() => expect(openBookMock).toHaveBeenCalled());
    expect(openBookMock).toHaveBeenCalledWith(42, {
      title: 'Dune (Audiobook)',
      author: 'Frank Herbert',
      coverImageUrl: 'https://example.com/cover.jpg',
    });
    expect(openSheetMock).toHaveBeenCalled();
  });

  it('in select mode, toggles selection instead of opening the player', async () => {
    const toggleSelection = vi.fn();
    render(
      <BookshelfItem
        mode='grid'
        item={audiobook}
        coverFit='crop'
        isSelectMode
        itemSelected={false}
        transferProgress={null}
        setLoading={vi.fn()}
        toggleSelection={toggleSelection}
        handleGroupBooks={vi.fn()}
        handleBookDownload={vi.fn()}
        handleBookUpload={vi.fn()}
        handleBookDelete={vi.fn()}
        handleSetSelectMode={vi.fn()}
        handleShowDetailsBook={vi.fn()}
        handleLibraryNavigation={vi.fn()}
        handleUpdateReadingStatus={vi.fn()}
        isAudiobookShelf
      />,
    );

    capturedOnTap!();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(toggleSelection).toHaveBeenCalledWith('cloud-42');
    expect(openBookMock).not.toHaveBeenCalled();
  });
});
