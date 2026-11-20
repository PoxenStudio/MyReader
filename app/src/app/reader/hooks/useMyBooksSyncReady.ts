import { useAuth } from '@/context/AuthContext';
import { ENABLE_SYNC_FEATURE } from '@/services/mybooks/constants';
import { useMyBooksSyncAllowed } from '@/store/mybooksStatusStore';

/**
 * Whether MyBooks record sync can run for this session.
 *
 * Shared by `useNativeSync` (which gates the actual pull/push) and
 * `FoliateViewer` (which gates raw-anchor construction and the on-open repair).
 * Building anchors is not free — it parses and normalizes a whole section — so
 * readers who are not logged into MyBooks must not pay for it.
 */
export const useMyBooksSyncReady = (): boolean => {
  const { status, isGuest } = useAuth();
  const isSyncAllowed = useMyBooksSyncAllowed();
  return ENABLE_SYNC_FEATURE && status === 'logged_in' && !isGuest && isSyncAllowed;
};

export default useMyBooksSyncReady;
