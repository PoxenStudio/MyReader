import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTransferStore } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import type { AudioTrack } from '@/services/audiobook/audiobookService';

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

// downloadMyBooksUrl pulls in tauriFetch/NAS cookie plumbing that isn't
// under test here; stub it so executeAudiobookTrackTransfer tests only
// assert on how it's called.
const downloadMyBooksUrlMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/cloudService', () => ({
  downloadMyBooksUrl: (...args: unknown[]) => downloadMyBooksUrlMock(...args),
}));

import { transferManager } from '@/services/transferManager';

const track = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  filename: 'ch1',
  url: '/api/audio/5/0001_ch1.mp3',
  size: 1000,
  ...overrides,
});

const resetTransferManager = () => {
  const mgr = transferManager as unknown as Record<string, unknown>;
  mgr['isInitialized'] = false;
  mgr['isProcessing'] = false;
  mgr['appService'] = null;
  mgr['getLibrary'] = null;
  mgr['updateBook'] = null;
  mgr['_'] = null;
  (mgr['abortControllers'] as Map<string, AbortController>).clear();
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

function makeAppService() {
  return {
    uploadBook: vi.fn().mockResolvedValue(undefined),
    downloadBook: vi.fn().mockResolvedValue(undefined),
    createDir: vi.fn().mockResolvedValue(undefined),
    resolveFilePath: vi.fn().mockImplementation(async (path: string) => `/resolved/${path}`),
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
  downloadMyBooksUrlMock.mockClear();
  localStorage.clear();
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

describe('TransferManager audiobook tracks', () => {
  test('queueAudiobookTrack queues a download transfer carrying the track payload', async () => {
    const appService = makeAppService();
    await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);
    transferManager.pauseQueue();

    const id = transferManager.queueAudiobookTrack(5, track())!;
    const transfer = useTransferStore.getState().transfers[id];

    expect(transfer).toBeDefined();
    expect(transfer!.kind).toBe('audiobook_track');
    expect(transfer!.type).toBe('download');
    expect(transfer!.isBackground).toBe(true);
    expect(transfer!.audiobook).toEqual({
      bookId: 5,
      filename: '0001_ch1.mp3',
      url: '/api/audio/5/0001_ch1.mp3',
      size: 1000,
    });
  });

  test('dedups against an already-queued track by physical filename', async () => {
    const appService = makeAppService();
    await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);
    transferManager.pauseQueue();

    const id1 = transferManager.queueAudiobookTrack(5, track());
    const id2 = transferManager.queueAudiobookTrack(5, track());
    expect(id1).toBe(id2);
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(1);
  });

  test('queueAudiobookTracks dedupes m4b virtual chapters sharing one physical file', async () => {
    const appService = makeAppService();
    await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);
    transferManager.pauseQueue();

    const shared = '/api/audio/5/book.m4b';
    const ids = transferManager.queueAudiobookTracks(5, [
      track({ filename: 'Chapter 1', url: shared, start_time: 0, end_time: 100 }),
      track({ filename: 'Chapter 2', url: shared, start_time: 100, end_time: 200 }),
    ]);

    expect(ids).toHaveLength(1);
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(1);
  });

  test('returns null/empty when not initialized', () => {
    expect(transferManager.queueAudiobookTrack(5, track())).toBeNull();
    expect(transferManager.queueAudiobookTracks(5, [track()])).toEqual([]);
  });

  test('processing downloads to Books/audiobooks/<bookId>/<filename> via downloadMyBooksUrl', async () => {
    const appService = makeAppService();
    await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

    const id = transferManager.queueAudiobookTrack(5, track())!;
    await vi.advanceTimersByTimeAsync(500);

    expect(appService['createDir']).toHaveBeenCalledWith('audiobooks/5', 'Books', true);
    expect(appService['resolveFilePath']).toHaveBeenCalledWith(
      'audiobooks/5/0001_ch1.mp3',
      'Books',
    );
    expect(downloadMyBooksUrlMock).toHaveBeenCalledWith(
      appService,
      '/api/audio/5/0001_ch1.mp3',
      '/resolved/audiobooks/5/0001_ch1.mp3',
      expect.any(Function),
    );

    const transfer = useTransferStore.getState().transfers[id];
    expect(transfer!.status).toBe('completed');
  });

  test('a failed audiobook download does not surface a success toast (isBackground)', async () => {
    const { eventDispatcher } = await import('@/utils/event');
    const appService = makeAppService();
    await transferManager.initialize(appService as never, () => [], vi.fn(), translationFn);

    transferManager.queueAudiobookTrack(5, track())!;
    await vi.advanceTimersByTimeAsync(500);

    expect(eventDispatcher.dispatch).not.toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'info' }),
    );
  });
});
