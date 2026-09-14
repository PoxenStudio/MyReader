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
// Yandex Translate Provider
// ---------------------------------------------------------------------------
describe('yandexProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates text using yandexgpt service', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: ['Bonjour'],
      }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);

    // Verify request format
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://translate.toil.cc/v2/translate/');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.service).toBe('yandexgpt');
    expect(body.lang).toBe('en-fr');
  });

  it('uses "en" when source language is AUTO', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: ['Bonjour'],
      }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await yandexProvider.translate(['Hello'], 'AUTO', 'fr');

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.lang).toBe('en-fr');
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limited' }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    await expect(yandexProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'yandexgpt failed with status 429',
    );
  });

  it('falls back to original text when translations array is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  it('has correct provider metadata', async () => {
    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    expect(yandexProvider.name).toBe('yandex');
    expect(yandexProvider.label).toBe('Yandex Translate');
    expect(yandexProvider.authRequired).toBe(false);
  });

  it('translates multiple texts in parallel', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: ['Translated'],
      }),
    });

    const { yandexProvider } = await import('@/services/translators/providers/yandex');
    const result = await yandexProvider.translate(['Hello', 'World'], 'en', 'fr');
    expect(result).toEqual(['Translated', 'Translated']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

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

  it('keeps yandex in getTranslators() so the UI can render it', async () => {
    const { getTranslators } = await import('@/services/translators/providers');
    const names = getTranslators().map((t) => t.name);
    expect(names).toContain('yandex');
  });

  it('exposes yandex as disabled so callers can grey it out', async () => {
    const { getTranslator } = await import('@/services/translators/providers');
    const yandex = getTranslator('yandex');
    expect(yandex).toBeDefined();
    expect(yandex!.disabled).toBe(true);
  });

  it('isTranslatorAvailable returns false for disabled providers', async () => {
    const { getTranslator, isTranslatorAvailable } = await import(
      '@/services/translators/providers'
    );
    const yandex = getTranslator('yandex')!;
    expect(isTranslatorAvailable(yandex, true)).toBe(false);
    expect(isTranslatorAvailable(yandex, false)).toBe(false);
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
