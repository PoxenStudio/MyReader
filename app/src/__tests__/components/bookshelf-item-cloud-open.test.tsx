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

const navigateToReaderMock = vi.fn();
vi.mock('@/utils/nav', () => ({
  navigateToReader: (...args: unknown[]) => navigateToReaderMock(...args),
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

import BookshelfItem from '@/app/library/components/BookshelfItem';

const cloudBook: Book = {
  hash: 'cloud-123',
  format: 'EPUB',
  title: 'Cloud Book',
  author: 'Someone',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  storageType: 'cloud',
} as unknown as Book;

describe('BookshelfItem opening a cloud-only book', () => {
  beforeEach(() => {
    capturedOnTap = null;
    navigateToReaderMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('downloads the book before navigating to the reader instead of opening it directly', async () => {
    const handleBookDownload = vi.fn().mockResolvedValue(true);

    render(
      <BookshelfItem
        mode='grid'
        item={cloudBook}
        coverFit='crop'
        isSelectMode={false}
        itemSelected={false}
        transferProgress={null}
        setLoading={vi.fn()}
        toggleSelection={vi.fn()}
        handleGroupBooks={vi.fn()}
        handleBookDownload={handleBookDownload}
        handleBookUpload={vi.fn()}
        handleBookDelete={vi.fn()}
        handleSetSelectMode={vi.fn()}
        handleShowDetailsBook={vi.fn()}
        handleLibraryNavigation={vi.fn()}
        handleUpdateReadingStatus={vi.fn()}
      />,
    );

    expect(capturedOnTap).not.toBeNull();
    capturedOnTap!();

    await waitFor(() => expect(navigateToReaderMock).toHaveBeenCalled());
    expect(handleBookDownload).toHaveBeenCalledWith(cloudBook, { queued: false });
  });

  it('does not navigate to the reader if the download fails', async () => {
    const handleBookDownload = vi.fn().mockResolvedValue(false);

    render(
      <BookshelfItem
        mode='grid'
        item={cloudBook}
        coverFit='crop'
        isSelectMode={false}
        itemSelected={false}
        transferProgress={null}
        setLoading={vi.fn()}
        toggleSelection={vi.fn()}
        handleGroupBooks={vi.fn()}
        handleBookDownload={handleBookDownload}
        handleBookUpload={vi.fn()}
        handleBookDelete={vi.fn()}
        handleSetSelectMode={vi.fn()}
        handleShowDetailsBook={vi.fn()}
        handleLibraryNavigation={vi.fn()}
        handleUpdateReadingStatus={vi.fn()}
      />,
    );

    capturedOnTap!();

    await waitFor(() =>
      expect(handleBookDownload).toHaveBeenCalledWith(cloudBook, { queued: false }),
    );
    // Give any (incorrect) navigation a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });
});
