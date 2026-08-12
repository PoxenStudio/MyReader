import { describe, test, expect, beforeEach } from 'vitest';
import {
  setEmbedReturnUrl,
  consumeEmbedReturnUrl,
  resolveEmbedReturnUrlFromLocation,
  hasEmbedReturnUrl,
} from '@/utils/embedReturn';

describe('embedReturn', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test('consumeEmbedReturnUrl returns null when nothing was stashed', () => {
    expect(consumeEmbedReturnUrl('cloud-42-epub')).toBeNull();
  });

  test('stores and returns the return URL for its book hash', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    expect(consumeEmbedReturnUrl('cloud-42-epub')).toBe('/book/42');
  });

  test('consuming clears the value so it is only used once', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    consumeEmbedReturnUrl('cloud-42-epub');
    expect(consumeEmbedReturnUrl('cloud-42-epub')).toBeNull();
  });

  test('keys by book hash, does not leak across books', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    expect(consumeEmbedReturnUrl('cloud-7-epub')).toBeNull();
    expect(consumeEmbedReturnUrl('cloud-42-epub')).toBe('/book/42');
  });
});

describe('hasEmbedReturnUrl', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test('is false when nothing was stashed', () => {
    expect(hasEmbedReturnUrl('cloud-42-epub')).toBe(false);
  });

  test('is true after setEmbedReturnUrl, without consuming it', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    expect(hasEmbedReturnUrl('cloud-42-epub')).toBe(true);
    expect(hasEmbedReturnUrl('cloud-42-epub')).toBe(true);
    expect(consumeEmbedReturnUrl('cloud-42-epub')).toBe('/book/42');
  });
});

describe('resolveEmbedReturnUrlFromLocation', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test('resolves the return URL from a /reader/:ids pathname', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    expect(resolveEmbedReturnUrlFromLocation('/reader/cloud-42-epub', '')).toBe('/book/42');
  });

  test('resolves the return URL from a ?ids= query param', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    expect(resolveEmbedReturnUrlFromLocation('/reader', '?ids=cloud-42-epub')).toBe('/book/42');
  });

  test('uses only the first id when multiple books are open', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    expect(resolveEmbedReturnUrlFromLocation('/reader/cloud-42-epub+cloud-7-epub', '')).toBe(
      '/book/42',
    );
  });

  test('returns null when no book was opened via the embedded flow', () => {
    expect(resolveEmbedReturnUrlFromLocation('/reader/cloud-42-epub', '')).toBeNull();
  });

  test('returns null outside the reader route', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    expect(resolveEmbedReturnUrlFromLocation('/library', '')).toBeNull();
  });
});
