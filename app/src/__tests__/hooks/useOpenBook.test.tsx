import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { Book } from '@/types/book';

// makeBookAvailable's fast path (book already present locally) previously
// only stamped downloadedAt/coverDownloadedAt — a cloud book downloaded
// before covers were repointed to their local copy (see cloudService.ts's
// downloadMyBooksBook) kept a dead remote coverImageUrl forever, breaking
// every reader/TTS UI that renders it directly. Every open should self-heal
// that instead of requiring a re-download.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next-view-transitions', () => ({
  useTransitionRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/utils/nav', () => ({
  navigateToReader: vi.fn(),
  showReaderWindow: vi.fn(),
}));

const updateBookMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ updateBook: updateBookMock }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

const isBookAvailableMock = vi.fn().mockResolvedValue(true);
const generateCoverImageUrlMock = vi.fn().mockResolvedValue('asset://localhost/Books/cover.png');
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      isBookAvailable: isBookAvailableMock,
      generateCoverImageUrl: generateCoverImageUrlMock,
      supportsViewTransitionsAPI: false,
    },
  }),
}));

import { useOpenBook } from '@/app/library/hooks/useOpenBook';

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'cloud-1-epub',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    uploadedAt: null,
    storageType: 'cloud',
    downloadedAt: Date.now(),
    coverDownloadedAt: Date.now(),
    ...overrides,
  } as Book;
}

describe('useOpenBook.makeBookAvailable', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    isBookAvailableMock.mockResolvedValue(true);
  });

  const setup = () =>
    renderHook(() =>
      useOpenBook({ setLoading: vi.fn(), handleBookDownload: vi.fn().mockResolvedValue(true) }),
    );

  test('migrates a stale remote coverImageUrl to the local copy on open', async () => {
    const book = createBook({ coverImageUrl: 'https://mybooks.example.com/thumb/1.jpg' });
    const { result } = setup();

    const available = await result.current.makeBookAvailable(book);

    expect(available).toBe(true);
    expect(generateCoverImageUrlMock).toHaveBeenCalledWith(book);
    expect(book.coverImageUrl).toBe('asset://localhost/Books/cover.png');
    expect(updateBookMock).toHaveBeenCalledWith({}, book);
  });

  test('leaves an already-local coverImageUrl untouched', async () => {
    const book = createBook({ coverImageUrl: 'asset://localhost/Books/cover.png' });
    const { result } = setup();

    await result.current.makeBookAvailable(book);

    expect(generateCoverImageUrlMock).not.toHaveBeenCalled();
    expect(updateBookMock).not.toHaveBeenCalled();
  });

  test('does not touch coverImageUrl for a non-cloud, non-uploaded book', async () => {
    const book = createBook({
      hash: 'local-abc123',
      storageType: undefined,
      uploadedAt: null,
      coverImageUrl: 'https://example.com/cover.jpg',
    });
    const { result } = setup();

    const available = await result.current.makeBookAvailable(book);

    expect(available).toBe(true);
    expect(isBookAvailableMock).not.toHaveBeenCalled();
    expect(generateCoverImageUrlMock).not.toHaveBeenCalled();
    expect(book.coverImageUrl).toBe('https://example.com/cover.jpg');
  });
});
