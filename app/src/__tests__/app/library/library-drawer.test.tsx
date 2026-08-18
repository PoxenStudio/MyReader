import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibraryDrawer from '@/app/library/components/LibraryDrawer';

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

let mockAuthStatus: 'logged_out' | 'logged_in' = 'logged_out';
let mockConnectionStatus: 'unconfigured' | 'connected' = 'unconfigured';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ status: mockAuthStatus }),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksConnectionStatus: () => mockConnectionStatus,
}));

vi.mock('@/components/user/UserSettingsDialog', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/user/DeviceManagementDialog', () => ({
  __esModule: true,
  default: () => null,
}));

let mockPathname = '/library';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  mockAuthStatus = 'logged_out';
  mockConnectionStatus = 'unconfigured';
});

describe('LibraryDrawer', () => {
  it('marks Home as active when pathname is /library with no source param', () => {
    mockPathname = '/library';
    render(<LibraryDrawer isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Home').closest('a')?.className).toContain('text-primary');
  });

  it('marks Home as active on startup when pathname is the root path', () => {
    mockPathname = '/';
    render(<LibraryDrawer isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Home').closest('a')?.className).toContain('text-primary');
  });

  it('does not fire onNavigate when clicking Home while already on the local bookshelf', () => {
    // Regression test: onNavigate flips a "cloud books loading" flag that is
    // only cleared once the URL (searchParams) actually changes. Clicking a
    // link identical to the current one doesn't navigate, so firing
    // onNavigate here would leave that flag stuck true forever, hiding the
    // (already-loaded, local) bookshelf behind a permanent spinner.
    mockPathname = '/library';
    const onNavigate = vi.fn();
    render(<LibraryDrawer isOpen onClose={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Home'));

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('still fires onNavigate when clicking a link that actually changes the view', () => {
    mockPathname = '/library';
    mockAuthStatus = 'logged_in';
    mockConnectionStatus = 'connected';
    const onNavigate = vi.fn();
    render(<LibraryDrawer isOpen onClose={vi.fn()} onNavigate={onNavigate} />);

    // Expand the "Reading Information" group, then pick a cloud section.
    fireEvent.click(screen.getByText('Reading Information'));
    fireEvent.click(screen.getByText('My Favorites'));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
