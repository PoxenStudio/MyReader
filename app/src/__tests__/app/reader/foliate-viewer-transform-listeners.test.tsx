import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';

const { readerState, openGate } = vi.hoisted(() => {
  return {
    openGate: { pending: null as Promise<void> | null, started: false },
    readerState: {
      setProgress: vi.fn(),
      getViewState: () => ({}),
      getViewSettings: () => ({ writingMode: 'auto' }),
      getView: () => null,
      setView: () => {},
      setViewInited: () => {},
      setPreviewMode: () => {},
      getProgress: () => null,
      setViewSettings: () => {},
    },
  };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: typeof readerState) => unknown) => select(readerState),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => unknown }) => unknown) =>
    select({ getBookData: () => null }),
}));
vi.mock('@/store/parallelViewStore', () => ({ useParallelViewStore: () => () => [] }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({ settings: {} }), { getState: () => ({ settings: {} }) }),
}));
vi.mock('@/store/themeStore', () => {
  const state = { themeCode: {}, isDarkMode: false };
  const useThemeStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { useThemeStore: Object.assign(useThemeStore, { getState: () => state }) };
});
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({
    getLoadedFonts: () => [],
    getAvailableFonts: () => [],
    loadFont: vi.fn(),
    loadCustomFonts: vi.fn(),
  }),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/libs/document', () => ({
  convertBlobUrlToDataUrl: vi.fn(),
  getDirection: () => ({ vertical: false, rtl: false }),
}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement & { book?: unknown }) => {
    const anyCall: object = new Proxy(() => anyCall, { get: () => anyCall, apply: () => anyCall });
    return Object.assign(view, {
      open: async (book: unknown) => {
        view.book = book;
        openGate.started = true;
        await openGate.pending;
      },
      init: async () => {},
      goToFraction: async () => {},
      renderer: anyCall,
    });
  },
}));
vi.mock('@/utils/style', () => ({
  getStyles: () => '',
  getThemeCode: () => ({}),
  applyTranslationStyle: () => {},
  applyFixedlayoutStyles: () => {},
  applyImageStyle: () => {},
  applyScrollbarStyle: () => {},
  applyScrollModeClass: () => {},
  applyThemeModeClass: () => {},
  keepTextAlignment: () => {},
  transformStylesheet: (data: unknown) => data,
}));
vi.mock('@/utils/scrollable', () => ({
  applyScrollableStyle: () => {},
  applyTableTouchScroll: () => {},
}));
vi.mock('@/styles/fonts', () => ({ mountAdditionalFonts: () => {}, mountCustomFont: () => {} }));
vi.mock('@/utils/warichu', () => ({ layoutWarichu: () => {}, relayoutWarichu: () => {} }));
vi.mock('@/services/transformService', () => ({ transformContent: vi.fn() }));
vi.mock('@/app/reader/utils/wordlensSection', () => ({ refreshSectionGlosses: vi.fn() }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: vi.fn() }));
vi.mock('@/app/reader/hooks/useBrightnessGesture', () => ({ useBrightnessGesture: () => ({}) }));
vi.mock('@/app/reader/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({ active: false }),
}));
vi.mock('@/app/reader/hooks/useAutoScrollSpeedGesture', () => ({
  useAutoScrollSpeedGesture: () => ({}),
}));
vi.mock('@/app/reader/hooks/useMiddleClickAutoscroll', () => ({
  useMiddleClickAutoscroll: () => null,
}));
vi.mock('@/app/reader/hooks/useIframeEvents', () => ({
  useMouseEvent: () => ({}),
  useTouchEvent: () => ({}),
  useOpenMediaEvent: () => {},
}));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  useCapturedTurn: () => {},
  applyPageTurnAttributes: () => {},
}));
vi.mock('@/app/reader/hooks/usePagination', () => ({ usePagination: () => ({}) }));
vi.mock('@/app/reader/hooks/useProgressAutoSave', () => ({ useProgressAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({ useTextTranslation: () => {} }));
vi.mock('@/app/reader/hooks/useWebDAVSync', () => ({ useWebDAVSync: () => {} }));
vi.mock('@/app/reader/hooks/useNativeSync', () => ({ useNativeSync: () => {} }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useAutoFocus', () => ({ useAutoFocus: () => {} }));
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({ applyEinkMode: () => {} }) }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: () => {} }));
vi.mock('@/utils/insets', () => ({
  getViewInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('@/app/reader/utils/footerBand', () => ({ footerReservesBand: () => false }));
vi.mock('@/utils/a11y', () => ({ handleA11yNavigation: () => {} }));
vi.mock('@/utils/lang', () => ({ isCJKLang: () => false }));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLocale: () => 'en',
}));
vi.mock('@/utils/network', () => ({ isMetered: () => false }));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { on: () => {}, off: () => {}, dispatch: () => {} },
}));
vi.mock('@/utils/font', () => ({ isFontType: () => false }));
vi.mock('@/utils/webtoon', () => ({ getScrollGapAttr: () => '0' }));
vi.mock('@/utils/config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getMaxInlineSize: () => 720,
}));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => 'ltr' }));
vi.mock('@/utils/book', () => ({
  getBookDirFromLanguage: () => 'auto',
  getBookDirFromWritingMode: () => 'auto',
  getBookHash: () => 'hash',
}));
vi.mock('@/utils/cfi', () => ({ getIndexFromCfi: () => 0 }));
vi.mock('@/utils/bridge', () => ({
  lockScreenOrientation: vi.fn(),
  setTextSelectionSuppressed: vi.fn(),
}));
vi.mock('@/utils/highlightjs', () => ({ manageSyntaxHighlighting: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/app/reader/utils/ttsMiniPlayerPosition', () => ({
  getTTSMiniPlayerBottomOffset: () => 0,
  TTS_MINI_PLAYER_HEIGHT: 0,
}));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/AutoscrollIndicator', () => ({ default: () => null }));
vi.mock('@/app/reader/components/AutoScrollControl', () => ({ default: () => null }));
vi.mock('@/app/reader/components/AutoScrollSpeedOverlay', () => ({ default: () => null }));

// #6710: the book document outlives the reader (bookDataStore caches it for
// the next open), so a listener the view adds to its transformTarget keeps
// that closed view, its iframes and their listeners alive, one more per open.
function setup() {
  const transformTarget = new EventTarget();
  const live = new Set<EventListenerOrEventListenerObject>();
  const add = transformTarget.addEventListener.bind(transformTarget);
  const remove = transformTarget.removeEventListener.bind(transformTarget);
  transformTarget.addEventListener = (type, listener, options) => {
    if (listener) live.add(listener);
    add(type, listener, options);
  };
  transformTarget.removeEventListener = (type, listener, options) => {
    if (listener) live.delete(listener);
    remove(type, listener, options);
  };
  const props = {
    bookKey: 'test-book',
    bookDoc: { metadata: {}, transformTarget },
    config: {},
    gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as ComponentProps<typeof FoliateViewer>;
  return { live, props };
}

it('removes its transformTarget listeners when the reader closes', async () => {
  openGate.pending = null;
  const { live, props } = setup();
  const { unmount } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(live.size).toBeGreaterThan(0));
  unmount();
  expect(live.size).toBe(0);
});

it('leaves no transformTarget listeners when the reader closes while the book is opening', async () => {
  let finishOpen = () => {};
  openGate.pending = new Promise<void>((resolve) => {
    finishOpen = resolve;
  });
  openGate.started = false;
  const { live, props } = setup();
  const { unmount } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(openGate.started).toBe(true));
  unmount();
  finishOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(live.size).toBe(0);
});
