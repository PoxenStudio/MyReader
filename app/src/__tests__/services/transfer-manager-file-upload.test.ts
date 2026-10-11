import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTransferStore } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
    dispatchSync: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage?: (msg: unknown) => void;
  },
}));

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauriAppPlatform: vi.fn(() => false),
}));

vi.mock('@/services/mybooksService', () => ({
  MyBooksApiError: class MyBooksApiError extends Error {
    constructor(
      public err: string,
      public msg?: string,
    ) {
      super(msg ?? err);
    }
  },
  fetchMyBooks: vi.fn(),
  isNativeFsPath: (p: string) => /^(\/|[A-Za-z]:[\\/]|content:\/\/)/.test(p),
  MYBOOKS_UPLOAD_TIMEOUT_MS: 30 * 60 * 1000,
  uploadMyBooksFilesNative: vi.fn(),
}));

import { transferManager } from '@/services/transferManager';
import { eventDispatcher } from '@/utils/event';
import { fetchMyBooks, uploadMyBooksFilesNative } from '@/services/mybooksService';
import { isTauriAppPlatform } from '@/services/environment';

const fetchMyBooksMock = vi.mocked(fetchMyBooks);
const uploadNativeMock = vi.mocked(uploadMyBooksFilesNative);
const isTauriMock = vi.mocked(isTauriAppPlatform);

const resetTransferManager = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only introspection
  const mgr = transferManager as unknown as Record<string, unknown>;
  mgr['isInitialized'] = false;
  mgr['isProcessing'] = false;
  mgr['appService'] = null;
  mgr['getLibrary'] = null;
  mgr['updateBook'] = null;
  mgr['_'] = null;
  (mgr['abortControllers'] as Map<string, AbortController>).clear();
  (mgr['pendingWebFiles'] as Map<string, File>).clear();
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

const settingsLoaded = (overrides: Partial<SystemSettings> = {}): void => {
  useSettingsStore.setState({
    settings: {
      version: 1,
      webdav: { enabled: false },
      autoRetryTransfers: false,
      ...overrides,
    } as SystemSettings,
  });
};

const translationFn = (key: string) => key;

const initManager = async () => {
  const appService = {
    uploadBook: vi.fn(),
    downloadBook: vi.fn(),
  };
  await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn as never);
  return appService;
};

const flushAsync = async (ms = 5000) => {
  await vi.advanceTimersByTimeAsync(ms);
};

const makeWebFile = () => new File(['epub-bytes'], 'a.epub', { type: 'application/epub+zip' });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetTransferStore();
  resetTransferManager();
  vi.clearAllMocks();
  localStorage.clear();
  settingsLoaded();
  isTauriMock.mockReturnValue(false);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('file upload transfers', () => {
  test('a completed web-file upload marks the transfer completed and passes a timeout', async () => {
    fetchMyBooksMock.mockResolvedValue({ err: 'ok' });
    await initManager();
    const [id] = transferManager.queueFileUploads([{ file: makeWebFile(), name: 'a.epub' }]);
    expect(id).toBeTruthy();
    await flushAsync();

    expect(fetchMyBooksMock).toHaveBeenCalledTimes(1);
    const args = fetchMyBooksMock.mock.calls[0]!;
    expect(args[0]).toBe('/book/upload');
    expect(args[2]).toBe('POST');
    expect(args[3]).toBeInstanceOf(FormData);
    expect(args[5]).toBe(30 * 60 * 1000);
    expect(args[6]).toBeInstanceOf(AbortSignal);
    expect(useTransferStore.getState().transfers[id!]?.status).toBe('completed');
  });

  test('an upload that lands after the user cancelled stays cancelled (no overwrite)', async () => {
    let resolveUpload: (value: { err: string }) => void = () => {};
    fetchMyBooksMock.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    await initManager();
    const [id] = transferManager.queueFileUploads([{ file: makeWebFile(), name: 'a.epub' }]);
    await flushAsync();
    expect(useTransferStore.getState().transfers[id!]?.status).toBe('in_progress');

    transferManager.cancelTransfer(id!);
    expect(useTransferStore.getState().transfers[id!]?.status).toBe('cancelled');

    // The upload still lands (the real fetch would honour the signal, but the
    // native invoke can complete after a cancel) — it must not flip the
    // user's cancelled status back to completed.
    resolveUpload({ err: 'ok' });
    await flushAsync();

    expect(useTransferStore.getState().transfers[id!]?.status).toBe('cancelled');
    expect(eventDispatcher.dispatch).not.toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'info' }),
    );
  });

  test('an upload rejected by a cancel is not marked failed either', async () => {
    fetchMyBooksMock.mockImplementation(
      (_endpoint, _params, _method, _body, _contentType, _timeoutMs, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Upload aborted', 'AbortError')),
          );
        }),
    );
    await initManager();
    const [id] = transferManager.queueFileUploads([{ file: makeWebFile(), name: 'a.epub' }]);
    await flushAsync();
    expect(useTransferStore.getState().transfers[id!]?.status).toBe('in_progress');

    transferManager.cancelTransfer(id!);
    await flushAsync();

    expect(useTransferStore.getState().transfers[id!]?.status).toBe('cancelled');
  });

  test('the native path receives the caller signal and the cancel flow aborts it', async () => {
    isTauriMock.mockReturnValue(true);
    let nativeSignal: AbortSignal | undefined;
    uploadNativeMock.mockImplementation((_endpoint, _files, _fields, _onProgress, options) => {
      nativeSignal = options?.signal;
      return new Promise(() => {});
    });
    await initManager();
    const [id] = transferManager.queueFileUploads([{ path: '/books/a.epub', name: 'a.epub' }]);
    await flushAsync();

    expect(uploadNativeMock).toHaveBeenCalledTimes(1);
    expect(nativeSignal).toBeInstanceOf(AbortSignal);

    transferManager.cancelTransfer(id!);
    expect(nativeSignal?.aborted).toBe(true);
    expect(useTransferStore.getState().transfers[id!]?.status).toBe('cancelled');
  });
});

describe('uploadMyBooksFilesNative cancellation wiring', () => {
  const loadRealService = async () =>
    await vi.importActual<typeof import('@/services/mybooksService')>('@/services/mybooksService');

  test('an aborted signal invokes cancel_upload with the invocation id and rejects', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'upload_multipart' ? new Promise(() => {}) : Promise.resolve(false),
    );
    localStorage.setItem('mybooks_host', 'http://nas.local');
    const service = await loadRealService();

    const controller = new AbortController();
    const pending = service.uploadMyBooksFilesNative(
      '/book/upload',
      [{ field: 'ebook', filePath: '/books/a.epub', fileName: 'a.epub' }],
      [],
      undefined,
      { signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(invokeMock).toHaveBeenCalledWith('cancel_upload', { uploadId: expect.any(String) });
    const uploadArgs = invokeMock.mock.calls.find(([cmd]) => cmd === 'upload_multipart')?.[1] as
      | { uploadId?: string }
      | undefined;
    expect(uploadArgs?.uploadId).toEqual(expect.any(String));
  });

  test('an already-aborted signal rejects without starting the upload', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const invokeMock = vi.mocked(invoke);
    localStorage.setItem('mybooks_host', 'http://nas.local');
    const service = await loadRealService();

    const controller = new AbortController();
    controller.abort();
    await expect(
      service.uploadMyBooksFilesNative(
        '/book/upload',
        [{ field: 'ebook', filePath: '/books/a.epub', fileName: 'a.epub' }],
        [],
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(invokeMock).not.toHaveBeenCalledWith('upload_multipart', expect.anything());
  });
});
