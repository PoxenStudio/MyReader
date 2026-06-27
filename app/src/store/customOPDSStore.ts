import { create } from 'zustand';
import type { EnvConfigType } from '@/services/environment';
import type { OPDSCatalog } from '@/types/opds';
import { useSettingsStore } from './settingsStore';

/**
 * Simple synchronous hash for a URL string, used as the stable
 * cross-device contentId for OPDS catalogs.
 */
const computeOpdsCatalogContentId = (url: string): string => {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
  }
  return `opds:${Math.abs(hash).toString(36)}`;
};

/**
 * Backfill `contentId` (and `addedAt`) on legacy catalogs that predate
 * replica sync. Returns the same array reference if no changes were
 * required so callers can cheaply detect a no-op.
 *
 * `addedAt` is assigned per array index so the existing display order
 * survives the migration: index 0 (newest in the legacy array) gets
 * the largest timestamp, index N gets the smallest. The total span is
 * tiny (≤ N ms) so newly-imported catalogs (with `Date.now()`) still
 * sort above the migrated set, which matches the legacy "prepend new
 * entries" UX.
 */
const backfillSyncFields = (catalogs: OPDSCatalog[]): OPDSCatalog[] => {
  let mutated = false;
  const baseTime = Date.now();
  const next = catalogs.map((c, i) => {
    if (c.contentId && c.addedAt !== undefined) return c;
    mutated = true;
    return {
      ...c,
      contentId: c.contentId ?? computeOpdsCatalogContentId(c.url),
      addedAt: c.addedAt ?? baseTime - i,
    };
  });
  return mutated ? next : catalogs;
};

interface OPDSStoreState {
  catalogs: OPDSCatalog[];
  loading: boolean;

  /** Visible catalogs sorted by `addedAt` descending (newest first). */
  getAvailableCatalogs(): OPDSCatalog[];
  getCatalog(id: string): OPDSCatalog | undefined;
  /** Look up by URL — used for popular-catalog dedup (independent of contentId). */
  findByUrl(url: string): OPDSCatalog | undefined;
  /** Look up by stable cross-device content id. */
  findByContentId(contentId: string): OPDSCatalog | undefined;

  /**
   * Add (or revive) a catalog. Computes `contentId` from URL if absent.
   * Re-import of a previously soft-deleted entry mints a reincarnation
   * token so the server-side tombstone gets replaced rather than stuck.
   */
  addCatalog(catalog: Omit<OPDSCatalog, 'contentId'> & { contentId?: string }): OPDSCatalog;
  /**
   * Patch a catalog's mutable fields. Only the patched fields are
   * republished — credentials (username/password) are NOT in the
   * synced field set yet, so editing them stays local-only until the
   * encrypted-field PR lands.
   */
  updateCatalog(id: string, patch: Partial<OPDSCatalog>): OPDSCatalog | undefined;
  /** Soft-delete by id; pushes a tombstone if the entry has a contentId. */
  removeCatalog(id: string): boolean;

  applyRemoteCatalog(catalog: OPDSCatalog): void;
  softDeleteByContentId(contentId: string): void;

  loadCustomOPDSCatalogs(envConfig: EnvConfigType): Promise<void>;
  saveCustomOPDSCatalogs(envConfig: EnvConfigType): Promise<void>;
}

export const useCustomOPDSStore = create<OPDSStoreState>((set, get) => ({
  catalogs: [],
  loading: false,

  getAvailableCatalogs: () =>
    get()
      .catalogs.filter((c) => !c.deletedAt)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)),

  getCatalog: (id) => get().catalogs.find((c) => c.id === id),

  findByUrl: (url) => {
    const normalized = url.trim().toLowerCase();
    return get().catalogs.find((c) => c.url.trim().toLowerCase() === normalized && !c.deletedAt);
  },

  findByContentId: (contentId) =>
    contentId ? get().catalogs.find((c) => c.contentId === contentId) : undefined,

  addCatalog: (input) => {
    const contentId = input.contentId ?? computeOpdsCatalogContentId(input.url);
    const existing = get().catalogs.find((c) => c.contentId === contentId);
    const reincarnation =
      existing?.deletedAt && !input.reincarnation
        ? Math.random().toString(36).slice(2)
        : input.reincarnation;
    const catalog: OPDSCatalog = {
      ...input,
      contentId,
      addedAt: input.addedAt ?? existing?.addedAt ?? Date.now(),
      deletedAt: undefined,
      reincarnation,
    };
    set((state) => {
      const idx = state.catalogs.findIndex((c) => c.contentId === contentId);
      const catalogs =
        idx >= 0
          ? state.catalogs.map((c, i) => (i === idx ? catalog : c))
          : [...state.catalogs, catalog];
      return { catalogs };
    });
    return catalog;
  },

  updateCatalog: (id, patch) => {
    let updated: OPDSCatalog | undefined;
    set((state) => {
      const idx = state.catalogs.findIndex((c) => c.id === id);
      if (idx < 0) return state;
      const old = state.catalogs[idx]!;
      if (old.deletedAt) return state;
      updated = { ...old, ...patch };
      if (patch.url && patch.url !== old.url) {
        updated.contentId = computeOpdsCatalogContentId(patch.url);
      }
      return {
        catalogs: state.catalogs.map((c, i) => (i === idx ? updated! : c)),
      };
    });
    return updated;
  },

  removeCatalog: (id) => {
    const catalog = get().catalogs.find((c) => c.id === id);
    if (!catalog) return false;
    set((state) => ({
      catalogs: state.catalogs.map((c) => (c.id === id ? { ...c, deletedAt: Date.now() } : c)),
    }));
    return true;
  },

  applyRemoteCatalog: (catalog) => {
    set((state) => {
      const idx = state.catalogs.findIndex((c) => c.contentId === catalog.contentId);
      if (idx >= 0) {
        const old = state.catalogs[idx]!;
        const merged: OPDSCatalog = {
          ...catalog,
          username: catalog.username ?? old.username,
          password: catalog.password ?? old.password,
          lastSeenCipher: catalog.lastSeenCipher ?? old.lastSeenCipher,
          deletedAt: undefined,
        };
        return { catalogs: state.catalogs.map((c, i) => (i === idx ? merged : c)) };
      }
      return { catalogs: [...state.catalogs, catalog] };
    });
  },

  softDeleteByContentId: (contentId) => {
    const target = get().catalogs.find((c) => c.contentId === contentId && !c.deletedAt);
    if (!target) return;
    set((state) => ({
      catalogs: state.catalogs.map((c) =>
        c.id === target.id ? { ...c, deletedAt: Date.now() } : c,
      ),
    }));
  },

  loadCustomOPDSCatalogs: async (_envConfig) => {
    try {
      const { settings } = useSettingsStore.getState();
      const persisted = settings?.opdsCatalogs ?? [];
      const backfilled = backfillSyncFields(persisted);
      set({ catalogs: backfilled });
      if (backfilled !== persisted) {
        await get().saveCustomOPDSCatalogs(_envConfig);
      }
    } catch (error) {
      console.error('Failed to load OPDS catalogs:', error);
    }
  },

  saveCustomOPDSCatalogs: async (_envConfig) => {
    try {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const { catalogs } = get();
      settings.opdsCatalogs = catalogs.filter((c) => !c.deletedAt);
      setSettings(settings);
      saveSettings(_envConfig, settings);
    } catch (error) {
      console.error('Failed to save OPDS catalogs:', error);
      throw error;
    }
  },
}));

/**
 * Look up an OPDS catalog by its cross-device contentId, falling back to
 * the persisted settings when the in-memory store is empty.
 */
export const findOPDSCatalogByContentId = (contentId: string): OPDSCatalog | undefined => {
  if (!contentId) return undefined;
  const inMemory = useCustomOPDSStore.getState().findByContentId(contentId);
  if (inMemory) return inMemory;
  const persisted = useSettingsStore.getState().settings?.opdsCatalogs ?? [];
  return persisted.find((c) => c.contentId === contentId && !c.deletedAt);
};
