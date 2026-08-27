import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useMyBooksStatusStore, useMyBooksSyncAllowed } from '@/store/mybooksStatusStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { getBookHash } from '@/utils/book';
import { BookConfig, BookNote } from '@/types/book';
import { ENABLE_SYNC_FEATURE } from '@/services/mybooks/constants';
import { pullSync, pushSync, SyncApiError } from '@/services/mybooks/syncClient';
import { syncLog, syncWarn } from '@/services/mybooks/syncLogger';
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
const PUSH_MAX_WAIT_MS = 20_000;
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
  const initialPullDoneRef = useRef(false);
  // Diagnostic only (see syncLogger.ts): timestamps how long a change has
  // sat "dirty" and how many times the push debounce got reset before it
  // actually fired — used to confirm/rule out debounce starvation (the
  // timer never getting a 15s quiet gap because progress keeps changing)
  // as the cause of reported 3+ minute gaps between pushes. Remove once
  // confirmed and fixed.
  const pendingSinceRef = useRef(0);
  const debounceResetCountRef = useRef(0);

  const pushNow = useCallback(async () => {
    if (!isReady) return;
    // Never push before the initial pull-on-open has resolved: pushing local
    // progress before the pull's remote merge lands would overwrite whatever
    // newer progress the server holds.
    if (!initialPullDoneRef.current) {
      syncLog(bookKey, 'push:skip', { reason: 'initial-pull-not-settled-yet' });
      return;
    }
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) {
      syncLog(bookKey, 'push:skip', { reason: 'preview-mode' });
      return;
    }

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;

    const now = Date.now();
    syncLog(bookKey, 'push:start', {
      location: config.location,
      progress: config.progress,
      localUpdatedAt: config.updatedAt ?? 0,
    });
    try {
      const currentUserId = useMyBooksStatusStore.getState().currentUserId;
      // Never push back a note that belongs to someone else — it can only be
      // here because it was pulled in via showOtherAnnotations, and pushing
      // it would re-store it under this account's own records server-side.
      const ownNotes = (config.booknotes ?? []).filter(
        (note) => !note.userId || note.userId === String(currentUserId),
      );
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
        notes: ownNotes.map((note) => ({
          book_hash: book.hash,
          meta_hash: book.metaHash,
          updated_at: note.updatedAt,
          deleted_at: note.deletedAt ?? null,
          ...note,
        })),
      });
      dirtyRef.current = false;
      pendingSinceRef.current = 0;
      debounceResetCountRef.current = 0;
      syncLog(bookKey, 'push:done', { elapsedMs: Date.now() - now });

      const latest = getConfig(bookKey);
      if (latest) {
        const synced: BookConfig = {
          ...latest,
          lastSyncedAtConfig: now,
          lastSyncedAtNotes: now,
        };
        setConfig(bookKey, synced);
        await saveConfig(envConfig, bookKey, synced, settings);
      }
    } catch (e) {
      if (e instanceof SyncApiError) {
        syncWarn(bookKey, 'push:error', { message: e.message });
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Sync failed: {{message}}', { message: e.message }),
        });
      } else {
        syncWarn(bookKey, 'push:error', { error: String(e) });
        console.warn('Native sync push failed', e);
      }
    }
  }, [isReady, bookKey, getConfig, getBookData, setConfig, saveConfig, envConfig, settings, _]);

  const pullNow = useCallback(async (): Promise<boolean> => {
    if (!isReady) return false;
    const book = getBookData(bookKey)?.book;
    const config = getConfig(bookKey);
    if (!book || !config) return false;

    const requestStartedAt = Date.now();
    syncLog(bookKey, 'pull:request', {
      bookHash: book.hash,
      localLocation: config.location,
      localUpdatedAt: config.updatedAt ?? 0,
    });

    try {
      const showOtherAnnotations = useMyBooksStatusStore.getState().showOtherAnnotations;
      // Always pass own explicitly (0/1), never omitted — lets the server
      // tell this (new) client apart from an old one that never sends it.
      const result = await pullSync(0, {
        book: book.hash,
        own: showOtherAnnotations ? 0 : 1,
      });
      lastPulledAtRef.current = Date.now();
      const now = Date.now();
      const elapsedMs = now - requestStartedAt;

      const remoteConfig = result.configs?.[0];
      const remoteNotes = result.notes ?? [];

      const localUpdatedAt = config.updatedAt ?? 0;
      const remoteUpdatedAt = remoteConfig?.updatedAt ?? remoteConfig?.updated_at ?? 0;
      const remoteWins = !!remoteConfig && remoteUpdatedAt > localUpdatedAt;

      // The comparison above (and everything derived from it) is computed
      // against `config`, a snapshot taken *before* the network await. If a
      // local write landed on this book while the request was in flight,
      // that write is invisible here — and the wholesale `setConfig` below
      // still overwrites the (now fresher) live config with a value built
      // on top of this stale snapshot, silently reverting it.
      const liveConfigNow = getConfig(bookKey);
      const localChangedDuringFlight =
        !!liveConfigNow && liveConfigNow.location !== config.location;

      syncLog(bookKey, 'pull:response', {
        elapsedMs,
        hasRemoteConfig: !!remoteConfig,
        remoteLocation: remoteConfig?.location,
        remoteUpdatedAt,
        localUpdatedAt,
        remoteWins,
        remoteNotesCount: remoteNotes.length,
      });
      if (localChangedDuringFlight) {
        syncWarn(bookKey, 'pull:local-drifted-during-flight', {
          snapshotLocation: config.location,
          liveLocationNow: liveConfigNow?.location,
          elapsedMs,
        });
      }

      const mergedConfig: BookConfig = remoteWins
        ? {
            ...config,
            progress: remoteConfig.progress ?? config.progress,
            location: remoteConfig.location ?? config.location,
            xpointer: remoteConfig.xpointer ?? config.xpointer,
            updatedAt: remoteUpdatedAt,
          }
        : { ...config };
      mergedConfig.lastSyncedAtConfig = now;

      // `pullSync` is always called with since=0 (see above), so `remoteNotes`
      // is a full snapshot of what the server has for this query scope — not
      // a delta. A local note missing from that snapshot means the server no
      // longer has it (deleted elsewhere), and the stale local copy must be
      // dropped; otherwise it survives every pull forever (only a full
      // site-data wipe clears it, since the cache lives in IndexedDB).
      //
      // The one case that must NOT be swept away: a note edited/created here
      // since the last successful sync but not pushed yet — the server
      // simply doesn't know about it yet, that's not the same as "deleted".
      // `lastSyncedAtNotes` (stamped after every successful push/pull) is the
      // watermark: only notes at or before it are safe to reconcile against
      // an authoritative snapshot.
      //
      // `own=1` pulls only cover this account's own notes, so a note pulled
      // in earlier from another user (via showOtherAnnotations) is out of
      // scope for that query and must be left alone.
      const currentUserId = useMyBooksStatusStore.getState().currentUserId;
      const remoteNoteIds = new Set(remoteNotes.map((n) => n.id));
      const syncWatermark = config.lastSyncedAtNotes ?? 0;

      const byId = new Map<string, BookNote>();
      for (const n of config.booknotes ?? []) {
        const isOwn = !n.userId || n.userId === String(currentUserId);
        const inScope = showOtherAnnotations || isOwn;
        const ts = Math.max(n.updatedAt ?? 0, n.deletedAt ?? 0);
        const staleOnServer = inScope && !remoteNoteIds.has(n.id) && ts <= syncWatermark;
        if (staleOnServer) continue;
        byId.set(n.id, n);
      }
      for (const remote of remoteNotes) {
        const local = byId.get(remote.id);
        const remoteTs = Math.max(remote.updatedAt ?? 0, remote.deletedAt ?? 0);
        const localTs = local ? Math.max(local.updatedAt ?? 0, local.deletedAt ?? 0) : -1;
        if (remoteTs >= localTs) {
          byId.set(remote.id, {
            ...local,
            ...remote,
            // The wire field is `uid` (a number), not `user_id` — see
            // `BookDataRecord.uid`'s doc comment.
            userId: remote.uid !== undefined ? String(remote.uid) : undefined,
            author: remote.author,
          } as BookNote);
        }
      }
      mergedConfig.booknotes = Array.from(byId.values());
      mergedConfig.lastSyncedAtNotes = now;

      setConfig(bookKey, mergedConfig);
      const latest = getConfig(bookKey);
      if (latest) await saveConfig(envConfig, bookKey, latest, settings);

      // saveConfig unconditionally re-stamps updatedAt to Date.now() (see
      // bookDataStore.saveConfig) instead of preserving remoteUpdatedAt when
      // remoteWins. Log the divergence so it's visible: this device's local
      // "freshness" clock just jumped to "now" even though the content is
      // only as fresh as remoteUpdatedAt, which can make this device
      // wrongly out-rank a genuinely newer push from another device on the
      // very next comparison.
      const savedUpdatedAt = getConfig(bookKey)?.updatedAt ?? 0;
      if (remoteWins && savedUpdatedAt !== remoteUpdatedAt) {
        syncWarn(bookKey, 'pull:updatedAt-restamped-past-remote', {
          remoteUpdatedAt,
          savedUpdatedAt,
          driftMs: savedUpdatedAt - remoteUpdatedAt,
        });
      }

      // The remote config landing here doesn't otherwise reach the already-
      // rendered view (it only opens at `config.location` once, at mount),
      // so without this the pulled position is silently ignored on screen.
      if (remoteWins && mergedConfig.location && mergedConfig.location !== config.location) {
        syncLog(bookKey, 'pull:goTo', { from: config.location, to: mergedConfig.location });
        useReaderStore.getState().getView(bookKey)?.goTo(mergedConfig.location);
      } else if (remoteWins) {
        syncLog(bookKey, 'pull:goTo-skipped', {
          reason: !mergedConfig.location ? 'no-location' : 'same-as-local',
        });
      }
      return true;
    } catch (e) {
      if (e instanceof SyncApiError) {
        syncWarn(bookKey, 'pull:error', { message: e.message });
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Sync failed: {{message}}', { message: e.message }),
        });
      } else {
        syncWarn(bookKey, 'pull:error', { error: String(e) });
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
    debounce(
      () => {
        if (!dirtyRef.current) {
          syncLog(bookKey, 'push:debounce-fired', { dirty: false });
          return;
        }
        syncLog(bookKey, 'push:debounce-fired', {
          dirty: true,
          pendingMs: pendingSinceRef.current ? Date.now() - pendingSinceRef.current : null,
          resetCount: debounceResetCountRef.current,
        });
        syncRefs.current.pushNow();
      },
      PUSH_DEBOUNCE_MS,
      { emitLast: true, maxWait: PUSH_MAX_WAIT_MS },
    ),
    [],
  );

  const markDirtyAndSchedule = useCallback(() => {
    // Diagnostic only (see pendingSinceRef/debounceResetCountRef comment
    // above): a call while already dirty means the 15s debounce timer just
    // got reset again before it could fire — track how long that's been
    // going on and how many times, to confirm/rule out debounce starvation.
    if (dirtyRef.current) {
      debounceResetCountRef.current += 1;
      syncLog(bookKey, 'push:debounce-reset', {
        resetCount: debounceResetCountRef.current,
        pendingMs: Date.now() - pendingSinceRef.current,
      });
    } else {
      pendingSinceRef.current = Date.now();
      debounceResetCountRef.current = 0;
    }
    dirtyRef.current = true;
    debouncedPush();
  }, [debouncedPush, bookKey]);

  // Pull once on book open.
  useEffect(() => {
    if (!isReady) {
      syncLog(bookKey, 'open:pull-once-skip', { reason: 'not-ready' });
      return;
    }
    if (!progress?.location) {
      syncLog(bookKey, 'open:pull-once-skip', { reason: 'no-local-progress-yet' });
      return;
    }
    if (hasPulledOnce.current) return;
    hasPulledOnce.current = true;
    syncLog(bookKey, 'open:pull-once-fire', { progressLocation: progress.location });
    void syncRefs.current.pullNow().finally(() => {
      initialPullDoneRef.current = true;
      syncLog(bookKey, 'open:initial-pull-settled');
    });
  }, [isReady, progress?.location]);

  // Auto-push on progress changes.
  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    syncLog(bookKey, 'push:progress-changed', { location: progress.location });
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
