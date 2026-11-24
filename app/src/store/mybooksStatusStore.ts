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
    const user = JSON.parse(cached) as {
      id?: number;
      is_login?: boolean;
      is_guest?: boolean;
    };
    // Only a logged-in reader's cache may lend out an id: a guest session or
    // a logged-out cache can belong to a previous account, and trusting its
    // id would make the current account's notes look foreign.
    if (user.is_login !== true || user.is_guest === true) return null;
    return Number.isSafeInteger(user.id) && (user.id as number) > 0 ? (user.id as number) : null;
  } catch {
    return null;
  }
};

/**
 * Whether `note`'s author stamp (`BookNote.userId`) belongs to the given
 * logged-in reader. Unstamped notes are local/not-yet-synced and therefore
 * the reader's own; an authored note is only own when the id is known and
 * matches. Unknown identity (null/undefined) is never a match.
 */
export const isOwnBooknoteId = (
  userId: string | undefined,
  currentUserId: number | null | undefined,
): boolean => !userId || (typeof currentUserId === 'number' && userId === String(currentUserId));

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
  setCurrentUserId: (currentUserId) => {
    // `/user/info` does not carry the reader id (see mybooksService's
    // ensureCurrentUserId), so callers may hand us `undefined` at runtime.
    // Never let that clobber a known id: ownership checks treat an unknown id
    // as "someone else's", which would hide the reader's own drawings.
    if (currentUserId === null) {
      set({ currentUserId: null });
      return;
    }
    if (Number.isSafeInteger(currentUserId) && (currentUserId as number) > 0) {
      set({ currentUserId });
    }
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

// Defaults to true (matches the server's own ENABLE_BOOK_REVIEW default —
// see webserver/handlers/base.py) so the review menu item isn't hidden
// before the first /user/info response lands.
export const useMyBooksBookReviewAllowed = (): boolean => {
  const sysInfo = useMyBooksStatusStore((state) => state.sysInfo);
  return sysInfo?.allow?.book_review !== false;
};

export const useMyBooksFolderAllowed = (): boolean => {
  const sysInfo = useMyBooksStatusStore((state) => state.sysInfo);
  return sysInfo?.allow?.folder === true;
};

// Admin sidebar whitelist; undefined/empty means every optional item is shown.
export const useMyBooksSidebarItems = (): string[] | undefined =>
  useMyBooksStatusStore((state) => state.sysInfo?.sidebar_items);

// Whether `note` (a BookNote) belongs to the current mybooks account — notes
// with no `userId` are local/not-yet-synced and treated as the user's own.
export const useIsOwnBooknote = (userId: string | undefined): boolean => {
  const currentUserId = useMyBooksStatusStore((state) => state.currentUserId);
  return isOwnBooknoteId(userId, currentUserId);
};
