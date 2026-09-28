import { describe, it, expect } from 'vitest';
import {
  applySiteDefaults,
  reconcileSiteDicts,
  syncWithSiteConfig,
  type SiteDictConfig,
} from '@/services/dictionaries/siteDictionaries';
import type { DictionarySettings } from '@/services/dictionaries/types';

const CONFIG: SiteDictConfig = {
  mybooks: false,
  baike: true,
  mydicts: [
    { id: 'a', name: 'Han', enabled: true },
    { id: 'b', name: 'Eng', enabled: false },
  ],
};

const base = (patch: Partial<DictionarySettings> = {}): DictionarySettings => ({
  providerOrder: [
    'builtin:mybooks',
    'builtin:baidu-baike',
    'builtin:wiktionary',
    'mydict:mine',
    'imp1',
    'web:builtin:google',
  ],
  providerEnabled: {
    'builtin:mybooks': true,
    'builtin:baidu-baike': true,
    'builtin:wiktionary': true,
    'mydict:mine': true,
    imp1: true,
    'web:builtin:google': false,
  },
  myDicts: [{ id: 'mydict:mine', name: 'Mine', url: 'http://x', token: 't' }],
  serverDicts: [],
  ...patch,
});

describe('reconcileSiteDicts', () => {
  it('appends new site dictionaries with the admin default', () => {
    const next = reconcileSiteDicts(base(), CONFIG);
    expect(next.providerOrder.slice(-2)).toEqual(['server:a', 'server:b']);
    expect(next.providerEnabled['server:a']).toBe(true);
    expect(next.providerEnabled['server:b']).toBe(false);
    expect(next.serverDicts).toEqual([
      { id: 'server:a', siteId: 'a', name: 'Han' },
      { id: 'server:b', siteId: 'b', name: 'Eng' },
    ]);
    // Everything else keeps the user's own state.
    expect(next.providerEnabled['builtin:mybooks']).toBe(true);
    expect(next.providerEnabled['mydict:mine']).toBe(true);
  });

  it("keeps the user's toggle and position for a site dictionary already seen", () => {
    const seen = base({
      providerOrder: ['server:b', 'builtin:mybooks', 'server:a'],
      providerEnabled: { 'server:a': false, 'server:b': true, 'builtin:mybooks': true },
      serverDicts: [
        { id: 'server:a', siteId: 'a', name: 'Han' },
        { id: 'server:b', siteId: 'b', name: 'Eng' },
      ],
    });
    expect(reconcileSiteDicts(seen, CONFIG)).toBe(seen);
  });

  it('drops site dictionaries the admin deleted and picks up renames', () => {
    const stale = base({
      providerOrder: ['server:gone', 'server:a', 'builtin:mybooks'],
      providerEnabled: { 'server:gone': true, 'server:a': false, 'builtin:mybooks': true },
      serverDicts: [
        { id: 'server:gone', siteId: 'gone', name: 'Gone' },
        { id: 'server:a', siteId: 'a', name: 'Old name' },
      ],
      defaultProviderId: 'server:gone',
    });
    const next = reconcileSiteDicts(stale, { ...CONFIG, mydicts: [CONFIG.mydicts[0]!] });
    expect(next.providerOrder).toEqual(['server:a', 'builtin:mybooks']);
    expect('server:gone' in next.providerEnabled).toBe(false);
    expect(next.providerEnabled['server:a']).toBe(false);
    expect(next.serverDicts).toEqual([{ id: 'server:a', siteId: 'a', name: 'Han' }]);
    expect(next.defaultProviderId).toBeUndefined();
  });

  it('leaves the env-configured server dictionary as it was', () => {
    const current = base({
      providerOrder: ['builtin:mydict-server', ...base().providerOrder],
      providerEnabled: { ...base().providerEnabled, 'builtin:mydict-server': true },
    });
    const next = syncWithSiteConfig(current, CONFIG);
    expect(next.providerOrder).toContain('builtin:mydict-server');
    expect(next.providerEnabled['builtin:mydict-server']).toBe(true);
  });
});

describe('applySiteDefaults', () => {
  it("adds the site dictionaries and takes the admin's MyBooks / Baike flags", () => {
    const next = applySiteDefaults(base(), CONFIG);
    expect(next.providerEnabled['builtin:mybooks']).toBe(false);
    expect(next.providerEnabled['builtin:baidu-baike']).toBe(true);
    expect(next.providerEnabled['server:a']).toBe(true);
    // Other providers keep their built-in defaults.
    expect(next.providerEnabled['builtin:wiktionary']).toBe(true);
  });
});

describe('syncWithSiteConfig', () => {
  it('applies the server state and disables everything else without deleting it', () => {
    const current = base({
      providerOrder: ['server:gone', ...base().providerOrder],
      providerEnabled: { ...base().providerEnabled, 'server:gone': true },
      serverDicts: [{ id: 'server:gone', siteId: 'gone', name: 'Gone' }],
      defaultProviderId: 'builtin:wiktionary',
    });
    const next = syncWithSiteConfig(current, CONFIG);

    // Server-sourced first, enabled before disabled; the rest keep their order.
    expect(next.providerOrder).toEqual([
      'server:a',
      'builtin:baidu-baike',
      'builtin:mybooks',
      'server:b',
      'builtin:wiktionary',
      'mydict:mine',
      'imp1',
      'web:builtin:google',
    ]);
    expect(next.providerEnabled).toEqual({
      'server:a': true,
      'builtin:baidu-baike': true,
      'builtin:mybooks': false,
      'server:b': false,
      'builtin:wiktionary': false,
      'mydict:mine': false,
      imp1: false,
      'web:builtin:google': false,
    });
    // The user's own MyDict server is kept, only turned off.
    expect(next.myDicts).toEqual(current.myDicts);
    expect(next.serverDicts?.map((d) => d.id)).toEqual(['server:a', 'server:b']);
    expect(next.defaultProviderId).toBeUndefined();
  });

  it('leaves the env-configured server dictionary as it was', () => {
    const current = base({
      providerOrder: ['builtin:mydict-server', ...base().providerOrder],
      providerEnabled: { ...base().providerEnabled, 'builtin:mydict-server': true },
    });
    const next = syncWithSiteConfig(current, CONFIG);
    expect(next.providerOrder).toContain('builtin:mydict-server');
    expect(next.providerEnabled['builtin:mydict-server']).toBe(true);
  });
});
