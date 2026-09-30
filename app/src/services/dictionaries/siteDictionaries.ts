/**
 * Site dictionaries — the dictionary defaults a MyBooks admin configures for
 * the embedded web reader (MyBooks settings → reader → dictionaries):
 * whether the MyBooks dictionary and Baidu Baike start enabled, plus a list
 * of MyDict servers that MyBooks itself queries on the reader's behalf.
 *
 * The admin's flags are defaults, never access control. They are applied:
 *   - on first run, when this browser has no dictionary settings and the
 *     user has no synced copy either ({@link applySiteDefaults});
 *   - when the user runs "Sync Dictionary Settings" ({@link syncWithSiteConfig}),
 *     which makes the server's picture authoritative and turns every other
 *     dictionary off (disabled, not deleted);
 *   - partially on every load ({@link reconcileSiteDicts}): site dictionaries
 *     the admin added since are appended with their default, deleted ones are
 *     dropped (their lookups would only 404), and the rest keep the user's
 *     own toggle.
 *
 * The web build goes through our relay; the Tauri apps call MyBooks directly.
 */
import { isTauriAppPlatform } from '@/services/environment';
import type { DictionarySettings, SiteDictEntry } from './types';
import { BUILTIN_PROVIDER_IDS, SITE_DICT_PREFIX } from './types';

/** Public view served by MyBooks' `GET /api/reader/dict-config`. */
export interface SiteDictConfig {
  mybooks: boolean;
  baike: boolean;
  mydicts: { id: string; name: string; enabled: boolean }[];
}

const MYBOOKS_HOST_KEY = 'mybooks_host';

/**
 * Same-origin base for MyBooks' site-dictionary API, relayed by
 * `app/api/mybooks/site-dict/[...path]` so it works whether or not MyReader
 * and MyBooks share an origin. The MyBooks host rides in the path (not the
 * query) because entry stylesheets reference their fonts/images relatively,
 * and a relative URL drops the query string. `null` without a MyBooks
 * connection.
 */
export const getSiteDictApiBase = (): string | null => {
  const host = getMyBooksHost();
  return host ? `/api/mybooks/site-dict/${encodeURIComponent(host)}` : null;
};

const getMyBooksHost = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(MYBOOKS_HOST_KEY)?.replace(/\/+$/, '') || null;
  } catch {
    return null;
  }
};

/** Base of one site dictionary; `<base>/query` and `<base>/res` hang off it. */
export const getSiteDictBase = (siteId: string): string | null => {
  const id = encodeURIComponent(siteId);
  if (isTauriAppPlatform()) {
    const host = getMyBooksHost();
    return host ? `${host}/api/reader/dict/${id}` : null;
  }
  const base = getSiteDictApiBase();
  return base ? `${base}/${id}` : null;
};

const getSiteDictConfigUrl = (): string | null => {
  if (isTauriAppPlatform()) {
    const host = getMyBooksHost();
    return host ? `${host}/api/reader/dict-config` : null;
  }
  const base = getSiteDictApiBase();
  return base ? `${base}/config` : null;
};

/** Tauri: plugin-http with the MyBooks session; web: the same-origin relay. */
export const fetchSiteDict = async (
  url: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; json?: unknown; signal?: AbortSignal } = {},
): Promise<Response> => {
  const { method = 'GET', json, signal } = init;
  const body = json === undefined ? undefined : JSON.stringify(json);
  const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
  if (!isTauriAppPlatform()) {
    return fetch(url, { method, headers, body, credentials: 'include', signal });
  }
  const [{ fetch: tauriFetch }, { buildMyBooksCookieHeaders }] = await Promise.all([
    import('@tauri-apps/plugin-http'),
    import('@/services/mybooks/cookieHeaders'),
  ]);
  return tauriFetch(url, {
    method,
    headers: { ...headers, ...buildMyBooksCookieHeaders(url) },
    body,
    signal,
  });
};

export const siteDictProviderId = (siteId: string): string => `${SITE_DICT_PREFIX}${siteId}`;

const isSiteDictConfig = (value: unknown): value is SiteDictConfig => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SiteDictConfig>;
  return (
    typeof v.mybooks === 'boolean' &&
    typeof v.baike === 'boolean' &&
    Array.isArray(v.mydicts) &&
    v.mydicts.every(
      (d) =>
        d &&
        typeof d.id === 'string' &&
        typeof d.name === 'string' &&
        typeof d.enabled === 'boolean',
    )
  );
};

/** Fetch the admin's dictionary config; `null` when unreachable or malformed. */
export const fetchSiteDictConfig = async (): Promise<SiteDictConfig | null> => {
  const url = getSiteDictConfigUrl();
  if (!url) return null;
  try {
    const res = await fetchSiteDict(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isSiteDictConfig(data) ? data : null;
  } catch {
    return null;
  }
};

const toEntries = (config: SiteDictConfig): SiteDictEntry[] =>
  config.mydicts.map((d) => ({ id: siteDictProviderId(d.id), siteId: d.id, name: d.name }));

/**
 * Bring the site dictionaries in line with the admin's list while keeping the
 * user's own choices: new ones are appended with the admin's default, removed
 * ones are dropped, renamed ones pick up the new name. Returns the input
 * object unchanged when nothing differs, so callers can skip a save.
 */
export const reconcileSiteDicts = (
  settings: DictionarySettings,
  config: SiteDictConfig,
): DictionarySettings => {
  const next = toEntries(config);
  const nextIds = new Set(next.map((e) => e.id));
  const seen = new Set((settings.serverDicts ?? []).map((e) => e.id));

  const providerOrder = settings.providerOrder.filter(
    (id) => !id.startsWith(SITE_DICT_PREFIX) || nextIds.has(id),
  );
  const providerEnabled = Object.fromEntries(
    Object.entries(settings.providerEnabled).filter(
      ([id]) => !id.startsWith(SITE_DICT_PREFIX) || nextIds.has(id),
    ),
  );
  const inOrder = new Set(providerOrder);
  config.mydicts.forEach((d) => {
    const id = siteDictProviderId(d.id);
    if (!seen.has(id) || !(id in providerEnabled)) providerEnabled[id] = d.enabled;
    if (!inOrder.has(id)) {
      providerOrder.push(id);
      inOrder.add(id);
    }
  });

  const unchanged =
    providerOrder.length === settings.providerOrder.length &&
    providerOrder.every((id, i) => id === settings.providerOrder[i]) &&
    Object.keys(providerEnabled).length === Object.keys(settings.providerEnabled).length &&
    Object.entries(providerEnabled).every(([id, on]) => settings.providerEnabled[id] === on) &&
    JSON.stringify(next) === JSON.stringify(settings.serverDicts ?? []);
  if (unchanged) return settings;

  return {
    ...settings,
    providerOrder,
    providerEnabled,
    serverDicts: next,
    defaultProviderId:
      settings.defaultProviderId?.startsWith(SITE_DICT_PREFIX) &&
      !nextIds.has(settings.defaultProviderId)
        ? undefined
        : settings.defaultProviderId,
  };
};

/**
 * First-run defaults: the site dictionaries plus the admin's MyBooks / Baidu
 * Baike flags on top of the built-in defaults. Everything else keeps its
 * built-in default.
 */
export const applySiteDefaults = (
  settings: DictionarySettings,
  config: SiteDictConfig,
): DictionarySettings => {
  const reconciled = reconcileSiteDicts(settings, config);
  return {
    ...reconciled,
    providerEnabled: {
      ...reconciled.providerEnabled,
      [BUILTIN_PROVIDER_IDS.myBooks]: config.mybooks,
      [BUILTIN_PROVIDER_IDS.baiduBaike]: config.baike,
    },
  };
};

/**
 * "Sync Dictionary Settings": make the server's picture authoritative.
 *
 *  - MyBooks dictionary / Baidu Baike / site dictionaries take the admin's
 *    flags; the admin's list replaces the local one outright.
 *  - Every other provider (Wiktionary, Wikipedia, web searches, the system
 *    dictionary, the user's own MyDict servers, imported dictionaries) is
 *    turned off — but kept, so the user can switch it back on. The
 *    env-configured server dictionary (`mydictServer`, transitional) is
 *    server-side config too and keeps its current toggle.
 *  - The server-sourced ones move to the top, enabled before disabled, in
 *    the order MyBooks → site dictionaries → Baidu Baike; the rest keep
 *    their relative order.
 */
export const syncWithSiteConfig = (
  settings: DictionarySettings,
  config: SiteDictConfig,
): DictionarySettings => {
  const serverDicts = toEntries(config);
  const serverEnabled = new Map<string, boolean>([
    [BUILTIN_PROVIDER_IDS.myBooks, config.mybooks],
    ...config.mydicts.map((d) => [siteDictProviderId(d.id), d.enabled] as [string, boolean]),
    [BUILTIN_PROVIDER_IDS.baiduBaike, config.baike],
  ]);
  const serverIds = [...serverEnabled.keys()];
  const head = [
    ...serverIds.filter((id) => serverEnabled.get(id)),
    ...serverIds.filter((id) => !serverEnabled.get(id)),
  ];
  const rest = settings.providerOrder.filter(
    (id) => !serverEnabled.has(id) && !id.startsWith(SITE_DICT_PREFIX),
  );
  const providerOrder = [...head, ...rest];
  const providerEnabled: Record<string, boolean> = {};
  for (const id of providerOrder) providerEnabled[id] = serverEnabled.get(id) ?? false;
  const legacyId = BUILTIN_PROVIDER_IDS.mydictServer;
  if (legacyId in providerEnabled) {
    providerEnabled[legacyId] = settings.providerEnabled[legacyId] !== false;
  }

  return {
    ...settings,
    providerOrder,
    providerEnabled,
    serverDicts,
    // The last-used tab may now be off; let the popup pick the first enabled.
    defaultProviderId: undefined,
  };
};
