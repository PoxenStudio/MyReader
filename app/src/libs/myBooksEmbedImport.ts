import type { Book, BookFormat } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { getBookDetail } from '@/services/mybooksService';
import {
  buildCloudBookHash,
  buildMetadataFromCloudBook,
  convertMyBooksToLocalBook,
} from '@/utils/bookConverter';
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

// Must be absolute: resolveBookContentSource (bookContent.ts) only opens a
// book.url through RemoteFile when isValidURL(book.url) can parse it as a
// full http(s) URL — `new URL()` throws on a bare path with no base, so a
// relative URL here would silently resolve to `{ kind: 'missing' }` and the
// reader would throw BookFileNotFoundError instead of streaming the book.
const buildLocalFileStreamUrl = (bookId: number, format: BookFormat): string =>
  `${window.location.origin}/api/mybooks/local-file?bookId=${bookId}&format=${format.toLowerCase()}`;

// Same-origin in the merged deployment (see
// document/MyReader_Embedded_WebApp.md), so this is MyBooks' own cover
// endpoint reached directly — no need for the /api/mybooks/cover proxy,
// which is built for the "connect to an external MyBooks host" flow and
// requires a `host` query param this embedded flow never has.
const buildCoverUrl = (bookId: number): string =>
  `${window.location.origin}/get/cover/${bookId}.jpg`;

/**
 * Probe whether the same-container embedded deployment can stream this
 * book's bytes on demand (see document/MyReader_Embedded_WebApp.md §13)
 * instead of downloading the whole file into IndexedDB. A HEAD request never
 * exposes the physical path to the browser — MyReader's server resolves it
 * internally via a server-to-server call to MyBooks — and costs nothing more
 * than one small round trip; any failure (non-embedded deployment, book not
 * shared on disk, MyBooks down, …) just falls back to the download flow.
 */
const canStreamLocalFile = async (streamUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(streamUrl, { method: 'HEAD', credentials: 'include' });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Fills in `metadata` (series/publisher/published/description/…) and
 * `rating` from MyBooks' book-detail endpoint — the bookId+format probe that
 * gates streaming only confirms the file's readable, it doesn't carry any of
 * this. Skipped once `book.metadata` is already set, both to avoid an
 * unnecessary round trip on every repeat open and, more importantly, to
 * never clobber a user's manual edit (BookDetailEdit). Best-effort: a
 * failure here shouldn't block opening the book, so it never throws.
 */
const applyCloudMetadata = async (book: Book, bookId: number): Promise<void> => {
  if (book.metadata) return;
  try {
    const cloudBook = await getBookDetail(bookId);
    if (!cloudBook) return;
    book.metadata = buildMetadataFromCloudBook(cloudBook);
    book.rating ??= cloudBook.rating || undefined;
  } catch {
    // Metadata is a nice-to-have here; the book still streams fine without it.
  }
};

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
    const hash = buildCloudBookHash(bookId, resolvedFormat);
    const existing = findByHash(hash);

    // A fully-downloaded local copy (from a prior bookId-flow open) is
    // strictly better than streaming over Range — prefer it when present.
    if (existing?.downloadedAt && (await appService.isBookAvailable(existing))) {
      return existing;
    }

    const streamUrl = buildLocalFileStreamUrl(bookId, resolvedFormat);
    if (await canStreamLocalFile(streamUrl)) {
      if (existing) {
        existing.url = streamUrl;
        // Unconditional, not ||=: a book persisted before this fix existed
        // can carry a stale broken cover (see libraryService.ts's comment on
        // why nothing else will ever correct it once it's on disk). Set both:
        // coverImageUrl for this page's own in-memory render, originCoverUrl
        // because it's the one saveLibraryBooks doesn't strip — loadLibraryBooks
        // rebuilds coverImageUrl from it on every future reload.
        existing.coverImageUrl = buildCoverUrl(bookId);
        existing.originCoverUrl = existing.coverImageUrl;
        await applyCloudMetadata(existing, bookId);
        existing.updatedAt = Date.now();
        useLibraryStore.getState().setLibrary(library);
        // Also persist (metadata only — saveLibraryBooks never writes the
        // file's bytes): navigating from pages/readerx/open.tsx to /reader
        // crosses a Pages Router ↔ App Router boundary, which Next.js falls
        // back to a hard navigation for, wiping this Zustand store. Without
        // persisting, the reloaded /reader page would load this book's
        // pre-streaming `url` (or none) straight from disk and not know to
        // stream it.
        await appService.saveLibraryBooks(library);
        return existing;
      }
      // No prior entry at all — build a transient one. Title/author are
      // placeholders; FoliateViewer refines book.sourceTitle from the parsed
      // doc metadata once it actually opens the file.
      const now = Date.now();
      const book: Book = {
        hash,
        bookId,
        format: resolvedFormat,
        sourceFormat: resolvedFormat,
        title: `Book ${bookId}`,
        author: '',
        storageType: 'cloud',
        createdAt: now,
        updatedAt: now,
        url: streamUrl,
        // See the `existing` branch above: originCoverUrl is what survives
        // saveLibraryBooks and lets loadLibraryBooks rebuild coverImageUrl on
        // every future reload — coverImageUrl here only serves this page's
        // own in-memory render before that first save.
        coverImageUrl: buildCoverUrl(bookId),
        originCoverUrl: buildCoverUrl(bookId),
      };
      await applyCloudMetadata(book, bookId);
      library.push(book);
      useLibraryStore.getState().setLibrary(library);
      // Persisted for the same reason as the `existing` branch above — the
      // hard navigation into /reader needs to find this book on reload, not
      // just in this page's in-memory store.
      await appService.saveLibraryBooks(library);
      return book;
    }

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
