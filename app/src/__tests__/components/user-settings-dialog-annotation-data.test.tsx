import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
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

const h = vi.hoisted(() => ({
  detailUser: {
    id: 1,
    username: 'alice',
    nickname: 'Alice',
    email: 'alice@example.com',
    avatar: '',
    is_admin: false,
    is_login: true,
    is_guest: false,
    is_active: true,
    podcast_token: '',
    show_other_annotations: false,
  },
  updateUserSettingsMock: vi.fn().mockResolvedValue(undefined),
  setShowOtherAnnotationsMock: vi.fn(),
}));
const { updateUserSettingsMock, setShowOtherAnnotationsMock } = h;

vi.mock('@/services/mybooksService', () => ({
  getUserDetailInfo: vi.fn().mockResolvedValue({ user: h.detailUser, sys: null }),
  getCachedUserDetailInfo: vi.fn().mockReturnValue(null),
  updateUserSettings: (...args: unknown[]) => h.updateUserSettingsMock(...args),
  uploadUserAvatar: vi.fn(),
  getMyBooksAvatarUrl: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksStatusStore: Object.assign(
    (selector: (s: { sysInfo: null }) => unknown) => selector({ sysInfo: null }),
    { getState: () => ({ setShowOtherAnnotations: h.setShowOtherAnnotationsMock }) },
  ),
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

describe('UserSettingsDialog — Annotation Data', () => {
  beforeEach(() => {
    updateUserSettingsMock.mockResolvedValue(undefined);
  });

  it('preloads the toggle from show_other_annotations and submits the flipped value on save', async () => {
    const { findByLabelText, findByText } = render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    const toggle = (await findByLabelText(
      'Show other users’ annotations while reading',
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    fireEvent.click(await findByText('Save'));

    await waitFor(() => {
      expect(updateUserSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ show_other_annotations: true }),
      );
    });
    expect(setShowOtherAnnotationsMock).toHaveBeenCalledWith(true);
  });
});
