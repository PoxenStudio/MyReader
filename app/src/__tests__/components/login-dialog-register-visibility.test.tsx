import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import LoginDialog from '@/components/user/LoginDialog';

const REGISTER_LABEL = 'Register';
const HOST_PLACEHOLDER = 'https://your-mybooks-server.com';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe('LoginDialog register button visibility', () => {
  it('hides the Register button once the host reports allow.register === false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', sys: { allow: { register: false, read: true } } }),
    } as Response);

    const { container, getByPlaceholderText } = render(<LoginDialog />);
    const hostInput = getByPlaceholderText(HOST_PLACEHOLDER);

    fireEvent.change(hostInput, { target: { value: 'https://mybooks.example.com' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).not.toContain(REGISTER_LABEL);
  });

  it('keeps the Register button visible when allow.register is true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok', sys: { allow: { register: true, read: true } } }),
    } as Response);

    const { container, getByPlaceholderText } = render(<LoginDialog />);
    const hostInput = getByPlaceholderText(HOST_PLACEHOLDER);

    fireEvent.change(hostInput, { target: { value: 'https://mybooks.example.com' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain(REGISTER_LABEL);
  });

  it('keeps the Register button visible by default before any host check resolves', () => {
    const { container } = render(<LoginDialog />);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain(REGISTER_LABEL);
  });
});
