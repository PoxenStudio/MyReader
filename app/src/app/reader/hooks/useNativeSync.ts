import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useMyBooksSyncAllowed } from '@/store/mybooksStatusStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { getBookHash } from '@/utils/book';
import { BookConfig, BookNote } from '@/types/book';
import { ENABLE_SYNC_FEATURE } from '@/services/mybooks/constants';
import { pullSync, pushSync, SyncApiError } from '@/services/mybooks/syncClient';
import { useWindowActiveChanged } from './useWindowActiveChanged';
import { useNativeSyncEvents, type SyncChangedEvent } from './useNativeSyncEvents';

/**
 * MyReader(Readest) Native Sync per-book hook — syncs reading progress (`BookConfig`)
 * and notes/highlights (`BookNote`) against mybooks' `/api/sync`
 * (document/MyBooks_Sync_WS_Design.md §11). Deliberately scoped to
 * configs + notes only:
 *   - Book file binaries are out of scope (mybooks owns the library).
 *   - Book metadata (title/author/tags) sync is not wired up here yet —
 *     it would need a library-page-level hook, not a per-reader one.
 *
 * Gated on having an active (non-guest) mybooks login — there is no
 * separate on/off toggle; being logged into mybooks *is* the toggle.
 */

const PUSH_DEBOUNCE_MS = 15_000;
const PULL_COOLDOWN_MS = 60_000;

export const useNativeSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { status, isGuest } = useAuth();
  const { settings } = useSettingsStore();
  const { getProgress } = useReaderStore();
  const { getConfig, setConfig, getBookData, saveConfig } = useBookDataStore();
  const isSyncAllowed = useMyBooksSyncAllowed();
  const progress = getProgress(bookKey);

  const isReady = ENABLE_SYNC_FEATURE && status === 'logged_in' && !isGuest && isSyncAllowed;

  useNativeSyncEvents(isReady);

  const dirtyRef = useRef(false);
  const lastPulledAtRef = useRef(0);
  const hasPulledOnce = useRef(false);

  const pushNow = useCallback(async () => {
    if (!isReady) return;
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;

    const now = Date.now();
    try {
      await pushSync({
        configs: [
          {
            id: book.hash,
            book_hash: book.hash,
            meta_hash: book.metaHash,
            updated_at: now,
            deleted_at: null,
            progress: config.progress,
            location: config.location,
            xpointer: config.xpointer,
            updatedAt: now,
          },
        ],
        notes: (config.booknotes ?? []).map((note) => ({
          book_hash: book.hash,
          meta_hash: book.metaHash,
          updated_at: note.updatedAt,
          deleted_at: note.deletedAt ?? null,
          ...note,
        })),
      });
      dirtyRef.current = false;
    } catch (e) {
      if (e instanceof SyncApiError) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Sync failed: {{message}}', { message: e.message }),
        });
      } else {
        console.warn('Native sync push failed', e);
      }
    }
  }, [isReady, bookKey, getConfig, getBookData, _]);

  const pullNow = useCallback(async (): Promise<boolean> => {
    if (!isReady) return false;
    const book = getBookData(bookKey)?.book;
    const config = getConfig(bookKey);
    if (!book || !config) return false;

    try {
      const result = await pullSync(0, { book: book.hash });
      lastPulledAtRef.current = Date.now();

      const remoteConfig = result.configs?.[0];
      const remoteNotes = result.notes ?? [];
      if (!remoteConfig && remoteNotes.length === 0) return false;

      const localUpdatedAt = config.updatedAt ?? 0;
      const remoteUpdatedAt = remoteConfig?.updatedAt ?? remoteConfig?.updated_at ?? 0;
      const mergedConfig: BookConfig =
        remoteConfig && remoteUpdatedAt > localUpdatedAt
          ? {
              ...config,
              progress: remoteConfig.progress ?? config.progress,
              location: remoteConfig.location ?? config.location,
              xpointer: remoteConfig.xpointer ?? config.xpointer,
              updatedAt: remoteUpdatedAt,
            }
          : config;

      const byId = new Map<string, BookNote>();
      for (const n of config.booknotes ?? []) byId.set(n.id, n);
      for (const remote of remoteNotes) {
        const local = byId.get(remote.id);
        const remoteTs = Math.max(remote.updatedAt ?? 0, remote.deletedAt ?? 0);
        const localTs = local ? Math.max(local.updatedAt ?? 0, local.deletedAt ?? 0) : -1;
        if (remoteTs >= localTs) byId.set(remote.id, { ...local, ...remote } as BookNote);
      }
      mergedConfig.booknotes = Array.from(byId.values());

      setConfig(bookKey, mergedConfig);
      const latest = getConfig(bookKey);
      if (latest) await saveConfig(envConfig, bookKey, latest, settings);
      return true;
    } catch (e) {
      if (e instanceof SyncApiError) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Sync failed: {{message}}', { message: e.message }),
        });
      } else {
        console.warn('Native sync pull failed', e);
      }
      return false;
    }
  }, [isReady, bookKey, getConfig, getBookData, setConfig, saveConfig, envConfig, settings, _]);

  const syncRefs = useRef({ pushNow, pullNow });
  useEffect(() => {
    syncRefs.current = { pushNow, pullNow };
  }, [pushNow, pullNow]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedPush = useCallback(
    debounce(() => {
      if (!dirtyRef.current) return;
      syncRefs.current.pushNow();
    }, PUSH_DEBOUNCE_MS),
    [],
  );

  const markDirtyAndSchedule = useCallback(() => {
    dirtyRef.current = true;
    debouncedPush();
  }, [debouncedPush]);

  // Pull once on book open.
  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    if (hasPulledOnce.current) return;
    hasPulledOnce.current = true;
    void syncRefs.current.pullNow();
  }, [isReady, progress?.location]);

  // Auto-push on progress changes.
  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    markDirtyAndSchedule();
  }, [isReady, progress?.location, markDirtyAndSchedule]);

  const config = getConfig(bookKey);
  const booknoteFingerprint = useMemo(() => {
    const notes = config?.booknotes ?? [];
    let max = 0;
    for (const n of notes) max = Math.max(max, n.updatedAt ?? 0, n.deletedAt ?? 0);
    return `${notes.length}:${max}`;
  }, [config?.booknotes]);
  useEffect(() => {
    if (!isReady) return;
    if (Date.now() - lastPulledAtRef.current < 1_000) return;
    markDirtyAndSchedule();
  }, [isReady, booknoteFingerprint, markDirtyAndSchedule]);

  // WS acceleration: an immediate pull when the WS channel reports this
  // book's config/notes changed elsewhere, instead of waiting for the next
  // window-focus pull. No-op when the WS channel isn't connected (Web, or
  // sync disabled) — the window-focus pull below is the REST fallback.
  useEffect(() => {
    if (!isReady) return;
    const handleChanged = (event: CustomEvent) => {
      const detail = event.detail as SyncChangedEvent | undefined;
      if (!detail) return;
      if (detail.scope !== 'configs' && detail.scope !== 'notes') return;
      if (detail.bookHash && detail.bookHash !== getBookHash(bookKey)) return;
      void syncRefs.current.pullNow();
    };
    eventDispatcher.on('native-sync-changed', handleChanged);
    return () => eventDispatcher.off('native-sync-changed', handleChanged);
  }, [isReady, bookKey]);

  useWindowActiveChanged((isActive) => {
    if (!isReady) return;
    if (isActive) {
      if (Date.now() - lastPulledAtRef.current < PULL_COOLDOWN_MS) return;
      void syncRefs.current.pullNow();
    } else if (dirtyRef.current) {
      debouncedPush.flush();
    }
  });

  useEffect(() => {
    return () => {
      debouncedPush.flush();
    };
  }, [debouncedPush]);

  return { pushNow, pullNow };
};

export default useNativeSync;
