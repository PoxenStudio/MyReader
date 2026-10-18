import { create } from 'zustand';
import { getMyNexusAvailability } from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';

// How long a probed per-book availability stays valid before re-checking.
const AVAILABILITY_TTL_MS = 5 * 60 * 1000;

interface MyNexusAvailabilityEntry {
  available: boolean;
  fetchedAt: number;
}

interface MyNexusState {
  availability: Record<number, MyNexusAvailabilityEntry>;
  loading: Record<number, boolean>;
  loadAvailability: (bookId: number, force?: boolean) => Promise<boolean>;
}

// Whether the site has MyNexus on at all; the per-book probe is gated on this.
export const useMyNexusEnabled = (): boolean =>
  useMyBooksStatusStore((state) => state.sysInfo?.mynexus_enabled === true);

export const useMyNexusAvailability = (bookId: number | undefined): boolean => {
  const available = useMyNexusStore((state) => (bookId ? state.availability[bookId] : undefined));
  return available?.available === true;
};

export const useMyNexusStore = create<MyNexusState>((set, get) => ({
  availability: {},
  loading: {},
  loadAvailability: async (bookId, force = false) => {
    if (!bookId) return false;
    if (useMyBooksStatusStore.getState().sysInfo?.mynexus_enabled !== true) return false;

    const entry = get().availability[bookId];
    if (!force && entry && Date.now() - entry.fetchedAt < AVAILABILITY_TTL_MS) {
      return entry.available;
    }
    if (get().loading[bookId]) return entry?.available ?? false;

    set((state) => ({ loading: { ...state.loading, [bookId]: true } }));
    try {
      const { available } = await getMyNexusAvailability(bookId);
      console.log(`[MyNexus] availability for book ${bookId}: ${available}`);
      set((state) => ({
        availability: { ...state.availability, [bookId]: { available, fetchedAt: Date.now() } },
      }));
      return available;
    } catch (error) {
      console.error(
        `[MyNexus] availability probe for book ${bookId} failed:`,
        error instanceof Error ? error.message : error,
      );
      set((state) => ({
        availability: {
          ...state.availability,
          [bookId]: { available: false, fetchedAt: Date.now() },
        },
      }));
      return false;
    } finally {
      set((state) => ({ loading: { ...state.loading, [bookId]: false } }));
    }
  },
}));
