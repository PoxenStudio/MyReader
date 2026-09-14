import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment module
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: vi.fn(() => 'https://api.example.com'),
}));

vi.mock('@/utils/misc', () => ({
  stubTranslation: (s: string) => s,
}));

vi.mock('@/utils/lang', () => ({
  normalizeToShortLang: vi.fn((lang: string) => {
    const map: Record<string, string> = {
      'en-US': 'en',
      'fr-FR': 'fr',
      'zh-CN': 'zh',
      AUTO: 'auto',
      en: 'en',
      fr: 'fr',
      de: 'de',
      zh: 'zh',
      auto: 'auto',
    };
    return map[lang] ?? lang;
  }),
  normalizeToFullLang: vi.fn((lang: string) => {
    const map: Record<string, string> = {
      en: 'en',
      fr: 'fr',
      de: 'de',
      zh: 'zh-Hans',
      auto: 'auto',
    };
    return map[lang] ?? lang;
  }),
}));

// Mock Tauri HTTP plugin
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// Stub Supabase so importing the full providers registry doesn't instantiate
// a real GoTrueClient on every `vi.resetModules()` round. Without this, each
// test that dynamically imports the registry logs a "Multiple GoTrueClient
// instances" warning from the real Supabase client.
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Edge Translator Provider
// ---------------------------------------------------------------------------
describe('edgeProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const { edgeProvider } = await import('@/services/translators/providers/edge');
    const result = await edgeProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates all texts in a single batched request without a token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { translations: [{ text: 'Bonjour' }] },
        { translations: [{ text: 'Monde' }] },
      ],
    });

    const { edgeProvider } = await import('@/services/translators/providers/edge');
    const result = await edgeProvider.translate(['Hello', 'World'], 'en', 'fr');
    expect(result).toEqual(['Bonjour', 'Monde']);
    // A single request for the whole batch — no separate auth call.
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [translateUrl, translateOpts] = mockFetch.mock.calls[0]!;
    expect(translateUrl).toContain('https://edge.microsoft.com/translate/translatetext');
    expect(translateOpts.headers['Authorization']).toBeUndefined();
    const body = JSON.parse(translateOpts.body);
    expect(body).toEqual(['Hello', 'World']);
  });

  it('preserves empty strings without sending them to the API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ translations: [{ text: 'Monde' }] }],
    });

    const { edgeProvider } = await import('@/services/translators/providers/edge');
    const result = await edgeProvider.translate(['', 'World'], 'en', 'fr');
    expect(result[0]).toBe('');
    expect(result[1]).toBe('Monde');

    const [, translateOpts] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(translateOpts.body);
    expect(body).toEqual(['World']);
  });

  it('throws when the translation request fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { edgeProvider } = await import('@/services/translators/providers/edge');
    await expect(edgeProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'Translation failed with status 500',
    );
  });

  it('falls back to original text when response format is unexpected', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { edgeProvider } = await import('@/services/translators/providers/edge');
    const result = await edgeProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  it('has correct provider metadata', async () => {
    const { edgeProvider } = await import('@/services/translators/providers/edge');
    expect(edgeProvider.name).toBe('edge');
    expect(edgeProvider.label).toBe('Edge Translator');
  });
});

// ---------------------------------------------------------------------------
// Provider registry — disabled providers stay visible but unselectable
// ---------------------------------------------------------------------------
describe('provider registry disabled handling', () => {
  // No `vi.resetModules()` here — these tests only inspect static provider
  // metadata, so resolving the registry once is enough. Resetting between
  // each test would re-evaluate the full import chain and churn module
  // state for no benefit.

  it('isTranslatorAvailable returns false for disabled providers', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const disabled = { name: 'x', label: 'X', disabled: true, translate: async () => [] };
    expect(isTranslatorAvailable(disabled, true)).toBe(false);
    expect(isTranslatorAvailable(disabled, false)).toBe(false);
  });

  it('isTranslatorAvailable returns false for authRequired without token', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const authed = { name: 'x', label: 'X', authRequired: true, translate: async () => [] };
    expect(isTranslatorAvailable(authed, false)).toBe(false);
    expect(isTranslatorAvailable(authed, true)).toBe(true);
  });

  it('getTranslatorDisplayLabel returns the plain label for healthy providers', async () => {
    const { getTranslator, getTranslatorDisplayLabel } = await import(
      '@/services/translators/providers'
    );
    const edge = getTranslator('edge')!;
    expect(getTranslatorDisplayLabel(edge, true, (s) => s)).toBe('Edge Translator');
  });
});
