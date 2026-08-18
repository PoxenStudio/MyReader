import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LibraryHeader from '@/app/library/components/LibraryHeader';
import { DropdownProvider } from '@/context/DropdownContext';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    safeAreaInsets: { top: 0, bottom: 0 },
    systemUIVisible: true,
    statusBarHeight: 0,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false, hasSafeAreaInset: false } }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ status: 'logged_out', isGuest: false, setIsAdmin: vi.fn() }),
}));

vi.mock('@/context/AuthUIStore', () => ({}));

vi.mock('@/store/authUIStore', () => ({
  useAuthUIStore: (selector: (state: { openLoginDialog: () => void }) => unknown) =>
    selector({ openLoginDialog: vi.fn() }),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksConnectionStatus: () => 'unconfigured',
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    setSettingsDialogOpen: vi.fn(),
    setRequestedPanel: vi.fn(),
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ currentBookshelf: [] }),
}));

vi.mock('@/services/mybooksService', () => ({
  checkMyBooksConnectivity: vi.fn(),
  getUserInfo: vi.fn().mockResolvedValue(null),
  getMyBooksAvatarUrl: () => '',
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('@/hooks/useShortcuts', () => ({
  __esModule: true,
  default: () => {},
}));

vi.mock('@/components/WindowButtons', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/user/UserSettingsDialog', () => ({
  __esModule: true,
  default: () => null,
}));

// Bypass the real dropdown-open mechanics: always render a plain button that
// fires onSelectCategory directly, so the test can focus on the query-param
// bug rather than the menu's open/close behavior.
vi.mock('@/app/library/components/SearchCategoryMenu', () => ({
  __esModule: true,
  default: ({ onSelectCategory }: { onSelectCategory: (category: string) => void }) => (
    <button onClick={() => onSelectCategory('title')}>Select Title Category</button>
  ),
}));

let mockSearchParams = '';
// Real next/navigation returns a stable URLSearchParams reference until the
// URL actually changes; recreating it on every call (as a naive mock would)
// makes effects keyed on it re-run every render, which papers over bugs like
// the one this test targets.
let cachedParamsKey: string | null = null;
let cachedParams = new URLSearchParams('');
const pushMock = vi.fn((url: string) => {
  mockSearchParams = url.split('?')[1] ?? '';
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => {
    if (cachedParamsKey !== mockSearchParams) {
      cachedParamsKey = mockSearchParams;
      cachedParams = new URLSearchParams(mockSearchParams);
    }
    return cachedParams;
  },
}));

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1200,
  });
  mockSearchParams = '';
  cachedParamsKey = null;
  pushMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const noop = () => {};

describe('LibraryHeader search category persistence', () => {
  it('keeps the selected category applied to the URL once a query is typed afterwards', () => {
    render(
      <DropdownProvider>
        <LibraryHeader
          isSelectMode={false}
          isSelectAll={false}
          isCloudLibrary={false}
          isDrawerOpen={false}
          onImportBooksFromFiles={noop}
          onOpenCatalogManager={noop}
          onOpenFeeds={noop}
          onToggleSelectMode={noop}
          onSelectAll={noop}
          onDeselectAll={noop}
          onToggleDrawer={noop}
        />
      </DropdownProvider>,
    );

    // Open the search-category dropdown, then select "Title" while the
    // search box is still empty — handleSelectCategory intentionally skips
    // the URL update in this case.
    fireEvent.click(screen.getByLabelText('Search Category'));
    fireEvent.click(screen.getByText('Select Title Category'));

    // Now type into the search box. The placeholder switches to the MyBooks
    // one once a non-local category is selected (see library-header-search-
    // placeholder.test.tsx), so target the search input by that placeholder.
    fireEvent.change(screen.getByPlaceholderText('Search in MyBooks...'), {
      target: { value: 'dune' },
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(pushMock).toHaveBeenCalled();
    const pushedUrl = pushMock.mock.calls.at(-1)![0] as string;
    const params = new URLSearchParams(pushedUrl.split('?')[1]);

    expect(params.get('q')).toBe('dune');
    expect(params.get('cat')).toBe('title');
    expect(params.get('source')).toBe('cloud');
    expect(params.get('type')).toBe('search');
  });

  it('immediately re-runs the search against MyBooks when a category is picked while the box already has text', () => {
    // A fresh element (not a reused reference) on each call — reusing the
    // same element object would make React bail out of re-rendering
    // entirely, defeating the `rerender` below.
    const ui = () => (
      <DropdownProvider>
        <LibraryHeader
          isSelectMode={false}
          isSelectAll={false}
          isCloudLibrary={false}
          isDrawerOpen={false}
          onImportBooksFromFiles={noop}
          onOpenCatalogManager={noop}
          onOpenFeeds={noop}
          onToggleSelectMode={noop}
          onSelectAll={noop}
          onDeselectAll={noop}
          onToggleDrawer={noop}
        />
      </DropdownProvider>
    );
    const { rerender } = render(ui());

    // Type first — still searching the current (local) bookshelf.
    fireEvent.change(screen.getByPlaceholderText('Search Books...'), {
      target: { value: 'dune' },
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // The debounced push landed on the mocked router/URL, but — unlike real
    // Next.js, where useSearchParams is a live context every consumer
    // re-renders from on navigation — this test's plain-function mock only
    // reflects it on the next render. Force that render, mirroring what the
    // real router would already have done by now.
    rerender(ui());
    pushMock.mockClear();

    // Selecting a MyBooks category with text already in the box should fire
    // the search against MyBooks right away, with no further typing needed.
    fireEvent.click(screen.getByLabelText('Search Category'));
    fireEvent.click(screen.getByText('Select Title Category'));

    expect(pushMock).toHaveBeenCalledTimes(1);
    const params = new URLSearchParams(pushMock.mock.calls[0]![0] as string);
    expect(params.get('q')).toBe('dune');
    expect(params.get('cat')).toBe('title');
    expect(params.get('source')).toBe('cloud');
    expect(params.get('type')).toBe('search');
  });
});
