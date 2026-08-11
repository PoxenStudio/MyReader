import { create } from 'zustand';
import type { MyBooksSysInfo } from '@/services/mybooksService';

export type MyBooksConnectionStatus = 'unconfigured' | 'connected' | 'unreachable';

const MYBOOKS_SYS_INFO_KEY = 'mybooks_sys_info';
const MYBOOKS_SHOW_OTHER_ANNOTATIONS_KEY = 'mybooks_show_other_annotations';

const readCachedSysInfo = (): MyBooksSysInfo | null => {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(MYBOOKS_SYS_INFO_KEY);
    return cached ? (JSON.parse(cached) as MyBooksSysInfo) : null;
  } catch {
    return null;
  }
};

// Defaults to true (matches the server's default, see plan/Social_Reading_Plan.md
// §2.2) so annotations aren't hidden before the first /user/info response lands.
const readCachedShowOtherAnnotations = (): boolean => {
  if (typeof window === 'undefined') return true;
  const cached = localStorage.getItem(MYBOOKS_SHOW_OTHER_ANNOTATIONS_KEY);
  return cached === null ? true : cached === 'true';
};

const readCachedCurrentUserId = (): number | null => {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem('mybooks_user_info');
    if (!cached) return null;
    const user = JSON.parse(cached) as { id?: number };
    return typeof user.id === 'number' ? user.id : null;
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
  // Whether to show other users' annotations while reading (mirrors the
  // account's `show_other_annotations` field from /user/info, see
  // plan/Social_Reading_Plan.md §2.2). Drives the `own` param on
  // `/api/sync` pulls — see useNativeSync.ts.
  showOtherAnnotations: boolean;
  setShowOtherAnnotations: (showOtherAnnotations: boolean) => void;
  // The current mybooks account's numeric id, mirrored here (from the same
  // `mybooks_user_info` cache AuthContext reads for `is_admin`) so ownership
  // checks against a note's `userId` (see BookNote) can be done
  // synchronously, without a component-local fetch.
  currentUserId: number | null;
  setCurrentUserId: (currentUserId: number | null) => void;
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
  showOtherAnnotations: readCachedShowOtherAnnotations(),
  setShowOtherAnnotations: (showOtherAnnotations) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(MYBOOKS_SHOW_OTHER_ANNOTATIONS_KEY, String(showOtherAnnotations));
    }
    set({ showOtherAnnotations });
  },
  currentUserId: readCachedCurrentUserId(),
  setCurrentUserId: (currentUserId) => set({ currentUserId }),
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

// Whether `note` (a BookNote) belongs to the current mybooks account — notes
// with no `userId` are local/not-yet-synced and treated as the user's own.
export const useIsOwnBooknote = (userId: string | undefined): boolean => {
  const currentUserId = useMyBooksStatusStore((state) => state.currentUserId);
  return !userId || (currentUserId !== null && userId === String(currentUserId));
};
