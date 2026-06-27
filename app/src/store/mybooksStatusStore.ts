import { create } from 'zustand';

export type MyBooksConnectionStatus = 'unconfigured' | 'connected' | 'unreachable';

const MYBOOKS_SYNC_ALLOWED_KEY = 'mybooks_sync_allowed';

interface MyBooksStatusState {
  // True once a request to the configured MyBooks host has failed to reach
  // the server (network failure), so the UI can show an offline indicator.
  isOffline: boolean;
  setOffline: (isOffline: boolean) => void;
  // Mirrors the 'mybooks_host' localStorage key so connection status can be
  // derived independently of login state and components can subscribe to it.
  host: string | null;
  setHost: (host: string | null) => void;
  // Mirrors the server's sys.allow.sync flag from /api/user/info, persisted
  // so sync hooks can gate on it without waiting for a fresh fetch. Defaults
  // to true so sync isn't blocked before the first user/info response.
  isSyncAllowed: boolean;
  setSyncAllowed: (isSyncAllowed: boolean) => void;
}

export const useMyBooksStatusStore = create<MyBooksStatusState>((set) => ({
  isOffline: false,
  setOffline: (isOffline) => set({ isOffline }),
  host: typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null,
  setHost: (host) => set({ host }),
  isSyncAllowed:
    typeof window !== 'undefined'
      ? localStorage.getItem(MYBOOKS_SYNC_ALLOWED_KEY) !== 'false'
      : true,
  setSyncAllowed: (isSyncAllowed) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(MYBOOKS_SYNC_ALLOWED_KEY, String(isSyncAllowed));
    }
    set({ isSyncAllowed });
  },
}));

export const useMyBooksConnectionStatus = (): MyBooksConnectionStatus => {
  const host = useMyBooksStatusStore((state) => state.host);
  const isOffline = useMyBooksStatusStore((state) => state.isOffline);
  if (!host) return 'unconfigured';
  return isOffline ? 'unreachable' : 'connected';
};
