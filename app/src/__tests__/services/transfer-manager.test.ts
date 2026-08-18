import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { useTransferStore, TransferItem } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

// ── Mocks ────────────────────────────────────────────────────────────
// The transferManager module is a singleton, so we need to mock its
// dependencies before importing it.

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
  },
}));

// After the module-level mock declarations, import the SUT
import { transferManager } from '@/services/transferManager';
import { eventDispatcher } from '@/utils/event';
import { MyBooksApiError } from '@/services/mybooksService';
import type { Book } from '@/types/book';

// ── Helpers ──────────────────────────────────────────────────────────
function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'hash1',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeTransferItem(overrides: Partial<TransferItem> = {}): TransferItem {
  return {
    id: 't1',
    kind: 'book',
    bookHash: 'hash1',
    bookTitle: 'Test Book',
    type: 'upload',
    status: 'pending',
    progress: 0,
    totalBytes: 0,
    transferredBytes: 0,
    transferSpeed: 0,
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    priority: 10,
    isBackground: false,
    ...overrides,
  };
}

// Reset the singleton and store before each test.
// Because TransferManager is a singleton with private isInitialized flag,
// we access the internal state via the exported instance.
const resetTransferManager = () => {
  // Reset internal state via prototype hacking
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only introspection
  const mgr = transferManager as unknown as Record<string, unknown>;
  mgr['isInitialized'] = false;
  mgr['isProcessing'] = false;
  mgr['appService'] = null;
  mgr['getLibrary'] = null;
  mgr['updateBook'] = null;
  mgr['_'] = null;
  (mgr['abortControllers'] as Map<string, AbortController>).clear();
  // Re-arm the readyPromise so each test starts with a pending one.
  let resolveReady: () => void = () => {};
  mgr['readyPromise'] = new Promise<void>((res) => {
    resolveReady = res;
  });
  mgr['readyResolve'] = resolveReady;
};

const resetTransferStore = () => {
  useTransferStore.setState({
    transfers: {},
    isQueuePaused: false,
    isTransferQueueOpen: false,
    maxConcurrent: 2,
    activeCount: 0,
  });
};

// Minimal AppService mock
function makeAppService() {
  return {
    uploadBook: vi.fn().mockResolvedValue(undefined),
    downloadBook: vi.fn().mockResolvedValue(undefined),
    deleteBook: vi.fn().mockResolvedValue(undefined),
    isMacOSApp: false,
  } as Record<string, unknown>;
}

const translationFn = (key: string, params?: Record<string, string | number>) => {
  if (params) {
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key);
  }
  return key;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetTransferStore();
  resetTransferManager();
  vi.clearAllMocks();
  localStorage.clear();
  // Book uploads are gated on the selected cloud sync provider and
  // deferred until settings hydrate; hydrate with Readest Cloud selected
  // so the pre-gating behavior under test is preserved.
  useSettingsStore.setState({
    settings: {
      version: 1,
      webdav: { enabled: false },
      googleDrive: { enabled: false },
    } as SystemSettings,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────
describe('TransferManager', () => {
  // ── Singleton ────────────────────────────────────────────────────
  describe('getInstance / singleton', () => {
    test('always returns the same instance', async () => {
      // The module export is the singleton; importing again should yield the same ref.
      const { transferManager: tm2 } = await import('@/services/transferManager');
      expect(tm2).toBe(transferManager);
    });
  });

  // ── isReady ──────────────────────────────────────────────────────
  describe('isReady', () => {
    test('returns false before initialization', () => {
      expect(transferManager.isReady()).toBe(false);
    });

    test('returns true after initialization', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);
      expect(transferManager.isReady()).toBe(true);
    });
  });

  // ── waitUntilReady ───────────────────────────────────────────────
  describe('waitUntilReady', () => {
    test('does not resolve before initialize', async () => {
      let resolved = false;
      void transferManager.waitUntilReady().then(() => {
        resolved = true;
      });
      // Yield to the microtask queue so any spurious early resolution would land.
      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(false);
    });

    test('resolves once initialize completes', async () => {
      let resolved = false;
      void transferManager.waitUntilReady().then(() => {
        resolved = true;
      });
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);
      await Promise.resolve();
      expect(resolved).toBe(true);
    });

    test('returns an already-resolved promise after initialize', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);
      // After init this should resolve in the next microtask, not block.
      let resolved = false;
      void transferManager.waitUntilReady().then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(true);
    });
  });

  // ── initialize ───────────────────────────────────────────────────
  describe('initialize', () => {
    test('loads persisted queue from localStorage', async () => {
      const item = makeTransferItem({ id: 'persisted-1', status: 'pending' });
      const data = {
        transfers: { 'persisted-1': item },
        isQueuePaused: true,
      };
      localStorage.setItem('readest_transfer_queue', JSON.stringify(data));

      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

      const store = useTransferStore.getState();
      expect(store.transfers['persisted-1']).toBeDefined();
      expect(store.isQueuePaused).toBe(true);
    });

    test('is idempotent — second call is a no-op', async () => {
      const appService = makeAppService();
      const getLibrary = () => [] as Book[];
      await transferManager.initialize(appService as never, getLibrary, vi.fn(), translationFn);

      // Change appService ref to detect if it gets overwritten
      const appService2 = makeAppService();
      await transferManager.initialize(appService2 as never, getLibrary, vi.fn(), translationFn);

      // The first appService should still be in use
      const mgr = transferManager as unknown as Record<string, unknown>;
      expect(mgr['appService']).toBe(appService);
    });
  });

  // ── queueUpload ──────────────────────────────────────────────────
  describe('queueUpload', () => {
    test('returns null when not initialized', () => {
      const result = transferManager.queueUpload(makeBook());
      expect(result).toBeNull();
    });

    test('queues an upload and returns a transfer id', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id = transferManager.queueUpload(makeBook());
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      const transfer = useTransferStore.getState().transfers[id!];
      expect(transfer).toBeDefined();
      expect(transfer!.type).toBe('upload');
      expect(transfer!.bookHash).toBe('hash1');
    });

    test('returns existing id if already queued', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id1 = transferManager.queueUpload(makeBook());
      const id2 = transferManager.queueUpload(makeBook());
      expect(id1).toBe(id2);
    });

    test('respects custom priority', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id = transferManager.queueUpload(makeBook(), 1);
      const transfer = useTransferStore.getState().transfers[id!];
      expect(transfer!.priority).toBe(1);
    });
  });

  // ── queueDownload ────────────────────────────────────────────────
  describe('queueDownload', () => {
    test('returns null when not initialized', () => {
      const result = transferManager.queueDownload(makeBook());
      expect(result).toBeNull();
    });

    test('queues a download and returns a transfer id', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id = transferManager.queueDownload(makeBook());
      expect(id).toBeTruthy();
      const transfer = useTransferStore.getState().transfers[id!];
      expect(transfer!.type).toBe('download');
    });

    test('returns existing id if already queued', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id1 = transferManager.queueDownload(makeBook());
      const id2 = transferManager.queueDownload(makeBook());
      expect(id1).toBe(id2);
    });
  });

  // ── queueDownloads (batch) ───────────────────────────────────────
  describe('queueDownloads', () => {
    test('returns empty array when not initialized', () => {
      const result = transferManager.queueDownloads([makeBook()]);
      expect(result).toEqual([]);
    });

    test('returns empty array for an empty batch', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);
      expect(transferManager.queueDownloads([])).toEqual([]);
    });

    test('queues every book and returns one id per book', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const book3 = makeBook({ hash: 'h3', title: 'B3' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2, book3],
        vi.fn(),
        translationFn,
      );

      // Pause so this only asserts on enqueueing, not on the (unrelated)
      // maxConcurrent processing that would otherwise flip some to in_progress.
      transferManager.pauseQueue();
      const ids = transferManager.queueDownloads([book1, book2, book3]);
      expect(ids).toHaveLength(3);
      ids.forEach((id) => {
        const transfer = useTransferStore.getState().transfers[id]!;
        expect(transfer.type).toBe('download');
        expect(transfer.status).toBe('pending');
      });
    });

    test('dedups against an already-queued download', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      const existingId = transferManager.queueDownload(book1);
      const ids = transferManager.queueDownloads([book1, book2]);
      expect(ids).toContain(existingId);
      expect(ids).toHaveLength(2);
      // book1 must not have been re-queued as a second transfer.
      const downloadTransfers = Object.values(useTransferStore.getState().transfers).filter(
        (t) => t.bookHash === 'h1' && t.type === 'download',
      );
      expect(downloadTransfers).toHaveLength(1);
    });

    test('marks every queued item isBackground when requested', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      const ids = transferManager.queueDownloads([book1, book2], 10, true);
      ids.forEach((id) => {
        expect(useTransferStore.getState().transfers[id]!.isBackground).toBe(true);
      });
    });

    test('persists the queue exactly once for the whole batch', async () => {
      const books = Array.from({ length: 20 }, (_, i) =>
        makeBook({ hash: `h${i}`, title: `B${i}` }),
      );
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => books, vi.fn(), translationFn);

      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      transferManager.queueDownloads(books);
      // One localStorage write for the entire batch, not one per book — a
      // per-item write of the whole (growing) transfers record is exactly
      // the O(n^2) main-thread burst that froze the app on Android.
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      setItemSpy.mockRestore();
    });
  });

  // ── queueBatchUploads ────────────────────────────────────────────
  describe('queueBatchUploads', () => {
    test('returns empty array when not initialized', () => {
      const result = transferManager.queueBatchUploads([makeBook()]);
      expect(result).toEqual([]);
    });

    test('queues multiple uploads', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      const ids = transferManager.queueBatchUploads([book1, book2]);
      expect(ids).toHaveLength(2);
      ids.forEach((id) => {
        expect(useTransferStore.getState().transfers[id]).toBeDefined();
      });
    });
  });

  // ── cancelTransfer ───────────────────────────────────────────────
  describe('cancelTransfer', () => {
    test('sets status to cancelled', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id = transferManager.queueUpload(makeBook())!;
      transferManager.cancelTransfer(id);

      const transfer = useTransferStore.getState().transfers[id];
      expect(transfer!.status).toBe('cancelled');
    });

    test('aborts an active abort controller', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id = transferManager.queueUpload(makeBook())!;

      // Manually inject an abort controller to simulate active transfer
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');
      const mgr = transferManager as unknown as Record<string, unknown>;
      (mgr['abortControllers'] as Map<string, AbortController>).set(id, abortController);

      transferManager.cancelTransfer(id);

      expect(abortSpy).toHaveBeenCalled();
    });

    test('persists queue after cancel', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id = transferManager.queueUpload(makeBook())!;
      transferManager.cancelTransfer(id);

      const stored = localStorage.getItem('readest_transfer_queue');
      expect(stored).toBeTruthy();
      const data = JSON.parse(stored!);
      expect(data.transfers[id].status).toBe('cancelled');
    });
  });

  // ── retryTransfer ────────────────────────────────────────────────
  describe('retryTransfer', () => {
    test('resets a failed transfer to pending', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      const id = transferManager.queueUpload(makeBook())!;
      useTransferStore.getState().setTransferStatus(id, 'failed', 'Network error');

      transferManager.retryTransfer(id);

      const transfer = useTransferStore.getState().transfers[id];
      expect(transfer!.status).toBe('pending');
      expect(transfer!.error).toBeUndefined();
    });
  });

  // ── retryAllFailed ───────────────────────────────────────────────
  describe('retryAllFailed', () => {
    test('retries all failed transfers', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      const id1 = transferManager.queueUpload(book1)!;
      const id2 = transferManager.queueDownload(book2)!;
      useTransferStore.getState().setTransferStatus(id1, 'failed', 'err1');
      useTransferStore.getState().setTransferStatus(id2, 'failed', 'err2');

      transferManager.retryAllFailed();

      expect(useTransferStore.getState().transfers[id1]!.status).toBe('pending');
      expect(useTransferStore.getState().transfers[id2]!.status).toBe('pending');
    });
  });

  // ── pauseQueue / resumeQueue ─────────────────────────────────────
  describe('pauseQueue / resumeQueue', () => {
    test('pauseQueue pauses the store queue', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

      transferManager.pauseQueue();
      expect(useTransferStore.getState().isQueuePaused).toBe(true);
    });

    test('resumeQueue resumes the store queue', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

      transferManager.pauseQueue();
      transferManager.resumeQueue();
      expect(useTransferStore.getState().isQueuePaused).toBe(false);
    });

    test('pauseQueue persists state', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

      transferManager.pauseQueue();
      const stored = JSON.parse(localStorage.getItem('readest_transfer_queue')!);
      expect(stored.isQueuePaused).toBe(true);
    });
  });

  // ── clearPending ─────────────────────────────────────────────────
  describe('clearPending', () => {
    test('removes pending transfers, keeps others, and persists the queue', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      // Pause first so queued items stay pending instead of being processed.
      transferManager.pauseQueue();
      const id1 = transferManager.queueUpload(book1)!;
      const id2 = transferManager.queueDownload(book2)!;
      useTransferStore.getState().setTransferStatus(id2, 'completed');

      transferManager.clearPending();

      expect(useTransferStore.getState().transfers[id1]).toBeUndefined();
      expect(useTransferStore.getState().transfers[id2]).toBeDefined();

      const stored = JSON.parse(localStorage.getItem('readest_transfer_queue')!);
      expect(stored.transfers[id1]).toBeUndefined();
      expect(stored.transfers[id2]).toBeDefined();
    });
  });

  // ── clearCompleted ───────────────────────────────────────────────
  describe('clearCompleted', () => {
    test('removes completed transfers, keeps others, and persists the queue', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      transferManager.pauseQueue();
      const id1 = transferManager.queueUpload(book1)!;
      const id2 = transferManager.queueDownload(book2)!;
      useTransferStore.getState().setTransferStatus(id1, 'completed');

      transferManager.clearCompleted();

      expect(useTransferStore.getState().transfers[id1]).toBeUndefined();
      expect(useTransferStore.getState().transfers[id2]).toBeDefined();

      const stored = JSON.parse(localStorage.getItem('readest_transfer_queue')!);
      expect(stored.transfers[id1]).toBeUndefined();
      expect(stored.transfers[id2]).toBeDefined();
    });
  });

  // ── clearFailed ──────────────────────────────────────────────────
  describe('clearFailed', () => {
    test('removes failed/cancelled transfers, keeps others, and persists the queue', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      transferManager.pauseQueue();
      const id1 = transferManager.queueUpload(book1)!;
      const id2 = transferManager.queueDownload(book2)!;
      useTransferStore.getState().setTransferStatus(id1, 'failed', 'boom');

      transferManager.clearFailed();

      expect(useTransferStore.getState().transfers[id1]).toBeUndefined();
      expect(useTransferStore.getState().transfers[id2]).toBeDefined();

      const stored = JSON.parse(localStorage.getItem('readest_transfer_queue')!);
      expect(stored.transfers[id1]).toBeUndefined();
      expect(stored.transfers[id2]).toBeDefined();
    });
  });

  // ── clearAll ─────────────────────────────────────────────────────
  describe('clearAll', () => {
    test('removes every transfer and persists the empty queue', async () => {
      const book1 = makeBook({ hash: 'h1', title: 'B1' });
      const book2 = makeBook({ hash: 'h2', title: 'B2' });
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [book1, book2],
        vi.fn(),
        translationFn,
      );

      transferManager.pauseQueue();
      transferManager.queueUpload(book1);
      transferManager.queueDownload(book2);

      transferManager.clearAll();

      expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);

      const stored = JSON.parse(localStorage.getItem('readest_transfer_queue')!);
      expect(Object.keys(stored.transfers)).toHaveLength(0);
    });
  });

  // ── Queue processing (integration-style) ─────────────────────────
  describe('queue processing', () => {
    test('successful upload calls appService.uploadBook and updates book', async () => {
      const book = makeBook({ hash: 'h1', title: 'Test Upload' });
      const appService = makeAppService();
      const updateBook = vi.fn().mockResolvedValue(undefined);

      await transferManager.initialize(
        appService as never,
        () => [book],
        updateBook,
        translationFn,
      );

      const id = transferManager.queueUpload(book)!;

      // Let the async queue processing run
      await vi.advanceTimersByTimeAsync(500);

      expect(appService['uploadBook']).toHaveBeenCalled();
      expect(updateBook).toHaveBeenCalled();

      const transfer = useTransferStore.getState().transfers[id];
      expect(transfer!.status).toBe('completed');
    });

    test('successful download calls appService.downloadBook and updates book', async () => {
      const book = makeBook({ hash: 'h1', title: 'Test Download' });
      const appService = makeAppService();
      const updateBook = vi.fn().mockResolvedValue(undefined);

      await transferManager.initialize(
        appService as never,
        () => [book],
        updateBook,
        translationFn,
      );

      const id = transferManager.queueDownload(book)!;

      await vi.advanceTimersByTimeAsync(500);

      expect(appService['downloadBook']).toHaveBeenCalled();
      expect(updateBook).toHaveBeenCalled();

      const transfer = useTransferStore.getState().transfers[id];
      expect(transfer!.status).toBe('completed');
    });

    test('dispatches toast on success for non-background transfers', async () => {
      const book = makeBook({ hash: 'h1', title: 'Toast Book' });
      const appService = makeAppService();

      await transferManager.initialize(
        appService as never,
        () => [book],
        vi.fn().mockResolvedValue(undefined),
        translationFn,
      );

      transferManager.queueUpload(book);
      await vi.advanceTimersByTimeAsync(500);

      expect(eventDispatcher.dispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ type: 'info' }),
      );
    });

    test('failed transfer with retries schedules retry', async () => {
      const book = makeBook({ hash: 'h1', title: 'Retry Book' });
      const appService = makeAppService();
      (appService['uploadBook'] as Mock).mockRejectedValue(new Error('Network fail'));

      await transferManager.initialize(
        appService as never,
        () => [book],
        vi.fn().mockResolvedValue(undefined),
        translationFn,
      );

      const id = transferManager.queueUpload(book)!;
      await vi.advanceTimersByTimeAsync(500);

      // After first failure, retryCount should be incremented and status back to pending
      const transfer = useTransferStore.getState().transfers[id];
      expect(transfer!.retryCount).toBeGreaterThanOrEqual(1);
    });

    test('paused queue does not process transfers', async () => {
      const book = makeBook({ hash: 'h1', title: 'Paused Book' });
      const appService = makeAppService();

      await transferManager.initialize(
        appService as never,
        () => [book],
        vi.fn().mockResolvedValue(undefined),
        translationFn,
      );

      transferManager.pauseQueue();
      transferManager.queueUpload(book);

      await vi.advanceTimersByTimeAsync(500);

      // The upload should not have been called because queue is paused
      expect(appService['uploadBook']).not.toHaveBeenCalled();
    });

    test('upload rejected by MyBooks dispatches an error dialog with the server message', async () => {
      const book = makeBook({ hash: 'h1', title: 'Rejected Book' });
      const appService = makeAppService();
      (appService['uploadBook'] as Mock).mockRejectedValue(
        new MyBooksApiError('duplicate', 'A book with this title already exists on your shelf'),
      );

      await transferManager.initialize(
        appService as never,
        () => [book],
        vi.fn().mockResolvedValue(undefined),
        translationFn,
      );

      transferManager.queueUpload(book);
      await vi.advanceTimersByTimeAsync(10000);

      expect(eventDispatcher.dispatch).toHaveBeenCalledWith(
        'show-error-message-dialog',
        expect.objectContaining({
          message: 'A book with this title already exists on your shelf',
        }),
      );
      // The generic upload-failure toast is superseded by the dialog for a
      // server-reported reason — it should not also fire.
      expect(eventDispatcher.dispatch).not.toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ type: 'error' }),
      );
    });

    test('book not found in library dispatches error', async () => {
      const book = makeBook({ hash: 'not-in-lib', title: 'Missing' });
      const appService = makeAppService();

      await transferManager.initialize(
        appService as never,
        () => [], // empty library
        vi.fn().mockResolvedValue(undefined),
        translationFn,
      );

      transferManager.queueUpload(book);
      await vi.advanceTimersByTimeAsync(10000);

      // After all retries exhausted, error toast should be dispatched
      expect(eventDispatcher.dispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ type: 'error' }),
      );
    });
  });

  // ── persistQueue / loadPersistedQueue ────────────────────────────
  describe('persistence', () => {
    test('persistQueue stores transfers to localStorage', async () => {
      const appService = makeAppService();
      await transferManager.initialize(
        appService as never,
        () => [makeBook()],
        vi.fn(),
        translationFn,
      );

      transferManager.queueUpload(makeBook());

      const stored = localStorage.getItem('readest_transfer_queue');
      expect(stored).toBeTruthy();
      const data = JSON.parse(stored!);
      expect(Object.keys(data.transfers).length).toBeGreaterThan(0);
    });

    test('caps persisted completed history to the most recent entries', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

      // 60 completed transfers accumulated over the app's lifetime — without
      // capping, every future persistQueue() call re-serializes all of them,
      // making the "single write per batch" fix from queueDownloads() still
      // expensive once history has piled up.
      const now = Date.now();
      const transfers: Record<string, TransferItem> = {};
      for (let i = 0; i < 60; i++) {
        transfers[`c${i}`] = makeTransferItem({
          id: `c${i}`,
          status: 'completed',
          completedAt: now + i,
        });
      }
      useTransferStore.setState({ transfers });

      // Any public method that calls persistQueue() works as the trigger.
      transferManager.pauseQueue();

      const stored = JSON.parse(localStorage.getItem('readest_transfer_queue')!);
      const persistedIds = Object.keys(stored.transfers);
      expect(persistedIds.length).toBeLessThanOrEqual(50);
      // Keeps the most recently completed, drops the oldest.
      expect(stored.transfers['c59']).toBeDefined();
      expect(stored.transfers['c0']).toBeUndefined();
    });

    test('never caps pending/active/failed transfers, only completed', async () => {
      const appService = makeAppService();
      await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

      const now = Date.now();
      const transfers: Record<string, TransferItem> = {};
      for (let i = 0; i < 60; i++) {
        transfers[`c${i}`] = makeTransferItem({
          id: `c${i}`,
          status: 'completed',
          completedAt: now + i,
        });
      }
      transfers['pending1'] = makeTransferItem({ id: 'pending1', status: 'pending' });
      useTransferStore.setState({ transfers });

      transferManager.pauseQueue();

      const stored = JSON.parse(localStorage.getItem('readest_transfer_queue')!);
      expect(stored.transfers['pending1']).toBeDefined();
    });

    test('handles missing localStorage gracefully', async () => {
      // Simulate localStorage being undefined
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = () => null;

      const appService = makeAppService();
      // Should not throw
      await expect(
        transferManager.initialize(appService as never, () => [], vi.fn(), translationFn),
      ).resolves.not.toThrow();

      localStorage.getItem = originalGetItem;
    });

    test('handles corrupted localStorage data gracefully', async () => {
      localStorage.setItem('readest_transfer_queue', 'invalid-json{{{');

      const appService = makeAppService();
      // Should not throw
      await expect(
        transferManager.initialize(appService as never, () => [], vi.fn(), translationFn),
      ).resolves.not.toThrow();
    });
  });
});
