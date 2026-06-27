import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteBook, downloadMyBooksBook, uploadBook } from '@/services/cloudService';
import { Book, BookFormat } from '@/types/book';
import { AppService, FileSystem } from '@/types/system';

vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/environment')>();
  return {
    ...actual,
    isTauriAppPlatform: vi.fn(() => false),
  };
});

const webDownloadMock = vi.fn();
vi.mock('@/utils/transfer', () => ({
  webDownload: (...args: unknown[]) => webDownloadMock(...args),
}));

const txtConvertMock = vi.fn();
vi.mock('@/utils/txt', () => ({
  TxtToEpubConverter: class {
    convert(options: { file: File }) {
      return txtConvertMock(options);
    }
  },
}));

// Mock external dependencies
vi.mock('@/utils/book', () => ({
  getDir: vi.fn((book: Book) => book.hash),
  getLocalBookFilename: vi.fn((book: Book) => `${book.hash}/${book.title}.epub`),
  getRemoteBookFilename: vi.fn((book: Book) => `${book.hash}/${book.hash}.epub`),
  getCoverFilename: vi.fn((book: Book) => `${book.hash}/cover.png`),
}));

vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
}));

const uploadBookToMyBooksMock = vi.fn().mockResolvedValue(123);
const deleteBookFromMyBooksMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/mybooksService', () => ({
  uploadBookToMyBooks: (...args: unknown[]) => uploadBookToMyBooksMock(...args),
  deleteBookFromMyBooks: (...args: unknown[]) => deleteBookFromMyBooksMock(...args),
}));

vi.mock('@/utils/file', () => ({
  ClosableFile: class {},
  RemoteFile: class {
    async open() {
      return new File(['content'], 'test.epub');
    }
  },
}));

function createMockBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'abc123',
    format: 'EPUB' as BookFormat,
    title: 'Test Book',
    author: 'Author',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    uploadedAt: null,
    downloadedAt: Date.now(),
    coverDownloadedAt: Date.now(),
    ...overrides,
  };
}

function createMockFs(): FileSystem {
  return {
    resolvePath: vi
      .fn()
      .mockReturnValue({ baseDir: 0, basePrefix: async () => '', fp: 'test', base: 'Books' }),
    getURL: vi.fn().mockReturnValue('url'),
    getBlobURL: vi.fn().mockResolvedValue('blob:url'),
    getImageURL: vi.fn().mockResolvedValue('image:url'),
    openFile: vi.fn().mockResolvedValue(new File(['content'], 'test.epub')),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    readDir: vi.fn().mockResolvedValue([]),
    createDir: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stats: vi.fn().mockResolvedValue({
      isFile: true,
      isDirectory: false,
      size: 100,
      mtime: null,
      atime: null,
      birthtime: null,
    }),
    getPrefix: vi.fn().mockResolvedValue('MyReader/Books'),
  };
}

describe('cloudService', () => {
  let mockFs: FileSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs = createMockFs();
    deleteBookFromMyBooksMock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('deleteBook', () => {
    describe('local delete action', () => {
      test('removes the local book file', async () => {
        const book = createMockBook();
        await deleteBook(mockFs, book, 'local');

        expect(mockFs.exists).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
      });

      test('sets downloadedAt to null', async () => {
        const book = createMockBook({ downloadedAt: 12345 });
        await deleteBook(mockFs, book, 'local');

        expect(book.downloadedAt).toBeNull();
      });

      test('does not set deletedAt for local-only delete', async () => {
        const book = createMockBook({ deletedAt: null });
        await deleteBook(mockFs, book, 'local');

        // local action does not modify deletedAt
        expect(book.deletedAt).toBeNull();
      });

      test('skips removal when file does not exist', async () => {
        vi.mocked(mockFs.exists).mockResolvedValue(false);
        const book = createMockBook();
        await deleteBook(mockFs, book, 'local');

        expect(mockFs.removeFile).not.toHaveBeenCalled();
      });

      test('only deletes book file, not cover (local action)', async () => {
        const book = createMockBook();
        await deleteBook(mockFs, book, 'local');

        // local action only deletes the book file
        expect(mockFs.removeFile).toHaveBeenCalledTimes(1);
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
      });

      test('removes the managed copy when filePath is stale', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/missing.epub' });
        const managedPath = `${book.hash}/${book.title}.epub`;
        vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
          return base === 'Books' && path === managedPath;
        });

        await deleteBook(mockFs, book, 'local');

        expect(mockFs.removeFile).toHaveBeenCalledWith(managedPath, 'Books');
        expect(mockFs.removeFile).not.toHaveBeenCalledWith(
          '/Users/me/Library/missing.epub',
          'None',
        );
      });
    });

    describe('both delete action', () => {
      test('removes book file and cover', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'both');

        // 'both' deletes localBookFilename + coverFilename
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/cover.png`, 'Books');
      });

      test('sets deletedAt, clears downloadedAt and coverDownloadedAt', async () => {
        const book = createMockBook({
          uploadedAt: 1000,
          downloadedAt: 2000,
          coverDownloadedAt: 3000,
        });
        await deleteBook(mockFs, book, 'both');

        expect(book.deletedAt).toBeGreaterThan(0);
        expect(book.downloadedAt).toBeNull();
        expect(book.coverDownloadedAt).toBeNull();
      });

      test('clears uploadedAt when uploaded', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'both');

        expect(book.uploadedAt).toBeNull();
      });
    });

    describe('cloud delete action', () => {
      test('does not delete local files', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'cloud');

        expect(mockFs.removeFile).not.toHaveBeenCalled();
      });

      test('clears uploadedAt when previously uploaded', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'cloud');

        expect(book.uploadedAt).toBeNull();
      });

      test('leaves uploadedAt null when not uploaded', async () => {
        const book = createMockBook({ uploadedAt: null });
        await deleteBook(mockFs, book, 'cloud');

        expect(book.uploadedAt).toBeNull();
      });
    });

    describe('remote delete action', () => {
      test('calls deleteBookFromMyBooks with the MyBooks id and does not touch local files', async () => {
        const book = createMockBook({ bookId: 42, downloadedAt: null });
        await deleteBook(mockFs, book, 'remote');

        expect(deleteBookFromMyBooksMock).toHaveBeenCalledWith(42);
        expect(mockFs.removeFile).not.toHaveBeenCalled();
        expect(book.deletedAt).toBeGreaterThan(0);
      });

      test('falls back to the id encoded in a cloud- hash when bookId is unset', async () => {
        const book = createMockBook({ hash: 'cloud-99-epub', bookId: undefined });
        await deleteBook(mockFs, book, 'remote');

        expect(deleteBookFromMyBooksMock).toHaveBeenCalledWith(99);
      });

      test('throws without calling the API when no MyBooks id can be determined', async () => {
        const book = createMockBook({ hash: 'local-only', bookId: undefined });
        await expect(deleteBook(mockFs, book, 'remote')).rejects.toThrow('Missing MyBooks book id');

        expect(deleteBookFromMyBooksMock).not.toHaveBeenCalled();
      });

      test('propagates errors from the MyBooks API', async () => {
        deleteBookFromMyBooksMock.mockRejectedValueOnce(new Error('admin permission required'));
        const book = createMockBook({ bookId: 42 });

        await expect(deleteBook(mockFs, book, 'remote')).rejects.toThrow(
          'admin permission required',
        );
      });
    });

    // In-place imports keep their content at a user-controlled location
    // (book.filePath, base 'None') rather than under Books/<hash>/. For
    // 'local'/'both' deletes that source file IS the local copy and gets
    // removed (symmetric with deleting Books/<hash>/<title>.epub for a
    // normal book). The cloud upload path is shared, so cross-device sync
    // can still pull the book back.
    describe('in-place (book.filePath set)', () => {
      const mockInPlaceExists = (book: Book, coverExists = true) => {
        vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
          if (base === 'None' && path === book.filePath) return true;
          if (base === 'Books' && path === `${book.hash}/cover.png`) return coverExists;
          return false;
        });
      };

      test('local action removes the user-controlled source file', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/sample.epub' });
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'local');

        // The source file is read from base 'None' (absolute path), not Books/.
        expect(mockFs.removeFile).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
      });

      test('local action does not remove Books/<hash>/<title>.epub', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/sample.epub' });
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'local');

        // The hash-copy path lives only on a normal book; for an in-place book,
        // the resolver can probe it, but deletion must target the external source.
        expect(mockFs.removeFile).not.toHaveBeenCalledWith(
          `${book.hash}/${book.title}.epub`,
          'Books',
        );
      });

      test('local action still clears downloadedAt', async () => {
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 12345,
        });
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'local');
        expect(book.downloadedAt).toBeNull();
      });

      test('local action does not throw when the source file is missing', async () => {
        // exists() returns false → no removeFile call, but no error either.
        vi.mocked(mockFs.exists).mockResolvedValue(false);
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 12345,
        });
        await deleteBook(mockFs, book, 'local');

        expect(mockFs.removeFile).not.toHaveBeenCalled();
        expect(book.downloadedAt).toBeNull();
      });

      test('local action swallows errors from removeFile (best-effort source delete)', async () => {
        vi.mocked(mockFs.removeFile).mockRejectedValueOnce(new Error('EPERM'));
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 12345,
        });
        mockInPlaceExists(book);

        // Must not throw, and must still flip the metadata bit so the UI
        // reflects the user's delete intent.
        await deleteBook(mockFs, book, 'local');
        expect(book.downloadedAt).toBeNull();
      });

      test('both action removes both the source file and the cover sidecar', async () => {
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          uploadedAt: null,
        });
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'both');

        // Source file under user-controlled path:
        expect(mockFs.removeFile).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
        // Cover sidecar under Books/<hash>/:
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/cover.png`, 'Books');
        // We must never poke at Books/<hash>/<title>.epub for an in-place book.
        expect(mockFs.removeFile).not.toHaveBeenCalledWith(
          `${book.hash}/${book.title}.epub`,
          'Books',
        );
      });

      test('both action still flips deletedAt/downloadedAt/coverDownloadedAt', async () => {
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 2000,
          coverDownloadedAt: 3000,
        });
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'both');

        expect(book.deletedAt).toBeGreaterThan(0);
        expect(book.downloadedAt).toBeNull();
        expect(book.coverDownloadedAt).toBeNull();
      });
    });
  });

  describe('uploadBook', () => {
    test('uses an existing managed copy before a stale filePath', async () => {
      const book = createMockBook({ filePath: '/Users/me/Library/missing.epub' });
      const managedPath = `${book.hash}/${book.title}.epub`;
      vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
        return base === 'Books' && path === managedPath;
      });

      await uploadBook(mockFs, book);

      expect(mockFs.exists).toHaveBeenCalledWith(managedPath, 'Books');
      expect(mockFs.exists).not.toHaveBeenCalledWith('/Users/me/Library/missing.epub', 'None');
      expect(mockFs.openFile).toHaveBeenCalledWith(managedPath, 'Books');
      expect(mockFs.openFile).not.toHaveBeenCalledWith(
        '/Users/me/Library/missing.epub',
        'None',
        expect.any(String),
      );
      expect(uploadBookToMyBooksMock).toHaveBeenCalledWith(
        expect.any(Blob),
        `${book.hash}/${book.hash}.epub`,
      );
      expect(book.uploadedAt).toBeGreaterThan(0);
      expect(book.storageType).toBe('cloud');
    });

    test('does not mark a book uploaded when only the cover exists', async () => {
      const book = createMockBook({ uploadedAt: null, downloadedAt: null });
      const managedPath = `${book.hash}/${book.title}.epub`;
      const coverPath = `${book.hash}/cover.png`;
      vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
        return base === 'Books' && path === coverPath;
      });

      await expect(uploadBook(mockFs, book)).rejects.toThrow('Book file not uploaded');

      expect(uploadBookToMyBooksMock).not.toHaveBeenCalled();
      expect(book.uploadedAt).toBeNull();
      expect(mockFs.exists).toHaveBeenCalledWith(managedPath, 'Books');
    });
  });

  describe('downloadMyBooksBook', () => {
    const mockAppService = {
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppService;

    beforeEach(() => {
      webDownloadMock.mockReset();
      webDownloadMock.mockResolvedValue({ blob: new Blob(['content']) });
      txtConvertMock.mockReset();
      localStorage.setItem('mybooks_host', 'https://mybooks.example.com');
    });

    afterEach(() => {
      localStorage.removeItem('mybooks_host');
    });

    test('downloads the file matching book.format, not files[0]', async () => {
      const book = createMockBook({
        hash: 'cloud-123-pdf',
        format: 'PDF' as BookFormat,
        files: [
          { format: 'EPUB' as BookFormat, size: 1, href: '/api/book/123.epub' },
          { format: 'PDF' as BookFormat, size: 2, href: '/api/book/123.pdf' },
        ],
      });

      await downloadMyBooksBook(mockAppService, mockFs, 'Books', book);

      expect(webDownloadMock).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('/api/book/123.pdf')),
        undefined,
        undefined,
        'include',
      );
    });

    test('converts a TXT-format cloud download to EPUB before writing to disk', async () => {
      const book = createMockBook({
        hash: 'cloud-123-txt',
        format: 'TXT' as BookFormat,
        files: [
          { format: 'EPUB' as BookFormat, size: 1, href: '/api/book/123.epub' },
          { format: 'TXT' as BookFormat, size: 2, href: '/api/book/123.txt' },
        ],
      });
      const epubBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
      txtConvertMock.mockResolvedValue({
        file: new File([epubBytes], 'Test Book.epub'),
        bookTitle: 'Test Book',
        chapterCount: 1,
        language: 'en',
      });

      await downloadMyBooksBook(mockAppService, mockFs, 'Books', book);

      // The raw TXT bytes must be converted to EPUB before being persisted, since
      // DocumentLoader has no TXT parser and would otherwise return a null bookDoc.
      expect(txtConvertMock).toHaveBeenCalledTimes(1);
      expect(mockAppService.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${book.hash}/`),
        'None',
        epubBytes,
      );
    });
  });
});
