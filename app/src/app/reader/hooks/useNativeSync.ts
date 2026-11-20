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
import { getIndexFromCfi } from '@/utils/cfi';
import { BookConfig, BookConfigRecord, BookNote, RawLocationAnchor } from '@/types/book';
import type { FoliateView } from '@/types/view';
import * as CFI from 'foliate-js/epubcfi.js';
import { ENABLE_SYNC_FEATURE } from '@/services/mybooks/constants';
import { pullSync, pushSync, SyncApiError } from '@/services/mybooks/syncClient';
import { syncLog, syncWarn } from '@/services/mybooks/syncLogger';
import {
  buildRawAnchorForRange,
  isCfiWithinRange,
  resolveLegacyCfiToLocal,
  resolveRawAnchorToCfi,
} from '@/services/mybooks/rawLocation';
import {
  ActiveReadingTracker,
  KEEPALIVE_PUSH_MS,
  PERSIST_INTERVAL_MS,
  TICK_INTERVAL_MS,
} from '@/services/mybooks/activeReadingTracker';
import { useWindowActiveChanged } from './useWindowActiveChanged';
import { useNativeSyncEvents, type SyncChangedEvent } from './useNativeSyncEvents';

/**
 * MyReader(Readest) Native Sync per-book hook — syncs reading progress (`BookConfig`)
 * and notes/highlights (`BookNote`) against mybooks' `/api/sync`.
 *
 * Cross-device positions are expressed as a raw-text anchor (spine index +
 * character offset in the *untransformed* EPUB text). Per-device transforms
 * (whitespace folding, 简繁, punctuation, proofread, …) only affect the local
 * raw→rendered mapping; they never decide whether a position can sync.
 */

const PUSH_DEBOUNCE_MS = 15_000;
const PUSH_MAX_WAIT_MS = 20_000;
const PULL_COOLDOWN_MS = 60_000;
// A pulled position is applied to the live view by jumping to its CFI. Doing
// that while the paginator is still laying out a section resolves the CFI
// against a document that is not settled: the anchor fails, the view lands on
// the section's first page, and that page is saved as the reading position
// (#44). Wait for a quiet gap in the renderer's own load/stabilized events so
// the jump runs against a laid-out document. Those two events mark layout
// work; page turns (`relocate`) are deliberately not watched.
const RENDER_QUIET_MS = 800;

const waitForViewInited = (bookKey: string): Promise<FoliateView | null> => {
  const viewState = () => useReaderStore.getState().getViewState(bookKey);
  const readyView = (): FoliateView | null =>
    viewState()?.inited ? useReaderStore.getState().getView(bookKey) : null;
  const immediate = readyView();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    function finish(view: FoliateView | null) {
      unsubscribe?.();
      resolve(view);
    }
    const check = () => {
      const view = readyView();
      if (view) return finish(view);
      const state = viewState();
      if (!state || state.error) finish(null);
    };
    unsubscribe = useReaderStore.subscribe(check);
    check();
  });
};

const waitForLayoutSettled = (view: FoliateView): Promise<void> => {
  const renderer = view.renderer;
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    function finish() {
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      renderer.removeEventListener('load', bump);
      renderer.removeEventListener('stabilized', bump);
      resolve();
    }
    function bump() {
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, RENDER_QUIET_MS);
    }
    renderer.addEventListener('load', bump);
    renderer.addEventListener('stabilized', bump);
    bump();
  });
};

/**
 * Whether `target` resolves to a range with real geometry in the section that
 * is already on screen. null means "cannot tell": the section is not loaded
 * (goTo loads and renders it itself), the CFI does not resolve in any of the
 * rendered chunks (fixed layout, section-level or stale CFI), or the range is
 * collapsed and cannot be measured here.
 */
const isTargetLaidOut = (view: FoliateView, target: string): boolean | null => {
  let index: number;
  let anchor: (doc: Document) => Range | null;
  try {
    ({ index, anchor } = view.resolveCFI(target));
  } catch {
    return null;
  }
  let docs: Document[];
  try {
    docs = view.renderer
      .getContents()
      .filter((content) => content.index === index)
      .map((content) => content.doc);
  } catch {
    return null;
  }
  if (docs.length === 0) return null;
  let measurable = false;
  for (const doc of docs) {
    let range: Range | null = null;
    try {
      range = anchor(doc);
    } catch {
      continue;
    }
    if (!range) continue;
    if (range.collapsed) {
      const node = range.startContainer;
      const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
        measurable = true;
      }
      continue;
    }
    const rects = Array.from(range.getClientRects?.() ?? []);
    if (rects.some((rect) => rect.width > 0 && rect.height > 0)) return true;
    measurable = true;
  }
  return measurable ? false : null;
};

const CFI_PATTERN = /^\s*epubcfi\(/;

const isSameStart = (a?: string, b?: string): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  // Malformed values (and test doubles) both collapse to `epubcfi()`, which
  // would compare equal. Only real CFIs may use the semantic comparison.
  if (!CFI_PATTERN.test(a) || !CFI_PATTERN.test(b)) return false;
  try {
    return CFI.compare(CFI.collapse(a), CFI.collapse(b)) === 0;
  } catch {
    return false;
  }
};

const rawAnchorSignature = (anchor?: RawLocationAnchor | null): string =>
  anchor
    ? `${anchor.v}:${anchor.index}:${anchor.rawOffset}:${Math.round(
        anchor.rawFraction * 1e6,
      )}:${anchor.sectionHash}:${anchor.precision}`
    : '';

const isValidRawAnchor = (value: unknown): value is RawLocationAnchor => {
  if (!value || typeof value !== 'object') return false;
  const anchor = value as Partial<RawLocationAnchor>;
  return (
    anchor.v === 2 &&
    Number.isInteger(anchor.index) &&
    (anchor.index ?? -1) >= 0 &&
    Number.isFinite(anchor.rawOffset) &&
    (anchor.rawOffset ?? -1) >= 0 &&
    Number.isFinite(anchor.rawFraction) &&
    (anchor.rawFraction ?? -1) >= 0 &&
    (anchor.rawFraction ?? 2) <= 1 &&
    typeof anchor.rawQuote === 'string' &&
    typeof anchor.sectionHash === 'string' &&
    Number.isFinite(anchor.rawTextVersion) &&
    (anchor.precision === 'exact' || anchor.precision === 'approx')
  );
};

const sectionFractionOf = (view: FoliateView, index: number, bookFraction?: number): number => {
  const fractions = view.getSectionFractions?.() ?? [];
  const start = fractions[index] ?? 0;
  const end = fractions[index + 1] ?? 1;
  const span = end - start;
  return span > 0 ? Math.max(0, Math.min(1, ((bookFraction ?? 0.5) - start) / span)) : 0.5;
};

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
  const localLocationGenerationRef = useRef(0);
  const lastProgressLocationRef = useRef<string | null>(null);
  const pullInFlightRef = useRef<Promise<boolean> | null>(null);
  const pushInFlightRef = useRef(false);
  const lastPushedLocationUpdatedAtRef = useRef(0);
  const lastPushedAnchorSignatureRef = useRef('');

  useEffect(() => {
    // A local anchor that predates this session has already been pushed (or
    // is covered by locationUpdatedAt); do not re-push it just because the
    // ref starts empty.
    const anchor = getConfig(bookKey)?.rawAnchor;
    if (anchor) lastPushedAnchorSignatureRef.current = rawAnchorSignature(anchor);
  }, [bookKey, getConfig]);

  const trackerRef = useRef<ActiveReadingTracker | null>(null);
  const isWindowActiveRef = useRef(true);
  const lastPersistedPendingRef = useRef<string>('');
  const lastPushAttemptAtRef = useRef(0);

  const ensureTracker = useCallback((): ActiveReadingTracker => {
    const timezone = useMyBooksStatusStore.getState().sysInfo?.timezone ?? null;
    if (!trackerRef.current) {
      const initialPending = getConfig(bookKey)?.pendingReadingSeconds ?? {};
      trackerRef.current = new ActiveReadingTracker(initialPending, Date.now(), timezone);
      lastPersistedPendingRef.current = JSON.stringify(initialPending);
    } else {
      trackerRef.current.setTimezone(timezone);
    }
    return trackerRef.current;
  }, [bookKey, getConfig]);

  const persistPendingSeconds = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    const pending = tracker.getPending();
    const serialized = JSON.stringify(pending);
    if (serialized === lastPersistedPendingRef.current) return;
    lastPersistedPendingRef.current = serialized;
    const config = getConfig(bookKey);
    if (!config) return;
    setConfig(bookKey, { pendingReadingSeconds: pending });
    const latest = getConfig(bookKey);
    if (latest) {
      // Persisting the local reading-time counter is bookkeeping, not a
      // reading-position edit; do not advance the record timestamp.
      await saveConfig(envConfig, bookKey, latest, settings, { preserveUpdatedAt: true });
    }
  }, [bookKey, getConfig, setConfig, saveConfig, envConfig, settings]);

  const pendingSinceRef = useRef(0);
  const debounceResetCountRef = useRef(0);

  const pushNow = useCallback(async () => {
    if (!isReady) return;
    if (pushInFlightRef.current) {
      syncLog(bookKey, 'push:skip', { reason: 'push-in-flight' });
      return;
    }
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

    pushInFlightRef.current = true;
    const now = Date.now();
    lastPushAttemptAtRef.current = now;

    // A position change invalidates the anchor until the idle build lands.
    // Blur/unmount can push before that; build it now instead of sending
    // `raw_anchor: null` and clearing the server's good anchor.
    let effectiveAnchor = config.rawAnchor;
    let anchorCleared = !!config.rawAnchorCleared;
    if (!effectiveAnchor && anchorCleared) {
      const progressNow = getProgress(bookKey);
      const view = useReaderStore.getState().getView(bookKey);
      const index = config.location ? getIndexFromCfi(config.location) : null;
      if (view && index != null && progressNow?.range && progressNow.location === config.location) {
        try {
          const anchor = await buildRawAnchorForRange(
            bookKey,
            view,
            index,
            progressNow.range,
            sectionFractionOf(view, index, progressNow.fraction),
            useReaderStore.getState().getViewSettings(bookKey),
          );
          const latestConfig = getConfig(bookKey);
          if (
            latestConfig &&
            (latestConfig.location !== config.location ||
              latestConfig.locationUpdatedAt !== config.locationUpdatedAt)
          ) {
            // The reader moved while the anchor was building. This push's
            // snapshot is stale; a later keepalive/turn pushes the new one.
            syncLog(bookKey, 'push:skip', {
              reason: 'location-moved-during-anchor-build',
            });
            pushInFlightRef.current = false;
            return;
          }
          if (anchor) {
            effectiveAnchor = anchor;
            anchorCleared = false;
            setConfig(bookKey, { rawAnchor: anchor, rawAnchorCleared: false });
          }
        } catch (error) {
          console.warn('[sync] failed to build raw anchor before push', error);
        }
      }
    }

    const locationUpdatedAt = config.locationUpdatedAt ?? config.updatedAt ?? 0;
    const anchorSignature = rawAnchorSignature(effectiveAnchor);
    const configChanged =
      (locationUpdatedAt > (config.lastSyncedAtConfig ?? 0) &&
        locationUpdatedAt > lastPushedLocationUpdatedAtRef.current) ||
      (!!anchorSignature && anchorSignature !== lastPushedAnchorSignatureRef.current);

    syncLog(bookKey, 'push:start', {
      location: config.location,
      locationUpdatedAt,
      configChanged,
      anchorChanged: !!anchorSignature && anchorSignature !== lastPushedAnchorSignatureRef.current,
    });

    const tracker = ensureTracker();
    const sentReadingSeconds = tracker.getPending();
    const readingSecondsPayload = tracker.toReadingSecondsPayload(book.hash);
    let collapsedLocation: string | undefined;
    if (configChanged && config.location) {
      try {
        collapsedLocation = CFI.collapse(config.location);
      } catch {
        collapsedLocation = config.location;
      }
    }
    try {
      const currentUserId = useMyBooksStatusStore.getState().currentUserId;
      const ownNotes = (config.booknotes ?? []).filter(
        (note) => !note.userId || note.userId === String(currentUserId),
      );
      if (!configChanged && ownNotes.length === 0 && readingSecondsPayload.length === 0) {
        syncLog(bookKey, 'push:skip', { reason: 'nothing-to-push' });
        return;
      }
      await pushSync({
        ...(configChanged && {
          configs: [
            {
              id: book.hash,
              book_hash: book.hash,
              meta_hash: book.metaHash,
              updated_at: locationUpdatedAt,
              updatedAt: locationUpdatedAt,
              deleted_at: null,
              progress: config.progress,
              location: collapsedLocation,
              xpointer: config.xpointer,
              ...(effectiveAnchor
                ? { raw_anchor: effectiveAnchor }
                : anchorCleared
                  ? { raw_anchor: null }
                  : {}),
            },
          ],
        }),
        notes: ownNotes.map((note) => ({
          book_hash: book.hash,
          meta_hash: book.metaHash,
          updated_at: note.updatedAt,
          deleted_at: note.deletedAt ?? null,
          ...note,
        })),
        ...(readingSecondsPayload.length > 0 && { reading_seconds: readingSecondsPayload }),
      });
      dirtyRef.current = false;
      pendingSinceRef.current = 0;
      debounceResetCountRef.current = 0;
      lastPushedLocationUpdatedAtRef.current = Math.max(
        lastPushedLocationUpdatedAtRef.current,
        locationUpdatedAt,
      );
      if (anchorSignature) lastPushedAnchorSignatureRef.current = anchorSignature;
      syncLog(bookKey, 'push:done', {
        elapsedMs: Date.now() - now,
        configPushed: configChanged,
      });
      if (readingSecondsPayload.length > 0) {
        tracker.clearSent(sentReadingSeconds);
      }

      const latest = getConfig(bookKey);
      if (latest) {
        const synced: BookConfig = {
          ...latest,
          ...(configChanged ? { rawAnchorCleared: false } : {}),
          lastSyncedAtConfig: configChanged ? now : latest.lastSyncedAtConfig,
          lastSyncedAtNotes: now,
          pendingReadingSeconds: tracker.getPending(),
        };
        lastPersistedPendingRef.current = JSON.stringify(synced.pendingReadingSeconds);
        setConfig(bookKey, synced);
        // The push itself must not make this device out-rank a newer remote
        // record; only the reader moving the position advances the timestamp.
        await saveConfig(envConfig, bookKey, synced, settings, { preserveUpdatedAt: true });
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
    } finally {
      pushInFlightRef.current = false;
    }
  }, [
    isReady,
    bookKey,
    getConfig,
    getBookData,
    setConfig,
    saveConfig,
    envConfig,
    settings,
    _,
    ensureTracker,
  ]);

  const resolveRemotePosition = useCallback(
    async (
      remoteConfig: Partial<BookConfigRecord>,
    ): Promise<{
      view: FoliateView;
      cfi: string;
      index: number;
      anchor: RawLocationAnchor | null;
      // false for the last-resort remote CFI, which is not a local coordinate.
      localized: boolean;
    } | null> => {
      const view = await waitForViewInited(bookKey);
      if (!view) return null;
      const viewSettings = useReaderStore.getState().getViewSettings(bookKey);
      const remoteAnchorRaw = remoteConfig.raw_anchor ?? remoteConfig.rawAnchor ?? null;
      const remoteAnchor = isValidRawAnchor(remoteAnchorRaw) ? remoteAnchorRaw : null;
      if (remoteAnchor) {
        const resolved = await resolveRawAnchorToCfi(bookKey, view, remoteAnchor, viewSettings);
        if (resolved) {
          return {
            view,
            cfi: resolved.cfi,
            index: remoteAnchor.index,
            anchor: remoteAnchor,
            localized: true,
          };
        }
        syncWarn(bookKey, 'pull:anchor-unresolved', {
          index: remoteAnchor.index,
          rawOffset: remoteAnchor.rawOffset,
        });
      }
      if (remoteConfig.location) {
        const legacy = await resolveLegacyCfiToLocal(
          bookKey,
          view,
          remoteConfig.location,
          viewSettings,
        );
        if (legacy) {
          return { view, cfi: legacy.cfi, index: legacy.index, anchor: null, localized: true };
        }
        syncWarn(bookKey, 'pull:legacy-unresolved', { location: remoteConfig.location });
        // Last resort for sections without a text stream (image-only or
        // fixed-layout): let the renderer try the collapsed CFI itself. The
        // landing is still verified before anything is persisted.
        try {
          const collapsed = CFI.collapse(remoteConfig.location);
          const index = view.resolveCFI(collapsed).index;
          if (index != null && index >= 0) {
            return { view, cfi: collapsed, index, anchor: null, localized: false };
          }
        } catch {
          // fall through
        }
      }
      return null;
    },
    [bookKey],
  );

  const applyRemotePosition = useCallback(
    async (
      view: FoliateView,
      target: string,
      index: number,
      remoteAnchor: RawLocationAnchor | null,
      generationAtStart: number,
      localized: boolean,
    ): Promise<{
      applied: boolean;
      location: string;
      anchor?: RawLocationAnchor;
      reason?: string;
    }> => {
      if (useReaderStore.getState().getView(bookKey) !== view) {
        return { applied: false, location: target, reason: 'view-replaced' };
      }
      // Capture the starting position before waiting: a page turn during the
      // quiet window must abort the jump, not be mistaken for the start.
      const from = view.lastLocation?.cfi;
      await waitForLayoutSettled(view);
      if (useReaderStore.getState().getView(bookKey) !== view) {
        return { applied: false, location: target, reason: 'view-replaced' };
      }
      let waitedForLayout = false;
      // A section can report a resolvable range with no geometry forever
      // (hidden chunk, zero-height inline content). Bounded attempts: proceed
      // to the jump and let the containment check decide, instead of hanging
      // pullNow (and every later pull) forever.
      for (let attempt = 0; attempt < 4; attempt++) {
        if (isTargetLaidOut(view, target) !== false) break;
        waitedForLayout = true;
        await waitForLayoutSettled(view);
        if (useReaderStore.getState().getView(bookKey) !== view) {
          return { applied: false, location: target, reason: 'view-replaced' };
        }
      }
      if (
        localLocationGenerationRef.current !== generationAtStart ||
        !isSameStart(from, view.lastLocation?.cfi)
      ) {
        syncWarn(bookKey, 'pull:goTo-aborted', {
          reason: 'view-moved',
          from,
          to: view.lastLocation?.cfi,
        });
        const currentSource = useReaderStore.getState().getViewState(bookKey)?.progressSource;
        if (currentSource !== 'tts') {
          useReaderStore.getState().setProgressSource(bookKey, 'user');
        }
        return { applied: false, location: target, reason: 'view-moved' };
      }

      const buildAnchorFrom = async (
        landed: NonNullable<FoliateView['lastLocation']> & { fraction?: number },
      ): Promise<RawLocationAnchor | undefined> => {
        if (!landed.range) return undefined;
        const fraction = sectionFractionOf(view, index, landed.fraction);
        return (
          (await buildRawAnchorForRange(
            bookKey,
            view,
            index,
            landed.range,
            fraction,
            useReaderStore.getState().getViewSettings(bookKey),
          )) ?? undefined
        );
      };

      // Already on the requested page: do not disturb the view (and do not
      // re-anchor layout/TTS) just because the remote timestamp moved.
      if (isCfiWithinRange(target, view.lastLocation?.cfi)) {
        const landed = view.lastLocation as
          | (NonNullable<FoliateView['lastLocation']> & { fraction?: number })
          | undefined;
        const anchor = remoteAnchor ?? (landed ? await buildAnchorFrom(landed) : undefined);
        return {
          applied: true,
          location: localized ? target : (landed?.cfi ?? target),
          anchor,
        };
      }

      useReaderStore.getState().setProgressSource(bookKey, 'remote');
      const startedAt = Date.now();
      try {
        await view.goTo(target);
        await waitForLayoutSettled(view);
        let contained = isCfiWithinRange(target, view.lastLocation?.cfi);
        if (!contained) {
          await waitForLayoutSettled(view);
          contained = isCfiWithinRange(target, view.lastLocation?.cfi);
        }
        const landed = view.lastLocation as
          | (NonNullable<FoliateView['lastLocation']> & { fraction?: number })
          | undefined;
        syncLog(bookKey, 'pull:goTo-applied', {
          to: target,
          landed: landed?.cfi,
          contained,
          waitedForLayout,
          waitedMs: Date.now() - startedAt,
        });
        if (localLocationGenerationRef.current !== generationAtStart) {
          // The reader turned a page while the jump was settling. Their page
          // wins: do not revert it and do not mark the remote position.
          useReaderStore.getState().setProgressSource(bookKey, 'user');
          return { applied: false, location: target, reason: 'user-moved' };
        }
        if (!contained || !landed?.cfi) {
          // The renderer may have dropped us on a fallback page. Keep the
          // source non-persistable, and put the reader back where it was;
          // never let the fallback become a saved "user" position.
          useReaderStore.getState().setProgressSource(bookKey, 'remote');
          if (from) {
            try {
              await view.goTo(from);
              await waitForLayoutSettled(view);
            } catch {
              // Best effort; the source guard still prevents persistence.
            }
          }
          useReaderStore.getState().setProgressSource(bookKey, 'restore');
          return { applied: false, location: target, reason: 'unverified' };
        }

        const anchor = remoteAnchor ?? (await buildAnchorFrom(landed));
        // The jump's own relocates are `navigation`/`anchor`, which the
        // reader does not promote; the next real page turn flips to user.
        useReaderStore.getState().setProgressSource(bookKey, 'restore');
        return {
          applied: true,
          location: localized ? target : landed.cfi,
          anchor,
        };
      } catch (e) {
        useReaderStore.getState().setProgressSource(bookKey, 'restore');
        return { applied: false, location: target, reason: String(e) };
      }
    },
    [bookKey],
  );

  const doPull = useCallback(async (): Promise<boolean> => {
    if (!isReady) return false;
    const book = getBookData(bookKey)?.book;
    const config = getConfig(bookKey);
    if (!book || !config) return false;

    const generationAtStart = localLocationGenerationRef.current;
    const requestStartedAt = Date.now();
    syncLog(bookKey, 'pull:request', {
      bookHash: book.hash,
      localLocation: config.location,
      localLocationUpdatedAt: config.locationUpdatedAt ?? config.updatedAt ?? 0,
    });

    try {
      const showOtherAnnotations = useMyBooksStatusStore.getState().showOtherAnnotations;
      const result = await pullSync(0, {
        book: book.hash,
        own: showOtherAnnotations ? 0 : 1,
      });
      lastPulledAtRef.current = Date.now();
      const now = Date.now();
      const elapsedMs = now - requestStartedAt;

      const remoteConfig = result.configs?.[0];
      const remoteNotes = result.notes ?? [];
      const liveConfig = getConfig(bookKey) ?? config;

      const previewMode = useReaderStore.getState().getViewState(bookKey)?.previewMode ?? false;
      const localChangedDuringFlight =
        localLocationGenerationRef.current !== generationAtStart ||
        (liveConfig.locationUpdatedAt ?? 0) !== (config.locationUpdatedAt ?? 0);

      const remoteAnchorRaw = remoteConfig?.raw_anchor ?? remoteConfig?.rawAnchor ?? null;
      const remoteAnchor = isValidRawAnchor(remoteAnchorRaw) ? remoteAnchorRaw : null;
      const remoteLocationUpdatedAt =
        remoteConfig?.locationUpdatedAt ?? remoteConfig?.updated_at ?? remoteConfig?.updatedAt ?? 0;
      const localLocationUpdatedAt = liveConfig.locationUpdatedAt ?? liveConfig.updatedAt ?? 0;
      const hasRemoteLocation = !!(remoteAnchor || remoteConfig?.location);
      // Migration: a legacy server record (no raw anchor) is the source of
      // truth once. `migratedRemoteUpdatedAt` keeps this from re-triggering
      // forever on books that cannot build an anchor (image-only sections).
      const migratedAt = liveConfig.migratedRemoteUpdatedAt ?? -1;
      const isLegacyRemote = hasRemoteLocation && !remoteAnchor;
      const migration = isLegacyRemote && remoteLocationUpdatedAt > migratedAt;
      const remoteLocationWins =
        hasRemoteLocation && (migration || remoteLocationUpdatedAt > localLocationUpdatedAt);

      syncLog(bookKey, 'pull:response', {
        elapsedMs,
        hasRemoteConfig: !!remoteConfig,
        remoteLocation: remoteConfig?.location,
        remoteLocationUpdatedAt,
        localLocationUpdatedAt,
        remoteLocationWins,
        migration,
        previewMode,
        remoteNotesCount: remoteNotes.length,
      });
      if (localChangedDuringFlight) {
        syncWarn(bookKey, 'pull:local-drifted-during-flight', {
          snapshotLocation: config.location,
          liveLocationNow: liveConfig.location,
          elapsedMs,
        });
      }
      let locationApplied = false;
      let appliedLocation: string | undefined;
      let appliedAnchor: RawLocationAnchor | undefined;
      let locationFailure: string | undefined;
      if (remoteLocationWins && !localChangedDuringFlight && !previewMode) {
        const resolved = await resolveRemotePosition(remoteConfig!);
        if (!resolved) {
          locationFailure = 'unresolvable';
        } else {
          const applied = await applyRemotePosition(
            resolved.view,
            resolved.cfi,
            resolved.index,
            resolved.anchor,
            generationAtStart,
            resolved.localized,
          );
          if (applied.applied) {
            locationApplied = true;
            appliedLocation = applied.location;
            appliedAnchor = applied.anchor;
            // Only an actually-applied remote position suppresses the local
            // config push; an unresolvable newer record must not freeze this
            // device's own progress.
            lastPushedLocationUpdatedAtRef.current = Math.max(
              lastPushedLocationUpdatedAtRef.current,
              remoteLocationUpdatedAt,
            );
            // A remote record that already had an anchor does not need to be
            // pushed back; one built locally during migration does.
            lastPushedAnchorSignatureRef.current = resolved.anchor
              ? rawAnchorSignature(resolved.anchor)
              : '';
          } else {
            locationFailure = applied.reason;
          }
        }
      } else if (remoteLocationWins) {
        locationFailure = previewMode ? 'preview-mode' : 'local-changed-during-flight';
      }

      // Re-read: the apply may have taken seconds, during which notes,
      // reading seconds or another user action may have landed. Never write
      // back a snapshot taken before the await.
      const fresh = getConfig(bookKey) ?? liveConfig;
      const userMovedAfterApply = localLocationGenerationRef.current !== generationAtStart;
      if (userMovedAfterApply) locationApplied = false;
      const merged: BookConfig = { ...fresh };
      if (locationApplied && appliedLocation) {
        merged.location = appliedLocation;
        merged.rawAnchor = appliedAnchor;
        merged.rawAnchorCleared = !appliedAnchor;
        merged.locationUpdatedAt = remoteLocationUpdatedAt;
        merged.updatedAt =
          remoteConfig!.updatedAt ?? remoteConfig!.updated_at ?? remoteLocationUpdatedAt;
        if (remoteConfig!.progress) merged.progress = remoteConfig!.progress;
        if (remoteConfig!.xpointer) merged.xpointer = remoteConfig!.xpointer;
      }
      if (isLegacyRemote && !previewMode) {
        // The server record has been migrated (or was unusable) once; a later
        // pull must not roll a reader who has already moved back. A deep-link
        // preview is not a migration attempt and must keep the one-time
        // server-truth migration available for the next normal open.
        merged.migratedRemoteUpdatedAt = Math.max(migratedAt, remoteLocationUpdatedAt);
      }

      const currentUserId = useMyBooksStatusStore.getState().currentUserId;
      const remoteNoteIds = new Set(remoteNotes.map((n) => n.id));
      const syncWatermark = fresh.lastSyncedAtNotes ?? 0;

      const byId = new Map<string, BookNote>();
      for (const n of fresh.booknotes ?? []) {
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
            userId: remote.uid !== undefined ? String(remote.uid) : undefined,
            author: remote.author,
          } as BookNote);
        }
      }
      merged.booknotes = Array.from(byId.values());
      // Only an applied remote location is "synced". Otherwise keep the old
      // watermark so an unsynced local position can still be pushed.
      merged.lastSyncedAtConfig = locationApplied ? now : (fresh.lastSyncedAtConfig ?? 0);
      merged.lastSyncedAtNotes = now;

      setConfig(bookKey, merged);
      const latest = getConfig(bookKey);
      if (latest) {
        // Pulls never advance the record timestamp; applying a remote
        // position must not make this device look newer than the peer.
        await saveConfig(envConfig, bookKey, latest, settings, { preserveUpdatedAt: true });
      }

      syncLog(bookKey, 'pull:applied', { locationApplied, locationFailure });
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
  }, [
    isReady,
    bookKey,
    getConfig,
    getBookData,
    setConfig,
    saveConfig,
    envConfig,
    settings,
    _,
    resolveRemotePosition,
    applyRemotePosition,
  ]);

  const pullNow = useCallback(async (): Promise<boolean> => {
    if (pullInFlightRef.current) return pullInFlightRef.current;
    const promise = doPull();
    pullInFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      pullInFlightRef.current = null;
    }
  }, [doPull]);

  const syncRefs = useRef({ pushNow, pullNow });
  useEffect(() => {
    syncRefs.current = { pushNow, pullNow };
  }, [pushNow, pullNow]);

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
    if (dirtyRef.current) {
      debounceResetCountRef.current += 1;
      syncLog(bookKey, 'push:debounce-reset', {
        resetCount: debounceResetCountRef.current,
        pendingMs: pendingSinceRef.current ? Date.now() - pendingSinceRef.current : null,
      });
    } else {
      pendingSinceRef.current = Date.now();
      debounceResetCountRef.current = 0;
    }
    dirtyRef.current = true;
    debouncedPush();
  }, [debouncedPush, bookKey]);

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
      // Opening the book is reading interaction; keep the tracker live and
      // queue a push only when the local record is actually ahead of the
      // last acknowledged sync (the pull may have just applied a remote one).
      ensureTracker().noteInteraction();
      const latest = getConfig(bookKey);
      const locationUpdatedAt = latest?.locationUpdatedAt ?? latest?.updatedAt ?? 0;
      const hasPendingSeconds = Object.keys(latest?.pendingReadingSeconds ?? {}).length > 0;
      if (latest && (locationUpdatedAt > (latest.lastSyncedAtConfig ?? 0) || hasPendingSeconds)) {
        markDirtyAndSchedule();
      }
    });
  }, [isReady, progress?.location, ensureTracker, getConfig, markDirtyAndSchedule]);

  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    // The first render carries the position restored from disk; it is not a
    // user navigation and must not bump the local sync generation.
    const isFirstSnapshot = lastProgressLocationRef.current === null;
    const changed = lastProgressLocationRef.current !== progress.location;
    lastProgressLocationRef.current = progress.location;
    if (isFirstSnapshot || !changed) return;
    if (progress.source !== 'user' && progress.source !== 'tts') {
      syncLog(bookKey, 'push:progress-display-only', {
        source: progress.source ?? 'unknown',
      });
      return;
    }
    localLocationGenerationRef.current += 1;
    syncLog(bookKey, 'push:progress-changed', {
      location: progress.location,
      source: progress.source,
    });
    ensureTracker().noteInteraction();
    markDirtyAndSchedule();
  }, [isReady, progress?.location, progress?.source, markDirtyAndSchedule, ensureTracker]);

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
    ensureTracker().noteInteraction();
    markDirtyAndSchedule();
  }, [isReady, booknoteFingerprint, markDirtyAndSchedule, ensureTracker]);

  useEffect(() => {
    if (!isReady) return;
    const tracker = ensureTracker();

    const tickId = setInterval(() => {
      tracker.setTimezone(useMyBooksStatusStore.getState().sysInfo?.timezone ?? null);
      tracker.tick(isWindowActiveRef.current);
    }, TICK_INTERVAL_MS);

    const persistId = setInterval(() => {
      void persistPendingSeconds();
    }, PERSIST_INTERVAL_MS);

    const keepAliveId = setInterval(() => {
      if (tracker.isEmpty()) return;
      if (Date.now() - lastPushAttemptAtRef.current < KEEPALIVE_PUSH_MS) return;
      void syncRefs.current.pushNow();
    }, KEEPALIVE_PUSH_MS);

    return () => {
      clearInterval(tickId);
      clearInterval(persistId);
      clearInterval(keepAliveId);
    };
  }, [isReady, ensureTracker, persistPendingSeconds]);

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
    trackerRef.current?.tick(isActive);
    isWindowActiveRef.current = isActive;
    if (!isReady) return;
    if (isActive) {
      if (Date.now() - lastPulledAtRef.current < PULL_COOLDOWN_MS) return;
      void syncRefs.current.pullNow();
    } else {
      if (dirtyRef.current) debouncedPush.flush();
      void persistPendingSeconds();
      if (trackerRef.current && !trackerRef.current.isEmpty()) {
        void syncRefs.current.pushNow();
      }
    }
  });

  useEffect(() => {
    return () => {
      debouncedPush.flush();
      void persistPendingSeconds();
      if (trackerRef.current && !trackerRef.current.isEmpty()) {
        void syncRefs.current.pushNow();
      }
    };
  }, [debouncedPush, persistPendingSeconds]);

  return { pushNow, pullNow };
};

export default useNativeSync;
