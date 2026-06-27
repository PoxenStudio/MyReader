import { cleanup, render, screen } from '@testing-library/react';
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

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ status: 'logged_out' }),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksConnectionStatus: () => 'unconfigured',
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
});
