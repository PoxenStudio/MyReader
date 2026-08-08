import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const logoutMock = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ logout: logoutMock }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false } }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { nas: undefined },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  }),
}));

vi.mock('@/services/mybooks/nasCookieStore', () => ({
  setNasCookies: vi.fn(),
}));

const signOutMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/mybooksService', () => ({
  getUserDetailInfo: vi.fn().mockResolvedValue(null),
  getCachedUserDetailInfo: vi.fn().mockReturnValue(null),
  updateUserSettings: vi.fn(),
  uploadUserAvatar: vi.fn(),
  getMyBooksAvatarUrl: vi.fn(),
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksStatusStore: (selector: (s: { sysInfo: null }) => unknown) =>
    selector({ sysInfo: null }),
  useMyBooksSyncAllowed: () => false,
}));

vi.mock('@/components/nas/NasRemoteWebview', () => ({ default: () => null }));
vi.mock('@/components/nas/NasRemoteLoginIconButton', () => ({ default: () => null }));
vi.mock('@/components/user/ReadingStatsCard', () => ({ default: () => null }));
vi.mock('@/components/UserAvatar', () => ({ default: () => null }));

import UserSettingsDialog from '@/components/user/UserSettingsDialog';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UserSettingsDialog sign-out', () => {
  beforeEach(() => {
    signOutMock.mockResolvedValue(undefined);
  });

  it('sends the shelf back to the local library once signed out', async () => {
    const { findByText } = render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(await findByText('Sign Out'));

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalled();
    });
    expect(pushMock).toHaveBeenCalledWith('/library?source=local');
  });

  it('still resets the shelf even when the sign-out API call fails', async () => {
    signOutMock.mockRejectedValue(new Error('network down'));
    const { findByText } = render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(await findByText('Sign Out'));

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalled();
    });
    expect(pushMock).toHaveBeenCalledWith('/library?source=local');
  });
});
