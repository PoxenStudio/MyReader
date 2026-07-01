import { describe, expect, it, vi } from 'vitest';

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
  default: () => null,
}));

const { normalizeHost } = await import('@/components/user/LoginDialog');

describe('normalizeHost', () => {
  it('strips a trailing slash', () => {
    expect(normalizeHost('http://example.com/')).toBe('http://example.com');
  });

  it('wraps a bare IPv6 host in brackets', () => {
    expect(normalizeHost('http://240e:3bb:649:646c::72c')).toBe('http://[240e:3bb:649:646c::72c]');
  });

  it('preserves the path when wrapping a bare IPv6 host', () => {
    expect(normalizeHost('http://240e:3bb:649:646c::72c/api')).toBe(
      'http://[240e:3bb:649:646c::72c]/api',
    );
  });

  it('leaves an already-bracketed IPv6 host untouched', () => {
    expect(normalizeHost('http://[240e:3bb:649:646c::72c]:8080')).toBe(
      'http://[240e:3bb:649:646c::72c]:8080',
    );
  });

  it('leaves an IPv4 host with a port untouched', () => {
    expect(normalizeHost('http://192.168.1.1:8080')).toBe('http://192.168.1.1:8080');
  });

  it('leaves a regular domain untouched', () => {
    expect(normalizeHost('https://example.com')).toBe('https://example.com');
  });
});
