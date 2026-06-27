import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('posthog-js', () => ({
  default: { identify: vi.fn() },
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';

describe('AuthContext memoization', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    cleanup();
  });

  test('returns the same context value reference when parent re-renders without state change', () => {
    const captured: ReturnType<typeof useAuth>[] = [];

    function Probe() {
      const value = useAuth();
      captured.push(value);
      return null;
    }

    function Wrapper({ tick }: { tick: number }) {
      // The tick prop forces a parent re-render but does not change AuthProvider state
      return (
        <AuthProvider>
          <span data-tick={tick} />
          <Probe />
        </AuthProvider>
      );
    }

    const { rerender } = render(<Wrapper tick={0} />);
    act(() => {
      rerender(<Wrapper tick={1} />);
    });
    act(() => {
      rerender(<Wrapper tick={2} />);
    });

    // Probe captures one value per render. We expect at least 3 captures.
    expect(captured.length).toBeGreaterThanOrEqual(3);

    // The first capture happens during initial mount (state may settle async),
    // but subsequent captures from parent-only re-renders should reuse the same
    // memoized context value reference. If login/logout/refresh are not stable
    // (no useCallback), useMemo's deps change every render and produce a fresh
    // object each time — this assertion catches that regression.
    const firstStable = captured[captured.length - 2]!;
    const secondStable = captured[captured.length - 1]!;
    expect(secondStable).toBe(firstStable);
  });

  test('login/logout/refresh callbacks are stable across re-renders', () => {
    const captured: ReturnType<typeof useAuth>[] = [];

    function Probe() {
      const value = useAuth();
      captured.push(value);
      return null;
    }

    function Wrapper({ tick }: { tick: number }) {
      return (
        <AuthProvider>
          <span data-tick={tick} />
          <Probe />
        </AuthProvider>
      );
    }

    const { rerender } = render(<Wrapper tick={0} />);
    act(() => {
      rerender(<Wrapper tick={1} />);
    });

    const last = captured[captured.length - 1]!;
    const prev = captured[captured.length - 2]!;
    expect(last.login).toBe(prev.login);
    expect(last.logout).toBe(prev.logout);
    expect(last.refresh).toBe(prev.refresh);
  });
});

describe('AuthContext guest login', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    cleanup();
  });

  function Probe({ onValue }: { onValue: (value: ReturnType<typeof useAuth>) => void }) {
    const value = useAuth();
    onValue(value);
    return null;
  }

  test('loginAsGuest sets isGuest, status, and a sentinel user', () => {
    let current: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <Probe onValue={(v) => (current = v)} />
      </AuthProvider>,
    );

    act(() => {
      current!.loginAsGuest('https://mybooks.example.com');
    });

    expect(current!.isGuest).toBe(true);
    expect(current!.status).toBe('guest');
    expect(current!.user).not.toBeNull();
    expect(current!.host).toBe('https://mybooks.example.com');
    expect(localStorage.getItem('mybooks_is_guest')).toBe('true');
    expect(localStorage.getItem('mybooks_host')).toBe('https://mybooks.example.com');
  });

  test('logout clears guest state', () => {
    let current: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <Probe onValue={(v) => (current = v)} />
      </AuthProvider>,
    );

    act(() => {
      current!.loginAsGuest('https://mybooks.example.com');
    });
    expect(current!.status).toBe('guest');

    act(() => {
      current!.logout();
    });

    expect(current!.isGuest).toBe(false);
    expect(current!.status).toBe('logged_out');
    expect(current!.user).toBeNull();
    expect(localStorage.getItem('mybooks_is_guest')).toBeNull();
  });

  test('status is logged_out with no token/user/guest flag', () => {
    let current: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <Probe onValue={(v) => (current = v)} />
      </AuthProvider>,
    );

    expect(current!.status).toBe('logged_out');
    expect(current!.isGuest).toBe(false);
  });
});

describe('AuthContext isAdmin', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    cleanup();
  });

  function Probe({ onValue }: { onValue: (value: ReturnType<typeof useAuth>) => void }) {
    const value = useAuth();
    onValue(value);
    return null;
  }

  test('defaults to false with no cached user info', () => {
    let current: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <Probe onValue={(v) => (current = v)} />
      </AuthProvider>,
    );

    expect(current!.isAdmin).toBe(false);
  });

  test('initializes from the cached mybooks_user_info admin flag', () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify({ is_admin: true }));
    let current: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <Probe onValue={(v) => (current = v)} />
      </AuthProvider>,
    );

    expect(current!.isAdmin).toBe(true);
  });

  test('setIsAdmin updates the value, and logout clears it', async () => {
    let current: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <Probe onValue={(v) => (current = v)} />
      </AuthProvider>,
    );

    act(() => {
      current!.setIsAdmin(true);
    });
    expect(current!.isAdmin).toBe(true);

    await act(async () => {
      await current!.logout();
    });
    expect(current!.isAdmin).toBe(false);
  });
});
