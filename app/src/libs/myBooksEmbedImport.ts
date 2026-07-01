import type { Book, BookFormat } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { getBookDetail } from '@/services/mybooksService';
import { buildCloudBookHash, convertMyBooksToLocalBook } from '@/utils/bookConverter';
import { ProgressHandler } from '@/utils/transfer';

const EMBED_FORMATS: Record<string, BookFormat> = {
  epub: 'EPUB',
  pdf: 'PDF',
};

export const resolveEmbedFormat = (format?: string | null): BookFormat | undefined =>
  format ? EMBED_FORMATS[format.toLowerCase()] : undefined;

interface EnsureMyBooksBookLocalArgs {
  bookId: number;
  format?: string | null;
  appService: AppService;
  onProgress?: ProgressHandler;
}

/**
 * Same three-branch shape as ensureSharedBookLocal (shareImport.ts), adapted for
 * MyBooks cloud books opened via the embedded reader entry point instead of a
 * share token. The bookHash is always the deterministic `cloud-<bookId>-<format>`
 * from buildCloudBookHash, never the partialMD5 importBook would otherwise
 * compute, so repeated opens land on the same local/sync key.
 */
export const ensureMyBooksBookLocal = async ({
  bookId,
  format,
  appService,
  onProgress,
}: EnsureMyBooksBookLocalArgs): Promise<Book> => {
  const storeState = useLibraryStore.getState();
  const wasLibraryLoaded = storeState.libraryLoaded;
  const library = wasLibraryLoaded ? storeState.library : await appService.loadLibraryBooks();
  const findByHash = (hash: string): Book | undefined =>
    wasLibraryLoaded ? storeState.getBookByHash(hash) : library.find((b) => b.hash === hash);

  const persistLibrary = async () => {
    await appService.saveLibraryBooks(library);
    if (wasLibraryLoaded) storeState.setLibrary(library);
  };

  const downloadExisting = async (book: Book): Promise<Book> => {
    const bytesPresent = !!book.downloadedAt && (await appService.isBookAvailable(book));
    if (bytesPresent) return book;

    await appService.downloadBook(book, false, false, onProgress);
    if (!(await appService.isBookAvailable(book))) {
      throw new Error('Could not download MyBooks book');
    }
    if (!book.downloadedAt) book.downloadedAt = Date.now();
    book.updatedAt = Date.now();
    await persistLibrary();
    return book;
  };

  const resolvedFormat = resolveEmbedFormat(format);
  if (resolvedFormat) {
    const existing = findByHash(buildCloudBookHash(bookId, resolvedFormat));
    if (existing) return downloadExisting(existing);
  }

  const cloudBook = await getBookDetail(bookId);
  if (!cloudBook) {
    throw new Error('Book not found on MyBooks');
  }

  const stub = convertMyBooksToLocalBook(cloudBook);
  const finalFormat = resolvedFormat ?? stub.format;
  const hash = buildCloudBookHash(bookId, finalFormat);

  const existingByFinalHash = findByHash(hash);
  if (existingByFinalHash) return downloadExisting(existingByFinalHash);

  const book: Book = { ...stub, hash, format: finalFormat, sourceFormat: finalFormat };
  await appService.downloadBook(book, false, false, onProgress);
  if (!(await appService.isBookAvailable(book))) {
    throw new Error('Could not download MyBooks book');
  }
  book.downloadedAt = Date.now();

  library.push(book);
  await persistLibrary();
  return book;
};
