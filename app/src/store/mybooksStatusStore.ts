import { create } from 'zustand';
import type { MyBooksSysInfo } from '@/services/mybooksService';

export type MyBooksConnectionStatus = 'unconfigured' | 'connected' | 'unreachable';

const MYBOOKS_SYS_INFO_KEY = 'mybooks_sys_info';

const readCachedSysInfo = (): MyBooksSysInfo | null => {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(MYBOOKS_SYS_INFO_KEY);
    return cached ? (JSON.parse(cached) as MyBooksSysInfo) : null;
  } catch {
    return null;
  }
};

interface MyBooksStatusState {
  // True once a request to the configured MyBooks host has failed to reach
  // the server (network failure), so the UI can show an offline indicator.
  isOffline: boolean;
  setOffline: (isOffline: boolean) => void;
  // Mirrors the 'mybooks_host' localStorage key so connection status can be
  // derived independently of login state and components can subscribe to it.
  host: string | null;
  setHost: (host: string | null) => void;
  // The server's `sys` block from the latest /api/user/info response
  // (title, version, allow.sync, ...), persisted so it survives reload and
  // is available outside React (mybooksService fetches run there) without
  // waiting on a component-local fetch.
  sysInfo: MyBooksSysInfo | null;
  setSysInfo: (sysInfo: MyBooksSysInfo) => void;
}

export const useMyBooksStatusStore = create<MyBooksStatusState>((set) => ({
  isOffline: false,
  setOffline: (isOffline) => set({ isOffline }),
  host: typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null,
  setHost: (host) => set({ host }),
  sysInfo: readCachedSysInfo(),
  setSysInfo: (sysInfo) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(MYBOOKS_SYS_INFO_KEY, JSON.stringify(sysInfo));
    }
    set({ sysInfo });
  },
}));

export const useMyBooksConnectionStatus = (): MyBooksConnectionStatus => {
  const host = useMyBooksStatusStore((state) => state.host);
  const isOffline = useMyBooksStatusStore((state) => state.isOffline);
  if (!host) return 'unconfigured';
  return isOffline ? 'unreachable' : 'connected';
};

// Defaults to true so sync isn't blocked before the first user/info response.
export const useMyBooksSyncAllowed = (): boolean => {
  const sysInfo = useMyBooksStatusStore((state) => state.sysInfo);
  return sysInfo?.allow?.sync !== false;
};
