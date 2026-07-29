import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { BUILTIN_WEB_SEARCH_IDS } from '@/services/dictionaries/types';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';

const ZERO = (s: string) => s.startsWith('web:builtin:');

describe('customDictionaryStore — web search CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset state to defaults so tests don't bleed.
    useCustomDictionaryStore.setState({
      dictionaries: [],
      settings: {
        providerOrder: [
          BUILTIN_WEB_SEARCH_IDS.google,
          BUILTIN_WEB_SEARCH_IDS.urban,
          BUILTIN_WEB_SEARCH_IDS.merriamWebster,
        ],
        providerEnabled: {
          [BUILTIN_WEB_SEARCH_IDS.google]: false,
          [BUILTIN_WEB_SEARCH_IDS.urban]: false,
          [BUILTIN_WEB_SEARCH_IDS.merriamWebster]: false,
        },
        webSearches: [],
      },
    });
  });

  it('seeds the three built-in web ids in default order, all disabled', () => {
    const { settings } = useCustomDictionaryStore.getState();
    const builtinWeb = settings.providerOrder.filter(ZERO);
    expect(builtinWeb).toEqual([
      BUILTIN_WEB_SEARCH_IDS.google,
      BUILTIN_WEB_SEARCH_IDS.urban,
      BUILTIN_WEB_SEARCH_IDS.merriamWebster,
    ]);
    for (const id of builtinWeb) {
      expect(settings.providerEnabled[id]).toBe(false);
    }
  });

  it('addWebSearch appends to order, enables, returns the entry', () => {
    const { addWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('My Site', 'https://example.com/?q=%WORD%');
    expect(entry.id.startsWith('web:')).toBe(true);
    expect(entry.id.startsWith('web:builtin:')).toBe(false);
    expect(entry.name).toBe('My Site');
    expect(entry.urlTemplate).toBe('https://example.com/?q=%WORD%');

    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(entry.id)).toBe(true);
    expect(after.providerEnabled[entry.id]).toBe(true);
    expect((after.webSearches ?? []).map((w) => w.id)).toEqual([entry.id]);
  });

  it('addWebSearch trims whitespace from name and URL', () => {
    const { addWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('  Spaced Name  ', '   https://x.com/?q=%WORD%   ');
    expect(entry.name).toBe('Spaced Name');
    expect(entry.urlTemplate).toBe('https://x.com/?q=%WORD%');
  });

  it('updateWebSearch updates name + URL of a custom entry', () => {
    const { addWebSearch, updateWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('Old', 'https://old.com/?q=%WORD%');
    updateWebSearch(entry.id, { name: 'New', urlTemplate: 'https://new.com/?q=%WORD%' });
    const list = useCustomDictionaryStore.getState().settings.webSearches ?? [];
    const updated = list.find((w) => w.id === entry.id);
    expect(updated?.name).toBe('New');
    expect(updated?.urlTemplate).toBe('https://new.com/?q=%WORD%');
  });

  it('updateWebSearch is a no-op for built-in ids', () => {
    const { updateWebSearch, settings } = useCustomDictionaryStore.getState();
    updateWebSearch(BUILTIN_WEB_SEARCH_IDS.google, { name: 'Hijacked' });
    // No `webSearches` entry was added or modified.
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.webSearches).toEqual(settings.webSearches ?? []);
  });

  it('removeWebSearch soft-deletes a custom entry and removes it from order/enabled', () => {
    const { addWebSearch, removeWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('Tmp', 'https://tmp.com/?q=%WORD%');
    expect(removeWebSearch(entry.id)).toBe(true);
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(entry.id)).toBe(false);
    expect(entry.id in after.providerEnabled).toBe(false);
    const found = (after.webSearches ?? []).find((w) => w.id === entry.id);
    expect(found?.deletedAt).toBeGreaterThan(0);
  });

  it('removeWebSearch refuses built-in ids', () => {
    const { removeWebSearch } = useCustomDictionaryStore.getState();
    expect(removeWebSearch(BUILTIN_WEB_SEARCH_IDS.google)).toBe(false);
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(BUILTIN_WEB_SEARCH_IDS.google)).toBe(true);
  });

  it('addDictionary inserts the new id at the TOP of providerOrder so the user sees it first', () => {
    // Seed an established order — builtins + an existing import.
    useCustomDictionaryStore.setState({
      dictionaries: [],
      settings: {
        providerOrder: ['builtin:wiktionary', 'builtin:wikipedia', 'imp-old'],
        providerEnabled: {
          'builtin:wiktionary': true,
          'builtin:wikipedia': true,
          'imp-old': true,
        },
        webSearches: [],
      },
    });

    const { addDictionary } = useCustomDictionaryStore.getState();
    addDictionary({
      id: 'imp-new',
      contentId: 'content-imp-new',
      kind: 'mdict',
      name: 'New Import',
      bundleDir: 'imp-new',
      files: { mdx: 'imp-new.mdx' },
      addedAt: Date.now(),
    });

    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder).toEqual([
      'imp-new',
      'builtin:wiktionary',
      'builtin:wikipedia',
      'imp-old',
    ]);
    expect(after.providerEnabled['imp-new']).toBe(true);
  });

  it('addDictionary that revives a previously soft-deleted entry does not duplicate it in providerOrder', () => {
    useCustomDictionaryStore.setState({
      dictionaries: [
        {
          id: 'imp-existing',
          contentId: 'content-existing',
          kind: 'mdict',
          name: 'Existing',
          bundleDir: 'imp-existing',
          files: { mdx: 'x.mdx' },
          addedAt: 1,
          deletedAt: 999,
        },
      ],
      settings: {
        providerOrder: ['builtin:wikipedia', 'imp-existing'],
        providerEnabled: { 'builtin:wikipedia': true, 'imp-existing': true },
        webSearches: [],
      },
    });

    const { addDictionary } = useCustomDictionaryStore.getState();
    addDictionary({
      id: 'imp-existing',
      contentId: 'content-existing',
      kind: 'mdict',
      name: 'Existing Reborn',
      bundleDir: 'imp-existing',
      files: { mdx: 'x.mdx' },
      addedAt: 2,
    });

    const after = useCustomDictionaryStore.getState().settings;
    // Already in providerOrder — keep its existing slot rather than
    // duplicating at the top.
    expect(after.providerOrder).toEqual(['builtin:wikipedia', 'imp-existing']);
  });

  it('updateDictionary patches the display name (trimmed) and ignores empty / unchanged input', () => {
    const { addDictionary, updateDictionary } = useCustomDictionaryStore.getState();
    addDictionary({
      id: 'mdict:abc',
      kind: 'mdict',
      name: 'Title (No HTML code allowed)',
      bundleDir: 'abc',
      files: { mdx: 'abc.mdx' },
      addedAt: 1,
    });

    updateDictionary('mdict:abc', { name: '  Webster MW11  ' });
    let dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Same name (no-op).
    updateDictionary('mdict:abc', { name: 'Webster MW11' });
    dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Empty / whitespace patch is rejected — keep existing name.
    updateDictionary('mdict:abc', { name: '   ' });
    dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Unknown id: silent no-op.
    expect(() => updateDictionary('mdict:nope', { name: 'X' })).not.toThrow();
  });
});

describe('customDictionaryStore — saveCustomDictionaries reference identity (PR 6)', () => {
  it('replaces useSettingsStore.settings with a NEW reference so subscribers fire', async () => {
    // Seed the settings store with a real reducer so setSettings actually
    // writes the new reference back.
    type SettingsState = ReturnType<typeof useSettingsStore.getState>;
    useSettingsStore.setState({
      settings: {
        customDictionaries: [],
        dictionarySettings: {
          providerOrder: ['a', 'b'],
          providerEnabled: { a: true, b: true },
          webSearches: [],
        },
      } as unknown as SettingsState['settings'],
      setSettings: (s: SettingsState['settings']) => useSettingsStore.setState({ settings: s }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as SettingsState);

    useCustomDictionaryStore.setState({
      ...useCustomDictionaryStore.getState(),
      dictionaries: [],
      settings: {
        providerOrder: ['b', 'a'], // reordered locally
        providerEnabled: { a: true, b: true },
        webSearches: [],
      },
    });

    const before = useSettingsStore.getState().settings;
    await useCustomDictionaryStore
      .getState()
      .saveCustomDictionaries({ name: 'env' } as unknown as EnvConfigType);
    const after = useSettingsStore.getState().settings;

    // The whole point: the post-save settings reference must be NEW
    // so the replicaSettingsSync subscriber sees state.settings !==
    // prev.settings and runs the publish diff. Mutating in place
    // bypasses the subscriber and the reorder never syncs.
    expect(after).not.toBe(before);
    // …and the new reference reflects the reorder.
    expect(after.dictionarySettings.providerOrder).toEqual(['b', 'a']);
  });
});

describe('customDictionaryStore — loadCustomDictionaries reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prunes providerOrder + providerEnabled entries whose customDictionaries row is tombstoned', async () => {
    type SettingsState = ReturnType<typeof useSettingsStore.getState>;
    useSettingsStore.setState({
      settings: {
        customDictionaries: [
          {
            id: 'imp1',
            contentId: 'content-imp1',
            kind: 'mdict',
            name: 'Stale',
            bundleDir: 'imp1',
            files: { mdx: 'imp1.mdx' },
            addedAt: 1,
            deletedAt: 999,
          },
        ],
        dictionarySettings: {
          providerOrder: ['builtin:wikipedia', 'imp1'],
          providerEnabled: { 'builtin:wikipedia': true, imp1: true },
          webSearches: [],
        },
      } as unknown as SettingsState['settings'],
    } as unknown as SettingsState);

    const fakeAppService = { exists: vi.fn().mockResolvedValue(false) };
    const fakeEnv = {
      getAppService: () => Promise.resolve(fakeAppService),
    } as unknown as EnvConfigType;

    await useCustomDictionaryStore.getState().loadCustomDictionaries(fakeEnv);

    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes('imp1')).toBe(false);
    expect('imp1' in after.providerEnabled).toBe(false);
    // Builtins remain untouched.
    expect(after.providerOrder.includes('builtin:wikipedia')).toBe(true);
    expect(after.providerEnabled['builtin:wikipedia']).toBe(true);
  });

  it('keeps providerOrder + providerEnabled entries with no matching customDictionaries row (in-flight pull)', async () => {
    // Conservative reconciliation: an id with no corresponding row at all
    // might be in-flight via the replica pull. Don't prune it.
    type SettingsState = ReturnType<typeof useSettingsStore.getState>;
    useSettingsStore.setState({
      settings: {
        customDictionaries: [],
        dictionarySettings: {
          providerOrder: ['builtin:wikipedia', 'pending-import'],
          providerEnabled: { 'builtin:wikipedia': true, 'pending-import': true },
          webSearches: [],
        },
      } as unknown as SettingsState['settings'],
    } as unknown as SettingsState);

    const fakeAppService = { exists: vi.fn().mockResolvedValue(false) };
    const fakeEnv = {
      getAppService: () => Promise.resolve(fakeAppService),
    } as unknown as EnvConfigType;

    await useCustomDictionaryStore.getState().loadCustomDictionaries(fakeEnv);

    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes('pending-import')).toBe(true);
    expect(after.providerEnabled['pending-import']).toBe(true);
  });

  it('appends providerEnabled keys missing from providerOrder so the dict still appears in the list', async () => {
    // Real-world bug: settings replica pushes can land out of order
    // under per-field LWW (e.g. a remote device's providerEnabled push
    // landed but its providerOrder push didn't, or arrived first with
    // an older value). The UI list is driven by providerOrder, so
    // dicts present in providerEnabled but absent from providerOrder
    // would silently disappear from the picker. Append them at the
    // end so users see them with a "feel-of-dict-lost" repair.
    type SettingsState = ReturnType<typeof useSettingsStore.getState>;
    useSettingsStore.setState({
      settings: {
        customDictionaries: [],
        dictionarySettings: {
          providerOrder: ['builtin:wiktionary', 'builtin:wikipedia', 'imp-known'],
          providerEnabled: {
            'builtin:wiktionary': false,
            'builtin:wikipedia': true,
            'imp-known': true,
            'imp-orphaned-1': true,
            'imp-orphaned-2': false,
          },
          webSearches: [],
        },
      } as unknown as SettingsState['settings'],
    } as unknown as SettingsState);

    const fakeAppService = { exists: vi.fn().mockResolvedValue(false) };
    const fakeEnv = {
      getAppService: () => Promise.resolve(fakeAppService),
    } as unknown as EnvConfigType;

    await useCustomDictionaryStore.getState().loadCustomDictionaries(fakeEnv);

    const after = useCustomDictionaryStore.getState().settings;
    // Existing order is preserved; default-builtin backfill runs first.
    // Orphan providerEnabled keys are inserted BEFORE the first builtin
    // so user-imported dicts stay at the top of the list (rather than
    // stranded after the builtins where the user might miss them).
    // Existing imp-known is already after builtins (intentional user
    // choice persisted in providerOrder) so it stays put. The
    // `builtin:system` sentinel was added in the default order when
    // the system-dictionary provider landed; backfill appends it
    // after the persisted builtins on hydration.
    expect(after.providerOrder).toEqual([
      'imp-orphaned-1',
      'imp-orphaned-2',
      'builtin:wiktionary',
      'builtin:wikipedia',
      'imp-known',
      'builtin:system',
      'web:builtin:google',
      'web:builtin:urban',
      'web:builtin:merriam-webster',
      'web:builtin:goodreads',
    ]);
  });

  it('does NOT append tombstoned providerEnabled keys to providerOrder', async () => {
    // Cross-check: the existing tombstone-prune logic should remove
    // the orphan from providerEnabled BEFORE we try to append it to
    // providerOrder. Otherwise we'd resurrect a deleted dict.
    type SettingsState = ReturnType<typeof useSettingsStore.getState>;
    useSettingsStore.setState({
      settings: {
        customDictionaries: [
          {
            id: 'imp-tombstoned',
            contentId: 'content-tombstoned',
            kind: 'mdict',
            name: 'Deleted',
            bundleDir: 'imp-tombstoned',
            files: { mdx: 'x.mdx' },
            addedAt: 1,
            deletedAt: 99,
          },
        ],
        dictionarySettings: {
          providerOrder: ['builtin:wikipedia'],
          providerEnabled: { 'builtin:wikipedia': true, 'imp-tombstoned': true },
          webSearches: [],
        },
      } as unknown as SettingsState['settings'],
    } as unknown as SettingsState);

    const fakeAppService = { exists: vi.fn().mockResolvedValue(false) };
    const fakeEnv = {
      getAppService: () => Promise.resolve(fakeAppService),
    } as unknown as EnvConfigType;

    await useCustomDictionaryStore.getState().loadCustomDictionaries(fakeEnv);

    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes('imp-tombstoned')).toBe(false);
    expect('imp-tombstoned' in after.providerEnabled).toBe(false);
  });
});

describe('customDictionaryStore — fontScale (dictionary popup font size, #4443)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCustomDictionaryStore.setState({
      dictionaries: [],
      settings: {
        providerOrder: ['local-x'],
        providerEnabled: { 'local-x': true },
        webSearches: [],
      },
    });
  });

  it('setFontScale updates the in-memory setting', () => {
    const { setFontScale } = useCustomDictionaryStore.getState();
    setFontScale(1.3);
    expect(useCustomDictionaryStore.getState().settings.fontScale).toBe(1.3);
  });

  it('loadCustomDictionaries defaults fontScale to 1 when the persisted settings omit it', async () => {
    type SettingsState = ReturnType<typeof useSettingsStore.getState>;
    useSettingsStore.setState({
      settings: {
        customDictionaries: [],
        dictionarySettings: {
          providerOrder: ['builtin:wikipedia'],
          providerEnabled: { 'builtin:wikipedia': true },
          webSearches: [],
        },
      } as unknown as SettingsState['settings'],
    } as unknown as SettingsState);

    const fakeAppService = { exists: vi.fn().mockResolvedValue(false) };
    const fakeEnv = {
      getAppService: () => Promise.resolve(fakeAppService),
    } as unknown as EnvConfigType;

    await useCustomDictionaryStore.getState().loadCustomDictionaries(fakeEnv);
    expect(useCustomDictionaryStore.getState().settings.fontScale).toBe(1);
  });

  it('loadCustomDictionaries preserves a persisted fontScale', async () => {
    type SettingsState = ReturnType<typeof useSettingsStore.getState>;
    useSettingsStore.setState({
      settings: {
        customDictionaries: [],
        dictionarySettings: {
          providerOrder: ['builtin:wikipedia'],
          providerEnabled: { 'builtin:wikipedia': true },
          webSearches: [],
          fontScale: 1.15,
        },
      } as unknown as SettingsState['settings'],
    } as unknown as SettingsState);

    const fakeAppService = { exists: vi.fn().mockResolvedValue(false) };
    const fakeEnv = {
      getAppService: () => Promise.resolve(fakeAppService),
    } as unknown as EnvConfigType;

    await useCustomDictionaryStore.getState().loadCustomDictionaries(fakeEnv);
    expect(useCustomDictionaryStore.getState().settings.fontScale).toBe(1.15);
  });
});
