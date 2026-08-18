import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

// Bypass the real dropdown-open mechanics: always render plain buttons that
// fire onSelectCategory directly, so the test can focus on the placeholder
// behavior rather than the menu's open/close mechanics.
vi.mock('@/app/library/components/SearchCategoryMenu', () => ({
  __esModule: true,
  default: ({ onSelectCategory }: { onSelectCategory: (category: string) => void }) => (
    <>
      <button onClick={() => onSelectCategory('title')}>Select Title Category</button>
      <button onClick={() => onSelectCategory('local')}>Select Local Category</button>
    </>
  ),
}));

let mockSearchParams = '';
// Real next/navigation returns a stable URLSearchParams reference until the
// URL actually changes; recreating it on every call would make the
// searchParams-keyed effect in LibraryHeader re-run every render and reset
// searchCategory back to 'local', papering over the bug under test.
let cachedParamsKey: string | null = null;
let cachedParams = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
});

afterEach(() => {
  cleanup();
});

const noop = () => {};

describe('LibraryHeader search placeholder', () => {
  it('shows the MyBooks placeholder when a non-local category is selected, and the bookshelf one for local', () => {
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

    expect(screen.getByPlaceholderText('Search Books...')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Search Category'));
    fireEvent.click(screen.getByText('Select Title Category'));

    expect(screen.queryByPlaceholderText('Search Books...')).toBeNull();
    expect(screen.getByPlaceholderText('Search in MyBooks...')).not.toBeNull();

    // The dropdown is still open from the previous selection (the mocked
    // menu doesn't close it on select), so no need to reopen it.
    fireEvent.click(screen.getByText('Select Local Category'));

    expect(screen.queryByPlaceholderText('Search in MyBooks...')).toBeNull();
    expect(screen.getByPlaceholderText('Search Books...')).not.toBeNull();
  });
});
