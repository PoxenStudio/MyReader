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
    // Selector-aware like zustand's hook: the sync hook reads `currentUserId`
    // through `useMyBooksStatusStore((s) => s.currentUserId)`.
    const store = ((selector?: (state: T) => unknown) =>
      selector ? selector(state) : state) as MockStore<T>;
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
      lastSyncedAtNotes?: number;
      pendingReadingSeconds?: Record<string, number>;
      lastSyncedAtNotes?: number;
      lastSyncedAtConfig?: number;
      locationUpdatedAt?: number;
      rawAnchor?: unknown;
      rawAnchorCleared?: boolean;
      migratedRemoteUpdatedAt?: number;
    },
    progress: { location: 'local-loc' } as { location: string; source?: string } | null,
    previewMode: false,
    inited: true,
    error: null as string | null,
    closed: false,
    view: null as null | {
      goTo: (target: string) => Promise<void> | void;
      renderer?: EventTarget & { getContents?: () => { index?: number; doc?: unknown }[] };
      lastLocation?: { cfi?: string };
      resolveCFI?: (cfi: string) => { index: number; anchor: (doc: unknown) => unknown };
    },
  };
  const setProgressSourceMock = vi.fn();
  const readerStore = makeStore({
    getProgress: () => state.progress,
    getViewState: () =>
      state.closed
        ? null
        : { previewMode: state.previewMode, inited: state.inited, error: state.error },
    getView: () => state.view,
    getViewSettings: () => null,
    setProgressSource: setProgressSourceMock,
  });

  return {
    makeStore,
    state,
    readerStore,
    setProgressSourceMock,
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
    saveConfigMock: vi.fn(async (..._args: unknown[]) => {}),
    goToMock: vi.fn(async (_target: string) => {}),
    ensureCurrentUserIdMock: vi.fn(async (): Promise<number | null> => 1),
    identityVerified: true,
    identitySettled: true,
    mybooksStatus: {
      currentUserId: 1 as number | null,
      showOtherAnnotations: true,
      sysInfo: null as { timezone?: string | null } | null,
    },
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

vi.mock('@/services/mybooksService', () => ({
  ensureCurrentUserId: () => h.ensureCurrentUserIdMock(),
  isCurrentUserIdVerified: () => h.identityVerified,
  isCurrentUserIdSettled: () => h.identitySettled,
}));

vi.mock('../hooks/useWindowActiveChanged', () => ({
  useWindowActiveChanged: () => {},
}));

vi.mock('../hooks/useNativeSyncEvents', () => ({
  useNativeSyncEvents: () => {},
}));

const rawLocationMocks = vi.hoisted(() => ({
  resolveRawAnchorToCfi: vi.fn(
    async (..._args: unknown[]): Promise<{ cfi: string; mode: 'exact' | 'approx' } | null> => ({
      cfi: 'remote-loc',
      mode: 'exact',
    }),
  ),
  resolveLegacyCfiToLocal: vi.fn(
    async (..._args: unknown[]): Promise<{ cfi: string; index: number } | null> => ({
      cfi: 'remote-loc',
      index: 0,
    }),
  ),
  buildRawAnchorForRange: vi.fn(async () => ({
    v: 2 as const,
    index: 0,
    rawOffset: 10,
    rawFraction: 0.1,
    rawQuote: 'quote',
    rawPrefix: '',
    rawSuffix: '',
    sectionHash: 'hash',
    rawTextVersion: 1,
    precision: 'exact' as const,
  })),
  isCfiWithinRange: vi.fn((_target?: string, _visible?: string) => true),
  resetLocationCaches: vi.fn(),
}));

vi.mock('@/services/mybooks/rawLocation', () => rawLocationMocks);

import { useNativeSync } from '@/app/reader/hooks/useNativeSync';

const makeRawAnchor = (rawOffset = 10) => ({
  v: 2 as const,
  index: 0,
  rawOffset,
  rawFraction: 0.1,
  rawQuote: 'quote',
  rawPrefix: '',
  rawSuffix: '',
  sectionHash: 'hash',
  rawTextVersion: 1,
  precision: 'exact' as const,
});

beforeEach(() => {
  vi.useFakeTimers();
  h.pullSyncMock.mockClear();
  h.pushSyncMock.mockClear();
  h.setConfigMock.mockClear();
  h.saveConfigMock.mockClear();
  h.goToMock.mockClear();
  h.setProgressSourceMock.mockClear();
  rawLocationMocks.resolveRawAnchorToCfi.mockClear();
  rawLocationMocks.resolveLegacyCfiToLocal.mockClear();
  rawLocationMocks.buildRawAnchorForRange.mockClear();
  rawLocationMocks.isCfiWithinRange.mockClear();
  rawLocationMocks.resolveRawAnchorToCfi.mockResolvedValue({
    cfi: 'remote-loc',
    mode: 'exact',
  });
  rawLocationMocks.resolveLegacyCfiToLocal.mockResolvedValue({
    cfi: 'remote-loc',
    index: 0,
  });
  rawLocationMocks.buildRawAnchorForRange.mockResolvedValue({
    v: 2,
    index: 0,
    rawOffset: 10,
    rawFraction: 0.1,
    rawQuote: 'quote',
    rawPrefix: '',
    rawSuffix: '',
    sectionHash: 'hash',
    rawTextVersion: 1,
    precision: 'exact',
  });
  rawLocationMocks.isCfiWithinRange.mockImplementation(
    (target?: string, visible?: string) => target === visible,
  );
  h.state.config = { location: 'local-loc', updatedAt: 1000 };
  h.state.progress = { location: 'local-loc', source: 'restore' };
  h.state.previewMode = false;
  h.state.inited = true;
  h.state.error = null;
  h.state.closed = false;
  h.state.view = {
    goTo: h.goToMock,
    renderer: new EventTarget(),
    lastLocation: { cfi: 'local-loc' },
  };
  h.goToMock.mockImplementation(async (target: string) => {
    h.state.view!.lastLocation = { cfi: target };
  });
  h.mybooksStatus.currentUserId = 1;
  h.mybooksStatus.showOtherAnnotations = true;
  h.mybooksStatus.sysInfo = null;
  h.ensureCurrentUserIdMock.mockClear();
  h.ensureCurrentUserIdMock.mockResolvedValue(1);
  h.identityVerified = true;
  h.identitySettled = true;
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
  test('holds sync until the reader identity is resolved', async () => {
    // A pull stamps `userId` onto the reader's own notes. Ownership checks are
    // strict, so without the numeric id those notes (notably drawings) become
    // invisible and stop being pushed. Sync therefore must not start before
    // `/user/whoami` (via ensureCurrentUserId) has resolved the identity.
    h.mybooksStatus.currentUserId = null;
    // Resolve through the same store the hook reads, i.e. what the real
    // ensureCurrentUserId does, rather than poking the field by hand.
    h.ensureCurrentUserIdMock.mockImplementation(async () => {
      h.mybooksStatus.currentUserId = 1;
      return 1;
    });

    const { rerender } = renderHook(() => useNativeSync('book-key'));
    await flushPushDebounce();

    expect(h.ensureCurrentUserIdMock).toHaveBeenCalled();
    // The mocked store doesn't re-render the hook by itself; the render after
    // the id lands is what makes it sync-ready.
    expect(h.pullSyncMock).not.toHaveBeenCalled();
    expect(h.pushSyncMock).not.toHaveBeenCalled();

    rerender();
    await flushMicrotasks();

    expect(h.pullSyncMock).toHaveBeenCalled();
  });

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

    // The jump waits for a quiet renderer window (see #44) and the config is
    // only committed after the landing is verified.
    expect(h.goToMock).not.toHaveBeenCalled();
    // 1st quiet window: run goTo. 2nd: verify the landing before persisting.
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ location: 'remote-loc' }),
    );
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

  test('keeps waiting out a slow open and drops the jump when it fails', async () => {
    // A slow open must keep the jump pending for as long as it takes — there
    // is no timeout. Only closing the book or a failed open ends the wait.
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
      vi.advanceTimersByTime(120_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();

    h.state.error = 'Failed to load book.';
    await act(async () => {
      h.readerStore.notify();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // A late init after the failure must not revive the dropped jump.
    h.state.error = null;
    h.state.inited = true;
    await act(async () => {
      h.readerStore.notify();
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();
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

  test('waits for the target range to have geometry before jumping', async () => {
    // #44: the paginator scrolls to the section start when the resolved range
    // has no client rects (the section is still being laid into a zero-width
    // iframe). The jump must wait for real geometry, not just a quiet gap.
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

    const range = { getClientRects: (): unknown[] => [] };
    const renderer = Object.assign(new EventTarget(), {
      getContents: () => [{ index: 0, doc: {} }],
    });
    h.state.view = {
      goTo: h.goToMock,
      renderer,
      lastLocation: { cfi: 'local-loc' },
      resolveCFI: () => ({ index: 0, anchor: () => range }),
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();

    // The section finished laying out: the range now has real client rects.
    range.getClientRects = () => [{ width: 10, height: 10 }];
    renderer.dispatchEvent(new Event('stabilized'));
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('lets goTo handle a section whose chunks cannot resolve the target', async () => {
    // Sections above the chunk threshold render as several documents under
    // the same index. Only the chunk that holds the target resolves it; the
    // others must be skipped instead of being read as "not laid out yet".
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

    const targetDoc = { name: 'target-chunk' };
    const range = { collapsed: false, getClientRects: () => [{ width: 10, height: 10 }] };
    h.state.view = {
      goTo: h.goToMock,
      renderer: Object.assign(new EventTarget(), {
        getContents: () => [
          { index: 0, doc: { name: 'placeholder-chunk' } },
          { index: 0, doc: targetDoc },
        ],
      }),
      lastLocation: { cfi: 'local-loc' },
      resolveCFI: () => ({
        index: 0,
        anchor: (doc: unknown) => (doc === targetDoc ? range : null),
      }),
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('drops the jump when the book was already closed before the pull landed', async () => {
    // The pull resolves after the reader left the book; the wait must notice
    // that immediately instead of hanging until some later store update (and
    // then applying the stale target to a reopened book).
    h.state.closed = true;
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

    h.state.closed = false;
    h.state.inited = true;
    await act(async () => {
      h.readerStore.notify();
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).not.toHaveBeenCalled();
  });

  test('an end-only relocation does not count as the view moving', async () => {
    // A background re-anchor can change the visible range's end offset while
    // the reader stays put; only a changed start means real navigation.
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
    h.state.view!.lastLocation = { cfi: 'epubcfi(/6/96!/4/2,/570,/586/1:45)' };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    h.state.view!.lastLocation = { cfi: 'epubcfi(/6/96!/4/2,/570,/700/1:2)' };
    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('keeps waiting through a long layout burst and still jumps once it settles', async () => {
    // Slow devices lay a large section out for tens of seconds (#44: first
    // page at 15.6s). Giving up mid-burst would mean those devices never
    // jump; the wait must survive the burst and apply the position afterwards.
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

    await act(async () => {
      vi.advanceTimersByTime(800);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
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

  test('coerces a numeric-string uid instead of treating the note as foreign', async () => {
    h.pullSyncMock.mockResolvedValue({
      configs: null,
      notes: [
        {
          id: 'n1',
          book_hash: 'book-hash',
          uid: '1',
          updatedAt: 10,
          note: 'mine',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof h.pullSyncMock>>);

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    const merged = h.setConfigMock.mock.calls
      .map((call) => call[1] as { booknotes?: BookNote[] })
      .find((config) => config?.booknotes);
    expect(merged?.booknotes?.[0]).toMatchObject({ id: 'n1', userId: '1' });
  });

  test('treats an author-tagged row without a uid as foreign, never unowned', async () => {
    // A row that carries author info is someone else's by definition; letting
    // it land as "no userId" would make the strict ownership checks adopt it.
    h.pullSyncMock.mockResolvedValue({
      configs: null,
      notes: [
        {
          id: 'n1',
          book_hash: 'book-hash',
          author: { nickname: 'Alice' },
          updatedAt: 10,
          note: 'theirs',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof h.pullSyncMock>>);

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    const merged = h.setConfigMock.mock.calls
      .map((call) => call[1] as { booknotes?: BookNote[] })
      .find((config) => config?.booknotes);
    expect(merged?.booknotes?.[0]).toMatchObject({ id: 'n1', userId: 'foreign' });
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

  test('buckets tracked seconds by the site timezone from sysInfo', async () => {
    // 接线测试：sys.timezone → ensureTracker → tick → reading_seconds.date。
    // 2026-10-30T16:30Z = 北京 10-31 00:30：按 UTC 日会记成 10-30，正是这个 bug。
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });
    h.mybooksStatus.sysInfo = { timezone: 'Asia/Shanghai' };
    vi.setSystemTime(new Date('2026-10-30T16:30:00Z'));

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    h.pushSyncMock.mockClear();

    // 20s 时攒下第一段 10s（首个 tick 只记 lastTickAt）；等 keepalive（60s 间隔、
    // 距上次 push 也要满 60s）把它带走——普通 debounce push 发生在攒到秒数之前。
    // Advance in steps so the push in flight can resolve; otherwise every
    // keepalive ticks while the first request is still pending and skips.
    for (let step = 0; step < 5; step++) {
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
    }

    const withSeconds = h.pushSyncMock.mock.calls
      .map((call) => call[0] as { reading_seconds?: { date: string; seconds: number }[] })
      .filter((payload) => payload.reading_seconds && payload.reading_seconds.length > 0);
    expect(withSeconds.length).toBeGreaterThan(0);
    const readings = withSeconds.at(-1)!.reading_seconds!;
    expect(readings[0]!.date).toBe('2026-10-31');
    expect(readings[0]!.seconds).toBeGreaterThan(0);
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

  test('does not push while the identity is still unverified', async () => {
    // A cached-but-unverified id could filter notes with the wrong account and
    // let the server stamp them under the current session; pushes wait for the
    // first whoami attempt to settle.
    h.identitySettled = false;
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });

    const { rerender } = renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    await flushPushDebounce();

    expect(h.pushSyncMock).not.toHaveBeenCalled();

    // A later local change (after identity settled) pushes normally.
    h.identitySettled = true;
    h.state.progress = { location: 'second-loc' };
    rerender();
    await flushPushDebounce();

    expect(h.pushSyncMock).toHaveBeenCalled();
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

  test('never sweeps a local drawing that the remote snapshot lacks', async () => {
    const ink: BookNote = {
      id: 'ink1',
      type: 'ink',
      cfi: 'epubcfi(/6/10)',
      note: '',
      createdAt: 1000,
      updatedAt: 1500,
      ink: [{ id: 's1', color: '#000', width: 0.004, points: [[0.1, 0.1]] }],
    };
    h.state.config = {
      location: 'local-loc',
      updatedAt: 1000,
      lastSyncedAtNotes: 999_999, // older than the drawing, so the old sweep would drop it
      booknotes: [ink],
    };
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: [] });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    const merged = h.setConfigMock.mock.calls
      .map((call) => call[1] as { booknotes?: BookNote[] })
      .find((config) => config?.booknotes);
    expect(merged?.booknotes?.some((note) => note.id === 'ink1')).toBe(true);
  });

  test('keeps local strokes when a live remote row carries no ink', async () => {
    const ink: BookNote = {
      id: 'ink1',
      type: 'ink',
      cfi: 'epubcfi(/6/10)',
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
      ink: [{ id: 's1', color: '#000', width: 0.004, points: [[0.1, 0.1]] }],
    };
    h.state.config = { location: 'local-loc', updatedAt: 1000, booknotes: [ink] };
    h.pullSyncMock.mockResolvedValue({
      configs: null,
      notes: [{ ...ink, updatedAt: 5000, ink: [] }],
    });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    const merged = h.setConfigMock.mock.calls
      .map((call) => call[1] as { booknotes?: BookNote[] })
      .find((config) => config?.booknotes);
    const stored = merged?.booknotes?.find((note) => note.id === 'ink1');
    expect(stored?.ink).toHaveLength(1);
  });

  test('applies a raw anchor and preserves the server record timestamp', async () => {
    const anchor = makeRawAnchor(120);
    rawLocationMocks.resolveRawAnchorToCfi.mockResolvedValue({
      cfi: 'anchor-loc',
      mode: 'exact',
    });
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
          raw_anchor: anchor,
        },
      ],
      notes: null,
    });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(rawLocationMocks.resolveRawAnchorToCfi).toHaveBeenCalledWith(
      'book-key',
      expect.anything(),
      anchor,
      null,
    );
    expect(h.goToMock).toHaveBeenCalledWith('anchor-loc');
    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({
        location: 'anchor-loc',
        rawAnchor: anchor,
        updatedAt: 2000,
      }),
    );
    expect(
      h.saveConfigMock.mock.calls.some(
        (call) => (call[4] as { preserveUpdatedAt?: boolean } | undefined)?.preserveUpdatedAt,
      ),
    ).toBe(true);
  });

  test('does not apply a remote location that cannot be resolved locally', async () => {
    rawLocationMocks.resolveRawAnchorToCfi.mockResolvedValue(null);
    rawLocationMocks.resolveLegacyCfiToLocal.mockResolvedValue(null);
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(h.goToMock).not.toHaveBeenCalled();
    expect(h.setConfigMock).not.toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ location: 'epubcfi(/6/4!/4/2/1:5)' }),
    );
  });

  test('migrates a legacy record from MyBooks even when the local timestamp is newer', async () => {
    h.state.config = { location: 'local-loc', updatedAt: 5000 };
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('pushes the collapsed location, locationUpdatedAt and raw anchor', async () => {
    const anchor = makeRawAnchor(120);
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });
    h.state.config = {
      location: 'epubcfi(/6/4!/4/2/1:5)',
      updatedAt: 1000,
      locationUpdatedAt: 3000,
      rawAnchor: anchor,
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    await flushPushDebounce();

    const payload = h.pushSyncMock.mock.calls.at(-1)![0] as {
      configs?: { updated_at: number; location: string; raw_anchor: unknown }[];
    };
    expect(payload.configs?.[0]?.updated_at).toBe(3000);
    expect(payload.configs?.[0]?.location).toBe('epubcfi(/6/4!/4/2/1:5)');
    expect(payload.configs?.[0]?.raw_anchor).toEqual(anchor);
  });

  test('a user turn during a pull is not overwritten by the remote snapshot', async () => {
    let resolvePull: (value: unknown) => void = () => {};
    h.pullSyncMock.mockImplementation(
      () => new Promise((resolve) => (resolvePull = resolve)) as never,
    );

    const { rerender } = renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();

    h.state.progress = { location: 'user-turn', source: 'user' };
    rerender();
    await flushMicrotasks();

    resolvePull({
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
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(h.goToMock).not.toHaveBeenCalled();
    expect(h.setConfigMock).not.toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ location: 'remote-loc' }),
    );
  });

  test('clears the server anchor when the position advanced without one', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });
    h.state.config = {
      location: 'epubcfi(/6/4!/4/2/1:5)',
      updatedAt: 1000,
      locationUpdatedAt: 3000,
      rawAnchorCleared: true,
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    await flushPushDebounce();

    const payload = h.pushSyncMock.mock.calls.at(-1)![0] as {
      configs?: { raw_anchor: unknown }[];
    };
    expect(payload.configs?.[0]?.raw_anchor).toBeNull();
  });

  test('does not repeat the server-truth migration for the same legacy record', async () => {
    h.state.config = {
      location: 'local-loc',
      updatedAt: 5000,
      migratedRemoteUpdatedAt: 2000,
    };
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(h.goToMock).not.toHaveBeenCalled();
  });

  test('skips goTo when the target is already on the visible page', async () => {
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });
    h.state.view!.lastLocation = { cfi: 'epubcfi(/6/4!/4/2/1:5)' };
    rawLocationMocks.resolveLegacyCfiToLocal.mockResolvedValue({
      cfi: 'epubcfi(/6/4!/4/2/1:5)',
      index: 0,
    });
    rawLocationMocks.isCfiWithinRange.mockReturnValue(true);

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(h.goToMock).not.toHaveBeenCalled();
    expect(h.setConfigMock).toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ location: 'epubcfi(/6/4!/4/2/1:5)' }),
    );
  });

  test('bounds the layout wait instead of hanging the pull forever', async () => {
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });
    // A resolvable range with no geometry, forever — the old loop would never
    // exit and every later pull would queue behind it.
    const zeroRectRange = {
      collapsed: false,
      getClientRects: () => [] as DOMRect[],
    } as unknown as Range;
    h.state.view!.resolveCFI = () => ({
      index: 0,
      anchor: () => zeroRectRange,
    });
    (h.state.view!.renderer as EventTarget & { getContents?: () => unknown[] }).getContents =
      () => [{ doc: document, index: 0 }];

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(h.goToMock).toHaveBeenCalledWith('remote-loc');
  });

  test('does not apply a remote location while a deep link is previewed', async () => {
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });
    h.state.previewMode = true;

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    expect(h.goToMock).not.toHaveBeenCalled();
    expect(h.setConfigMock).not.toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ location: 'epubcfi(/6/4!/4/2/1:5)' }),
    );
  });

  test('omits raw_anchor entirely when there is neither an anchor nor a pending clear', async () => {
    h.pullSyncMock.mockResolvedValue({ configs: null, notes: null });
    h.state.config = {
      location: 'epubcfi(/6/4!/4/2/1:5)',
      updatedAt: 1000,
    };

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    await flushPushDebounce();

    const payload = h.pushSyncMock.mock.calls.at(-1)![0] as {
      configs?: Record<string, unknown>[];
    };
    expect(payload.configs?.[0]).toBeDefined();
    expect('raw_anchor' in payload.configs![0]!).toBe(false);
  });

  test('a user turn after a remote apply is still pushed', async () => {
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });

    const { rerender } = renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }
    h.pushSyncMock.mockClear();

    const userLocation = 'epubcfi(/6/4!/4/2/1:1)';
    h.state.config = {
      location: userLocation,
      updatedAt: 3000,
      locationUpdatedAt: 3000,
    };
    h.state.progress = { location: userLocation, source: 'user' };
    rerender();
    await flushMicrotasks();
    await flushPushDebounce();

    const payload = h.pushSyncMock.mock.calls.at(-1)![0] as {
      configs?: { location: string; updated_at: number }[];
    };
    expect(payload.configs?.[0]?.location).toBe(userLocation);
    expect(payload.configs?.[0]?.updated_at).toBe(3000);
  });

  test('an unverified landing is not promoted to a user position and is reverted', async () => {
    h.pullSyncMock.mockResolvedValue({
      configs: [
        {
          id: 'book-hash',
          book_hash: 'book-hash',
          updatedAt: 2000,
          progress: [1, 450],
          location: 'epubcfi(/6/4!/4/2/1:5)',
        },
      ],
      notes: null,
    });
    rawLocationMocks.resolveLegacyCfiToLocal.mockResolvedValue({
      cfi: 'remote-loc',
      index: 0,
    });
    rawLocationMocks.isCfiWithinRange.mockReturnValue(false);

    renderHook(() => useNativeSync('book-key'));
    await flushMicrotasks();
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(800);
        for (let j = 0; j < 10; j++) await Promise.resolve();
      });
    }

    // Applied target, then reverted to the previous position.
    expect(h.goToMock.mock.calls.map((call) => call[0])).toEqual(['remote-loc', 'local-loc']);
    expect(h.setProgressSourceMock).toHaveBeenCalledWith('book-key', 'remote');
    expect(h.setProgressSourceMock).not.toHaveBeenCalledWith('book-key', 'user');
    expect(h.setConfigMock).not.toHaveBeenCalledWith(
      'book-key',
      expect.objectContaining({ location: 'remote-loc' }),
    );
  });
});
