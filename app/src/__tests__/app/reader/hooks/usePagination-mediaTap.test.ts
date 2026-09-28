import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// A tap on an image/table only opens the media viewer from the centre zone;
// in the page-turn zones it turns the page like any other tap, so paging
// through illustrated books doesn't keep opening the viewer by accident.
const h = vi.hoisted(() => ({
  viewSettings: {} as Record<string, unknown>,
  setHoveredBookKey: vi.fn(),
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => h.viewSettings,
      getViewState: () => ({ inited: true }),
      hoveredBookKey: null,
      setHoveredBookKey: h.setHoveredBookKey,
    }),
    { getState: () => ({ hoveredBookKey: null }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: unknown) => unknown) =>
      selector ? selector({ settings: {} }) : { settings: {} },
    { getState: () => ({ settings: {} }) },
  ),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => ({}), { getState: () => ({ sideBarBookKey: 'book-1' }) }),
}));

import { usePagination } from '@/app/reader/hooks/usePagination';
import type { FoliateView } from '@/types/view';

const BOOK_KEY = 'book-1';
const MEDIA = { elementType: 'image', src: 'blob:http://localhost/abc' };
// The view spans screen x 0..1000; the centre zone is 375..625.
const VIEW_WIDTH = 1000;

let postSpy: ReturnType<typeof vi.spyOn>;
let view: {
  renderer: { scrolled: boolean };
  book: { dir: 'ltr' };
  next: ReturnType<typeof vi.fn>;
  prev: ReturnType<typeof vi.fn>;
};

const setup = () => {
  view = { renderer: { scrolled: false }, book: { dir: 'ltr' }, next: vi.fn(), prev: vi.fn() };
  const viewRef = { current: view as unknown as FoliateView };
  const containerRef = {
    current: { getBoundingClientRect: () => ({ left: 0, width: VIEW_WIDTH }) } as HTMLDivElement,
  };
  return renderHook(() => usePagination(BOOK_KEY, viewRef, containerRef));
};

const tap = async (
  handlePageFlip: ReturnType<typeof usePagination>['handlePageFlip'],
  screenX: number,
  media?: typeof MEDIA,
) => {
  await act(async () => {
    await handlePageFlip(
      new MessageEvent('message', {
        data: { type: 'iframe-single-click', bookKey: BOOK_KEY, screenX, ...(media && { media }) },
      }),
    );
  });
};

const openedMedia = () =>
  postSpy.mock.calls
    .map((call: unknown[]) => call[0] as Record<string, unknown>)
    .filter((m: Record<string, unknown>) => m['type'] === 'iframe-open-media');

beforeEach(() => {
  vi.clearAllMocks();
  h.viewSettings = {};
  postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('usePagination media taps', () => {
  test('a tap on an image in the centre zone opens the media viewer', async () => {
    const { result } = setup();
    await tap(result.current.handlePageFlip, 500, MEDIA);

    expect(openedMedia()).toEqual([{ type: 'iframe-open-media', bookKey: BOOK_KEY, ...MEDIA }]);
    expect(view.next).not.toHaveBeenCalled();
    expect(h.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test('a tap on an image in the right page-turn zone turns the page', async () => {
    const { result } = setup();
    await tap(result.current.handlePageFlip, 900, MEDIA);

    expect(openedMedia()).toEqual([]);
    expect(view.next).toHaveBeenCalled();
  });

  test('a tap on an image in the left page-turn zone turns the page back', async () => {
    const { result } = setup();
    await tap(result.current.handlePageFlip, 100, MEDIA);

    expect(openedMedia()).toEqual([]);
    expect(view.prev).toHaveBeenCalled();
  });

  test('with tap-to-turn disabled, a tap anywhere on an image opens the viewer', async () => {
    h.viewSettings = { disableClick: true };
    const { result } = setup();
    await tap(result.current.handlePageFlip, 900, MEDIA);

    expect(openedMedia()).toHaveLength(1);
    expect(view.next).not.toHaveBeenCalled();
  });

  test('a centre tap without media still toggles the toolbar', async () => {
    const { result } = setup();
    await tap(result.current.handlePageFlip, 500);

    expect(openedMedia()).toEqual([]);
    expect(h.setHoveredBookKey).toHaveBeenCalledWith(BOOK_KEY);
  });
});
