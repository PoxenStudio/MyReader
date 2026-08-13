import { describe, test, expect, vi } from 'vitest';
import type { FileSystem } from '@/types/system';
import type { Book } from '@/types/book';
import { loadLibraryBooks } from '@/services/libraryService';

function makeFs(books: Book[]): FileSystem {
  return {
    exists: vi.fn().mockResolvedValue(true),
    createDir: vi.fn(),
    readFile: vi.fn().mockResolvedValue(JSON.stringify(books)),
  } as unknown as FileSystem;
}

describe('loadLibraryBooks', () => {
  test('regenerates the cover for a locally-downloaded book', async () => {
    const book: Book = {
      hash: 'local-1',
      format: 'EPUB',
      title: 'Local Book',
      author: 'Author',
      downloadedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      coverImageUrl: 'stale-blob-url',
    };
    const generateCoverImageUrl = vi.fn().mockResolvedValue('fresh-blob-url');

    const [result] = await loadLibraryBooks(makeFs([book]), generateCoverImageUrl);

    expect(generateCoverImageUrl).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'local-1' }),
    );
    expect(result!.coverImageUrl).toBe('fresh-blob-url');
  });

  test('a cloud book with no local bytes derives its cover from originCoverUrl instead of a broken local-file lookup', async () => {
    // Mirrors ensureMyBooksBookLocal's streaming-branch Book (myBooksEmbedImport.ts):
    // storageType 'cloud', never downloaded. generateCoverImageUrl assumes a
    // local file on disk — calling it here would silently return a broken
    // relative path (webAppService's getBlobURL catch-fallback), which the
    // browser then resolves against the current page, producing garbage like
    // /reader/MyReader/Books/.../cover.png.
    //
    // coverImageUrl itself is never persisted (saveLibraryBooks strips it —
    // it's normally an ephemeral blob: URL), so on reload the only durable
    // signal is originCoverUrl, which does survive persistence.
    const book: Book = {
      hash: 'cloud-1-epub',
      bookId: 1,
      format: 'EPUB',
      title: 'Book 1',
      author: '',
      storageType: 'cloud',
      createdAt: 1000,
      updatedAt: 1000,
      originCoverUrl: 'http://localhost:3000/get/cover/1.jpg',
    };
    const generateCoverImageUrl = vi.fn().mockResolvedValue('broken-local-path');

    const [result] = await loadLibraryBooks(makeFs([book]), generateCoverImageUrl);

    expect(generateCoverImageUrl).not.toHaveBeenCalled();
    expect(result!.coverImageUrl).toBe('http://localhost:3000/get/cover/1.jpg');
  });

  test('a cloud book with no local bytes and no originCoverUrl on file gets no cover, rather than a broken local-file lookup', async () => {
    const book: Book = {
      hash: 'cloud-2-epub',
      bookId: 2,
      format: 'EPUB',
      title: 'Book 2',
      author: '',
      storageType: 'cloud',
      createdAt: 1000,
      updatedAt: 1000,
    };
    const generateCoverImageUrl = vi.fn().mockResolvedValue('broken-local-path');

    const [result] = await loadLibraryBooks(makeFs([book]), generateCoverImageUrl);

    expect(generateCoverImageUrl).not.toHaveBeenCalled();
    expect(result!.coverImageUrl).toBeUndefined();
  });
});
