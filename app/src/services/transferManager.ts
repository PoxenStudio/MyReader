import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import { useTransferStore, TransferItem } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import { TranslationFunc } from '@/hooks/useTranslation';
import { createProgressThrottle, ProgressPayload } from '@/utils/transfer';
import { eventDispatcher } from '@/utils/event';
import { getTransferMessages } from './transferMessages';

const TRANSFER_QUEUE_KEY = 'readest_transfer_queue';
const RETRY_DELAY_BASE_MS = 2000;
// Coalesce per-chunk progress emissions to at most ~10/sec per transfer so the
// transfer-store fan-out cannot sustain a synchronous React update storm (a
// buffered download emits progress once per chunk in a microtask burst, and
// transferSpeed changes every call so the store's no-op guard cannot help)
// (Sentry READEST-2).
const PROGRESS_THROTTLE_MS = 100;
// Quota failures in a batch import arrive one per book as transfers drain;
// collapse them into one summary toast per burst instead of N identical toasts.
const QUOTA_TOAST_FLUSH_MS = 1500;

interface PersistedQueueData {
  schemaVersion?: number;
  transfers: Record<string, TransferItem>;
  isQueuePaused: boolean;
}

const QUEUE_SCHEMA_VERSION = 1;

class TransferManager {
  private static instance: TransferManager;
  private appService: AppService | null = null;
  private isProcessing = false;
  private abortControllers: Map<string, AbortController> = new Map();
  private isInitialized = false;
  private getLibrary: (() => Book[]) | null = null;
  private updateBook: ((book: Book) => Promise<void>) | null = null;
  private _: TranslationFunc | null = null;
  private settingsUnsub: (() => void) | null = null;
  private quotaFailureCount = 0;
  private quotaToastTimer: ReturnType<typeof setTimeout> | null = null;
  private readyResolve: () => void = () => {};
  private readyPromise: Promise<void> = new Promise<void>((resolve) => {
    this.readyResolve = resolve;
  });

  private constructor() {}

  /**
   * Settings hydrate asynchronously at app start (`settings` begins as
   * `{}`); `settings.version` truthiness is the loaded signal (same
   * convention as useSync). Before hydration the provider is unknown, so
   * book uploads are deferred rather than judged — acting on unknown
   * settings could both mis-cancel and mis-allow. Replica transfers and
   * downloads are never deferred: they are not provider-gated and the
   * boot-time replica pull relies on waitUntilReady().
   */
  private isSettingsLoaded(): boolean {
    return !!useSettingsStore.getState().settings?.version;
  }

  private isBookUploadAllowed(): boolean {
    return true;
  }

  private isDeferredBookUpload(t: TransferItem): boolean {
    return t.kind === 'book' && t.type === 'upload' && !this.isSettingsLoaded();
  }

  /**
   * Cancel pending book uploads when Readest Cloud is not the selected
   * provider. Idempotent (acts on pending rows only) — safe to run on
   * every processQueue pass, which also re-settles rows another window
   * or a rogue retry re-pended. Cancellation is visible ('cancelled'
   * with cancelReason 'policy'), never a silent drop.
   */
  private reconcileUploadsWithProvider(): void {
    if (!this.isSettingsLoaded() || this.isBookUploadAllowed()) return;

    const store = useTransferStore.getState();
    const gated = store
      .getPendingTransfers()
      .filter((t) => t.kind === 'book' && t.type === 'upload');
    if (gated.length === 0) return;

    gated.forEach((t) => {
      store.setTransferStatus(t.id, 'cancelled', undefined, 'policy');
    });
    console.info(
      `[cloudSync] cancelled ${gated.length} pending Readest Cloud upload(s): third-party provider selected`,
    );
    this.persistQueue();
  }

  static getInstance(): TransferManager {
    if (!TransferManager.instance) {
      TransferManager.instance = new TransferManager();
    }
    return TransferManager.instance;
  }

  async initialize(
    appService: AppService,
    getLibrary: () => Book[],
    updateBook: (book: Book) => Promise<void>,
    translationFn: TranslationFunc,
  ): Promise<void> {
    if (this.isInitialized) return;

    this.appService = appService;
    this.getLibrary = getLibrary;
    this.updateBook = updateBook;
    this._ = translationFn;
    await this.loadPersistedQueue();
    this.reconcileUploadsWithProvider();
    this.isInitialized = true;
    this.readyResolve();

    // Re-gate when settings hydrate or the selected provider changes.
    this.settingsUnsub?.();
    this.settingsUnsub = useSettingsStore.subscribe((state, prev) => {
      if (state.settings === prev.settings) return;
      this.reconcileUploadsWithProvider();
      this.processQueue();
    });

    // Start processing queue
    this.processQueue();
  }

  isReady(): boolean {
    return this.isInitialized && this.appService !== null;
  }

  /**
   * Resolves once `initialize()` has completed. Lets callers that need
   * to enqueue transfers defer until the manager is wired up — the
   * manager only inits after the library is loaded, which can lag well
   * behind app boot.
   */
  waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  queueUpload(book: Book, priority: number = 10): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    // Readest Cloud storage is not written to while a third-party
    // provider is selected. Before settings hydrate the entry is queued
    // and deferred; the reconcile on hydration decides its fate.
    if (this.isSettingsLoaded() && !this.isBookUploadAllowed()) {
      return null;
    }

    const store = useTransferStore.getState();

    // Check if already queued or in progress
    const existing = store.getTransferByBookHash(book.hash, 'upload');
    if (existing) {
      return existing.id;
    }

    const transferId = store.addTransfer(book.hash, book.title, 'upload', priority);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  queueDownload(book: Book, priority: number = 10): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    const store = useTransferStore.getState();

    const existing = store.getTransferByBookHash(book.hash, 'download');
    if (existing) {
      return existing.id;
    }

    const transferId = store.addTransfer(book.hash, book.title, 'download', priority);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  queueBatchUploads(books: Book[], priority: number = 10): string[] {
    return books
      .map((book) => this.queueUpload(book, priority))
      .filter((id): id is string => id !== null);
  }

  cancelTransfer(transferId: string): void {
    const controller = this.abortControllers.get(transferId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(transferId);
    }

    useTransferStore.getState().setTransferStatus(transferId, 'cancelled', undefined, 'user');
    this.persistQueue();
  }

  retryTransfer(transferId: string): void {
    const store = useTransferStore.getState();
    store.retryTransfer(transferId);
    this.persistQueue();
    this.processQueue();
  }

  retryAllFailed(): void {
    const store = useTransferStore.getState();
    const failed = store.getFailedTransfers();
    failed.forEach((transfer) => {
      store.retryTransfer(transfer.id);
    });
    this.persistQueue();
    this.processQueue();
  }

  pauseQueue(): void {
    useTransferStore.getState().pauseQueue();
    this.persistQueue();
  }

  resumeQueue(): void {
    useTransferStore.getState().resumeQueue();
    this.processQueue();
    this.persistQueue();
  }

  clearPending(): void {
    useTransferStore.getState().clearPending();
    this.persistQueue();
  }

  clearCompleted(): void {
    useTransferStore.getState().clearCompleted();
    this.persistQueue();
  }

  clearFailed(): void {
    useTransferStore.getState().clearFailed();
    this.persistQueue();
  }

  clearAll(): void {
    useTransferStore.getState().clearAll();
    this.persistQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      await this._processQueueInternal();
    } finally {
      this.isProcessing = false;
    }
  }

  private async _processQueueInternal(): Promise<void> {
    this.reconcileUploadsWithProvider();

    const store = useTransferStore.getState();

    if (store.isQueuePaused) return;

    const pending = store.getPendingTransfers().filter((t) => !this.isDeferredBookUpload(t));
    const activeCount = store.getActiveTransfers().length;
    const maxConcurrent = store.maxConcurrent;

    const availableSlots = maxConcurrent - activeCount;
    if (availableSlots <= 0 || pending.length === 0) return;

    // Sort by priority (lower = higher priority) then by createdAt
    const sortedPending = [...pending].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });

    const toProcess = sortedPending.slice(0, availableSlots);

    await Promise.all(toProcess.map((transfer) => this.executeTransfer(transfer)));

    // Check if more items to process. Deferred book uploads (settings
    // not yet hydrated) don't count — re-looping on them every 100ms
    // would busy-wait; the settings subscription wakes them instead.
    const newStore = useTransferStore.getState();
    const processable = newStore.getPendingTransfers().filter((t) => !this.isDeferredBookUpload(t));
    if (processable.length > 0 && !newStore.isQueuePaused) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private async executeTransfer(transfer: TransferItem): Promise<void> {
    if (!this.appService || !this.getLibrary || !this.updateBook) {
      console.error('TransferManager not properly initialized');
      return;
    }

    const _ = this._!;
    const store = useTransferStore.getState();
    const abortController = new AbortController();
    this.abortControllers.set(transfer.id, abortController);

    store.setTransferStatus(transfer.id, 'in_progress');
    store.setActiveCount(store.getActiveTransfers().length + 1);

    const progressThrottle = createProgressThrottle((progress) => {
      const percentage = progress.total > 0 ? (progress.progress / progress.total) * 100 : 0;
      useTransferStore
        .getState()
        .updateTransferProgress(
          transfer.id,
          percentage,
          progress.progress,
          progress.total,
          progress.transferSpeed,
        );
    }, PROGRESS_THROTTLE_MS);

    const progressHandler = (progress: ProgressPayload) => {
      if (abortController.signal.aborted) return;
      progressThrottle.push(progress);
    };

    try {
      await this.executeBookTransfer(transfer, progressHandler, abortController);

      // Land the final progress value that the throttle may still be holding.
      progressThrottle.flush();
      useTransferStore.getState().setTransferStatus(transfer.id, 'completed');

      const messages = getTransferMessages(transfer, _);

      if (!transfer.isBackground) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: messages.success[transfer.type],
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // Already cancelled, don't update status
        return;
      }

      const errorMessage = error instanceof Error ? error.message : _('Unknown error');
      const currentStore = useTransferStore.getState();
      const currentTransfer = currentStore.transfers[transfer.id];

      // Quota exhaustion is permanent for this account state; retrying
      // burns three backoff rounds per book for the same 403.
      const isQuotaError = errorMessage.includes('Insufficient storage quota');

      if (
        !isQuotaError &&
        currentTransfer &&
        currentTransfer.retryCount < currentTransfer.maxRetries
      ) {
        // Schedule retry with exponential backoff
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, currentTransfer.retryCount);
        currentStore.incrementRetryCount(transfer.id);
        currentStore.setTransferStatus(
          transfer.id,
          'pending',
          `Retry ${currentTransfer.retryCount + 1}/${currentTransfer.maxRetries}`,
        );

        setTimeout(() => {
          this.processQueue();
        }, delay);
      } else {
        if (errorMessage.includes('Not authenticated')) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: _('Please log in to continue'),
          });
        } else if (isQuotaError) {
          this.recordQuotaFailure();
        } else {
          const errorMessages = getTransferMessages(transfer, _).failure;

          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: errorMessages[transfer.type],
          });
        }

        useTransferStore.getState().setTransferStatus(transfer.id, 'failed', errorMessage);
      }
    } finally {
      // Drop any pending throttled progress + its trailing timer (a
      // failed/aborted transfer's stale progress must not fire after teardown).
      progressThrottle.cancel();
      this.abortControllers.delete(transfer.id);

      const currentStore = useTransferStore.getState();
      currentStore.setActiveCount(Math.max(0, currentStore.getActiveTransfers().length));
      this.persistQueue();

      // Continue processing
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private recordQuotaFailure(): void {
    this.quotaFailureCount += 1;
    if (this.quotaToastTimer) clearTimeout(this.quotaToastTimer);
    this.quotaToastTimer = setTimeout(() => this.flushQuotaToast(), QUOTA_TOAST_FLUSH_MS);
  }

  private flushQuotaToast(): void {
    const _ = this._;
    const count = this.quotaFailureCount;
    this.quotaFailureCount = 0;
    this.quotaToastTimer = null;
    if (!count || !_) return;

    eventDispatcher.dispatch('toast', {
      type: 'error',
      message:
        count === 1
          ? _('Insufficient storage quota')
          : _('{{count}} uploads failed: insufficient storage quota', { count }),
    });
  }

  private async executeBookTransfer(
    transfer: TransferItem,
    progressHandler: (p: ProgressPayload) => void,
    _abortController: AbortController,
  ): Promise<void> {
    const _ = this._!;
    const library = this.getLibrary!();
    const book = library.find((b) => b.hash === transfer.bookHash);

    if (!book) {
      throw new Error(_('Book not found in library'));
    }

    if (transfer.type === 'upload') {
      await this.appService!.uploadBook(book, progressHandler);
      book.uploadedAt = Date.now();
      await this.updateBook!(book);
    } else if (transfer.type === 'download') {
      await this.appService!.downloadBook(book, false, false, progressHandler);
      book.downloadedAt = Date.now();
      await this.updateBook!(book);
    }
  }

  private async loadPersistedQueue(): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') return;

      const stored = localStorage.getItem(TRANSFER_QUEUE_KEY);
      if (!stored) return;

      const data: PersistedQueueData = JSON.parse(stored);
      const store = useTransferStore.getState();

      // Restore all transfers using the store's restore method
      // This preserves the original IDs and handles in_progress -> pending conversion
      store.restoreTransfers(data.transfers, data.isQueuePaused);
    } catch (error) {
      console.error('Failed to load transfer queue:', error);
    }
  }

  private persistQueue(): void {
    try {
      if (typeof localStorage === 'undefined') return;

      const store = useTransferStore.getState();

      // Persist all transfers including completed (for history)
      const data: PersistedQueueData = {
        schemaVersion: QUEUE_SCHEMA_VERSION,
        transfers: store.transfers,
        isQueuePaused: store.isQueuePaused,
      };

      localStorage.setItem(TRANSFER_QUEUE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to persist transfer queue:', error);
    }
  }
}

export const transferManager = TransferManager.getInstance();
