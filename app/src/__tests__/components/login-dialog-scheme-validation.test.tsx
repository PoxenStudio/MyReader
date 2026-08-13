import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), loginAsGuest: vi.fn() }),
}));

vi.mock('@/store/authUIStore', () => ({
  useAuthUIStore: (
    selector: (state: { isLoginDialogOpen: boolean; closeLoginDialog: () => void }) => unknown,
  ) => selector({ isLoginDialogOpen: true, closeLoginDialog: vi.fn() }),
}));

vi.mock('@/utils/credentialStorage', () => ({
  MYBOOKS_PASSWORD_KEY: 'mybooks_password',
  getStoredMyBooksPassword: () => null,
  setStoredMyBooksPassword: vi.fn(),
  setSessionMyBooksPassword: vi.fn(),
}));

vi.mock('@/utils/mybooksHistory', () => ({
  getMyBooksHostHistory: () => [],
  addMyBooksHostToHistory: vi.fn(),
  getMyBooksUsernameHistory: () => [],
  addMyBooksUsernameToHistory: vi.fn(),
}));

vi.mock('@/components/user/RegisterDialog', () => ({
  RegisterDialog: () => null,
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/services/mybooks/tauriCookieStore', () => ({
  setTauriMyBooksCookie: vi.fn(),
  extractCookieHeaderFromResponse: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

const settingsStoreState = {
  settings: {},
  setSettings: vi.fn(),
  saveSettings: vi.fn(),
};

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => settingsStoreState, {
    getState: () => settingsStoreState,
  }),
}));

const tauriFetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => tauriFetchMock(...args),
}));

import LoginDialog from '@/components/user/LoginDialog';

const HOST_PLACEHOLDER = 'https://your-mybooks-server.com';

afterEach(() => {
  cleanup();
  tauriFetchMock.mockReset();
});

describe('LoginDialog host scheme validation on sign-in', () => {
  // A host without an http(s):// scheme is not a fetchable absolute URL in
  // Tauri's webview — it resolves against the app's own `tauri://` origin,
  // and tauriFetch (Rust-side, http(s)-only) rejects it with a cryptic
  // "scheme tauri not supported" error. Reject it in the UI first instead.
  it('rejects a scheme-less host with a friendly error and does not call fetch', () => {
    const { getByPlaceholderText, getByText } = render(<LoginDialog />);

    fireEvent.change(getByPlaceholderText(HOST_PLACEHOLDER), {
      target: { value: '192.168.31.33:9000' },
    });
    fireEvent.change(getByPlaceholderText('Your username'), {
      target: { value: 'alice' },
    });
    fireEvent.change(getByPlaceholderText('Your password'), {
      target: { value: 'secret' },
    });

    fireEvent.click(getByText('Sign In'));

    expect(getByText('Please enter a valid http/https host address')).toBeTruthy();
    expect(tauriFetchMock).not.toHaveBeenCalled();
  });

  it('proceeds to fetch when the host includes a valid scheme', () => {
    tauriFetchMock.mockResolvedValue({
      status: 200,
      clone: () => ({ json: async () => ({ err: 'ok', data: { user_id: 1 } }) }),
    });

    const { getByPlaceholderText, getByText, queryByText } = render(<LoginDialog />);

    fireEvent.change(getByPlaceholderText(HOST_PLACEHOLDER), {
      target: { value: 'http://192.168.31.33:9000' },
    });
    fireEvent.change(getByPlaceholderText('Your username'), {
      target: { value: 'alice' },
    });
    fireEvent.change(getByPlaceholderText('Your password'), {
      target: { value: 'secret' },
    });

    fireEvent.click(getByText('Sign In'));

    expect(queryByText('Please enter a valid http/https host address')).toBeNull();
    expect(tauriFetchMock).toHaveBeenCalled();
  });
});
