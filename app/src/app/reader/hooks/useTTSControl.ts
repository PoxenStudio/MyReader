import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useProofreadStore } from '@/store/proofreadStore';
import { TransformContext } from '@/services/transformers/types';
import { proofreadTransformer } from '@/services/transformers/proofread';
import { useTranslation } from '@/hooks/useTranslation';
import {
  ensureSharedAudioContext,
  TTSController,
  TTSHighlightOptions,
  TTSVoicesGroup,
} from '@/services/tts';
import { DEFAULT_SENTENCE_GAP_SEC } from '@/services/tts/EdgeTTSClient';
import { DEFAULT_PARAGRAPH_GAP_SEC } from '@/services/tts/TTSController';
import { eventDispatcher } from '@/utils/event';
import { genSSMLRaw, parseSSMLLang } from '@/utils/ssml';
import { throttle } from '@/utils/throttle';
import { isCfiInLocation } from '@/utils/cfi';
import { getLocale } from '@/utils/misc';
import { estimateTTSTime } from '@/utils/ttsTime';
import { releaseUnblockAudio, ttsMediaBridge, unblockAudio } from '@/services/tts/ttsMediaBridge';
import { getBookHashFromKey, ttsSessionManager } from '@/services/tts/TTSSessionManager';
import {
  isContentVisible,
  isRangeVisibleInContent,
  markTtsNavigation,
} from '@/services/tts/ttsContent';
import { TTSDocumentProvider } from '@/services/tts/ttsDocumentProvider';
import { createBookContentTransformContext } from '@/libs/bookContentTransform';
import { FoliateView } from '@/types/view';

interface UseTTSControlProps {
  bookKey: string;
  onRequestHidePanel?: () => void;
}

export const useTTSControl = ({ bookKey, onRequestHidePanel }: UseTTSControlProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { isDarkMode } = useThemeStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const getViewState = useReaderStore((s) => s.getViewState);
  const getProgress = useReaderStore((s) => s.getProgress);
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const setViewSettings = useReaderStore((s) => s.setViewSettings);
  const setProgressLocation = useReaderStore((s) => s.setProgressLocation);
  const setTTSEnabled = useReaderStore((s) => s.setTTSEnabled);
  const { getMergedRules } = useProofreadStore();

  const [ttsLang, setTtsLang] = useState<string>('en');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showIndicator, setShowIndicator] = useState(false);
  const [showBackToCurrentTTSLocation, setShowBackToCurrentTTSLocation] = useState(false);

  const [timeoutOption, setTimeoutOption] = useState(0);
  const [timeoutTimestamp, setTimeoutTimestamp] = useState(0);

  const followingTTSLocationRef = useRef(true);
  const sectionChangingTimestampRef = useRef(0);
  const previousSectionLabelRef = useRef<string | undefined>(undefined);
  const ttsControllerRef = useRef<TTSController | null>(null);
  const isStartingTTSRef = useRef(false);
  const ttsEpochRef = useRef(0);
  const startAbortRef = useRef<AbortController | null>(null);
  const restoreAbortRef = useRef<AbortController | null>(null);

  const waitForLayoutApplied = useCallback(
    (key: string, expected: boolean, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        function cleanup() {
          eventDispatcher.off('reader-layout-applied', onApplied);
          if (signal) signal.removeEventListener('abort', onAbort);
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
        function onApplied(event: Event) {
          const detail = (event as CustomEvent<{ bookKey?: string; ttsEnabled?: boolean }>).detail;
          if (detail?.bookKey !== key || !!detail?.ttsEnabled !== expected) return;
          cleanup();
          resolve();
        }
        function onAbort() {
          cleanup();
          resolve();
        }
        if (signal?.aborted) {
          resolve();
          return;
        }
        // FoliateViewer dispatches this on the async bus.
        eventDispatcher.on('reader-layout-applied', onApplied);
        signal?.addEventListener('abort', onAbort, { once: true });
        // Safety net: the layout effect dispatches this synchronously from the
        // margin update, so a short timeout covers "no view / missing
        // settings" without leaving the mini player showing "playing" silently
        // for half a minute.
        timer = setTimeout(() => {
          console.warn('[TTS] reader-layout-applied timed out; continuing');
          cleanup();
          resolve();
        }, 2_000);
      }),
    [],
  );

  // The stop-restore wait outlives the hook only long enough to settle the
  // reflow; cutting it on unmount keeps the closed book from being written.
  useEffect(() => {
    return () => {
      restoreAbortRef.current?.abort();
      restoreAbortRef.current = null;
    };
  }, []);

  const createDocumentProvider = useCallback(
    (view: FoliateView) => {
      // Headless playback outlives the reader's stores: snapshot the transform
      // inputs now so section documents built after the book closes keep the
      // same text basis as the rendered view.
      const initialViewSettings = getViewSettings(bookKey);
      const settingsSnapshot = initialViewSettings ? { ...initialViewSettings } : null;
      const initialBookData = getBookData(bookKey);
      const isFixedLayoutSnapshot = initialBookData?.isFixedLayout;
      const primaryLanguageSnapshot = initialBookData?.book?.primaryLanguage;
      const settingsForTransform = () => getViewSettings(bookKey) ?? settingsSnapshot;
      const rectOf = () => view.renderer?.getBoundingClientRect?.();
      return new TTSDocumentProvider({
        view,
        hasLiveTransforms: () => !!getViewSettings(bookKey),
        createTransformContext: (content, sectionHref) => {
          const viewSettings = settingsForTransform();
          if (!viewSettings) return null;
          const bookData = getBookData(bookKey);
          const rect = rectOf();
          return createBookContentTransformContext(
            {
              bookKey,
              viewSettings,
              width: rect?.width,
              height: rect?.height,
              isFixedLayout: bookData?.isFixedLayout ?? isFixedLayoutSnapshot ?? false,
              primaryLanguage: bookData?.book?.primaryLanguage ?? primaryLanguageSnapshot,
              userLocale: getLocale(),
            },
            content,
            sectionHref,
          );
        },
        getTransformSignature: () => {
          const viewSettings = settingsForTransform();
          if (!viewSettings) return '';
          const bookData = getBookData(bookKey);
          const rect = rectOf();
          return JSON.stringify({
            overrideLayout: viewSettings.overrideLayout,
            convertChineseVariant: viewSettings.convertChineseVariant,
            replaceQuotationMarks: viewSettings.replaceQuotationMarks,
            proofreadRules: viewSettings.proofreadRules,
            allowScript: viewSettings.allowScript,
            vertical: viewSettings.vertical,
            width: rect?.width,
            height: rect?.height,
            primaryLanguage: bookData?.book?.primaryLanguage ?? primaryLanguageSnapshot,
            userLocale: getLocale(),
            globalProofreadRules: getMergedRules(bookKey),
          });
        },
      });
    },
    [bookKey, getViewSettings, getBookData, getMergedRules],
  );
  // Last broadcast playback state, so a follower engaging mid-session can be
  // replayed the current state on demand (see handleTTSSyncRequest).
  const playbackStateRef = useRef<'playing' | 'paused' | 'stopped'>('stopped');
  const [ttsController, setTtsController] = useState<TTSController | null>(null);
  const [ttsClientsInited, setTtsClientsInitialized] = useState(false);

  // Broadcast playback transitions on the app-wide bus so consumers that
  // can't read the hook-local isPlaying flag (RSVP, paragraph mode) can react.
  const emitPlaybackState = (state: 'playing' | 'paused' | 'stopped') => {
    playbackStateRef.current = state;
    eventDispatcher.dispatch('tts-playback-state', { bookKey, state });
  };

  // A follower (paragraph / RSVP mode) that engages mid-session asks the
  // controller to re-broadcast its current playback state and position, so it
  // can sync immediately instead of waiting for the next word/sentence boundary
  // (or forcing the user to stop and restart TTS inside the mode). Replays only
  // when a session actually exists (playing or paused).
  const handleTTSSyncRequest = (event: CustomEvent) => {
    const detail = event.detail as { bookKey?: string } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const state = playbackStateRef.current;
    if (state !== 'playing' && state !== 'paused') return;
    if (!ttsControllerRef.current) return;
    // Position first, then state: RSVP's 'paused' handler drops following, which
    // would discard a position arriving after it. Position-first lets the
    // follower sync the current word/paragraph before a (possibly paused) state
    // lands. Only the entering mode listens to these events, so the order is
    // deterministic. The live flow (separate emits) is unaffected.
    ttsControllerRef.current.redispatchPosition();
    emitPlaybackState(state);
  };

  const handleTTSForward = async (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string; byMark?: boolean } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.forward(detail?.byMark ?? false);
    }
  };

  const handleTTSBackward = async (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string; byMark?: boolean } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.backward(detail?.byMark ?? false);
    }
  };

  const handleTTSHighlightSentence = (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const sentence = ttsControllerRef.current?.getSpokenSentence();
    if (!sentence) return;
    eventDispatcher.dispatch('create-tts-highlight', { bookKey, ...sentence });
  };

  // Set the TTS rate from the app bus. The RSVP overlay is full-screen, so its
  // rate picker can't reach the TTS panel; it dispatches `tts-set-rate` and we
  // reuse the same controller rate-change path the panel uses (handleSetRate,
  // defined below — stop→setRate→start while playing, throttled). Also persists
  // the value to viewSettings so it survives like a panel change.
  const handleTTSSetRate = (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string; rate?: number } | undefined;
    if (detail?.bookKey !== bookKey || typeof detail.rate !== 'number') return;
    const viewSettings = getViewSettings(bookKey);
    if (viewSettings) {
      viewSettings.ttsRate = detail.rate;
      setViewSettings(bookKey, viewSettings);
    }
    handleSetRate(detail.rate);
  };

  const handleTTSTogglePlay = async (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;
    if (ttsController.state === 'playing') {
      setIsPlaying(false);
      setIsPaused(true);
      emitPlaybackState('paused');
      await ttsController.pause();
    } else {
      setIsPlaying(true);
      setIsPaused(false);
      emitPlaybackState('playing');
      if (ttsController.state === 'paused') {
        await ttsController.resume();
      } else {
        await ttsController.start();
      }
    }
  };

  useEffect(() => {
    eventDispatcher.on('tts-speak', handleTTSSpeak);
    eventDispatcher.on('tts-stop', handleTTSStop);
    eventDispatcher.on('tts-close-book', handleTTSCloseBook);
    eventDispatcher.on('tts-forward', handleTTSForward);
    eventDispatcher.on('tts-backward', handleTTSBackward);
    eventDispatcher.on('tts-toggle-play', handleTTSTogglePlay);
    eventDispatcher.on('tts-set-rate', handleTTSSetRate);
    eventDispatcher.on('tts-highlight-sentence', handleTTSHighlightSentence);
    eventDispatcher.on('tts-sync-request', handleTTSSyncRequest);
    return () => {
      eventDispatcher.off('tts-speak', handleTTSSpeak);
      eventDispatcher.off('tts-stop', handleTTSStop);
      eventDispatcher.off('tts-close-book', handleTTSCloseBook);
      eventDispatcher.off('tts-forward', handleTTSForward);
      eventDispatcher.off('tts-backward', handleTTSBackward);
      eventDispatcher.off('tts-toggle-play', handleTTSTogglePlay);
      eventDispatcher.off('tts-set-rate', handleTTSSetRate);
      eventDispatcher.off('tts-highlight-sentence', handleTTSHighlightSentence);
      eventDispatcher.off('tts-sync-request', handleTTSSyncRequest);
      if (ttsControllerRef.current) {
        const controller = ttsControllerRef.current;
        const bookHash = getBookHashFromKey(bookKey);
        const session = ttsSessionManager.getSessionByHash(bookHash);
        if (session?.controller === controller && !controller.terminated) {
          // Ownership transfers to the manager: the session keeps playing
          // headless (route unmount, deep-link book switch, split-view pane
          // close all funnel through this cleanup).
          ttsSessionManager.detach(bookHash);
        } else {
          controller.shutdown();
          ttsSessionManager.release(bookHash);
        }
        ttsControllerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manager-driven stops (sleep timer, end of book, headless error, replaced
  // by another book) must reconcile this reader's UI when it is mounted.
  useEffect(() => {
    const onSessionChanged = (e: Event) => {
      const { reason } = (e as CustomEvent<{ reason: string }>).detail;
      if (reason !== 'stopped' || !ttsControllerRef.current) return;
      ttsControllerRef.current = null;
      setTtsController(null);
      setIsPlaying(false);
      setIsPaused(false);
      setShowIndicator(false);
      setShowBackToCurrentTTSLocation(false);
      setTTSEnabled(bookKey, false);
      setTimeoutOption(0);
      setTimeoutTimestamp(0);
      onRequestHidePanel?.();
    };
    ttsSessionManager.addEventListener('session-changed', onSessionChanged);
    return () => ttsSessionManager.removeEventListener('session-changed', onSessionChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Opening a book whose hash doesn't match the active session stops it —
  // unless that session's book is still mounted elsewhere (split view).
  useEffect(() => {
    const active = ttsSessionManager.getActiveSession();
    if (!active) return;
    const mountedHashes = useReaderStore.getState().bookKeys.map(getBookHashFromKey);
    if (!mountedHashes.includes(active.bookHash)) {
      void ttsSessionManager.stopActive('replaced');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Seamless reattach: adopt a live background session for this book (same
  // hash, fresh bookKey) once its view is ready. Audio never stops; the view
  // catches up. Adoption runs only in the primary pane for the hash.
  useEffect(() => {
    const bookHash = getBookHashFromKey(bookKey);
    const session = ttsSessionManager.getSessionByHash(bookHash);
    if (!session || session.controller.terminated) return;
    if (ttsControllerRef.current === session.controller) return;
    const primaryKey = useReaderStore
      .getState()
      .bookKeys.find((k) => getBookHashFromKey(k) === bookHash);
    if (primaryKey !== bookKey) return;

    let cancelled = false;
    const tryAdopt = async (): Promise<boolean> => {
      if (cancelled || isStartingTTSRef.current) return false;
      const view = getView(bookKey);
      if (!view) return false;
      isStartingTTSRef.current = true;
      try {
        const controller = session.controller;
        ttsControllerRef.current = controller;
        setTtsController(controller);
        // Indicator on at adoption START so it never flickers in after the
        // async attach resolves.
        setShowIndicator(true);
        setTtsClientsInitialized(true);
        setTTSEnabled(bookKey, true);
        const paused = controller.state.includes('paused');
        setIsPlaying(!paused);
        setIsPaused(paused);
        emitPlaybackState(paused ? 'paused' : 'playing');
        const timer = ttsSessionManager.getSleepTimer();
        setTimeoutOption(timer?.timeoutSec ?? 0);
        setTimeoutTimestamp(timer?.firesAt ?? 0);
        const bookData = getBookData(bookKey);
        if (bookData?.book) {
          ttsSessionManager.adopt(bookKey, {
            bookKey,
            title: bookData.book.title,
            author: bookData.book.author,
            coverImageUrl: bookData.book.coverImageUrl || null,
            metadataMode: getViewSettings(bookKey)?.ttsMediaMetadata ?? 'sentence',
            getSectionLabel: () => getProgress(bookKey)?.sectionLabel,
          });
        }
        await controller.attachView(view, {
          bookKey,
          preprocessCallback: preprocessSSMLForTTS,
          onSectionChange: handleSectionChange,
          documentProvider: createDocumentProvider(view),
        });
        const speakingLang = controller.getSpeakingLang();
        if (speakingLang) setTtsLang(speakingLang);
      } catch (err) {
        console.warn('TTS session adoption failed:', err);
      } finally {
        isStartingTTSRef.current = false;
      }
      return true;
    };

    const interval = setInterval(() => {
      void tryAdopt().then((done) => {
        if (done) clearInterval(interval);
      });
    }, 300);
    void tryAdopt().then((done) => {
      if (done) clearInterval(interval);
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Controller event listeners (re-registered when ttsController changes)
  useEffect(() => {
    if (!ttsController || !bookKey) return;
    const handleNeedAuth = () => {
      eventDispatcher.dispatch('toast', {
        message: _('Please log in to use advanced TTS features'),
        type: 'error',
        timeout: 5000,
      });
    };

    const handleHighlightMark = (e: Event) => {
      const { cfi, preview } = (e as CustomEvent<{ cfi: string; preview?: boolean }>).detail;
      const view = getView(bookKey);
      const progress = getProgress(bookKey);
      const viewSettings = getViewSettings(bookKey);
      const { location } = progress || {};
      if (!cfi || !view || !location || !viewSettings) return;

      // A scrubber-drag preview navigates the view but must not move the
      // session's saved location — only a committed seek (which fires a
      // non-preview mark) does that.
      if (!preview) {
        viewSettings.ttsLocation = cfi;
        setViewSettings(bookKey, viewSettings);
      }

      const hlContents = view.renderer.getContents();
      const selectionActive = hlContents.some(
        ({ doc }) => (doc.getSelection()?.toString().length ?? 0) > 0,
      );
      const { anchor, index: ttsSectionIndex } = view.resolveCFI(cfi);
      // A large section can be split across several chunk documents; pick the
      // chunk in which the CFI actually resolves. A dual-page spread can also
      // keep the TTS section in a non-primary column.
      const content = hlContents
        .filter((item) => item.index === ttsSectionIndex)
        .find((item) => anchor(item.doc));

      if (!content || !isContentVisible(view.renderer, content)) {
        // TTS crossed into a new section before the view caught up. The
        // `await onSectionChange` path in TTSController fires renderer.goTo
        // via handleSectionChange, but the new paginator's #goTo can resolve
        // before the visible page actually flips when the target section is
        // already preloaded as an adjacent view — leaving the user stuck on
        // the last page of the previous chapter while audio continues. Drive
        // navigation from the highlight cfi directly, stamping the timestamp
        // so the "back-to-TTS" button stays suppressed while progress.location
        // catches up. Skip when the user paged away (back-to-TTS owns the
        // return) or is actively selecting text.
        if (selectionActive) return;
        if (!preview && !followingTTSLocationRef.current) return;
        sectionChangingTimestampRef.current = Date.now();
        followingTTSLocationRef.current = true;
        if (!preview) setProgressLocation(bookKey, cfi, null);
        markTtsNavigation(bookKey, { index: ttsSectionIndex, cfi });
        view.goTo?.(cfi);
        return;
      }

      // A drag preview is an explicit "show me there" gesture: it navigates
      // even when auto-follow was suppressed by the user paging away.
      if (!preview && !followingTTSLocationRef.current) return;
      if (selectionActive) return;

      const range = anchor(content.doc);
      // The cfi may not resolve to a range in this doc (stale/cross-realm doc,
      // detached node). A null range would crash scrollToAnchor (foliate reads
      // range.startContainer) or getBoundingClientRect below (READEST-21).
      if (!range) return;
      if (!preview) setProgressLocation(bookKey, cfi, range);
      const primaryContent = hlContents.find((item) => item.index === view.renderer.primaryIndex);
      const isPrimary = primaryContent
        ? content.doc === primaryContent.doc
        : content.index === view.renderer.primaryIndex;
      // A visible non-primary column may still be on a later page of that
      // section; navigate when the range itself is not visible. Scrolling a
      // non-primary iframe would mix iframe-local rects with paginator coords.
      if (!isPrimary) {
        if (!isRangeVisibleInContent(view.renderer, content, range)) {
          markTtsNavigation(bookKey, { index: ttsSectionIndex, cfi });
          view.goTo?.(cfi);
        }
        return;
      }
      if (!view.renderer.scrolled) {
        // scrollToAnchor relocates with reason 'navigation'/'scroll', which the
        // anchor-only suppression in FoliateViewer does not cover.
        markTtsNavigation(bookKey, { index: ttsSectionIndex, cfi });
        view.renderer.scrollToAnchor?.(range);
      } else {
        const rect = range.getBoundingClientRect();
        const { start, end, sideProp } = view.renderer;
        const rangeTop = rect[sideProp === 'height' ? 'y' : 'x'];
        const rangeBottom = rangeTop + rect[sideProp === 'height' ? 'height' : 'width'];

        const showHeader = viewSettings.showHeader;
        const showFooter = viewSettings.showFooter;
        const headerScrollOverlap = showHeader ? viewSettings.marginTopPx : 0;
        const footerScrollOverlap = showFooter ? viewSettings.marginBottomPx : 0;
        const scrollingOverlap = viewSettings.scrollingOverlap;
        const outOfView =
          rangeBottom > end - footerScrollOverlap - scrollingOverlap ||
          rangeTop < start + headerScrollOverlap + scrollingOverlap;
        if (outOfView) {
          markTtsNavigation(bookKey, { index: ttsSectionIndex, cfi });
          view.renderer.scrollToAnchor?.(range);
        }
      }
    };

    // Word-level page following: turn the page as soon as the spoken word
    // moves off the visible page, instead of waiting for the next sentence's
    // mark. Only navigates when the word is outside the visible range, so
    // on-page words don't trigger relocations.
    const handleHighlightWord = (e: Event) => {
      const { cfi } = (e as CustomEvent<{ cfi: string }>).detail;
      const view = getView(bookKey);
      if (!cfi || !view || !followingTTSLocationRef.current) return;

      const hlContents = view.renderer.getContents();
      const { anchor, index: ttsSectionIndex } = view.resolveCFI(cfi);
      const content = hlContents
        .filter((item) => item.index === ttsSectionIndex)
        .find((item) => anchor(item.doc));
      // Cross-section navigation is driven by the sentence-level mark handler.
      if (!content || !isContentVisible(view.renderer, content)) return;
      if (hlContents.some(({ doc }) => (doc.getSelection()?.toString().length ?? 0) > 0)) return;

      const wordRange = anchor(content.doc);
      if (!wordRange) return;
      const primaryContent = hlContents.find((item) => item.index === view.renderer.primaryIndex);
      const isPrimary = primaryContent
        ? content.doc === primaryContent.doc
        : content.index === view.renderer.primaryIndex;
      if (isRangeVisibleInContent(view.renderer, content, wordRange)) return;
      // A visible non-primary column may still be on a later page of that
      // section; navigate when the word is off-page.
      if (isPrimary) {
        markTtsNavigation(bookKey, { index: ttsSectionIndex, cfi });
        view.renderer.scrollToAnchor?.(wordRange);
      } else {
        markTtsNavigation(bookKey, { index: ttsSectionIndex, cfi });
        view.goTo?.(cfi);
      }
    };

    // Republish the controller's canonical position signal onto the app-wide
    // bus so paragraph mode + RSVP can follow TTS without touching the
    // controller. This MUST be its own listener: handleHighlightMark /
    // handleHighlightWord early-return on following-suppression and text
    // selection, which would silently stop the modes from following. The
    // forward fires on every controller 'tts-position', gated only by the
    // listener's lifecycle (it exists only while the controller does).
    const handlePosition = (e: Event) => {
      eventDispatcher.dispatch('tts-position', {
        bookKey,
        ...(e as CustomEvent).detail,
      });
    };

    // Lock-screen play/pause acts on the controller through the media
    // bridge; the panel derives its state from the controller, not from
    // local optimistic taps. Transit 'stopped' (every paragraph advance) is
    // ignored; terminal stops arrive via explicit stop paths.
    const handleStateChange = (e: Event) => {
      const { state } = (e as CustomEvent<{ state: string }>).detail;
      if (state === 'playing') {
        setIsPlaying(true);
        setIsPaused(false);
        playbackStateRef.current = 'playing';
      } else if (state.includes('paused')) {
        setIsPlaying(false);
        setIsPaused(true);
        playbackStateRef.current = 'paused';
      }
    };

    ttsController.addEventListener('tts-need-auth', handleNeedAuth);
    ttsController.addEventListener('tts-highlight-mark', handleHighlightMark);
    ttsController.addEventListener('tts-highlight-word', handleHighlightWord);
    ttsController.addEventListener('tts-position', handlePosition);
    ttsController.addEventListener('tts-state-change', handleStateChange);
    return () => {
      ttsController.removeEventListener('tts-need-auth', handleNeedAuth);
      ttsController.removeEventListener('tts-highlight-mark', handleHighlightMark);
      ttsController.removeEventListener('tts-highlight-word', handleHighlightWord);
      ttsController.removeEventListener('tts-position', handlePosition);
      ttsController.removeEventListener('tts-state-change', handleStateChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsController, bookKey]);

  // Location tracking — re-highlight when progress changes.
  // Reactive subscription via readerProgressStore so the effect below
  // re-runs on page turns without dragging in the whole readerStore.
  const progress = useBookProgress(bookKey);
  useEffect(() => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;

    const viewSettings = getViewSettings(bookKey);
    const ttsLocation = viewSettings?.ttsLocation;
    const { location } = progress || {};
    if (!location || !ttsLocation) return;

    // Check the actual highlighted position against the view. During
    // word-by-word playback the word can sit on a different page than the
    // sentence's ttsLocation (a sentence spanning a page break), so the word
    // position is the correct reference — otherwise the back-to-TTS button
    // wrongly appears after the view follows the word onto the next page.
    const highlightCfi = ttsController.getCurrentHighlightCfi() ?? ttsLocation;
    if (isCfiInLocation(highlightCfi, location)) {
      setShowBackToCurrentTTSLocation(false);
      // Word-aware re-apply: re-draws the current word during word-by-word
      // playback instead of redrawing the whole sentence over it.
      ttsController.reapplyCurrentHighlight();
    } else {
      const msSinceSectionChange = Date.now() - sectionChangingTimestampRef.current;
      if (msSinceSectionChange < 2000) return;
      setShowBackToCurrentTTSLocation(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Location tracking — keep followingTTSLocationRef in sync with showBackToCurrentTTSLocation
  useEffect(() => {
    if (showBackToCurrentTTSLocation) {
      followingTTSLocationRef.current = false;
    } else {
      followingTTSLocationRef.current = true;
    }
  }, [showBackToCurrentTTSLocation]);

  // Location tracking — handleBackToCurrentTTSLocation
  const handleBackToCurrentTTSLocation = () => {
    const view = getView(bookKey);
    const viewSettings = getViewSettings(bookKey);
    const ttsLocation = viewSettings?.ttsLocation;
    if (!view || !ttsLocation) return;

    const resolved = view.resolveNavigation(ttsLocation);
    markTtsNavigation(bookKey, { index: resolved.index, cfi: ttsLocation });
    view.renderer.goTo?.(resolved);
  };

  const viewSettings = getViewSettings(bookKey);
  const bookData = getBookData(bookKey);
  const ttsTime = useMemo(() => {
    const rate = viewSettings?.ttsRate ?? 1;
    return estimateTTSTime(progress, rate);
  }, [progress, viewSettings?.ttsRate]);

  const getTTSTargetLang = useCallback((): string | null => {
    const vs = getViewSettings(bookKey);
    const ttsReadAloudText = vs?.ttsReadAloudText;
    if (vs?.translationEnabled && ttsReadAloudText === 'translated') {
      return vs?.translateTargetLang || getLocale();
    } else if (vs?.translationEnabled && ttsReadAloudText === 'source') {
      return bookData?.book?.primaryLanguage || '';
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bookKey,
    getBookData,
    getViewSettings,
    viewSettings?.translationEnabled,
    viewSettings?.ttsReadAloudText,
    viewSettings?.translateTargetLang,
  ]);

  useEffect(() => {
    ttsControllerRef.current?.setTargetLang(getTTSTargetLang() || '');
  }, [getTTSTargetLang]);

  // SSML preprocessing
  const transformCtx: TransformContext = useMemo(
    () => ({
      bookKey,
      viewSettings: getViewSettings(bookKey)!,
      userLocale: getLocale(),
      isFixedLayout: bookData?.isFixedLayout || false,
      content: '',
      transformers: [],
      reversePunctuationTransform: true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const preprocessSSMLForTTS = useCallback(
    async (ssml: string) => {
      const rules = getMergedRules(bookKey);
      const viewSettings = getViewSettings(bookKey)!;
      const ttsOnlyRules = rules.filter(
        (rule) =>
          rule.enabled && rule.onlyForTTS && (rule.scope === 'book' || rule.scope === 'library'),
      );
      if (ttsOnlyRules.length === 0) return ssml;

      transformCtx['content'] = ssml;
      transformCtx['viewSettings'] = viewSettings;
      ssml = await proofreadTransformer.transform(transformCtx, {
        docType: 'text/xml',
        onlyForTTS: true,
      });
      return ssml;
    },
    [bookKey, getMergedRules, getViewSettings, transformCtx],
  );

  // Section change callback
  const handleSectionChange = useCallback(
    async (sectionIndex: number) => {
      if (!followingTTSLocationRef.current) return;
      const view = getView(bookKey);
      const sections = view?.book.sections;
      if (!sections || sectionIndex < 0 || sectionIndex >= sections.length) return;
      sectionChangingTimestampRef.current = Date.now();
      const resolved = view.resolveNavigation(sectionIndex);
      // The next section (or any of its chunks) may already be visible as a
      // non-primary column; re-anchoring it to page 0 would jump backwards.
      const sectionVisible = view.renderer
        .getContents()
        .filter((item) => item.index === sectionIndex)
        .some((item) => isContentVisible(view.renderer, item));
      if (!sectionVisible) {
        // Await so TTSController's `await onSectionChange` doesn't proceed to
        // speak the new section before the view has finished navigating to it.
        markTtsNavigation(bookKey, { index: sectionIndex });
        await view.renderer.goTo?.(resolved);
      }
    },
    [bookKey, getView],
  );

  // TTS highlight options
  const getTTSHighlightOptions = useCallback(
    (ttsHighlightOptions: TTSHighlightOptions, isEink: boolean) => {
      const einkBgColor = isDarkMode ? '#000000' : '#ffffff';
      const color = isEink ? einkBgColor : ttsHighlightOptions.color;
      return {
        ...ttsHighlightOptions,
        color,
      };
    },
    [isDarkMode],
  );

  useEffect(() => {
    const ttsHighlightOptions = viewSettings?.ttsHighlightOptions;
    if (ttsControllerRef.current && ttsHighlightOptions) {
      ttsControllerRef.current.updateHighlightOptions(
        getTTSHighlightOptions(ttsHighlightOptions, viewSettings!.isEink),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings?.ttsHighlightOptions, viewSettings?.isEink, getTTSHighlightOptions]);

  useEffect(() => {
    if (ttsControllerRef.current && viewSettings?.ttsHighlightGranularity) {
      ttsControllerRef.current.setHighlightGranularity(viewSettings.ttsHighlightGranularity);
    }
  }, [viewSettings?.ttsHighlightGranularity]);

  // handleStop (defined before handleTTSSpeak/handleTTSStop which reference it)
  const handleStop = useCallback(
    async (bookKey: string) => {
      const ttsController = ttsControllerRef.current;
      const stopEpoch = ++ttsEpochRef.current;
      startAbortRef.current?.abort();
      startAbortRef.current = null;
      // Reset all UI/session state up front — including the TTS toggle
      // (ttsEnabled) and indicator that color the TTS icon — so disabling TTS
      // always takes effect immediately. The teardown below is best-effort and
      // must never block or skip these resets if it hangs or throws, which was
      // observed with iOS system TTS (Edge TTS was unaffected). See #4676.
      ttsControllerRef.current = null;
      setTtsController(null);
      setIsPlaying(false);
      emitPlaybackState('stopped');
      onRequestHidePanel?.();
      setShowIndicator(false);
      setShowBackToCurrentTTSLocation(false);
      previousSectionLabelRef.current = undefined;
      const lastTtsLocation = getViewSettings(bookKey)?.ttsLocation;
      // Removing the mini-player clearance reflows once; restore the last
      // spoken CFI after that layout settles so the stop transition cannot
      // leave a page-start position in progress.
      const wantsRestore =
        !!lastTtsLocation && followingTTSLocationRef.current && getViewState(bookKey)?.ttsEnabled;
      restoreAbortRef.current?.abort();
      restoreAbortRef.current = null;
      const restoreAbort = wantsRestore ? new AbortController() : null;
      const restoreAfterLayout =
        restoreAbort && lastTtsLocation
          ? waitForLayoutApplied(bookKey, false, restoreAbort.signal)
          : null;
      if (restoreAbort) restoreAbortRef.current = restoreAbort;
      setTTSEnabled(bookKey, false);
      if (restoreAfterLayout && lastTtsLocation && restoreAbort) {
        void restoreAfterLayout.then(() => {
          if (restoreAbort.signal.aborted) return;
          if (restoreAbortRef.current === restoreAbort) restoreAbortRef.current = null;
          if (ttsEpochRef.current !== stopEpoch) return;
          // A page turn during the wait means the user picked a new position;
          // restoring would drag them back to the last spoken sentence.
          if (getProgress(bookKey)?.location !== lastTtsLocation) return;
          setProgressLocation(bookKey, lastTtsLocation, null);
        });
      }
      getView(bookKey)?.deselect();
      releaseUnblockAudio();

      // Tear down the controller, the lock-screen media session, and the
      // background-audio session best-effort and IN PARALLEL. The controller's
      // own shutdown can stall on iOS system TTS, and it must NOT gate the media
      // session / background-audio teardown — otherwise the lock-screen Now
      // Playing keeps running after TTS is disabled (Edge TTS was unaffected
      // because it never hits the stalling native path). See #4676.
      await Promise.all([
        ttsController
          ? Promise.resolve()
              .then(() => ttsController.shutdown())
              .catch((error) => console.warn('TTS shutdown failed:', error))
          : Promise.resolve(),
        Promise.resolve()
          .then(() => ttsMediaBridge.unbind())
          .catch(() => {}),
      ]);
      ttsSessionManager.release(getBookHashFromKey(bookKey));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService],
  );

  // handleTTSSpeak / handleTTSStop (plain functions, registered once at mount via closure)
  const handleTTSSpeak = async (event: CustomEvent) => {
    const { bookKey: ttsBookKey, range, index, oneTime = false } = event.detail;
    if (bookKey !== ttsBookKey) return;
    // Guard against concurrent starts (e.g. rapid double-clicks on the TTS
    // icon). Without this, both invocations race past the `await`s below and
    // end up creating two TTSController instances that speak simultaneously.
    if (isStartingTTSRef.current) return;
    isStartingTTSRef.current = true;
    const sessionEpoch = ++ttsEpochRef.current;
    // A pending stop-restore would fight the new session for progress.
    restoreAbortRef.current?.abort();
    restoreAbortRef.current = null;

    try {
      const view = getView(bookKey);
      const progress = getProgress(bookKey);
      const viewSettings = getViewSettings(bookKey);
      const bookData = getBookData(bookKey);
      const { location } = progress || {};
      if (!view || !progress || !viewSettings || !bookData || !bookData.book) return;
      const ttsSpeakRange = range as Range | null;
      let ttsFromRange = ttsSpeakRange;
      let ttsFromIndex = typeof index === 'number' ? index : null;
      if (!ttsFromRange && viewSettings.ttsLocation) {
        const ttsCfi = viewSettings.ttsLocation;
        if (isCfiInLocation(ttsCfi, location)) {
          const { index, anchor } = view.resolveCFI(ttsCfi);
          const { doc } = view.renderer.getContents().find((x) => x.index === index) || {};
          if (doc) {
            ttsFromRange = anchor(doc);
            ttsFromIndex = index;
          }
        }
      }

      if (!ttsFromIndex) {
        ttsFromIndex = progress.index;
      }

      if (!ttsFromRange && !bookData.isFixedLayout) {
        ttsFromRange = progress.range;
      }

      const currentSection = view.renderer.getContents().find((x) => x.index === ttsFromIndex);
      if (ttsFromRange && currentSection) {
        const ttsLocation = view.getCFI(currentSection?.index || 0, ttsFromRange);
        viewSettings.ttsLocation = ttsLocation;
        setViewSettings(bookKey, viewSettings);
        if (isCfiInLocation(ttsLocation, location)) {
          setShowBackToCurrentTTSLocation(false);
        }
      }

      const primaryLang = bookData.book.primaryLanguage;

      if (ttsControllerRef.current) {
        ttsControllerRef.current.stop();
        ttsControllerRef.current = null;
      }

      let ttsController: TTSController | null = null;
      try {
        // Gesture-path audio unlocks, BEFORE any network/plugin await: WebKit
        // rejects AudioContext.resume() outside the user-gesture window, and
        // speak() itself only runs after preprocessing and preload fetches.
        // The silent keep-alive element runs on ALL platforms — desktop
        // Chromium only surfaces hardware media keys while an
        // HTMLMediaElement is playing, and Edge playback no longer has one.
        unblockAudio();
        void ensureSharedAudioContext();
        // No use_background_audio here: on iOS the native-tts media session
        // claims the audio session itself on activation (non-mixable
        // .playback/.spokenAudio). The old call set .mixWithOthers, which
        // disqualifies the app from Now Playing and fought the claim.
        setTtsClientsInitialized(false);

        // Show the mini player immediately, in the "playing" state: client
        // init below can take a while and the session is conceptually already
        // starting. The catch handler rolls both back if the start fails.
        setShowIndicator(true);
        setIsPlaying(true);
        // Reserve the mini-player clearance and let pagination settle BEFORE
        // the first mark, otherwise TTS starts scrolling against a layout that
        // is still reflowing.
        const ttsAlreadyEnabled = getViewState(bookKey)?.ttsEnabled ?? false;
        if (!ttsAlreadyEnabled) setTTSEnabled(bookKey, true);
        // Tests / non-mounted readers can leave the store flag unchanged; only
        // wait for the layout event when enabling actually took effect.
        const layoutAbort = new AbortController();
        startAbortRef.current?.abort();
        startAbortRef.current = layoutAbort;
        const layoutApplied =
          !ttsAlreadyEnabled && getViewState(bookKey)?.ttsEnabled
            ? waitForLayoutApplied(bookKey, true, layoutAbort.signal)
            : Promise.resolve();
        ttsController = new TTSController(
          appService,
          view,
          !!user?.id,
          preprocessSSMLForTTS,
          handleSectionChange,
        );
        // The constructor takes the view directly (attachView, which also binds
        // this, only runs on the background-session reattach path), so set the
        // book key here or the per-book audio cache never gets a hash to open.
        ttsController.bookKey = bookKey;
        ttsController.setDocumentProvider(createDocumentProvider(view));
        ttsControllerRef.current = ttsController;
        setTtsController(ttsController);
        ttsSessionManager.claim(bookKey, ttsController, {
          bookKey,
          title: bookData.book.title,
          author: bookData.book.author,
          coverImageUrl: bookData.book.coverImageUrl || null,
          metadataMode: viewSettings.ttsMediaMetadata ?? 'sentence',
          getSectionLabel: () => getProgress(bookKey)?.sectionLabel,
        });
        const startController = ttsController;
        // A stop that lands during the awaits below may have captured the ref
        // before this controller existed; if the ref still points at it, its
        // init/session must be torn down here or clients leak while the UI
        // already shows a stopped session.
        const isStaleStart = () =>
          sessionEpoch !== ttsEpochRef.current || ttsControllerRef.current !== startController;
        const cleanupStaleStart = () => {
          if (ttsControllerRef.current !== startController) return;
          ttsControllerRef.current = null;
          setTtsController(null);
          void startController.shutdown().catch(() => {});
          const bookHash = getBookHashFromKey(bookKey);
          if (ttsSessionManager.getSessionByHash(bookHash)?.controller === startController) {
            ttsSessionManager.release(bookHash);
          }
        };

        await Promise.all([startController.init(), layoutApplied]);
        if (isStaleStart()) {
          cleanupStaleStart();
          return;
        }
        await startController.initViewTTS(ttsFromIndex);
        if (isStaleStart()) {
          cleanupStaleStart();
          return;
        }
        startController.updateHighlightOptions(
          getTTSHighlightOptions(viewSettings.ttsHighlightOptions, viewSettings.isEink),
        );
        startController.setHighlightGranularity(viewSettings.ttsHighlightGranularity ?? 'word');
        const anchoredFromRange = ttsFromRange
          ? startController.anchorRangeInTtsDoc(ttsFromRange)
          : null;
        const ssml =
          oneTime && ttsSpeakRange
            ? genSSMLRaw(ttsSpeakRange.toString().trim())
            : anchoredFromRange
              ? view.tts?.from(anchoredFromRange)
              : view.tts?.start();
        if (ssml) {
          const lang = parseSSMLLang(ssml, primaryLang) || 'en';
          setIsPlaying(true);
          emitPlaybackState('playing');
          setTtsLang(lang);

          startController.setLang(lang);
          startController.setRate(viewSettings.ttsRate);
          startController.setSentenceGap(viewSettings.ttsSentenceGap ?? DEFAULT_SENTENCE_GAP_SEC);
          startController.setParagraphGap(
            viewSettings.ttsParagraphGap ?? DEFAULT_PARAGRAPH_GAP_SEC,
          );
          startController.speak(ssml, oneTime, () => handleStop(bookKey));
          startController.setTargetLang(getTTSTargetLang() || '');
        } else {
          // Nothing to speak: roll back the optimistic playing state.
          setIsPlaying(false);
        }
        setTtsClientsInitialized(true);
      } catch (error) {
        // A stop that landed mid-start already reset the UI; surfacing the
        // init rejection as an error toast would contradict the user's stop.
        if (
          sessionEpoch !== ttsEpochRef.current ||
          (ttsController !== null && ttsControllerRef.current !== ttsController)
        ) {
          return;
        }
        setShowIndicator(false);
        setIsPlaying(false);
        setTTSEnabled(bookKey, false);
        eventDispatcher.dispatch('toast', {
          message: _('TTS not supported for this document'),
          type: 'error',
        });
        console.error(error);
      }
    } finally {
      isStartingTTSRef.current = false;
    }
  };

  const handleTTSStop = async (event: CustomEvent) => {
    const { bookKey: ttsBookKey } = event.detail;
    if (ttsControllerRef.current && bookKey === ttsBookKey) {
      handleStop(bookKey);
    }
  };

  // Book close (back to library): a live session goes headless instead of
  // dying. Gate on `terminated`, NOT the state value — chapter transitions
  // sit in transit 'stopped' for seconds and closing during one must detach.
  const handleTTSCloseBook = async (event: CustomEvent) => {
    const { bookKey: closingKey } = event.detail;
    if (bookKey !== closingKey) return;
    const controller = ttsControllerRef.current;
    if (!controller) return;
    if (!controller.terminated) {
      ttsSessionManager.detach(getBookHashFromKey(bookKey));
    } else {
      await handleStop(bookKey);
    }
  };

  // Sentence-snapped seek used by the lock-screen scrubber and the panel.
  const handleSeekTo = useCallback(async (seconds: number) => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;
    await ttsController.seekToTime(seconds);
  }, []);

  // Throttled by the scrubber: preview the location under an in-flight drag
  // (navigate + highlight) without moving the session.
  const handleSeekPreview = useCallback((seconds: number) => {
    ttsControllerRef.current?.previewSeekTime(seconds);
  }, []);

  const handleGetPlaybackInfo = useCallback(() => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return null;
    // Kick the lazy timeline build (off the playback critical path); the
    // first polls return null until it lands and the UI shows a
    // disabled/reserved row for that state.
    void ttsController.ensureTimeline();
    return ttsController.getPlaybackInfo();
  }, []);

  const handleSupportsPlaybackInfo = useCallback(() => {
    return ttsControllerRef.current?.supportsPlaybackInfo() ?? false;
  }, []);

  const handleSupportsGapControl = useCallback(() => {
    return ttsControllerRef.current?.supportsGapControl() ?? false;
  }, []);

  // Stable handle for the download/chapters surface (reads the cache and
  // drives headless pre-synthesis off the playback path). MUST be memoized:
  // an inline arrow here changes identity every render, which would cascade
  // through useTTSDownloads' refresh callback into its effect and spin an
  // infinite render loop the moment the sheet opens.
  const getController = useCallback(() => ttsControllerRef.current, []);

  // Playback callbacks
  const handleTogglePlay = useCallback(async () => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;

    if (isPlaying) {
      setIsPlaying(false);
      setIsPaused(true);
      emitPlaybackState('paused');
      await ttsController.pause();
    } else if (isPaused) {
      setIsPlaying(true);
      setIsPaused(false);
      emitPlaybackState('playing');
      // start for forward/backward/setvoice-paused
      // set rate don't pause the tts
      if (ttsController.state === 'paused') {
        await ttsController.resume();
      } else {
        await ttsController.start();
      }
    }
  }, [isPlaying, isPaused]);

  const handleBackward = useCallback(async (byMark = false) => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.backward(byMark);
    }
  }, []);

  const handleForward = useCallback(async (byMark = false) => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.forward(byMark);
    }
  }, []);

  const handlePause = useCallback(async () => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      setIsPlaying(false);
      setIsPaused(true);
      emitPlaybackState('paused');
      await ttsController.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rate/voice/timeout/bar controls
  // rate range: 0.5 - 3, 1.0 is normal speed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSetRate = useCallback(
    throttle(async (rate: number) => {
      const ttsController = ttsControllerRef.current;
      if (ttsController) {
        if (ttsController.state === 'playing') {
          await ttsController.stop();
          await ttsController.setRate(rate);
          await ttsController.start();
        } else {
          await ttsController.setRate(rate);
        }
      }
    }, 3000),
    [],
  );

  // Inter-sentence gap: read live at schedule time by the controller, so
  // changing it must not stop/restart playback like handleSetRate does.
  const handleSetSentenceGap = useCallback((sec: number) => {
    ttsControllerRef.current?.setSentenceGap(sec);
  }, []);

  // Paragraph gap: applies to every TTS client (not Edge-only), read live by
  // the controller when auto-advancing, so no stop/restart here either.
  const handleSetParagraphGap = useCallback((sec: number) => {
    ttsControllerRef.current?.setParagraphGap(sec);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSetVoice = useCallback(
    throttle(async (voice: string, lang: string) => {
      const ttsController = ttsControllerRef.current;
      if (ttsController) {
        if (ttsController.state === 'playing') {
          await ttsController.stop();
          await ttsController.setVoice(voice, lang);
          await ttsController.start();
        } else {
          await ttsController.setVoice(voice, lang);
        }
      }
    }, 3000),
    [],
  );

  const handleGetVoices = async (lang: string): Promise<TTSVoicesGroup[]> => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      return ttsController.getVoices(lang);
    }
    return [];
  };

  const handleGetVoiceId = () => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      return ttsController.getVoiceId();
    }
    return '';
  };

  // The timer lives in the session manager so it survives reader unmount and
  // stops a background session (a hook-local timer would fire into a dead
  // closure and orphan the audio).
  const handleSelectTimeout = (_bookKey: string, value: number) => {
    setTimeoutOption(value);
    ttsSessionManager.setSleepTimer(value);
    setTimeoutTimestamp(value > 0 ? Date.now() + value * 1000 : 0);
  };

  const refreshTtsLang = useCallback(() => {
    const speakingLang = ttsControllerRef.current?.getSpeakingLang();
    if (speakingLang) {
      setTtsLang(speakingLang);
    }
  }, []);

  return {
    isPlaying,
    isPaused,
    ttsLang,
    ttsClientsInited,
    isTTSActive: ttsController !== null,
    showIndicator,
    showBackToCurrentTTSLocation,
    timeoutOption,
    timeoutTimestamp,
    chapterRemainingSec: ttsTime.chapterRemainingSec,
    bookRemainingSec: ttsTime.bookRemainingSec,
    finishAtTimestamp: ttsTime.finishAtTimestamp,
    handleTogglePlay,
    handleBackward,
    handleForward,
    handlePause,
    handleSetRate,
    handleSetSentenceGap,
    handleSetParagraphGap,
    handleSetVoice,
    handleGetVoices,
    handleGetVoiceId,
    handleSelectTimeout,
    handleBackToCurrentTTSLocation,
    handleSeekTo,
    handleSeekPreview,
    handleGetPlaybackInfo,
    handleSupportsPlaybackInfo,
    handleSupportsGapControl,
    refreshTtsLang,
    getController,
  };
};
