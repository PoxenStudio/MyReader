import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { BookNote } from '@/types/book';

const h = vi.hoisted(() => {
  type MockStore<T> = (() => T) & {
    getState: () => T;
    subscribe: (listener: () => void) => () => void;
    notify: () => void;
  };
  const makeStore = <T,>(state: T): MockStore<T> => {
    const listeners = new Set<() => void>();
    const store = (() => state) as MockStore<T>;
    store.getState = () => state;
    store.subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    store.notify = () => listeners.forEach((listener) => listener());
    return store;
  };

  const state = {
    config: { location: 'local-loc', updatedAt: 1000 } as {
      location: string;
      updatedAt: number;
      booknotes?: BookNote[];
      pendingReadingSeconds?: Record<string, number>;
    },
    progress: { location: 'local-loc' } as { location: string } | null,
    previewMode: false,
    inited: true,
    view: null as null | {
      goTo: (target: string) => Promise<void> | void;
      renderer?: EventTarget;
      lastLocation?: { cfi?: string };
    },
  };
  const readerStore = makeStore({
    getProgress: () => state.progress,
    getViewState: () => ({ previewMode: state.previewMode, inited: state.inited }),
    getView: () => state.view,
  });

  return {
    makeStore,
    state,
    readerStore,
    // `configs`/`notes` are intentionally loose: tests below resolve both a
    // `null` payload and a populated one.
    pullSyncMock: vi.fn(
      async (): Promise<{ configs: unknown; notes: unknown }> => ({
        configs: null,
        notes: null,
      }),
    ),
    pushSyncMock: vi.fn(async (_payload: unknown) => ({})),
    setConfigMock: vi.fn(),
    saveConfigMock: vi.fn(async () => {}),
    goToMock: vi.fn(),
    mybooksStatus: { currentUserId: 1, showOtherAnnotations: true },
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
  useMyBooksStatusStore: h.makeStore(h.mybooksStatus),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.readerStore,
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
  h.state.inited = true;
  h.state.view = {
    goTo: h.goToMock,
    renderer: new EventTarget(),
    lastLocation: { cfi: 'local-loc' },
  };
  h.mybooksStatus.currentUserId = 1;
  h.mybooksStatus.showOtherAnnotations = true;
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
    // The jump itself waits for a quiet gap in the renderer (see #44).
    expect(h.goToMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('waits for the renderer to settle before jumping to the pulled position', async () => {
    // Bug #44: applying a pulled CFI while the section is still being laid out
    // resolves it against an unsettled document. The paginator then falls back
    // to the section's first page, and that fallback is saved as the reading
    // position. The jump must wait until the renderer stops emitting
    // load/stabilized events.
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

    const renderer = h.state.view!.renderer!;
    // A layout burst keeps postponing the jump.
    await act(async () => {
      vi.advanceTimersByTime(700);
      renderer.dispatchEvent(new Event('stabilized'));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();

    // Still inside the quiet window that the event above restarted.
    await act(async () => {
      vi.advanceTimersByTime(400);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();

    // Quiet window elapsed: the jump runs.
    await act(async () => {
      vi.advanceTimersByTime(500);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('drops the jump when the book was closed while waiting for the renderer', async () => {
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

    h.state.view = null;
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();
  });

  test('waits for the view to finish initializing before jumping', async () => {
    // Bug #44: the view is registered in the store before view.init() runs,
    // so a pull that lands during init used to goTo a half-built renderer.
    h.state.inited = false;
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
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();

    h.state.inited = true;
    await act(async () => {
      h.readerStore.notify();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('aborts the jump when the view moved while waiting', async () => {
    // A page turn during the wait changes lastLocation; jumping anyway would
    // yank the reader away from the page they just turned to.
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

    h.state.view!.lastLocation = { cfi: 'user-loc' };
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();
  });

  test('gives up when the renderer never goes quiet', async () => {
    // The wait is bounded: a renderer that keeps emitting layout events would
    // otherwise postpone the jump forever and then fire it mid-read.
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

    const renderer = h.state.view!.renderer!;
    await act(async () => {
      for (let elapsed = 0; elapsed < 12_000; elapsed += 500) {
        vi.advanceTimersByTime(500);
        renderer.dispatchEvent(new Event('stabilized'));
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    });
    expect(h.goToMock).not.toHaveBeenCalled();
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

  test('pulls with own=1 when showOtherAnnotations is off', async () => {
    h.mybooksStatus.showOtherAnnotations = false;
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    expect(h.pullSyncMock).toHaveBeenCalledWith(0, { book: 'book-hash', own: 1 });
  });

  test('pulls with own=0 when showOtherAnnotations is on', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    expect(h.pullSyncMock).toHaveBeenCalledWith(0, { book: 'book-hash', own: 0 });
  });

  test('merges a pulled note’s userId/author from the wire uid/author fields', async () => {
    // The mybooks `/api/sync` server stamps cross-user notes with a numeric
    // `uid` field (see webserver/services/sync_service.py's
    // _push_book_records/_shared_notes) — NOT `user_id`. A note carrying
    // `author` but no recognized uid field must not silently fall back to
    // "own" (isOwn treats a missing userId as the current user's note).
    h.pullSyncMock.mockResolvedValue({
      configs: null,
      notes: [
        {
          id: 'n1',
          book_hash: 'book-hash',
          uid: 99,
          author: { nickname: 'Alice', avatar: 'a.png' },
          updatedAt: 10,
          note: 'theirs',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof h.pullSyncMock>>);

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({
        booknotes: [
          expect.objectContaining({
            id: 'n1',
            userId: '99',
            author: { nickname: 'Alice', avatar: 'a.png' },
          }),
        ],
      }),
    );
  });

  test('drops a locally-cached note the server no longer returns, once it was already synced', async () => {
    // Bug: pullNow's merge only ever adds/updates ids present in the
    // response — it never reconciles a local note whose id is *missing*
    // from a full (since=0) snapshot. So a note deleted server-side (or
    // never pushed by any device) stayed cached locally forever, re-saved
    // on every pull. A note that hasn't been pushed yet (newer than the
    // last successful sync) must NOT be swept away just because it isn't
    // on the server yet.
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: [] } as unknown as Awaited<
      ReturnType<typeof h.pullSyncMock>
    >);
    h.state.config = {
      location: 'local-loc',
      updatedAt: 1000,
      lastSyncedAtNotes: 5000,
      booknotes: [
        { id: 'stale', userId: '1', updatedAt: 100, note: 'gone on server' } as BookNote,
        { id: 'pending', updatedAt: 9000, note: 'not pushed yet' } as BookNote,
      ],
    } as unknown as typeof h.state.config;

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({
        booknotes: [expect.objectContaining({ id: 'pending' })],
      }),
    );
  });

  test('does not include a reading_seconds field when nothing has been tracked yet', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    h.pushSyncMock.mockClear();

    await flushPushDebounce();

    expect(h.pushSyncMock).toHaveBeenCalled();
    const payload = h.pushSyncMock.mock.calls[0]![0] as { reading_seconds?: unknown };
    expect(payload.reading_seconds).toBeUndefined();
  });

  test('piggybacks pending offline reading seconds onto the next push and clears them on success', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });
    h.state.config = {
      location: 'local-loc',
      updatedAt: 1000,
      pendingReadingSeconds: { '2025-12-31': 120 },
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    h.pushSyncMock.mockClear();
    h.setConfigMock.mockClear();

    await flushPushDebounce();

    expect(h.pushSyncMock).toHaveBeenCalled();
    const payload = h.pushSyncMock.mock.calls[0]![0] as {
      reading_seconds?: { book_hash: string; date: string; seconds: number }[];
    };
    expect(payload.reading_seconds).toEqual([
      { book_hash: 'book-hash', date: '2025-12-31', seconds: 120 },
    ]);
    // acked seconds must be cleared from the persisted config after a successful push
    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ pendingReadingSeconds: {} }),
    );
  });

  test('keeps pending offline reading seconds on a failed push', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });
    h.state.config = {
      location: 'local-loc',
      updatedAt: 1000,
      pendingReadingSeconds: { '2025-12-31': 60 },
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    h.pushSyncMock.mockRejectedValueOnce(new Error('offline'));
    h.setConfigMock.mockClear();

    await flushPushDebounce();

    expect(h.setConfigMock).not.toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ pendingReadingSeconds: expect.anything() }),
    );
  });

  test('does not push back a note that belongs to another user', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });
    h.state.config = {
      location: 'local-loc',
      updatedAt: 1000,
      booknotes: [
        { id: 'mine', userId: '1', updatedAt: 5, note: 'mine' } as BookNote,
        { id: 'theirs', userId: '99', updatedAt: 5, note: 'theirs' } as BookNote,
        { id: 'local', updatedAt: 5, note: 'local, not yet synced' } as BookNote,
      ],
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    h.setConfigMock.mockClear();

    await flushPushDebounce();

    expect(h.pushSyncMock).toHaveBeenCalled();
    const payload = h.pushSyncMock.mock.calls[0]![0] as { notes: { id: string }[] };
    expect(payload.notes.map((n) => n.id)).toEqual(['mine', 'local']);
  });
});
