import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LibraryHeader from '@/app/library/components/LibraryHeader';

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
  useEnv: () => ({ appService: { isMobile: true, hasSafeAreaInset: false } }),
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

let mockSearchParams = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearchParams),
}));

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
  mockSearchParams = '';
});

afterEach(() => {
  cleanup();
});

const noop = () => {};

describe('LibraryHeader mobile search', () => {
  it('hides the search input by default and reveals it after tapping the search icon, then hides it again on second tap', () => {
    render(
      <LibraryHeader
        isSelectMode={false}
        isSelectAll={false}
        isCloudLibrary={false}
        onImportBooksFromFiles={noop}
        onOpenCatalogManager={noop}
        onToggleSelectMode={noop}
        onSelectAll={noop}
        onDeselectAll={noop}
        onToggleDrawer={noop}
      />,
    );

    expect(screen.queryByPlaceholderText('Search Books...')).toBeNull();

    fireEvent.click(screen.getByLabelText('Search Books'));
    expect(screen.queryByPlaceholderText('Search Books...')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Search Books'));
    expect(screen.queryByPlaceholderText('Search Books...')).toBeNull();
  });

  it('shows the current bookshelf name where the search box would be, and hides it while searching', () => {
    mockSearchParams = 'source=cloud&type=favorites';

    render(
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
      />,
    );

    expect(screen.getByText('My Favorites')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Search Books'));
    expect(screen.queryByText('My Favorites')).toBeNull();
  });
});
