import { describe, test, expect, beforeEach } from 'vitest';
import { setEmbedReturnUrl, consumeEmbedReturnUrl } from '@/utils/embedReturn';

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
