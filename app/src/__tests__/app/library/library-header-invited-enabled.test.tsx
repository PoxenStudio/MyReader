import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const { sysInfo, hasTauriMyBooksCookieNamed, isTauriAppPlatform } = vi.hoisted(() => ({
  sysInfo: { current: null as { invited_enabled?: boolean } | null },
  hasTauriMyBooksCookieNamed: vi.fn(() => false),
  isTauriAppPlatform: vi.fn(() => true),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksConnectionStatus: () => 'connected',
  useMyBooksStatusStore: { getState: () => ({ sysInfo: sysInfo.current }) },
}));

vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform };
});

vi.mock('@/services/mybooks/tauriCookieStore', () => ({ hasTauriMyBooksCookieNamed }));

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
  getUserInfo.mockResolvedValue(null);
  refreshTauriAccessCodeCookie.mockClear();
  refreshTauriAccessCodeCookie.mockResolvedValue(undefined);
  hasTauriMyBooksCookieNamed.mockReset();
  hasTauriMyBooksCookieNamed.mockReturnValue(false);
  isTauriAppPlatform.mockReturnValue(true);
  sysInfo.current = null;
});

afterEach(() => {
  cleanup();
});

const noop = () => {};

const renderHeader = () =>
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

describe('LibraryHeader — proactive access-code prompt via sys.invited_enabled', () => {
  it('prompts when the site has invite mode on and mybooks_tauri_cookie still lacks invited', async () => {
    sysInfo.current = { invited_enabled: true };
    hasTauriMyBooksCookieNamed.mockReturnValue(false);

    renderHeader();

    await waitFor(() => expect(screen.getByTestId('access-code-dialog')).not.toBeNull());
  });

  it('does not prompt when invited is already present in mybooks_tauri_cookie', async () => {
    sysInfo.current = { invited_enabled: true };
    hasTauriMyBooksCookieNamed.mockReturnValue(true);

    renderHeader();

    await waitFor(() => expect(getUserInfo).toHaveBeenCalled());
    expect(screen.queryByTestId('access-code-dialog')).toBeNull();
  });

  it('does not prompt when the site has invite mode off', async () => {
    sysInfo.current = { invited_enabled: false };
    hasTauriMyBooksCookieNamed.mockReturnValue(false);

    renderHeader();

    await waitFor(() => expect(getUserInfo).toHaveBeenCalled());
    expect(screen.queryByTestId('access-code-dialog')).toBeNull();
  });

  it('does not prompt on the web platform even when invited is missing', async () => {
    isTauriAppPlatform.mockReturnValue(false);
    sysInfo.current = { invited_enabled: true };
    hasTauriMyBooksCookieNamed.mockReturnValue(false);

    renderHeader();

    await waitFor(() => expect(getUserInfo).toHaveBeenCalled());
    expect(screen.queryByTestId('access-code-dialog')).toBeNull();
  });

  it('gives refreshTauriAccessCodeCookie a chance to run before checking', async () => {
    sysInfo.current = { invited_enabled: true };
    hasTauriMyBooksCookieNamed.mockReturnValue(false);

    renderHeader();

    await waitFor(() =>
      expect(refreshTauriAccessCodeCookie).toHaveBeenCalledWith('https://mybooks.example.com'),
    );
    // refreshTauriAccessCodeCookie must resolve before fetchUserInfo/getUserInfo runs.
    const refreshOrder = refreshTauriAccessCodeCookie.mock.invocationCallOrder[0]!;
    const getUserInfoOrder = getUserInfo.mock.invocationCallOrder[0]!;
    expect(refreshOrder).toBeLessThan(getUserInfoOrder);
  });
});
