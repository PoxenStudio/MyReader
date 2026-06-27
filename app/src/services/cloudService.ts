import { AppService, FileSystem, DeleteAction } from '@/types/system';
import { Book } from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getRemoteBookFilename,
  getCoverFilename,
} from '@/utils/book';
import { ClosableFile } from '@/utils/file';
import { ProgressHandler } from '@/utils/transfer';
import { isBookFileContentSource, resolveBookContentSource } from './bookContent';
import { EXTS } from '@/libs/document';
import { isTauriAppPlatform } from '@/services/environment';
import { getCloudBookId } from '@/utils/bookConverter';
import { uploadBookToMyBooks, deleteBookFromMyBooks } from '@/services/mybooksService';

export async function deleteBook(
  fs: FileSystem,
  book: Book,
  deleteAction: DeleteAction,
): Promise<void> {
  // Admin-only deletion from the MyBooks server catalog (e.g. deleting a book
  // while browsing the cloud shelf) — distinct from 'cloud', which only clears
  // local upload bookkeeping for a book the current user uploaded themselves.
  if (deleteAction === 'remote') {
    const id = book.bookId ?? getCloudBookId(book.hash);
    if (id == null) {
      throw new Error('Missing MyBooks book id');
    }
    await deleteBookFromMyBooks(id);
    book.deletedAt = Date.now();
    return;
  }
  if (deleteAction === 'local' || deleteAction === 'both') {
    const source = await resolveBookContentSource(fs, book);
    if (source.kind === 'external') {
      try {
        if (await fs.exists(source.path, source.base)) {
          await fs.removeFile(source.path, source.base);
        }
      } catch (error) {
        // Best effort: a missing/permission-denied source shouldn't block
        // the metadata-side bookkeeping that follows.
        console.log('Failed to remove in-place source file:', error);
      }
    } else if (source.kind === 'managed') {
      if (await fs.exists(source.path, source.base)) {
        await fs.removeFile(source.path, source.base);
      }
    }

    if (deleteAction === 'both' && (await fs.exists(getCoverFilename(book), 'Books'))) {
      await fs.removeFile(getCoverFilename(book), 'Books');
    }
    if (deleteAction === 'local') {
      book.downloadedAt = null;
    } else {
      book.deletedAt = Date.now();
      book.downloadedAt = null;
      book.coverDownloadedAt = null;
    }
  }
  // MyReader has no remote-delete API yet (see mybooksService.ts) — clear the
  // local upload bookkeeping so the UI stops treating the book as backed up.
  if ((deleteAction === 'cloud' || deleteAction === 'both') && book.uploadedAt) {
    book.uploadedAt = null;
  }
}

export async function uploadBook(
  fs: FileSystem,
  book: Book,
  onProgress?: ProgressHandler,
): Promise<number> {
  let bookSource = await resolveBookContentSource(fs, book);
  if (bookSource.kind === 'url') {
    const fileobj = await fs.openFile(bookSource.path, bookSource.base);
    await fs.writeFile(getLocalBookFilename(book), 'Books', await fileobj.arrayBuffer());
    const f = fileobj as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
    bookSource = { kind: 'managed', path: getLocalBookFilename(book), base: 'Books' };
  }

  if (!isBookFileContentSource(bookSource)) {
    throw new Error('Book file not uploaded');
  }

  const file = await fs.openFile(bookSource.path, bookSource.base);
  const arrayBuffer = await file.arrayBuffer();
  const f = file as ClosableFile;
  if (f && f.close) {
    await f.close();
  }

  onProgress?.({ progress: 0, total: arrayBuffer.byteLength, transferSpeed: 0 });
  const bookId = await uploadBookToMyBooks(new Blob([arrayBuffer]), getRemoteBookFilename(book));
  onProgress?.({
    progress: arrayBuffer.byteLength,
    total: arrayBuffer.byteLength,
    transferSpeed: 0,
  });

  book.deletedAt = null;
  book.updatedAt = Date.now();
  book.uploadedAt = Date.now();
  book.downloadedAt = Date.now();
  book.coverDownloadedAt = Date.now();
  // The book now lives on the MyBooks server, so treat it the same as a
  // book that was downloaded from the cloud rather than a local-only one.
  book.storageType = 'cloud';
  book.bookId = bookId;
  return bookId;
}

export async function downloadMyBooksBook(
  appService: AppService,
  fs: FileSystem,
  localBooksDir: string,
  book: Book,
  onProgress?: ProgressHandler,
): Promise<void> {
  // Extract MyReader book ID from hash (format: 'cloud-<id>' or 'cloud-<id>-<format>')
  const bookId = String(getCloudBookId(book.hash));
  const host = typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null;

  console.log('MyReader host:', host);

  if (!host) {
    throw new Error('MyReader host not configured');
  }
  const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;

  // 优先用 files 中与 book.format 匹配的那一项的 href 组合 mybooks host 作为 downloadUrl，
  // 找不到匹配项时回退到 files[0]，没有 files 时才使用 format 拼接默认下载路径
  let downloadUrl = '';
  const matchedFile = book.files?.find((f) => f.format === book.format) ?? book.files?.[0];
  if (matchedFile?.href) {
    const fileHref = matchedFile.href;
    const path = fileHref.startsWith('/') ? fileHref : `/${fileHref}`;
    downloadUrl = `${normalizedHost}${path}`;
  } else {
    const ext = EXTS[book.format] || book.format.toLowerCase();
    downloadUrl = `${normalizedHost}/api/book/${bookId}.${ext}`;
  }

  // Web 平台下使用本地代理解决 CORS 跨域问题
  if (!isTauriAppPlatform()) {
    downloadUrl = `/api/mybooks/download?url=${encodeURIComponent(downloadUrl)}`;
  }

  if (!(await fs.exists(getDir(book), 'Books'))) {
    console.log('Create the dir:', getDir(book));
    await fs.createDir(getDir(book), 'Books');
  }

  const lfp = getLocalBookFilename(book);
  const dst = `${localBooksDir}/${lfp}`;
  console.log(`Downloading MyReader book from: ${downloadUrl} to ${dst}`);

  // Always use fetch (with credentials: 'include') for MyReader downloads so that
  // session cookies set by the MyReader server are sent correctly. Tauri's Rust-side
  // downloader (reqwest) does not share the webview cookie store and would get a 401.
  const { webDownload } = await import('@/utils/transfer');
  const { blob } = await webDownload(downloadUrl, onProgress, undefined, 'include');
  let bookArrayBuffer = await blob.arrayBuffer();
  if (book.format === 'TXT') {
    // DocumentLoader has no TXT parser (it only sniffs EPUB/PDF/MOBI/FB2 by magic bytes),
    // so local TXT imports are converted to EPUB before being persisted (see importBook in
    // bookService.ts). Cloud TXT downloads must go through the same conversion, otherwise
    // DocumentLoader.open() returns a null bookDoc when the reader tries to open the file.
    const { TxtToEpubConverter } = await import('@/utils/txt');
    const txtFile = new File([bookArrayBuffer], `${book.sourceTitle || book.title}.txt`);
    const { file: epubFile } = await new TxtToEpubConverter().convert({ file: txtFile });
    bookArrayBuffer = await epubFile.arrayBuffer();
  }
  await appService.writeFile(dst, 'None', bookArrayBuffer);

  const bookDownloaded = await fs.exists(lfp, 'Books');
  if (bookDownloaded) {
    book.downloadedAt = Date.now();
  } else {
    throw new Error('Failed to download file');
  }

  // Download cover image
  const coverUrl = book.originCoverUrl;
  if (coverUrl) {
    console.log(`Downloading MyReader book cover from: ${coverUrl}`);
    try {
      const coverDownloadUrl = isTauriAppPlatform()
        ? coverUrl
        : `/api/mybooks/download?url=${encodeURIComponent(coverUrl)}`;
      const { blob: coverBlob } = await webDownload(
        coverDownloadUrl,
        undefined,
        undefined,
        'include',
      );
      const coverLfp = getCoverFilename(book);
      const coverDst = `${localBooksDir}/${coverLfp}`;
      await appService.writeFile(coverDst, 'None', await coverBlob.arrayBuffer());

      const coverDownloaded = await fs.exists(coverLfp, 'Books');
      if (coverDownloaded) {
        book.coverDownloadedAt = Date.now();
        console.log('Cover downloaded successfully');
      }
    } catch (error) {
      console.log('Failed to download cover image:', error);
      // Don't throw error if cover download fails - book can still be read without cover
    }
  }
}

export async function downloadBook(
  appService: AppService,
  fs: FileSystem,
  localBooksDir: string,
  book: Book,
  _onlyCover: boolean = false,
  _redownload: boolean = false,
  onProgress?: ProgressHandler,
): Promise<void> {
  // Cloud books are always downloaded from the MyBooks server.
  return downloadMyBooksBook(appService, fs, localBooksDir, book, onProgress);
}
