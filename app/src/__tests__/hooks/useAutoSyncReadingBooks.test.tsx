import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const mockUser: { current: { id: string } | null } = { current: { id: 'user-1' } };
const mockSettings: { current: { autoSyncReadingBooks: boolean } } = {
  current: { autoSyncReadingBooks: true },
};
const mockLibrary: { current: Array<Record<string, unknown>> } = { current: [] };

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveLibraryBooks: (books: unknown) => saveLibraryBooks(books) } }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: mockSettings.current }),
  },
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: Object.assign(() => ({ libraryLoaded: true }), {
    getState: () => ({
      library: mockLibrary.current,
      setLibrary: (books: Array<Record<string, unknown>>) => setLibrary(books),
    }),
  }),
}));

vi.mock('@/services/mybooksService', () => ({
  getBooksByType: (type: string, page: number, num: number) => getBooksByType(type, page, num),
}));

vi.mock('@/services/transferManager', () => ({
  transferManager: {
    queueDownloads: (books: unknown[], priority?: number, isBackground?: boolean) =>
      queueDownloads(books, priority, isBackground),
  },
}));

const saveLibraryBooks = vi.fn(async () => {});
const setLibrary = vi.fn((books: Array<Record<string, unknown>>) => {
  mockLibrary.current = books;
});
const getBooksByType = vi.fn();
const queueDownloads = vi.fn();

vi.mock('@/utils/bookConverter', () => ({
  convertMyBooksToLocalBooks: (cloudBooks: Array<{ id: number; title: string; author: string }>) =>
    cloudBooks.map((b) => ({
      hash: `cloud-${b.id}-epub`,
      title: b.title,
      author: b.author,
      storageType: 'cloud',
      format: 'EPUB',
      createdAt: 0,
      updatedAt: 0,
    })),
  hasLocalCopy: (
    cloudBook: { title: string; author: string },
    localBooks: Array<{ storageType?: string; title: string; author: string }>,
  ) =>
    localBooks.some(
      (b) =>
        b.storageType !== 'cloud' && b.title === cloudBook.title && b.author === cloudBook.author,
    ),
}));

import { eventDispatcher } from '@/utils/event';
import { useAutoSyncReadingBooks } from '@/hooks/useAutoSyncReadingBooks';

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mockUser.current = { id: 'user-1' };
  mockSettings.current = { autoSyncReadingBooks: true };
  mockLibrary.current = [];
  saveLibraryBooks.mockClear();
  setLibrary.mockClear();
  getBooksByType.mockReset();
  queueDownloads.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useAutoSyncReadingBooks', () => {
  test('downloads reading books that are missing locally', async () => {
    getBooksByType.mockResolvedValue({
      books: [{ id: 1, title: 'Book One', author: 'Author A' }],
      total: 1,
    });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();

    expect(getBooksByType).toHaveBeenCalledWith('reading', 1, expect.any(Number));
    expect(setLibrary).toHaveBeenCalledTimes(1);
    expect(mockLibrary.current).toEqual([
      expect.objectContaining({ hash: 'cloud-1-epub', title: 'Book One' }),
    ]);
    expect(saveLibraryBooks).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(queueDownloads).toHaveBeenCalledTimes(1);
    expect(queueDownloads).toHaveBeenCalledWith(
      [expect.objectContaining({ hash: 'cloud-1-epub' })],
      expect.any(Number),
      true,
    );
  });

  test('does nothing when the setting is disabled', async () => {
    mockSettings.current = { autoSyncReadingBooks: false };
    getBooksByType.mockResolvedValue({ books: [], total: 0 });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();

    expect(getBooksByType).not.toHaveBeenCalled();
  });

  test('does nothing when the user is not logged in', async () => {
    mockUser.current = null;
    getBooksByType.mockResolvedValue({ books: [], total: 0 });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();

    expect(getBooksByType).not.toHaveBeenCalled();
  });

  test('skips books that already have a downloaded local copy', async () => {
    mockLibrary.current = [
      { hash: 'cloud-1-epub', title: 'Book One', author: 'Author A', downloadedAt: 123 },
    ];
    getBooksByType.mockResolvedValue({
      books: [{ id: 1, title: 'Book One', author: 'Author A' }],
      total: 1,
    });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(setLibrary).not.toHaveBeenCalled();
    expect(queueDownloads).not.toHaveBeenCalled();
  });

  test('skips books that already exist locally under a different hash', async () => {
    mockLibrary.current = [{ hash: 'local-1', title: 'Book One', author: 'Author A' }];
    getBooksByType.mockResolvedValue({
      books: [{ id: 1, title: 'Book One', author: 'Author A' }],
      total: 1,
    });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(setLibrary).not.toHaveBeenCalled();
    expect(queueDownloads).not.toHaveBeenCalled();
  });

  test('queues a download for a cloud entry already in the library but not yet downloaded', async () => {
    mockLibrary.current = [{ hash: 'cloud-1-epub', title: 'Book One', author: 'Author A' }];
    getBooksByType.mockResolvedValue({
      books: [{ id: 1, title: 'Book One', author: 'Author A' }],
      total: 1,
    });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();

    expect(setLibrary).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(queueDownloads).toHaveBeenCalledTimes(1);
  });

  test('queues all missing books in a single batch call, not one call per book', async () => {
    getBooksByType.mockResolvedValue({
      books: [
        { id: 1, title: 'Book One', author: 'Author A' },
        { id: 2, title: 'Book Two', author: 'Author B' },
        { id: 3, title: 'Book Three', author: 'Author C' },
      ],
      total: 3,
    });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // A loop calling queueDownload() per book is exactly the burst that
    // froze the app on Android (see transferManager.queueDownloads); the
    // hook must hand the whole list to one batch call instead.
    expect(queueDownloads).toHaveBeenCalledTimes(1);
    const [queuedBooks] = queueDownloads.mock.calls[0]!;
    expect(queuedBooks).toHaveLength(3);
  });

  test('a forced manual sync bypasses a disabled autoSyncReadingBooks setting', async () => {
    // This is exactly the "Sync Reading Books from Library" button's
    // scenario: LibraryEmptyState only shows it when the setting is OFF, so
    // the manual trigger must not hit the same gate the background/auto
    // trigger respects, or clicking it would silently no-op.
    mockSettings.current = { autoSyncReadingBooks: false };
    getBooksByType.mockResolvedValue({
      books: [{ id: 1, title: 'Book One', author: 'Author A' }],
      total: 1,
    });

    const { result } = renderHook(() => useAutoSyncReadingBooks());
    await settle();
    // The passive auto-trigger on mount still respects the setting.
    expect(getBooksByType).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.syncReadingBooks(true);
    });

    expect(getBooksByType).toHaveBeenCalledWith('reading', 1, expect.any(Number));
    expect(setLibrary).toHaveBeenCalledTimes(1);
  });

  test('re-syncs immediately when the check-reading-books-sync event fires', async () => {
    getBooksByType.mockResolvedValue({
      books: [{ id: 1, title: 'Book One', author: 'Author A' }],
      total: 1,
    });

    renderHook(() => useAutoSyncReadingBooks());
    await settle();
    expect(getBooksByType).toHaveBeenCalledTimes(1);

    await act(async () => {
      await eventDispatcher.dispatch('check-reading-books-sync');
    });
    expect(getBooksByType).toHaveBeenCalledTimes(2);
  });
});
