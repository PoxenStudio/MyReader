import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getBooksByType } from '@/services/mybooksService';
import { transferManager } from '@/services/transferManager';
import { convertMyBooksToLocalBooks, hasLocalCopy } from '@/utils/bookConverter';
import { eventDispatcher } from '@/utils/event';
import { Book } from '@/types/book';

// Mirrors the delay useOPDSSubscriptions uses before queuing transfers, so
// the transfer manager has a chance to finish initializing if this fires
// right after libraryLoaded.
const QUEUE_DOWNLOAD_DELAY_MS = 3000;

export function useAutoSyncReadingBooks() {
  const { appService } = useEnv();
  const { user } = useAuth();
  const { libraryLoaded } = useLibraryStore();
  const isSyncingRef = useRef(false);

  // `force` lets a manual "sync now" action (e.g. the "Sync Reading Books
  // from Library" button in LibraryEmptyState, which only renders when
  // autoSyncReadingBooks is OFF) bypass the setting gate below. Without it,
  // clicking that button would immediately hit the same early return the
  // passive auto-trigger respects and silently do nothing.
  const syncReadingBooks = useCallback(
    async (force = false) => {
      if (!appService || !libraryLoaded || !user) return;
      if (isSyncingRef.current) return;

      if (!force) {
        const { settings } = useSettingsStore.getState();
        if (!settings.autoSyncReadingBooks) return;
      }

      isSyncingRef.current = true;
      try {
        const { books: cloudReadingBooks } = await getBooksByType('reading', 1, 100);
        if (cloudReadingBooks.length === 0) return;

        const readingBooks = convertMyBooksToLocalBooks(cloudReadingBooks);
        const currentLibrary = useLibraryStore.getState().library;
        const existingByHash = new Map(currentLibrary.map((b) => [b.hash, b]));

        const booksToAdd: Book[] = [];
        const booksToDownload: Book[] = [];
        for (const book of readingBooks) {
          const existing = existingByHash.get(book.hash);
          if (existing) {
            if (!existing.downloadedAt) booksToDownload.push(book);
          } else if (!hasLocalCopy(book, currentLibrary)) {
            booksToAdd.push(book);
            booksToDownload.push(book);
          }
        }

        if (booksToAdd.length > 0) {
          const merged = [...booksToAdd, ...currentLibrary];
          useLibraryStore.getState().setLibrary(merged);
          appService.saveLibraryBooks(merged);
        }

        if (booksToDownload.length > 0) {
          setTimeout(() => {
            // Batched: a loop of individual queueDownload() calls each did a
            // full store update + a synchronous localStorage persist, which
            // for ~100 reading books froze the UI (worst on Android). Queued
            // as isBackground so this silent sync doesn't fire a success toast
            // per book. See transferManager.queueDownloads.
            transferManager.queueDownloads(booksToDownload, 10, true);
          }, QUEUE_DOWNLOAD_DELAY_MS);
        }
      } catch (error) {
        console.error('Auto sync reading books error:', error);
      } finally {
        isSyncingRef.current = false;
      }
    },
    [appService, libraryLoaded, user],
  );

  // Auto-trigger on startup once the library is loaded, and again whenever
  // `user` changes (e.g. right after login) since a fresh login is exactly
  // when a first sync is most wanted.
  useEffect(() => {
    if (!libraryLoaded || !user) return;
    syncReadingBooks();
  }, [libraryLoaded, user, syncReadingBooks]);

  // Lets SettingsMenu request an immediate sync right when the user enables
  // the setting, instead of waiting for the next mount/login.
  useEffect(() => {
    const handler = () => syncReadingBooks();
    eventDispatcher.on('check-reading-books-sync', handler);
    return () => eventDispatcher.off('check-reading-books-sync', handler);
  }, [syncReadingBooks]);

  return { syncReadingBooks };
}
