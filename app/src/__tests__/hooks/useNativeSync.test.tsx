import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = () => state;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as (() => T) & { getState: () => T };
  };

  return {
    makeStore,
    state: {
      config: { location: 'local-loc', updatedAt: 1000 } as {
        location: string;
        updatedAt: number;
      },
      progress: { location: 'local-loc' } as { location: string } | null,
      previewMode: false,
    },
    pullSyncMock: vi.fn(async () => ({ configs: null, notes: null })),
    pushSyncMock: vi.fn(async () => ({})),
    setConfigMock: vi.fn(),
    saveConfigMock: vi.fn(async () => {}),
    goToMock: vi.fn(),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ status: 'logged_in', isGuest: false }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { name: 'env' } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    setConfig: h.setConfigMock,
    getBookData: () => ({ book: { hash: 'book-hash', metaHash: 'meta-hash' } }),
    saveConfig: h.saveConfigMock,
  }),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksSyncAllowed: () => true,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({
    getProgress: () => h.state.progress,
    getViewState: () => ({ previewMode: h.state.previewMode }),
    getView: () => ({ goTo: h.goToMock }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({ settings: { version: 1 } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/services/mybooks/constants', () => ({
  ENABLE_SYNC_FEATURE: true,
}));

vi.mock('@/services/mybooks/syncClient', () => ({
  pullSync: (...args: Parameters<typeof h.pullSyncMock>) => h.pullSyncMock(...args),
  pushSync: (...args: Parameters<typeof h.pushSyncMock>) => h.pushSyncMock(...args),
  SyncApiError: class SyncApiError extends Error {},
}));

vi.mock('../hooks/useWindowActiveChanged', () => ({
  useWindowActiveChanged: () => {},
}));

vi.mock('../hooks/useNativeSyncEvents', () => ({
  useNativeSyncEvents: () => {},
}));

import { useNativeSync } from '@/app/reader/hooks/useNativeSync';

beforeEach(() => {
  vi.useFakeTimers();
  h.pullSyncMock.mockClear();
  h.pushSyncMock.mockClear();
  h.setConfigMock.mockClear();
  h.saveConfigMock.mockClear();
  h.goToMock.mockClear();
  h.state.config = { location: 'local-loc', updatedAt: 1000 };
  h.state.progress = { location: 'local-loc' };
  h.state.previewMode = false;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const flushPushDebounce = async () => {
  await act(async () => {
    vi.advanceTimersByTime(15_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

const flushMicrotasks = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

describe('useNativeSync', () => {
  test('does not push before the initial pull-on-open has resolved', async () => {
    // Bug: opening a book fires the pull-once effect and the auto-push effect
    // in the same render (both keyed off progress?.location). If pushNow isn't
    // gated on hasPulledOnce, it can push local (possibly stale) progress and
    // overwrite the server's config before the pull's merge ever lands.
    h.pullSyncMock.mockImplementation(() => new Promise(() => {})); // never resolves

    renderHook(() => useNativeSync('book-key'));

    await flushPushDebounce();

    expect(h.pushSyncMock).not.toHaveBeenCalled();
  });

  test('navigates the live view when the pulled remote config wins the merge', async () => {
    // Bug: pulling a newer remote config updates the BookConfig store
    // (setConfig/saveConfig) but nothing tells the already-rendered
    // <foliate-view> to jump to that location, so the book silently stays
    // at the local/default position even though sync "succeeded".
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'remote-loc',
        },
      ],
      notes: null,
    });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ location: 'remote-loc' }),
    );
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('records lastSyncedAtConfig/lastSyncedAtNotes after a successful pull', async () => {
    // Bug: pullNow never wrote lastSyncedAtConfig/lastSyncedAtNotes onto the
    // BookConfig, so the "last synced" UI always showed "Never synced" even
    // after sync ran successfully.
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({
        lastSyncedAtConfig: expect.any(Number),
        lastSyncedAtNotes: expect.any(Number),
      }),
    );
  });

  test('records lastSyncedAtConfig/lastSyncedAtNotes after a successful push', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    h.setConfigMock.mockClear();

    await flushPushDebounce();

    expect(h.pushSyncMock).toHaveBeenCalled();
    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({
        lastSyncedAtConfig: expect.any(Number),
        lastSyncedAtNotes: expect.any(Number),
      }),
    );
  });
});
