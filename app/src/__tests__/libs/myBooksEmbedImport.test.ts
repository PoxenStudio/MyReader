import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

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
    // Default: the local-file streaming probe fails (as it would on any
    // non-embedded deployment, or when MyBooks can't resolve the path) —
    // tests exercising the download flow rely on this so they aren't
    // accidentally short-circuited by the streaming branch. Tests that want
    // to exercise streaming override this per-test.
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('no local-file service'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  test('book already local but bytes missing, streaming unavailable: downloads bytes and persists', async () => {
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

  test('book not local, streaming unavailable: fetches metadata, builds a cloud Book with the deterministic hash, downloads it', async () => {
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

  describe('local-file streaming (bookId+format probe, no physical path ever sent to the browser)', () => {
    test('probe succeeds, no prior entry: builds a transient streaming Book, persisting its metadata (not bytes) so it survives the readerx/open → /reader navigation', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      getBookDetail.mockResolvedValue(
        makeCloudBook({
          series: 'The Series',
          series_index: 2,
          publisher: 'Pub Co',
          pubdate: '2020-01-01',
          comments: 'A description',
          rating: 8,
        }),
      );
      const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(false) });

      const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService });

      expect(result.hash).toBe(buildCloudBookHash(42, 'EPUB'));
      expect(result.bookId).toBe(42);
      // Must be absolute: resolveBookContentSource (bookContent.ts) only
      // recognizes a book.url as an openable RemoteFile source when
      // isValidURL(book.url) parses it as a full http(s) URL — a relative
      // path silently falls through to `{ kind: 'missing' }`, throwing
      // BookFileNotFoundError when the reader tries to open it.
      expect(result.url).toBe('http://localhost:3000/api/mybooks/local-file?bookId=42&format=epub');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3000/api/mybooks/local-file?bookId=42&format=epub',
        expect.objectContaining({ method: 'HEAD', credentials: 'include' }),
      );
      expect(appService.downloadBook).not.toHaveBeenCalled();
      // Series/rating/publisher/published/description aren't in the
      // bookId+format probe — only MyBooks' book-detail endpoint has them —
      // so streaming still fetches this (cheap: JSON metadata, not bytes).
      expect(getBookDetail).toHaveBeenCalledWith(42);
      expect(result.rating).toBe(8);
      expect(result.metadata?.series).toBe('The Series');
      expect(result.metadata?.seriesIndex).toBe(2);
      expect(result.metadata?.publisher).toBe('Pub Co');
      expect(result.metadata?.published).toBe('2020-01-01');
      expect(result.metadata?.description).toBe('A description');
      // Points straight at MyBooks' own cover endpoint (same origin in the
      // merged deployment — see document/MyReader_Embedded_WebApp.md) rather
      // than a local file: this book's bytes were never downloaded, so
      // there's no local cover to extract. Both fields matter: coverImageUrl
      // for this page's own in-memory render, originCoverUrl because it's
      // the one saveLibraryBooks doesn't strip — loadLibraryBooks
      // (libraryService.ts) rebuilds coverImageUrl from it on every future
      // reload instead of clobbering it with a broken local-file lookup.
      expect(result.coverImageUrl).toBe('http://localhost:3000/get/cover/42.jpg');
      expect(result.originCoverUrl).toBe('http://localhost:3000/get/cover/42.jpg');
      // Metadata (title/hash/url, not the file's bytes) must be persisted:
      // navigating from pages/readerx/open.tsx to /reader crosses a Pages
      // Router ↔ App Router boundary, which Next.js falls back to a hard
      // navigation for — an in-memory-only entry wouldn't survive that and
      // the reader would throw "Book not found".
      expect(appService.saveLibraryBooks).toHaveBeenCalledWith([
        expect.objectContaining({ hash: result.hash, url: result.url }),
      ]);
      expect(useLibraryStore.getState().getBookByHash(result.hash)).toBe(result);
    });

    test('probe succeeds, entry exists without bytes: switches it to streaming instead of downloading, persists the updated url, and fills in metadata it never had', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
      getBookDetail.mockResolvedValue(makeCloudBook({ publisher: 'Pub Co', rating: 6 }));
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

      const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(false) });

      const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService });

      expect(result).toBe(localBook);
      expect(result.url).toBe('http://localhost:3000/api/mybooks/local-file?bookId=42&format=epub');
      expect(result.coverImageUrl).toBe('http://localhost:3000/get/cover/42.jpg');
      expect(result.originCoverUrl).toBe('http://localhost:3000/get/cover/42.jpg');
      expect(result.metadata?.publisher).toBe('Pub Co');
      expect(result.rating).toBe(6);
      expect(appService.downloadBook).not.toHaveBeenCalled();
      expect(appService.saveLibraryBooks).toHaveBeenCalledWith([
        expect.objectContaining({ hash, url: result.url }),
      ]);
    });

    test('probe succeeds, entry already has metadata (e.g. user-edited via BookDetailEdit): leaves it alone', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
      const hash = buildCloudBookHash(42, 'EPUB');
      const localBook: Book = {
        hash,
        format: 'EPUB',
        title: 'Test Book',
        author: 'Author',
        rating: 10,
        metadata: { title: 'Test Book', author: 'Author', publisher: 'My Own Edit' },
        createdAt: 1000,
        updatedAt: 1000,
      };
      useLibraryStore.getState().setLibrary([localBook]);

      const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(false) });

      const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService });

      expect(getBookDetail).not.toHaveBeenCalled();
      expect(result.metadata?.publisher).toBe('My Own Edit');
      expect(result.rating).toBe(10);
    });

    test('probe succeeds, entry exists with a stale broken cover from before the coverImageUrl fix: corrects it', async () => {
      // A book persisted by an older build of ensureMyBooksBookLocal (before
      // it set coverImageUrl at all) can carry the broken local-file lookup
      // result (see libraryService.ts) baked into disk. Since
      // loadLibraryBooks now deliberately leaves a cloud/undownloaded book's
      // coverImageUrl alone, nothing else will ever correct it — this must.
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
      const hash = buildCloudBookHash(42, 'EPUB');
      const localBook: Book = {
        hash,
        format: 'EPUB',
        title: 'Test Book',
        author: 'Author',
        createdAt: 1000,
        updatedAt: 1000,
        coverImageUrl: 'MyReader/Books/cloud-42-epub/cover.png',
      };
      useLibraryStore.getState().setLibrary([localBook]);

      const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(false) });

      const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService });

      expect(result.coverImageUrl).toBe('http://localhost:3000/get/cover/42.jpg');
      expect(result.originCoverUrl).toBe('http://localhost:3000/get/cover/42.jpg');
    });

    test('probe fails (e.g. non-embedded deployment): falls back to the download flow unchanged', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
      const appService = makeAppService({ isBookAvailable: vi.fn().mockResolvedValue(true) });
      getBookDetail.mockResolvedValue(makeCloudBook());

      const result = await ensureMyBooksBookLocal({ bookId: 42, format: 'epub', appService });

      expect(getBookDetail).toHaveBeenCalledWith(42);
      expect(appService.downloadBook).toHaveBeenCalled();
      expect(result.url).not.toContain('local-file');
    });

    test('a fully-downloaded local copy is preferred over streaming and never triggers a probe', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
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

      expect(result).toBe(localBook);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
