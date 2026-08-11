import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LibraryHeader from '@/app/library/components/LibraryHeader';
import { MyBooksApiError } from '@/services/mybooksService';

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
  useAuth: () => ({
    status: 'logged_in',
    isGuest: false,
    setIsAdmin: vi.fn(),
    host: 'https://mybooks.example.com',
  }),
}));

vi.mock('@/store/authUIStore', () => ({
  useAuthUIStore: (selector: (state: { openLoginDialog: () => void }) => unknown) =>
    selector({ openLoginDialog: vi.fn() }),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksConnectionStatus: () => 'connected',
  useMyBooksStatusStore: { getState: () => ({ sysInfo: null }) },
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

const { getUserInfo, refreshTauriAccessCodeCookie } = vi.hoisted(() => ({
  getUserInfo: vi.fn(),
  refreshTauriAccessCodeCookie: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/mybooks/accessCodeRefresh', () => ({ refreshTauriAccessCodeCookie }));

vi.mock('@/services/mybooksService', async () => {
  const actual = await vi.importActual<typeof import('@/services/mybooksService')>(
    '@/services/mybooksService',
  );
  return {
    ...actual,
    checkMyBooksConnectivity: vi.fn(),
    getUserInfo,
    getMyBooksAvatarUrl: () => '',
  };
});

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

vi.mock('@/components/user/AccessCodeDialog', () => ({
  AccessCodeDialog: ({ host }: { host: string }) => (
    <div data-testid='access-code-dialog'>{host}</div>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
  getUserInfo.mockReset();
  refreshTauriAccessCodeCookie.mockReset();
  refreshTauriAccessCodeCookie.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

const noop = () => {};

describe('LibraryHeader — not_invited on startup', () => {
  it('opens the AccessCodeDialog when /user/info reports not_invited', async () => {
    getUserInfo.mockRejectedValue(new MyBooksApiError('not_invited', '需要访问码'));

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

    await waitFor(() => expect(screen.getByTestId('access-code-dialog')).not.toBeNull());
    expect(screen.getByTestId('access-code-dialog').textContent).toBe(
      'https://mybooks.example.com',
    );
  });

  it('does not open the dialog for other errors', async () => {
    getUserInfo.mockRejectedValue(new MyBooksApiError('permission.denied', 'nope'));

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

    await waitFor(() => expect(getUserInfo).toHaveBeenCalled());
    expect(screen.queryByTestId('access-code-dialog')).toBeNull();
  });

  it('silently refreshes the Tauri access-code cookie whenever the session is logged in', async () => {
    getUserInfo.mockResolvedValue(null);

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

    await waitFor(() =>
      expect(refreshTauriAccessCodeCookie).toHaveBeenCalledWith('https://mybooks.example.com'),
    );
  });
});
