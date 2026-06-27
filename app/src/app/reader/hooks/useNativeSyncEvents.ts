import { useEffect } from 'react';
import { ENABLE_SYNC_FEATURE } from '@/services/mybooks/constants';
import { acquireNativeSyncEvents } from '@/services/mybooks/syncEvents';

export type { SyncChangedEvent } from '@/services/mybooks/syncEvents';

/**
 * Maintains the shared Tauri WS notification channel for Readest Native
 * Sync (document/MyBooks_Sync_WS_Design.md §4). Safe to call from every
 * open reader instance — the underlying connection is ref-counted.
 *
 * No-op on Web (the proxy relay isn't implemented yet — see §6 of the
 * design doc) and when sync is disabled or no mybooks account is active.
 */
export const useNativeSyncEvents = (enabled: boolean) => {
  useEffect(() => {
    if (!ENABLE_SYNC_FEATURE || !enabled) return;
    return acquireNativeSyncEvents();
  }, [enabled]);
};

export default useNativeSyncEvents;
