'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
  useEffect,
} from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import { clearTauriMyBooksCookie } from '@/services/mybooks/tauriCookieStore';
import posthog from 'posthog-js';

export type LoginStatus = 'logged_out' | 'guest' | 'logged_in';

const GUEST_TOKEN = 'guest';

const createGuestUser = (): User => {
  const now = new Date().toISOString();
  return {
    id: 'guest',
    email: 'guest@local',
    app_metadata: {},
    user_metadata: {},
    aud: '',
    role: '',
    confirmed_at: now,
    created_at: now,
    updated_at: now,
  } as unknown as User;
};

interface AuthContextType {
  token: string | null;
  user: User | null;
  host: string | null;
  isGuest: boolean;
  isAdmin: boolean;
  status: LoginStatus;
  login: (token: string, user: User, host?: string) => void;
  loginAsGuest: (host: string) => void;
  logout: () => void;
  refresh: () => void;
  setIsAdmin: (isAdmin: boolean) => void;
}

const MYBOOKS_USER_INFO_KEY = 'mybooks_user_info';

const readCachedIsAdmin = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const cached = localStorage.getItem(MYBOOKS_USER_INFO_KEY);
    return cached ? Boolean(JSON.parse(cached).is_admin) : false;
  } catch {
    return false;
  }
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  });
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const userJson = localStorage.getItem('user');
      return userJson ? JSON.parse(userJson) : null;
    }
    return null;
  });
  const [host, setHost] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('mybooks_host');
    }
    return null;
  });
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('mybooks_is_guest') === 'true';
    }
    return false;
  });
  const [isAdmin, setIsAdmin] = useState<boolean>(readCachedIsAdmin);

  useEffect(() => {
    // MyReader sessions are managed via cookie-based auth on a custom host,
    // not Supabase. Running the Supabase auth flow for them would call
    // syncSession(null) on refresh failure and wipe the MyReader user state.
    if (typeof window !== 'undefined' && localStorage.getItem('mybooks_host')) {
      return;
    }

    const syncSession = (
      session: { access_token: string; refresh_token: string; user: User } | null,
    ) => {
      if (session) {
        console.log('Syncing session');
        const { access_token, refresh_token, user } = session;
        localStorage.setItem('token', access_token);
        localStorage.setItem('refresh_token', refresh_token);
        localStorage.setItem('user', JSON.stringify(user));
        posthog.identify(user.id);
        setToken(access_token);
        setUser(user);
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      }
    };
    const refreshSession = async () => {
      try {
        await supabase.auth.refreshSession();
      } catch {
        syncSession(null);
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_, session) => {
      syncSession(session);
    });

    refreshSession();
    return () => {
      subscription?.subscription.unsubscribe();
    };
  }, []);

  // setToken / setUser from useState are stable across renders, so the empty
  // deps array is correct. Wrapping in useCallback (and only including stable
  // refs in the deps) is what makes the useMemo below actually memoize the
  // context value — without this, login/logout/refresh would be recreated on
  // every render and the memo would always invalidate.
  const login = useCallback((newToken: string, newUser: User, newHost?: string) => {
    console.log('Logging in');
    setToken(newToken);
    setUser(newUser);
    setIsGuest(false);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    localStorage.removeItem('mybooks_is_guest');
    if (newHost) {
      setHost(newHost);
      localStorage.setItem('mybooks_host', newHost);
      useMyBooksStatusStore.getState().setHost(newHost);
    }
  }, []);

  const loginAsGuest = useCallback((newHost: string) => {
    console.log('Logging in as guest');
    const guestUser = createGuestUser();
    setToken(GUEST_TOKEN);
    setUser(guestUser);
    setIsGuest(true);
    setIsAdmin(false);
    setHost(newHost);
    localStorage.setItem('token', GUEST_TOKEN);
    localStorage.setItem('user', JSON.stringify(guestUser));
    localStorage.setItem('mybooks_is_guest', 'true');
    localStorage.setItem('mybooks_host', newHost);
    useMyBooksStatusStore.getState().setHost(newHost);
  }, []);

  const logout = useCallback(async () => {
    console.log('Logging out');
    try {
      await supabase.auth.refreshSession();
    } catch {
    } finally {
      await supabase.auth.signOut();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('mybooks_user_info');
      localStorage.removeItem('mybooks_is_guest');
      clearTauriMyBooksCookie();
      setToken(null);
      setUser(null);
      setIsGuest(false);
      setIsAdmin(false);
      setHost(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await supabase.auth.refreshSession();
    } catch {}
  }, []);

  const status: LoginStatus = user ? (isGuest ? 'guest' : 'logged_in') : 'logged_out';

  const value = useMemo(
    () => ({
      token,
      user,
      host,
      isGuest,
      isAdmin,
      status,
      login,
      loginAsGuest,
      logout,
      refresh,
      setIsAdmin,
    }),
    [token, user, host, isGuest, isAdmin, status, login, loginAsGuest, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
