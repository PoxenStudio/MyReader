import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

const getBookDetail = vi.fn();
vi.mock('@/services/mybooksService', () => ({
  getBookDetail: (...args: unknown[]) => getBookDetail(...args),
}));

import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { MyBooksBook } from '@/services/mybooksService';
import { ensureMyBooksBookLocal } from '@/libs/myBooksEmbedImport';
import { buildCloudBookHash } from '@/utils/bookConverter';

function makeAppService(overrides: Partial<AppService> = {}): AppService {
  return {
    loadLibraryBooks: vi.fn().mockResolvedValue([]),
    saveLibraryBooks: vi.fn().mockResolvedValue(undefined),
    isBookAvailable: vi.fn().mockResolvedValue(false),
    downloadBook: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AppService;
}

function makeCloudBook(overrides: Partial<MyBooksBook> = {}): MyBooksBook {
  return {
    id: 42,
    title: 'Test Book',
    rating: 0,
    timestamp: '',
    pubdate: '',
    author: 'Author',
    authors: ['Author'],
    author_sort: 'Author',
    tag: '',
    tags: [],
    publisher: '',
    comments: '',
    series: '',
    series_index: 0,
    languages: [],
    isbn: '',
    img: '',
    thumb: '',
    collector: '',
    count_visit: 0,
    count_download: 0,
    sole: false,
    has_audio: 0,
    book_type: 0,
    book_count: 1,
    state: {
      favorite: 0,
      favorite_date: null,
      wants: 0,
      wants_date: null,
      read_state: 0,
      read_date: null,
      online_read: 0,
      download: 0,
    },
    category: '',
    ext_link: '',
    files: [
      { format: 'epub', size: 100, href: '/api/book/42.epub' },
      { format: 'pdf', size: 200, href: '/api/book/42.pdf' },
    ],
    dynamic_cover: 0,
    ...overrides,
  };
}

describe('ensureMyBooksBookLocal', () => {
  beforeEach(() => {
    getBookDetail.mockReset();
    useLibraryStore.setState({
      library: [],
      libraryLoaded: false,
      isSyncing: false,
      syncProgress: 0,
      currentBookshelf: [],
      selectedBooks: new Set(),
      groups: {},
      hashIndex: new Map(),
      visibleLibrary: [],
    });
  });

  test('book already local with bytes present: returns it without downloading', async () => {
    const hash = buildCloudBookHash(42, 'EPUB');
    const localBook: Book = {
      hash,
      format: 'EPUB',
      title: 'Test Book',
      author: 'Author',
      downloadedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    };
    useLibraryStore.getState().setLibrary([localBook]);

    const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(true) });

    const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService });

    expect(result.hash).toBe(hash);
    expect(appService.downloadBook).not.toHaveBeenCalled();
    expect(getBookDetail).not.toHaveBeenCalled();
  });

  test('book already local but bytes missing: downloads bytes and persists', async () => {
    const hash = buildCloudBookHash(42, 'EPUB');
    const localBook: Book = {
      hash,
      format: 'EPUB',
      title: 'Test Book',
      author: 'Author',
      createdAt: 1000,
      updatedAt: 1000,
    };
    useLibraryStore.getState().setLibrary([localBook]);

    const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(true) });

    const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService });

    expect(appService.downloadBook).toHaveBeenCalledWith(localBook, false, false, undefined);
    expect(appService.saveLibraryBooks).toHaveBeenCalled();
    expect(result.downloadedAt).toBeDefined();
  });

  test('book not local: fetches metadata, builds a cloud Book with the deterministic hash, downloads it', async () => {
    getBookDetail.mockResolvedValue(makeCloudBook());
    const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(true) });

    const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'pdf', appService });

    expect(getBookDetail).toHaveBeenCalledWith(42);
    expect(result.hash).toBe(buildCloudBookHash(42, 'PDF'));
    expect(result.format).toBe('PDF');
    expect(result.bookId).toBe(42);
    expect(appService.downloadBook).toHaveBeenCalledWith(result, false, false, undefined);
    expect(appService.saveLibraryBooks).toHaveBeenCalled();
  });

  test('format omitted: falls back to the primary format from MyBooks metadata', async () => {
    getBookDetail.mockResolvedValue(makeCloudBook());
    const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(true) });

    const result = await ensureMyBooksBookLocal({ bookId: 42, appService });

    expect(result.hash).toBe(buildCloudBookHash(42, 'EPUB'));
    expect(result.format).toBe('EPUB');
  });

  test('download succeeds but bytes still missing: throws', async () => {
    getBookDetail.mockResolvedValue(makeCloudBook());
    const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(false) });

    await expect(
      ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService }),
    ).rejects.toThrow('Could not download MyBooks book');
  });

  test('book id unknown to MyBooks: throws', async () => {
    getBookDetail.mockResolvedValue(null);
    const appService = makeAppService();

    await expect(
      ensureMyBooksBookLocal({ bookId: 999, format: 'epub', appService }),
    ).rejects.toThrow('Book not found on MyBooks');
  });
});
