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
import { getCloudBookId, getMyBooksId } from '@/utils/bookConverter';
import { uploadBookToMyBooks, deleteBookFromMyBooks } from '@/services/mybooksService';
import { useSettingsStore } from '@/store/settingsStore';
import { NAS_CHROME_USER_AGENT, getNasCookies } from '@/services/mybooks/nasCookieStore';

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
  if (deleteAction === 'local' || deleteAction === 'both' || deleteAction === 'purge') {
    const source = await resolveBookContentSource(fs, book);
    // Only remove files Readest itself created. A 'managed' source lives under
    // our Books/<hash>/ dir (a copy we made on import), so it is ours to delete.
    // An 'external' source is the user's own file at a user-controlled location
    // (book.filePath, base 'None') — e.g. a "Read books in place" import or a
    // transiently-opened file. Deleting a book from Readest must NEVER remove
    // that source file; doing so silently destroyed users' originals.
    if (source.kind === 'managed' && deleteAction !== 'purge') {
      // Purge wipes the whole directory below, so skip the per-file removal.
      if (await fs.exists(source.path, source.base)) {
        await fs.removeFile(source.path, source.base);
      }
    }

    // Purge erases the entire app-generated Books/<hash>/ directory — the
    // managed book file, cover.png, and (the reason for issue #4615)
    // config.json (reading progress, notes, bookmarks) + nav.json that the
    // other delete actions leave behind. In-place books keep their external
    // source file untouched; this only clears Readest's own sidecar dir.
    if (deleteAction === 'purge') {
      const dir = getDir(book);
      if (await fs.exists(dir, 'Books')) {
        await fs.removeDir(dir, 'Books', true);
      }
      // The per-book TTS audio cache lives under Cache (kept out of Books/
      // so backups and sync never pick it up); purge erases every trace of
      // the book, so drop it too. Non-purge deletes leave it: like
      // config.json, a re-downloaded book resumes with a warm audio cache.
      const ttsCacheDir = `tts-cache/${book.hash}`;
      if (await fs.exists(ttsCacheDir, 'Cache')) {
        await fs.removeDir(ttsCacheDir, 'Cache', true);
      }
    }

    if (deleteAction === 'both' && (await fs.exists(getCoverFilename(book), 'Books'))) {
      await fs.removeFile(getCoverFilename(book), 'Books');
    }
    if (deleteAction === 'local' || deleteAction === 'purge') {
      // Mirror 'local': mark not-downloaded but leave the tombstone (deletedAt)
      // to the caller. The page's handleBookDelete sets deletedAt and queues the
      // cloud deletion for purge, exactly as it does for the 'both' action.
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

/**
 * Streams `url` straight to `dst` instead of buffering the whole response
 * through the webview fetch + JS memory.
 *
 * On Tauri this routes through the native Rust downloader (`download_file`,
 * already used for OPDS and gloss-pack downloads) which writes each chunk
 * directly to disk and only sends small progress updates over the IPC
 * channel. Going through the webview's `fetch` polyfill instead (as this
 * used to) shuttles every chunk through IPC as a JSON array of bytes, and
 * `webDownload()` then re-copies the whole thing through a chunk array +
 * Blob + arrayBuffer — for a ~76MB book that easily blew past Android's
 * ~256MB heap growth limit with a single 264MB allocation and crashed with
 * an OOM during the auto "reading books" sync.
 *
 * The native downloader's reqwest client doesn't share the webview's cookie
 * jar, though, so the MyBooks session cookie has to be passed explicitly as
 * a header — the same trick `tauriCookieStore.ts` already uses for the
 * WebSocket sync channel, which has the identical problem.
 */
async function downloadMyBooksUrl(
  appService: AppService,
  url: string,
  dst: string,
  onProgress?: ProgressHandler,
): Promise<void> {
  const { downloadFile } = await import('@/libs/storage');
  if (isTauriAppPlatform()) {
    const { getTauriMyBooksCookie } = await import('@/services/mybooks/tauriCookieStore');
    const cookie = getTauriMyBooksCookie();
    const headers: Record<string, string> = {};
    if (cookie) headers['Cookie'] = cookie;
    // The native downloader's reqwest client doesn't share the webview's
    // cookie jar either, so — same as `fetchMyBooks` and the cover fetch in
    // `BookCover.tsx` — the NAS relay cookie has to be attached explicitly,
    // merged alongside the regular MyBooks session cookie above (a NAS-gated
    // download needs both: the relay's own gate cookie plus the app-level
    // session).
    const nasSettings = useSettingsStore.getState().settings.nas;
    if (nasSettings?.enabled) {
      const nasCookie = getNasCookies(new URL(url).host);
      if (nasCookie) headers['Cookie'] = [cookie, nasCookie].filter(Boolean).join('; ');
      headers['User-Agent'] = NAS_CHROME_USER_AGENT;
    }
    await downloadFile({
      appService,
      dst,
      url,
      headers: Object.keys(headers).length ? headers : undefined,
      onProgress,
    });
  } else {
    await downloadFile({ appService, dst, url, credentials: 'include', onProgress });
  }
}

export async function downloadMyBooksBook(
  appService: AppService,
  fs: FileSystem,
  localBooksDir: string,
  book: Book,
  onProgress?: ProgressHandler,
): Promise<void> {
  // Extract MyReader book ID from hash (format: 'cloud-<id>' or 'cloud-<id>-<format>')
  const bookId = String(getMyBooksId(book));
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
  console.log(
    '[downloadMyBooksBook] matchedFile:',
    matchedFile,
    'resolved downloadUrl:',
    downloadUrl,
  );

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

  if (book.format === 'TXT') {
    // DocumentLoader has no TXT parser (it only sniffs EPUB/PDF/MOBI/FB2 by magic bytes),
    // so local TXT imports are converted to EPUB before being persisted (see importBook in
    // bookService.ts). Cloud TXT downloads must go through the same conversion, otherwise
    // DocumentLoader.open() returns a null bookDoc when the reader tries to open the file.
    // This still needs the full bytes in JS memory (unlike downloadMyBooksUrl below), but
    // TXT sources are plain text and small next to an EPUB with embedded images/fonts, so
    // the memory tradeoff is fine here.
    const { webDownload } = await import('@/utils/transfer');
    // `webDownload` uses `tauriFetch` on Tauri, same as `BookCover.tsx`'s
    // cover fetch — its cookie jar never sees cookies captured from the NAS
    // login webview, so they have to be attached explicitly here too.
    let headers: Record<string, string> | undefined;
    if (isTauriAppPlatform()) {
      const nasSettings = useSettingsStore.getState().settings.nas;
      if (nasSettings?.enabled) {
        const nasCookie = getNasCookies(new URL(downloadUrl).host);
        headers = { 'User-Agent': NAS_CHROME_USER_AGENT, ...(nasCookie && { Cookie: nasCookie }) };
      }
    }
    const { blob } = await webDownload(downloadUrl, onProgress, headers, 'include');
    const bookArrayBuffer = await blob.arrayBuffer();
    const { TxtToEpubConverter } = await import('@/utils/txt');
    const txtFile = new File([bookArrayBuffer], `${book.sourceTitle || book.title}.txt`);
    const { file: epubFile } = await new TxtToEpubConverter().convert({ file: txtFile });
    await appService.writeFile(dst, 'None', await epubFile.arrayBuffer());
  } else {
    await downloadMyBooksUrl(appService, downloadUrl, dst, onProgress);
  }

  const bookDownloaded = await fs.exists(lfp, 'Books');
  if (bookDownloaded) {
    book.downloadedAt = Date.now();
    book.deletedAt = null;
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
      const coverLfp = getCoverFilename(book);
      const coverDst = `${localBooksDir}/${coverLfp}`;
      await downloadMyBooksUrl(appService, coverDownloadUrl, coverDst);

      const coverDownloaded = await fs.exists(coverLfp, 'Books');
      if (coverDownloaded) {
        book.coverDownloadedAt = Date.now();
        // Repoint coverImageUrl at the just-downloaded local copy — left as
        // the remote host URL, an <img>/fetch reader/TTS UI renders directly
        // fails without network access (or CORS-blocked cross-origin fetches
        // like fetchImageAsBase64's media-session artwork), even though the
        // cover is now sitting on disk right next to the book file.
        book.coverImageUrl = await appService.generateCoverImageUrl(book);
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
